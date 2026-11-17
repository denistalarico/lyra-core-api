import type {
  FormField,
  NormalizedLead,
  NormalizedOpportunity,
  NormalizedSubmission,
} from './forms.types';

/**
 * Pure normalization of a visitor's answers against the form definition.
 * Unknown keys are dropped: only what the form declares is ever stored or
 * pushed to the CRM.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MAX = 500;
const TEXTAREA_MAX = 5000;

export type FieldErrors = Record<string, string>;

export class FormValidationError extends Error {
  constructor(readonly fieldErrors: FieldErrors) {
    super('Form validation failed.');
  }
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

/** E.164; national BR numbers (10–11 digits) get +55. */
export function normalizePhone(value: string): string | null {
  const hasPlus = value.trim().startsWith('+');
  let digits = value.replace(/\D/g, '');
  if (!hasPlus && digits.startsWith('00')) digits = digits.slice(2);
  else if (!hasPlus && digits.length === 12 && digits.startsWith('0'))
    digits = digits.slice(1);
  if (!hasPlus && (digits.length === 10 || digits.length === 11))
    digits = `55${digits}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Digit variants a stored phone may have been typed with (for dedup). */
export function phoneMatchVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, '');
  const variants = new Set([digits]);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13))
    variants.add(digits.slice(2));
  return [...variants];
}

function checkDigits(digits: string, weights: number[]): number {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0,
  );
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  const first = ((): number => {
    const sum = [...digits.slice(0, 9)].reduce(
      (total, d, i) => total + Number(d) * (10 - i),
      0,
    );
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  })();
  const second = ((): number => {
    const sum = [...digits.slice(0, 10)].reduce(
      (total, d, i) => total + Number(d) * (11 - i),
      0,
    );
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  })();
  return first === Number(digits[9]) && second === Number(digits[10]);
}

export function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const first = checkDigits(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigits(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(digits[12]) && second === Number(digits[13]);
}

function asText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return raw ? 'true' : null;
  return null;
}

export function parseAmount(value: string): number | null {
  // "1.234,56" (BR) or "1234.56"
  const cleaned = value.replace(/[^\d,.-]/g, '');
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100) / 100
    : null;
}

function display(value: string | string[] | boolean | number): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
}

function normalizeField(
  field: FormField,
  raw: unknown,
): { value?: string | string[] | boolean | number; error?: string } {
  const max =
    field.maxLength ?? (field.type === 'textarea' ? TEXTAREA_MAX : DEFAULT_MAX);

  if (field.type === 'consent') {
    const accepted =
      raw === true || raw === 'true' || raw === 'on' || raw === '1';
    if (field.required && !accepted) return { error: 'Aceite obrigatório.' };
    return { value: accepted };
  }

  if (field.type === 'checkbox') {
    if (field.options?.length) {
      const list = (
        Array.isArray(raw)
          ? raw
          : raw === undefined || raw === null || raw === ''
            ? []
            : [raw]
      )
        .map(asText)
        .filter((item): item is string => item !== null);
      if (list.some((item) => !field.options!.includes(item)))
        return { error: 'Opção inválida.' };
      if (field.required && list.length === 0)
        return { error: 'Campo obrigatório.' };
      return list.length ? { value: [...new Set(list)] } : {};
    }
    const checked =
      raw === true || raw === 'true' || raw === 'on' || raw === '1';
    if (field.required && !checked) return { error: 'Campo obrigatório.' };
    return { value: checked };
  }

  const value = asText(raw);
  if (value === null)
    return field.required ? { error: 'Campo obrigatório.' } : {};
  if (value.length > max) return { error: `Máximo de ${max} caracteres.` };

  switch (field.type) {
    case 'email': {
      const email = normalizeEmail(value);
      return email ? { value: email } : { error: 'E-mail inválido.' };
    }
    case 'phone': {
      const phone = normalizePhone(value);
      return phone ? { value: phone } : { error: 'Telefone inválido.' };
    }
    case 'select':
    case 'radio':
      return field.options?.includes(value)
        ? { value }
        : { error: 'Opção inválida.' };
    case 'date':
      return DATE.test(value) && !Number.isNaN(Date.parse(value))
        ? { value }
        : { error: 'Data inválida.' };
    case 'number': {
      const number = Number(value.replace(',', '.'));
      return Number.isFinite(number)
        ? { value: number }
        : { error: 'Número inválido.' };
    }
    case 'cpf':
      return isValidCpf(value)
        ? { value: value.replace(/\D/g, '') }
        : { error: 'CPF inválido.' };
    case 'cnpj':
      return isValidCnpj(value)
        ? { value: value.replace(/\D/g, '') }
        : { error: 'CNPJ inválido.' };
    default:
      return { value };
  }
}

export function normalizeSubmission(
  fields: FormField[],
  rawValues: Record<string, unknown>,
): NormalizedSubmission {
  const values: NormalizedSubmission['values'] = {};
  const errors: FieldErrors = {};
  const lead: NormalizedLead = {
    name: null,
    email: null,
    phone: null,
    company: null,
    position: null,
  };
  const opportunity: NormalizedOpportunity = {
    title: null,
    valueAmount: null,
    notes: null,
  };
  const summaryLines: string[] = [];

  for (const field of fields) {
    const result = normalizeField(field, rawValues[field.key]);
    if (result.error) {
      errors[field.key] = result.error;
      continue;
    }
    if (result.value === undefined) continue;
    values[field.key] = result.value;

    const asString =
      typeof result.value === 'string' ? result.value : display(result.value);
    switch (field.target) {
      case 'contact.name':
        lead.name = asString.slice(0, 200);
        break;
      case 'contact.email':
        lead.email =
          field.type === 'email' ? asString : normalizeEmail(asString);
        break;
      case 'contact.phone':
        lead.phone =
          field.type === 'phone' ? asString : normalizePhone(asString);
        break;
      case 'contact.company':
        lead.company = asString.slice(0, 200);
        break;
      case 'contact.position':
        lead.position = asString.slice(0, 120);
        break;
      case 'opportunity.title':
        opportunity.title = asString.slice(0, 200);
        break;
      case 'opportunity.value':
        opportunity.valueAmount =
          typeof result.value === 'number'
            ? result.value
            : parseAmount(asString);
        break;
      case 'opportunity.notes':
        opportunity.notes = opportunity.notes
          ? `${opportunity.notes}\n${asString}`
          : asString;
        break;
      default:
        break;
    }
    if (field.type !== 'hidden' && field.type !== 'consent')
      summaryLines.push(`${field.label}: ${display(result.value)}`);
  }

  if (Object.keys(errors).length) throw new FormValidationError(errors);
  return { values, lead, opportunity, summaryLines };
}

/** UTM / click ids / page context, whitelisted and capped. */
const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'fbp',
  'fbc',
  'ttclid',
  'msclkid',
] as const;
const ATTRIBUTION_URL_KEYS = ['pageUrl', 'landingUrl', 'referrer'] as const;

export function sanitizeAttribution(input: unknown): Record<string, string> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return {};
  const source = input as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = asText(source[key]);
    if (value) result[key] = value.slice(0, 500);
  }
  for (const key of ATTRIBUTION_URL_KEYS) {
    const value = asText(source[key]);
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:')
        result[key] = url.toString().slice(0, 1000);
    } catch {
      // not a URL: dropped
    }
  }
  return result;
}
