import {
  contractToday,
  resolveContractTerm,
  type ContractTermRecord,
} from './contract-term';
import {
  ContractDocumentKind,
  ContractDocumentType,
  ContractSignatureProvider,
  ContractStatus,
} from './enums';
const today = '2026-10-11';
const record = (
  override: Partial<ContractTermRecord> = {},
): ContractTermRecord => ({
  id: 'one',
  title: 'Contrato',
  documentKind: ContractDocumentKind.Contract,
  status: ContractStatus.Draft,
  signatureProvider: ContractSignatureProvider.None,
  validFrom: '2026-01-01',
  validUntil: '2026-12-31',
  metadata: { clientContract: { mode: 'generator' } },
  variablesData: {},
  createdAt: new Date('2026-01-01'),
  archivedAt: null,
  cancelledAt: null,
  documents: [{ type: ContractDocumentType.SignedPdf }],
  ...override,
});
describe('contractTerm', () => {
  it('always returns an object and ignores cancelled, archived and terms', () => {
    expect(resolveContractTerm([], today).state).toBe('none');
    expect(
      resolveContractTerm(
        [
          record({ status: ContractStatus.Cancelled }),
          record({ archivedAt: new Date() }),
          record({ documentKind: ContractDocumentKind.Amendment }),
        ],
        today,
      ).state,
    ).toBe('none');
  });
  it.each([
    ['active', '2026-12-31'],
    ['expiring', '2026-11-10'],
    ['expired', '2026-10-10'],
    ['open_ended', null],
  ] as const)('resolves %s with inclusive boundary', (state, validUntil) =>
    expect(resolveContractTerm([record({ validUntil })], today).state).toBe(
      state,
    ),
  );
  it('uses configurable window', () =>
    expect(
      resolveContractTerm([record({ validUntil: '2026-11-10' })], today, 15)
        .state,
    ).toBe('active'));
  it('unsigned and mark-manually-signed without a document remain pending', () => {
    for (const status of [
      ContractStatus.Draft,
      ContractStatus.Generated,
      ContractStatus.SentForSignature,
      ContractStatus.ManuallySigned,
      ContractStatus.Completed,
    ])
      expect(
        resolveContractTerm([record({ status, documents: [] })], today).state,
      ).toBe('pending');
  });
  it.each([ContractStatus.DigitallySigned, ContractStatus.Completed])(
    'accepts Autentique %s without waiting for download',
    (status) =>
      expect(
        resolveContractTerm(
          [
            record({
              status,
              signatureProvider: ContractSignatureProvider.Autentique,
              documents: [],
            }),
          ],
          today,
        ).state,
      ).toBe('active'),
  );
  it('accepts legacy manual attachment; new unsigned attachment does not count', () => {
    const legacy = record({
      documents: [],
      metadata: {
        clientContract: { mode: 'manual', attachedPdf: { documentId: 'doc' } },
      },
    });
    expect(resolveContractTerm([legacy], today).state).toBe('active');
    legacy.metadata = {
      clientContract: {
        mode: 'manual',
        attachedPdf: { documentId: 'doc', signed: false },
      },
    };
    expect(resolveContractTerm([legacy], today).state).toBe('pending');
  });
  it('termination suppresses expiry until effective day, then removes the parent', () => {
    const parent = record({
      validUntil: '2026-10-15',
      metadata: { termination: { effectiveDate: '2026-10-20' } },
    });
    expect(resolveContractTerm([parent], today)).toMatchObject({
      state: 'terminating',
      terminatesAt: '2026-10-20',
    });
    expect(resolveContractTerm([parent], '2026-10-20').state).toBe('none');
  });
  it('selects latest started signed contract, keeps pending successor, then earliest future', () => {
    const old = record({ id: 'old', validFrom: '2025-01-01' }),
      current = record({ id: 'new' }),
      future = record({ id: 'future', validFrom: '2027-01-01' }),
      pending = record({
        id: 'pending',
        documents: [],
        createdAt: new Date('2026-10-11'),
      });
    expect(
      resolveContractTerm([future, old, pending, current], today),
    ).toMatchObject({ contractId: 'new', pendingContractId: 'pending' });
    expect(
      resolveContractTerm(
        [future, record({ id: 'later', validFrom: '2028-01-01' })],
        today,
      ).contractId,
    ).toBe('future');
  });
  it('uses effective terms over manual over variables and preserves currencies', () => {
    const parent = record({
      metadata: {
        effectiveTerms: { monthlyValue: '123.45' },
        clientContract: {
          mode: 'manual',
          manual: {
            monthlyValue: '100',
            dueDay: '15',
            currency: 'USD',
            autoRenewal: true,
          },
        },
      },
      variablesData: { 'contract.monthlyValue': '90', 'contract.dueDay': '10' },
    });
    expect(resolveContractTerm([parent], today)).toMatchObject({
      monthlyValue: '123.45',
      dueDay: '15',
      currency: 'USD',
      autoRenewal: true,
    });
  });
  it('computes local Sao Paulo day around UTC midnight', () =>
    expect(contractToday(new Date('2026-10-12T01:00:00Z'))).toBe(today));
});
