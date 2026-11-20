import { normalizeEmail, normalizePhone } from './form-submission.normalizer';
import type { NormalizedSubmission } from './forms.types';

/**
 * ML1 (D-L2/D-L7): pure parser/normalizer of one Meta lead, as `GET /{lead-id}`
 * and `GET /{form-id}/leads` return it:
 * `{ id, created_time, field_data: [{ name, values: [] }], ad_id, adset_id,
 * campaign_id, form_id, platform, is_organic }`.
 *
 * Standard questions arrive with Meta's own keys (`full_name`, `email`,
 * `phone_number`, …); custom questions with the key Meta derived from their
 * text. Unknown fields are ignored. Nothing here logs.
 */

export type MetaLeadField = { name: string; value: string };

export type ParsedMetaLead = {
  leadId: string;
  pageId: string | null;
  formId: string | null;
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  platform: string | null;
  isOrganic: boolean;
  isTest: boolean;
  submittedAt: string | null;
  fields: MetaLeadField[];
};

const MAX_FIELDS = 100;
const MAX_VALUE = 1000;
const MAX_ID = 150;

/**
 * Not a documented flag: the Lead Ads Testing Tool fills every answer with a
 * placeholder like `<test lead: dummy data for email>`. Recognizing it is what
 * lets D-L4 hold for Meta. Unverified until the first test lead (ML1 smoke).
 */
const TEST_VALUE = /^<test lead: dummy data for /i;

/** pt-BR labels of Meta's standard question keys that are not contact fields. */
const FIELD_LABELS: Record<string, string> = {
  full_name: 'Nome',
  first_name: 'Nome',
  last_name: 'Sobrenome',
  email: 'E-mail',
  work_email: 'E-mail corporativo',
  phone_number: 'Telefone',
  work_phone_number: 'Telefone comercial',
  company_name: 'Empresa',
  job_title: 'Cargo',
  street_address: 'Endereço',
  city: 'Cidade',
  state: 'Estado',
  province: 'Província',
  country: 'País',
  zip_code: 'CEP',
  post_code: 'CEP',
  date_of_birth: 'Data de nascimento',
  gender: 'Gênero',
  marital_status: 'Estado civil',
  relationship_status: 'Relacionamento',
  military_status: 'Situação militar',
  cpf: 'CPF',
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

/** Meta writes `2015-02-28T08:49:14+0000`; the offset gets its colon first. */
function asIsoDate(value: unknown): string | null {
  const text = asText(value, 64)?.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** `null` when the lead has no id: there is nothing to deduplicate it by. */
export function parseMetaLead(
  raw: unknown,
  pageId: string | null = null,
): ParsedMetaLead | null {
  const root = asRecord(raw);
  const leadId = asText(root?.id, MAX_ID);
  if (!root || !leadId) return null;

  const fields: MetaLeadField[] = [];
  const data = Array.isArray(root.field_data) ? root.field_data : [];
  for (const entry of data.slice(0, MAX_FIELDS)) {
    const item = asRecord(entry);
    const name = asText(item?.name, 200);
    const values = Array.isArray(item?.values)
      ? item.values.map((value) => asText(value)).filter(Boolean)
      : [];
    if (name && values.length)
      fields.push({ name, value: values.join(', ').slice(0, MAX_VALUE) });
  }

  return {
    leadId,
    pageId,
    formId: asText(root.form_id, 80),
    campaignId: asText(root.campaign_id, 80),
    adSetId: asText(root.adset_id, 80),
    adId: asText(root.ad_id, 80),
    platform: asText(root.platform, 40),
    isOrganic: root.is_organic === true || root.is_organic === 'true',
    isTest:
      fields.length > 0 &&
      fields.every((field) => TEST_VALUE.test(field.value)),
    submittedAt: asIsoDate(root.created_time),
    fields,
  };
}

/**
 * D-L3 layer 1 is the `leadgen_id`. A Testing Tool lead is a new id every time,
 * so, unlike Google's test button, it needs no extra key.
 */
export function metaExternalLeadId(lead: ParsedMetaLead): string {
  return lead.leadId;
}

export function metaLeadAttribution(
  lead: ParsedMetaLead,
): Record<string, string> {
  const entries: Array<[string, string | null]> = [
    ['campaignId', lead.campaignId],
    ['adSetId', lead.adSetId],
    ['adId', lead.adId],
    ['formId', lead.formId],
    ['pageId', lead.pageId],
    ['leadId', lead.leadId],
    ['platform', lead.platform],
    ['submittedAt', lead.submittedAt],
    ['isOrganic', lead.isOrganic ? 'true' : 'false'],
    ['isTest', lead.isTest ? 'true' : 'false'],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

function humanize(key: string): string {
  const text = key.replace(/[_?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function normalizeMetaLead(lead: ParsedMetaLead): NormalizedSubmission {
  const values: NormalizedSubmission['values'] = {};
  const first = new Map<string, MetaLeadField>();
  const extras: MetaLeadField[] = [];
  for (const field of lead.fields) {
    const key = field.name.toLowerCase();
    if (first.has(key)) extras.push(field);
    else {
      first.set(key, field);
      values[field.name] = field.value;
    }
  }
  const consumed = new Set<MetaLeadField>();
  const take = (key: string) => {
    const field = first.get(key);
    if (field) consumed.add(field);
    return field?.value ?? null;
  };
  const firstValid = (
    keys: string[],
    normalize: (value: string) => string | null,
  ) => {
    for (const key of keys) {
      const field = first.get(key);
      const normalized = field ? normalize(field.value) : null;
      if (field && normalized) {
        consumed.add(field);
        return normalized;
      }
    }
    return null;
  };

  const fullName = take('full_name');
  const given = take('first_name');
  const family = take('last_name');
  const name =
    fullName ?? ([given, family].filter(Boolean).join(' ').trim() || null);

  const email = firstValid(['email', 'work_email'], normalizeEmail);
  const phone = firstValid(
    ['phone_number', 'work_phone_number'],
    normalizePhone,
  );
  const company = take('company_name');
  const position = take('job_title');

  // Whatever did not become a contact field stays visible as "label: value"
  // (custom questions included), so no answer is lost (D-L2).
  const summaryLines = [...first.values(), ...extras]
    .filter((field) => !consumed.has(field))
    .map(
      (field) =>
        `${FIELD_LABELS[field.name.toLowerCase()] ?? humanize(field.name)}: ${field.value}`,
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
