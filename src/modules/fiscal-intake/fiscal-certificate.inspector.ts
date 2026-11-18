import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as forge from 'node-forge';
import {
  FISCAL_CERTIFICATE_MAX_BYTES,
  type FiscalCertificateMeta,
  onlyDigits,
} from './fiscal-intake.types';

/** ICP-Brasil otherName in subjectAltName that carries the company's CNPJ. */
export const ICP_BRASIL_CNPJ_OID = '2.16.76.1.3.3';

type Inspection = { meta: FiscalCertificateMeta; icpBrasil: boolean };

function attr(
  cert: forge.pki.Certificate,
  field: 'subject' | 'issuer',
  shortName: string,
) {
  const found = cert[field].attributes.filter((a) => a.shortName === shortName);
  return found.map((a) => String(a.value ?? '')).filter(Boolean);
}

/** Bytes of an ASN.1 primitive, flattening a constructed string if needed. */
function asn1Bytes(node: forge.asn1.Asn1): string {
  if (typeof node.value === 'string') return node.value;
  return node.value.map(asn1Bytes).join('');
}

/** Reads the CNPJ from subjectAltName → otherName (2.16.76.1.3.3). */
export function cnpjFromSubjectAltName(
  cert: forge.pki.Certificate,
): string | null {
  const extension = cert.getExtension('subjectAltName') as
    | { value?: string }
    | undefined;
  if (!extension?.value || typeof extension.value !== 'string') return null;
  try {
    const sequence = forge.asn1.fromDer(extension.value);
    if (!Array.isArray(sequence.value)) return null;
    for (const general of sequence.value) {
      // otherName = [0] { type-id OID, [0] EXPLICIT value }
      if (
        general.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC ||
        // context-specific tag number 0 (forge types `type` as the universal enum)
        Number(general.type) !== 0
      )
        continue;
      if (!Array.isArray(general.value) || general.value.length < 2) continue;
      const [oidNode, wrapped] = general.value;
      if (typeof oidNode.value !== 'string') continue;
      if (forge.asn1.derToOid(oidNode.value) !== ICP_BRASIL_CNPJ_OID) continue;
      const inner = Array.isArray(wrapped.value) ? wrapped.value[0] : wrapped;
      const digits = onlyDigits(asn1Bytes(inner));
      if (digits.length >= 14) return digits.slice(0, 14);
    }
  } catch {
    return null;
  }
  return null;
}

function pickLeaf(
  certs: forge.pki.Certificate[],
  key: forge.pki.PrivateKey | null,
) {
  if (key && 'n' in key) {
    const rsaKey = key;
    const match = certs.find((cert) => {
      const pub = cert.publicKey as forge.pki.rsa.PublicKey;
      return Boolean(pub?.n) && pub.n.equals(rsaKey.n);
    });
    if (match) return match;
  }
  // Fallback: the certificate that is not the issuer of any other in the bundle.
  return (
    certs.find(
      (cert) => !certs.some((other) => other !== cert && cert.isIssuer(other)),
    ) ?? certs[0]
  );
}

/**
 * Opens the PKCS#12 and reads what the agency needs to see (§8.3). Nothing is
 * stored here; the caller encrypts the original bytes. Errors carry messages
 * fit for the accountant and never echo the password.
 */
export function inspectCertificate(
  file: Buffer,
  password: string,
  fileName: string | null = null,
): Inspection {
  if (!file.length || file.length > FISCAL_CERTIFICATE_MAX_BYTES)
    throw new BadRequestException(
      'O arquivo do certificado deve ter até 50 KB.',
    );

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(file.toString('binary')),
    );
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (error) {
    const message = (error as Error)?.message ?? '';
    if (/mac|password|decrypt|invalid/i.test(message))
      throw new BadRequestException(
        'Senha do certificado incorreta ou arquivo inválido.',
      );
    throw new BadRequestException(
      'Não foi possível ler o arquivo. Envie o certificado A1 (.pfx ou .p12).',
    );
  }

  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ??
    [];
  const certs = certBags
    .map((bag) => bag.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[
      forge.pki.oids.keyBag
    ] ?? []),
  ];
  const key = keyBags.find((bag) => bag.key)?.key ?? null;
  if (!certs.length)
    throw new BadRequestException('O arquivo não contém certificado.');
  if (!key)
    throw new BadRequestException(
      'O arquivo não contém a chave privada. Exporte o A1 com a chave.',
    );

  const leaf = pickLeaf(certs, key);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();
  const subjectCn = attr(leaf, 'subject', 'CN')[0] ?? '';
  const organizations = [
    ...attr(leaf, 'subject', 'O'),
    ...attr(leaf, 'issuer', 'O'),
  ];
  const cnpj =
    cnpjFromSubjectAltName(leaf) ??
    /:(\d{14})\s*$/.exec(subjectCn)?.[1] ??
    null;

  return {
    icpBrasil: organizations.some((o) => /icp-brasil/i.test(o)),
    meta: {
      holder: subjectCn.replace(/:\d{14}\s*$/, '').trim() || subjectCn,
      cnpj,
      issuer:
        attr(leaf, 'issuer', 'CN')[0] ?? attr(leaf, 'issuer', 'O')[0] ?? '',
      serialNumber: leaf.serialNumber,
      validFrom: leaf.validity.notBefore.toISOString(),
      validTo: leaf.validity.notAfter.toISOString(),
      fingerprintSha256: createHash('sha256')
        .update(Buffer.from(der, 'binary'))
        .digest('hex'),
      fileName: fileName ? fileName.slice(0, 200) : null,
      sizeBytes: file.length,
    },
  };
}

/** §8.3 rules on top of the inspection: valid now, ICP-Brasil e-CNPJ, same CNPJ. */
export function assertCertificateAcceptable(
  inspection: Inspection,
  expectedCnpj: string | null,
  now = new Date(),
): FiscalCertificateMeta {
  const { meta, icpBrasil } = inspection;
  if (new Date(meta.validTo) <= now)
    throw new BadRequestException('O certificado está vencido.');
  if (new Date(meta.validFrom) > now)
    throw new BadRequestException('O certificado ainda não está válido.');
  if (!icpBrasil || !meta.cnpj)
    throw new BadRequestException(
      'Envie um certificado ICP-Brasil do tipo e-CNPJ (A1).',
    );
  if (expectedCnpj && meta.cnpj !== onlyDigits(expectedCnpj))
    throw new BadRequestException(
      'O CNPJ do certificado é diferente do CNPJ informado.',
    );
  return meta;
}
