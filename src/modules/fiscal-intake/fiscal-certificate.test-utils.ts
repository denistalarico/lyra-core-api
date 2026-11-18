import { generateKeyPairSync } from 'crypto';
import * as forge from 'node-forge';
import { ICP_BRASIL_CNPJ_OID } from './fiscal-certificate.inspector';

/**
 * Spec helper: a self-signed "e-CNPJ" A1 packed as PKCS#12. Not imported by
 * runtime code. The key comes from Node's crypto (fast) and is converted to
 * forge only to sign and pack.
 */
export function buildTestPfx(options: {
  password: string;
  cnpj?: string | null;
  icpBrasil?: boolean;
  notBefore?: Date;
  notAfter?: Date;
  legalName?: string;
  cnpjInCommonName?: boolean;
}): Buffer {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
  });
  const key = forge.pki.privateKeyFromPem(
    privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  );
  const pub = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  );

  const cert = forge.pki.createCertificate();
  cert.publicKey = pub;
  cert.serialNumber = '01ab';
  cert.validity.notBefore =
    options.notBefore ?? new Date(Date.now() - 86_400_000);
  cert.validity.notAfter =
    options.notAfter ?? new Date(Date.now() + 200 * 86_400_000);
  const cnpj = options.cnpj === undefined ? '11222333000181' : options.cnpj;
  const name = options.legalName ?? 'EMPRESA TESTE LTDA';
  const attrs = [
    {
      shortName: 'CN',
      value:
        cnpj && options.cnpjInCommonName !== false ? `${name}:${cnpj}` : name,
    },
    {
      shortName: 'O',
      value: options.icpBrasil === false ? 'Outra AC' : 'ICP-Brasil',
    },
    { shortName: 'C', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer([
    { shortName: 'CN', value: 'AC TESTE RFB v5' },
    {
      shortName: 'O',
      value: options.icpBrasil === false ? 'Outra AC' : 'ICP-Brasil',
    },
  ]);
  if (cnpj) {
    const { asn1 } = forge;
    const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer(ICP_BRASIL_CNPJ_OID).getBytes(),
      ),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, cnpj),
      ]),
    ]);
    cert.setExtensions([
      {
        id: '2.5.29.17',
        name: 'subjectAltName',
        value: asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          otherName,
        ]),
      },
    ]);
  }
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], options.password, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}
