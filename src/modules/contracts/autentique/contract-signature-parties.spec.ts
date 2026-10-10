import { ContractPartyRole, ContractTargetType } from '../enums';
import {
  deriveSignatureParties,
  validateSigners,
} from './contract-signature-parties';

function reader(values: Record<string, unknown>) {
  return (path: string) => values[path];
}

describe('deriveSignatureParties', () => {
  it('derives agency and client signers from the contract variables', () => {
    const result = deriveSignatureParties({
      targetType: ContractTargetType.Client,
      read: reader({
        'agency.signerName': 'Ana Agência',
        'agency.signerEmail': 'Ana@Agencia.com',
        'client.signatory': 'Carlos Cliente',
        'client.signatory.email': 'carlos@cliente.com',
      }),
      settingsMetadata: {},
    });

    expect(result.issues).toEqual([]);
    expect(result.signers).toEqual([
      expect.objectContaining({
        role: ContractPartyRole.Company,
        name: 'Ana Agência',
        email: 'ana@agencia.com',
        signatureOrder: 1,
      }),
      expect.objectContaining({
        role: ContractPartyRole.Client,
        name: 'Carlos Cliente',
        email: 'carlos@cliente.com',
        signatureOrder: 2,
      }),
    ]);
  });

  it('falls back to the signer chosen in the signature settings', () => {
    const result = deriveSignatureParties({
      targetType: ContractTargetType.Client,
      read: reader({
        'client.signatory': { name: 'Carlos Cliente' },
        'client.signatory.email': 'carlos@cliente.com',
      }),
      settingsMetadata: {
        contractSignerUserId: 'user-9',
        contractSignerName: 'Responsável Config',
        contractSignerEmail: 'resp@agencia.com',
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.signers[0]).toEqual(
      expect.objectContaining({
        name: 'Responsável Config',
        email: 'resp@agencia.com',
        userId: 'user-9',
      }),
    );
    expect(result.signers[1].name).toBe('Carlos Cliente');
  });

  it('does not link the settings user when the agency e-mail is someone else', () => {
    const result = deriveSignatureParties({
      targetType: ContractTargetType.Client,
      read: reader({
        'agency.signerName': 'Outra Pessoa',
        'agency.signerEmail': 'outra@agencia.com',
        'client.signatory': 'C',
        'client.signatory.email': 'c@cliente.com',
      }),
      settingsMetadata: {
        contractSignerUserId: 'user-9',
        contractSignerEmail: 'resp@agencia.com',
      },
    });

    expect(result.signers[0].userId).toBeNull();
  });

  it('derives the team member counterpart', () => {
    const result = deriveSignatureParties({
      targetType: ContractTargetType.TeamMember,
      read: reader({
        'agency.signerName': 'Ana',
        'agency.signerEmail': 'ana@agencia.com',
        'member.displayName': 'Bia Membro',
        'member.email': 'bia@agencia.com',
      }),
      settingsMetadata: null,
    });

    expect(result.issues).toEqual([]);
    expect(result.signers[1]).toEqual(
      expect.objectContaining({
        role: ContractPartyRole.TeamMember,
        name: 'Bia Membro',
        email: 'bia@agencia.com',
      }),
    );
  });

  it('reports what is missing instead of guessing', () => {
    const result = deriveSignatureParties({
      targetType: ContractTargetType.Client,
      read: reader({
        'client.signatory': 'Carlos',
        'client.email': 'geral@cliente.com',
      }),
      settingsMetadata: {},
    });

    expect(result.issues.map((issue) => issue.code)).toEqual([
      'company_name_missing',
      'company_email_missing',
      'client_email_missing',
    ]);
  });

  it('flags target types without a derivation rule', () => {
    const result = deriveSignatureParties({
      targetType: ContractTargetType.Vendor,
      read: reader({}),
      settingsMetadata: {},
    });
    expect(result.issues.map((issue) => issue.code)).toContain(
      'unsupported_target',
    );
  });
});

describe('validateSigners', () => {
  it('rejects invalid and duplicated e-mails', () => {
    const issues = validateSigners([
      { role: ContractPartyRole.Company, name: 'A', email: 'a@x.com' },
      { role: ContractPartyRole.Client, name: 'B', email: 'A@x.com' },
      { role: ContractPartyRole.Witness, name: 'C', email: 'not-an-email' },
    ]);

    expect(issues.map((issue) => issue.code)).toEqual([
      'duplicate_signer_email',
      'witness_email_invalid',
    ]);
  });
});
