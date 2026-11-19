import { normalizeEmail, normalizePhone } from './form-submission.normalizer';
import type { NormalizedSubmission } from './forms.types';

/**
 * GL1 (D-L2): pure parser/normalizer of the Google Ads lead-form webhook body.
 * https://developers.google.com/google-ads/webhook/docs/implementation
 *
 * The parser reads only what it knows and ignores everything else (Google adds
 * fields without notice). `google_key` is never read here: the secret stays out
 * of anything that gets stored or logged.
 */

export class GoogleAdsLeadFormatError extends Error {}

export type GoogleAdsLeadColumn = {
  id: string;
  name: string | null;
  value: string;
};

export type ParsedGoogleAdsLead = {
  leadId: string;
  formId: string | null;
  campaignId: string | null;
  adGroupId: string | null;
  assetGroupId: string | null;
  creativeId: string | null;
  gclid: string | null;
  isTest: boolean;
  submittedAt: string | null;
  columns: GoogleAdsLeadColumn[];
};

const MAX_COLUMNS = 100;
const MAX_VALUE = 1000;
const MAX_LEAD_ID = 150;

/** pt-BR labels for the `column_id`s that do not map to a contact field. */
const COLUMN_LABELS: Record<string, string> = {
  FULL_NAME: 'Nome',
  FIRST_NAME: 'Nome',
  LAST_NAME: 'Sobrenome',
  EMAIL: 'E-mail',
  WORK_EMAIL: 'E-mail corporativo',
  PHONE_NUMBER: 'Telefone',
  WORK_PHONE: 'Telefone comercial',
  PHONE_NUMBER_VERIFIED: 'Telefone verificado',
  COMPANY_NAME: 'Empresa',
  JOB_TITLE: 'Cargo',
  POSTAL_CODE: 'CEP',
  STREET_ADDRESS: 'Endereço',
  CITY: 'Cidade',
  REGION: 'Estado',
  COUNTRY: 'País',
};

function asText(value: unknown, max = MAX_VALUE): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function columnValue(item: Record<string, unknown>): string | null {
  // The doc shows `string_value` beside `column_id`; `column_value.string_value` is tolerated too.
  const nested = asRecord(item.column_value);
  return (
    asText(item.string_value) ??
    asText(nested?.string_value) ??
    asText(item.column_value)
  );
}

function asIsoDate(value: unknown): string | null {
  const text = asText(value, 64);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function parseGoogleAdsLead(body: unknown): ParsedGoogleAdsLead {
  const root = asRecord(body);
  if (!root) throw new GoogleAdsLeadFormatError('Body must be a JSON object.');
  const leadId = asText(root.lead_id, MAX_LEAD_ID);
  if (!leadId) throw new GoogleAdsLeadFormatError('lead_id is required.');
  if (!Array.isArray(root.user_column_data))
    throw new GoogleAdsLeadFormatError('user_column_data must be an array.');

  const columns: GoogleAdsLeadColumn[] = [];
  for (const raw of root.user_column_data.slice(0, MAX_COLUMNS)) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = asText(item.column_id, 80);
    const value = columnValue(item);
    if (!id || !value) continue;
    columns.push({ id, name: asText(item.column_name, 200), value });
  }

  return {
    leadId,
    formId: asText(root.form_id, 80),
    campaignId: asText(root.campaign_id, 80),
    adGroupId: asText(root.adgroup_id, 80),
    assetGroupId: asText(root.asset_group_id, 80),
    creativeId: asText(root.creative_id, 80),
    gclid: asText(root.gcl_id, 500),
    isTest: root.is_test === true || root.is_test === 'true',
    submittedAt: asIsoDate(root.lead_submit_time),
    columns,
  };
}

/**
 * D-L3 layer 1. The test button can resend the same `lead_id`, and a swallowed
 * test looks like a broken integration, so tests also key on their submit time.
 */
export function googleAdsExternalLeadId(lead: ParsedGoogleAdsLead): string {
  return lead.isTest
    ? `test:${lead.leadId}:${lead.submittedAt ?? ''}`.slice(0, 200)
    : lead.leadId;
}

export function googleAdsLeadAttribution(
  lead: ParsedGoogleAdsLead,
): Record<string, string> {
  const entries: Array<[string, string | null]> = [
    ['gclid', lead.gclid],
    ['campaignId', lead.campaignId],
    ['assetGroupId', lead.assetGroupId],
    ['adGroupId', lead.adGroupId],
    ['formId', lead.formId],
    ['leadId', lead.leadId],
    ['submittedAt', lead.submittedAt],
    ['isTest', lead.isTest ? 'true' : 'false'],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

function humanize(id: string): string {
  const text = id.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function normalizeGoogleAdsLead(
  lead: ParsedGoogleAdsLead,
): NormalizedSubmission {
  const values: NormalizedSubmission['values'] = {};
  const first = new Map<string, GoogleAdsLeadColumn>();
  const extras: GoogleAdsLeadColumn[] = [];
  for (const column of lead.columns) {
    if (first.has(column.id)) extras.push(column);
    else {
      first.set(column.id, column);
      values[column.id] = column.value;
    }
  }
  const consumed = new Set<GoogleAdsLeadColumn>();
  const take = (id: string) => {
    const column = first.get(id);
    if (column) consumed.add(column);
    return column?.value ?? null;
  };
  const firstValid = (
    ids: string[],
    normalize: (value: string) => string | null,
  ) => {
    for (const id of ids) {
      const column = first.get(id);
      const normalized = column ? normalize(column.value) : null;
      if (column && normalized) {
        consumed.add(column);
        return normalized;
      }
    }
    return null;
  };

  const fullName = take('FULL_NAME');
  const given = take('FIRST_NAME');
  const family = take('LAST_NAME');
  const name =
    fullName ?? ([given, family].filter(Boolean).join(' ').trim() || null);

  const email = firstValid(['EMAIL', 'WORK_EMAIL'], normalizeEmail);
  const phone = firstValid(['PHONE_NUMBER', 'WORK_PHONE'], normalizePhone);
  const company = take('COMPANY_NAME');
  const position = take('JOB_TITLE');

  // Whatever did not become a contact field stays visible as "label: value"
  // (an e-mail or phone that failed validation included), so no answer is lost.
  const summaryLines = [...first.values(), ...extras]
    .filter((column) => !consumed.has(column))
    .map(
      (column) =>
        `${COLUMN_LABELS[column.id] ?? column.name ?? humanize(column.id)}: ${column.value}`,
    );

  return {
    values,
    lead: {
      name: name?.slice(0, 200) ?? null,
      email,
      phone,
      company: company?.slice(0, 200) ?? null,
      position: position?.slice(0, 200) ?? null,
    },
    opportunity: { title: null, valueAmount: null, notes: null },
    summaryLines,
  };
}
