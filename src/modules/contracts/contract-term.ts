import {
  ContractDocumentKind,
  ContractDocumentType,
  ContractSignatureProvider,
  ContractStatus,
} from './enums';
import type { ContractRecord, ContractDocument } from './entities';
export type ContractTermRecord = Pick<
  ContractRecord,
  | 'id'
  | 'title'
  | 'status'
  | 'signatureProvider'
  | 'validFrom'
  | 'validUntil'
  | 'metadata'
  | 'variablesData'
  | 'createdAt'
  | 'archivedAt'
  | 'cancelledAt'
> & {
  documentKind?: ContractDocumentKind;
  documents?: Pick<ContractDocument, 'type'>[];
  signedDocument?: boolean;
};
export type ContractTerm = {
  state:
    | 'none'
    | 'pending'
    | 'active'
    | 'open_ended'
    | 'expiring'
    | 'expired'
    | 'terminating';
  contractId: string | null;
  title: string | null;
  status: ContractStatus | null;
  mode: 'generator' | 'manual' | null;
  validFrom: string | null;
  validUntil: string | null;
  daysUntilEnd: number | null;
  windowDays: number;
  autoRenewal: boolean;
  monthlyValue: string | null;
  dueDay: string | null;
  currency: string | null;
  terminatesAt: string | null;
  pendingContractId: string | null;
};
export function contractToday(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function contractObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function contractVariable(
  data: Record<string, unknown>,
  key: string,
): unknown {
  return (
    data[key] ??
    key
      .split('.')
      .reduce<unknown>((value, part) => contractObject(value)[part], data)
  );
}
export function isSignedContract(record: ContractTermRecord): boolean {
  const client = contractObject(record.metadata.clientContract);
  const attached = contractObject(client.attachedPdf);
  return (
    (record.signatureProvider === ContractSignatureProvider.Autentique &&
      [ContractStatus.DigitallySigned, ContractStatus.Completed].includes(
        record.status,
      )) ||
    record.signedDocument === true ||
    record.documents?.some((doc) =>
      [
        ContractDocumentType.SignedPdf,
        ContractDocumentType.ManuallySignedPdf,
      ].includes(doc.type),
    ) === true ||
    // New principal attachments explicitly carry signed=false. Historical manual
    // attachments remain readable without rewriting the two production records.
    (client.mode === 'manual' &&
      Boolean(attached.documentId) &&
      attached.signed !== false)
  );
}
export function resolveContractTerm(
  records: ContractTermRecord[],
  today: string,
  windowDays = 30,
): ContractTerm {
  const empty: ContractTerm = {
    state: 'none',
    contractId: null,
    title: null,
    status: null,
    mode: null,
    validFrom: null,
    validUntil: null,
    daysUntilEnd: null,
    windowDays,
    autoRenewal: false,
    monthlyValue: null,
    dueDay: null,
    currency: null,
    terminatesAt: null,
    pendingContractId: null,
  };
  const candidates = records.filter(
    (r) =>
      (r.documentKind ?? ContractDocumentKind.Contract) ===
        ContractDocumentKind.Contract &&
      !r.archivedAt &&
      !r.cancelledAt &&
      ![ContractStatus.Archived, ContractStatus.Cancelled].includes(r.status),
  );
  const newest = (a: ContractTermRecord, b: ContractTermRecord) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
    b.id.localeCompare(a.id);
  const pending = candidates
    .filter((r) => !isSignedContract(r))
    .sort(newest)[0];
  const signed = candidates.filter(
    (r) =>
      isSignedContract(r) &&
      !(
        typeof contractObject(r.metadata.termination).effectiveDate ===
          'string' &&
        String(contractObject(r.metadata.termination).effectiveDate) <= today
      ),
  );
  const started = signed
    .filter((r) => !r.validFrom || r.validFrom <= today)
    .sort(
      (a, b) =>
        (b.validFrom ?? '').localeCompare(a.validFrom ?? '') || newest(a, b),
    );
  const future = signed
    .filter((r) => r.validFrom && r.validFrom > today)
    .sort((a, b) => a.validFrom!.localeCompare(b.validFrom!) || newest(a, b));
  const current = started[0] ?? future[0];
  const record = current ?? pending;
  if (!record) return empty;
  const client = contractObject(record.metadata.clientContract),
    manual = contractObject(client.manual),
    effective = contractObject(record.metadata.effectiveTerms);
  const text = (...values: unknown[]): string | null => {
    const value = values.find(
      (v) =>
        (typeof v === 'string' && v.trim() !== '') || typeof v === 'number',
    );
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : null;
  };
  const mode = client.mode === 'manual' ? 'manual' : 'generator';
  const terminatesAt = text(
    contractObject(record.metadata.termination).effectiveDate,
  );
  const days = record.validUntil
    ? Math.round((Date.parse(record.validUntil) - Date.parse(today)) / 86400000)
    : null;
  const presets = contractObject(client.presets);
  return {
    ...empty,
    state: !current
      ? 'pending'
      : terminatesAt
        ? 'terminating'
        : days === null
          ? 'open_ended'
          : days < 0
            ? 'expired'
            : days <= windowDays
              ? 'expiring'
              : 'active',
    contractId: record.id,
    title: record.title,
    status: record.status,
    mode,
    validFrom: record.validFrom,
    validUntil: record.validUntil,
    daysUntilEnd: days,
    pendingContractId: pending?.id ?? null,
    terminatesAt,
    autoRenewal:
      mode === 'manual'
        ? manual.autoRenewal === true
        : ['same_period', 'monthly'].includes(
            String(presets['contract.autoRenewal']),
          ),
    monthlyValue: text(
      effective.monthlyValue,
      manual.monthlyValue,
      contractVariable(record.variablesData, 'contract.monthlyValue'),
    ),
    dueDay: text(
      effective.dueDay,
      manual.dueDay,
      contractVariable(record.variablesData, 'contract.dueDay'),
      contractVariable(record.variablesData, 'contract.invoiceDay'),
    ),
    currency: text(
      effective.currency,
      manual.currency,
      contractVariable(record.variablesData, 'contract.currency'),
      contractVariable(record.variablesData, 'agency.defaultCurrency'),
    ),
  };
}
