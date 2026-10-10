// Derives the signing parties of a contract from its variables when none were
// registered by hand. Pure: the caller passes a path reader bound to the
// contract's variables (so the service's alias rules apply) and the signature
// provider settings metadata (the "Responsável pela assinatura" fallback).

import { ContractPartyRole, ContractTargetType } from '../enums';

export type SignerCandidate = {
  role: ContractPartyRole;
  name: string | null;
  email: string | null;
  signatureOrder: number;
  userId: string | null;
};

export type SignatureReadinessIssue = {
  code: string;
  message: string;
};

type PathReader = (path: string) => unknown;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSignerEmail(value: string | null | undefined) {
  return Boolean(value && value.length <= 180 && EMAIL_PATTERN.test(value));
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  // `client.signatory` may be stored nested as `{ name, email, ... }`.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
}

function firstText(read: PathReader, paths: string[]) {
  for (const path of paths) {
    const value = text(read(path));
    if (value) return value;
  }
  return null;
}

function firstEmail(read: PathReader, paths: string[]) {
  for (const path of paths) {
    const value = read(path);
    if (typeof value === 'string' && value.trim())
      return value.trim().toLowerCase();
  }
  return null;
}

export function deriveSignatureParties(input: {
  targetType: ContractTargetType;
  read: PathReader;
  settingsMetadata: Record<string, unknown> | null | undefined;
}): { signers: SignerCandidate[]; issues: SignatureReadinessIssue[] } {
  const { read } = input;
  const settings = input.settingsMetadata ?? {};
  const issues: SignatureReadinessIssue[] = [];

  const settingsSignerName = text(settings.contractSignerName);
  const settingsSignerEmail =
    typeof settings.contractSignerEmail === 'string' &&
    settings.contractSignerEmail.trim()
      ? settings.contractSignerEmail.trim().toLowerCase()
      : null;
  const settingsSignerUserId =
    typeof settings.contractSignerUserId === 'string' &&
    settings.contractSignerUserId.trim()
      ? settings.contractSignerUserId.trim()
      : null;

  const agencyName =
    firstText(read, ['agency.signerName', 'agency.representative']) ??
    settingsSignerName;
  const agencyEmail =
    firstEmail(read, ['agency.signerEmail']) ?? settingsSignerEmail;

  const signers: SignerCandidate[] = [
    {
      role: ContractPartyRole.Company,
      name: agencyName,
      email: agencyEmail,
      signatureOrder: 1,
      // Only link the platform user when the e-mail really is theirs.
      userId:
        settingsSignerUserId &&
        agencyEmail &&
        agencyEmail === settingsSignerEmail
          ? settingsSignerUserId
          : null,
    },
  ];

  if (input.targetType === ContractTargetType.Client) {
    signers.push({
      role: ContractPartyRole.Client,
      name: firstText(read, ['client.signatory', 'client.signatory.name']),
      email: firstEmail(read, ['client.signatory.email']),
      signatureOrder: 2,
      userId: null,
    });
  } else if (input.targetType === ContractTargetType.TeamMember) {
    signers.push({
      role: ContractPartyRole.TeamMember,
      name: firstText(read, [
        'contractor.fullName',
        'member.displayName',
        'member.name',
      ]),
      email: firstEmail(read, ['member.email', 'contractor.email']),
      signatureOrder: 2,
      userId: null,
    });
  } else {
    issues.push({
      code: 'unsupported_target',
      message:
        'Este tipo de contrato não tem regra automática de signatários. Cadastre as partes manualmente.',
    });
  }

  issues.push(...validateSigners(signers));
  return { signers, issues };
}

const ROLE_LABEL: Partial<Record<ContractPartyRole, string>> = {
  [ContractPartyRole.Company]: 'agência',
  [ContractPartyRole.Client]: 'cliente',
  [ContractPartyRole.TeamMember]: 'membro',
};

const ROLE_HINT: Partial<
  Record<ContractPartyRole, { name: string; email: string }>
> = {
  [ContractPartyRole.Company]: {
    name: 'Preencha "Responsável pela assinatura" (agency.signerName) ou escolha o responsável em Geração de contratos.',
    email:
      'Preencha o e-mail do responsável pela assinatura (agency.signerEmail).',
  },
  [ContractPartyRole.Client]: {
    name: 'Preencha o signatário do cliente (client.signatory).',
    email:
      'Preencha o e-mail do signatário do cliente (client.signatory.email).',
  },
  [ContractPartyRole.TeamMember]: {
    name: 'Preencha o nome do prestador (contractor.fullName).',
    email: 'Preencha o e-mail do membro (member.email).',
  },
};

export function validateSigners(
  signers: Array<Pick<SignerCandidate, 'role' | 'name' | 'email'>>,
): SignatureReadinessIssue[] {
  const issues: SignatureReadinessIssue[] = [];
  const seenEmails = new Set<string>();

  for (const signer of signers) {
    const label = ROLE_LABEL[signer.role] ?? signer.role;
    const hint = ROLE_HINT[signer.role];

    if (!signer.name) {
      issues.push({
        code: `${signer.role}_name_missing`,
        message: hint?.name ?? `Nome do signatário (${label}) ausente.`,
      });
    }

    if (!signer.email) {
      issues.push({
        code: `${signer.role}_email_missing`,
        message: hint?.email ?? `E-mail do signatário (${label}) ausente.`,
      });
    } else if (!isValidSignerEmail(signer.email)) {
      issues.push({
        code: `${signer.role}_email_invalid`,
        message: `E-mail do signatário (${label}) inválido: ${signer.email}`,
      });
    } else {
      const email = signer.email.toLowerCase();
      if (seenEmails.has(email)) {
        issues.push({
          code: 'duplicate_signer_email',
          message: `O e-mail ${email} aparece em mais de um signatário.`,
        });
      }
      seenEmails.add(email);
    }
  }

  return issues;
}
