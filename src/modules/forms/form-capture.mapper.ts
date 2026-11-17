import {
  normalizeEmail,
  normalizePhone,
  parseAmount,
} from './form-submission.normalizer';
import {
  FORM_CAPTURE_TARGETS,
  type CapturedField,
  type FormCaptureTarget,
  type FormFieldTarget,
  type NormalizedSubmission,
} from './forms.types';

/**
 * F3 (§5.6) — pure helpers for the capture script: parse what capture.js
 * sends, guess where each site field goes, and build the same normalized
 * shape the rest of the pipeline already consumes.
 */

const MAX_FIELDS = 60;
const MAX_VALUE = 5000;
const NONCE = /^[A-Za-z0-9_-]{8,64}$/;
/** Never stored, even if an old/forked script sends it. */
const SENSITIVE =
  /pass|senha|card|cartao|cvv|cvc|csrf|token|captcha|nonce|\bcc\b|cc-/;
const SKIPPED_TYPES = new Set([
  'password',
  'file',
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
]);

export class CaptureFormatError extends Error {}

export type ParsedCapture = {
  fields: CapturedField[];
  nonce: string | null;
  attribution: unknown;
  elapsedMs: number | null;
};

function plain(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-[\].:]+/g, ' ');
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Control characters (except tab/newline) never reach the CRM.
  const cleaned = [...value]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('')
    .trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export function parseCapturePayload(raw: string): ParsedCapture {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new CaptureFormatError('Payload is not JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new CaptureFormatError('Payload must be an object.');
  const input = data as Record<string, unknown>;
  if (!Array.isArray(input.fields))
    throw new CaptureFormatError('fields must be a list.');

  const byKey = new Map<string, CapturedField>();
  for (const item of input.fields.slice(0, MAX_FIELDS)) {
    if (typeof item !== 'object' || item === null) continue;
    const field = item as Record<string, unknown>;
    const key = str(field.key, 120);
    const value = str(field.value, MAX_VALUE);
    if (!key || !value) continue;
    const type = (str(field.type, 30) ?? 'text').toLowerCase();
    const autocomplete = str(field.autocomplete, 60)?.toLowerCase() ?? null;
    if (SKIPPED_TYPES.has(type)) continue;
    if (SENSITIVE.test(plain(`${key} ${type} ${autocomplete ?? ''}`))) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.value = `${existing.value}, ${value}`.slice(0, MAX_VALUE);
      continue;
    }
    byKey.set(key, {
      key,
      label: str(field.label, 200),
      type,
      autocomplete,
      hint: str(field.hint, 40)?.toLowerCase() ?? null,
      value,
    });
  }

  const nonce =
    typeof input.nonce === 'string' && NONCE.test(input.nonce)
      ? input.nonce
      : null;
  const elapsed = input.elapsedMs;
  return {
    fields: [...byKey.values()],
    nonce,
    attribution: input.attribution,
    elapsedMs:
      typeof elapsed === 'number' && Number.isInteger(elapsed) && elapsed >= 0
        ? elapsed
        : null,
  };
}

const HINTS: Record<string, FormCaptureTarget> = {
  name: 'contact.name',
  first_name: 'contact.name',
  last_name: 'contact.name',
  email: 'contact.email',
  phone: 'contact.phone',
  company: 'contact.company',
  position: 'contact.position',
  title: 'opportunity.title',
  value: 'opportunity.value',
  message: 'opportunity.notes',
  notes: 'opportunity.notes',
  ignore: 'ignore',
};

const AUTOCOMPLETE: Record<string, FormFieldTarget> = {
  email: 'contact.email',
  tel: 'contact.phone',
  'tel-national': 'contact.phone',
  name: 'contact.name',
  'given-name': 'contact.name',
  'family-name': 'contact.name',
  organization: 'contact.company',
  'organization-title': 'contact.position',
};

/** Order matters: "company_name" is a company, not a person's name. */
const PATTERNS: Array<[RegExp, FormFieldTarget]> = [
  [/e ?mail/, 'contact.email'],
  [/empresa|company|organiza|razao social|business|negocio/, 'contact.company'],
  [/cargo|position|job title|funcao/, 'contact.position'],
  [/phone|fone|\btel\b|whats|\bzap\b|celular|\bcel\b|mobile/, 'contact.phone'],
  [/nome|name/, 'contact.name'],
  [
    /mensag|message|\bmsg\b|coment|observa|descri|duvida|assunto|subject|detalhe/,
    'opportunity.notes',
  ],
];

export type CaptureTargetSource = 'map' | 'hint' | 'auto' | 'none';

export function resolveCaptureTarget(
  field: Pick<
    CapturedField,
    'key' | 'label' | 'type' | 'autocomplete' | 'hint'
  >,
  fieldMap: Record<string, FormCaptureTarget> = {},
): { target: FormCaptureTarget; source: CaptureTargetSource } {
  const mapped = fieldMap[field.key];
  if (mapped && FORM_CAPTURE_TARGETS.includes(mapped))
    return { target: mapped, source: 'map' };
  if (field.hint) {
    const hinted =
      HINTS[field.hint] ??
      (FORM_CAPTURE_TARGETS.includes(field.hint as FormCaptureTarget)
        ? (field.hint as FormCaptureTarget)
        : undefined);
    if (hinted) return { target: hinted, source: 'hint' };
  }
  const auto = field.autocomplete
    ? AUTOCOMPLETE[field.autocomplete.split(/\s+/).pop() ?? '']
    : undefined;
  if (auto) return { target: auto, source: 'auto' };
  if (field.type === 'email')
    return { target: 'contact.email', source: 'auto' };
  if (field.type === 'tel') return { target: 'contact.phone', source: 'auto' };
  for (const text of [field.key, field.label ?? '']) {
    const haystack = plain(text);
    const match = PATTERNS.find(([pattern]) => pattern.test(haystack));
    if (match) return { target: match[1], source: 'auto' };
  }
  return { target: 'none', source: 'none' };
}

export function normalizeCapture(
  fields: CapturedField[],
  fieldMap: Record<string, FormCaptureTarget> = {},
): NormalizedSubmission {
  const result: NormalizedSubmission = {
    values: {},
    lead: {
      name: null,
      email: null,
      phone: null,
      company: null,
      position: null,
    },
    opportunity: { title: null, valueAmount: null, notes: null },
    summaryLines: [],
  };
  const names: string[] = [];
  const { lead, opportunity } = result;
  for (const field of fields) {
    const { target } = resolveCaptureTarget(field, fieldMap);
    if (target === 'ignore') continue;
    const value = field.value;
    result.values[field.key] = value;
    switch (target) {
      case 'contact.name':
        names.push(value);
        break;
      case 'contact.email':
        lead.email ??= normalizeEmail(value);
        break;
      case 'contact.phone':
        lead.phone ??= normalizePhone(value);
        break;
      case 'contact.company':
        lead.company ??= value.slice(0, 200);
        break;
      case 'contact.position':
        lead.position ??= value.slice(0, 120);
        break;
      case 'opportunity.title':
        opportunity.title ??= value.slice(0, 200);
        break;
      case 'opportunity.value':
        opportunity.valueAmount ??= parseAmount(value);
        break;
      case 'opportunity.notes':
        opportunity.notes = opportunity.notes
          ? `${opportunity.notes}\n${value}`
          : value;
        break;
      default:
        break;
    }
    // Notes already open the opportunity description; everything else is listed.
    if (target !== 'opportunity.notes')
      result.summaryLines.push(
        `${(field.label ?? field.key).slice(0, 120)}: ${value}`,
      );
  }
  lead.name = names.join(' ').slice(0, 200) || null;
  return result;
}

export function hasLeadIdentity(normalized: NormalizedSubmission): boolean {
  const { name, email, phone } = normalized.lead;
  return Boolean(name || email || phone);
}

export type DetectedCaptureField = {
  key: string;
  label: string | null;
  type: string;
  count: number;
  target: FormCaptureTarget;
  source: CaptureTargetSource;
  sample: string;
};

/** "Learning mode": fields seen in recent captures and where each one goes now. */
export function summarizeCapturedFields(
  payloads: unknown[],
  fieldMap: Record<string, FormCaptureTarget> = {},
): DetectedCaptureField[] {
  const seen = new Map<string, DetectedCaptureField>();
  for (const payload of payloads) {
    const fields = (payload as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(fields)) continue;
    for (const field of fields as CapturedField[]) {
      if (!field || typeof field.key !== 'string') continue;
      const current = seen.get(field.key);
      if (current) {
        current.count += 1;
        continue;
      }
      seen.set(field.key, {
        key: field.key,
        label: field.label ?? null,
        type: field.type,
        count: 1,
        ...resolveCaptureTarget(field, fieldMap),
        sample: String(field.value ?? '').slice(0, 60),
      });
    }
  }
  return [...seen.values()];
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Same matching as the iframe (exact host or `*.domain`, apex included). Empty list = any site. */
export function isCaptureOriginAllowed(
  origin: string | null | undefined,
  referer: string | null | undefined,
  allowedOrigins: string[],
): boolean {
  if (!allowedOrigins.length) return true;
  const host = hostOf(origin) ?? hostOf(referer);
  if (!host) return false;
  return allowedOrigins.some((pattern) =>
    pattern.startsWith('*.')
      ? host === pattern.slice(2) || host.endsWith(pattern.slice(1))
      : host === pattern,
  );
}
