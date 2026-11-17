import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_FORM_AFTER_SUBMIT,
  DEFAULT_FORM_DESTINATION,
  DEFAULT_FORM_SECURITY,
  FORM_DESTINATION_TARGETS,
  FORM_FIELD_TARGETS,
  FORM_FIELD_TYPES,
  type FormAfterSubmit,
  type FormDestination,
  type FormField,
  type FormFieldsConfig,
  type FormSecurity,
} from './forms.types';

/**
 * Validates and sanitizes the jsonb parts of a form. The builder (F2) is the
 * only writer, but the API never trusts it: everything a public visitor later
 * sees or that drives a CRM write passes through here.
 */

const MAX_FIELDS = 60;
const MAX_STEPS = 12;
const MAX_OPTIONS = 100;
const MAX_JSON_BYTES = 32_000;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Exact host or `*.example.com`; no scheme, port or path. */
const ORIGIN_PATTERN = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$|^localhost$/;
const UNIQUE_TARGETS = new Set([
  'contact.name',
  'contact.email',
  'contact.phone',
  'contact.company',
  'contact.position',
  'opportunity.title',
  'opportunity.value',
]);

function fail(message: string): never {
  throw new BadRequestException(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > max)
    fail(`${label} must have at most ${max} characters.`);
  return trimmed || null;
}

function defaultTarget(field: Pick<FormField, 'type'>): FormField['target'] {
  if (field.type === 'email') return 'contact.email';
  if (field.type === 'phone') return 'contact.phone';
  return 'none';
}

export function validateFieldsConfig(input: unknown): FormFieldsConfig {
  if (input === undefined || input === null) return { fields: [] };
  if (!isRecord(input) || !Array.isArray(input.fields))
    fail('fields must be an object with a fields array.');
  if (input.fields.length > MAX_FIELDS)
    fail(`A form can have at most ${MAX_FIELDS} fields.`);

  const steps =
    input.steps === undefined || input.steps === null
      ? undefined
      : Array.isArray(input.steps)
        ? input.steps
        : fail('steps must be an array.');
  if (steps && steps.length > MAX_STEPS)
    fail(`A form can have at most ${MAX_STEPS} steps.`);
  const cleanSteps = steps?.map((step, index) => {
    if (!isRecord(step)) fail(`Step ${index + 1} is invalid.`);
    return {
      title:
        text(step.title, 120, `Step ${index + 1} title`) ??
        fail(`Step ${index + 1} needs a title.`),
      description: text(step.description, 300, `Step ${index + 1} description`),
    };
  });

  const keys = new Set<string>();
  const usedTargets = new Set<string>();
  const fields = input.fields.map((raw, index): FormField => {
    const at = `Field ${index + 1}`;
    if (!isRecord(raw)) fail(`${at} is invalid.`);
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (!FIELD_KEY.test(key))
      fail(
        `${at}: key must be lowercase letters, digits or _ (starting with a letter).`,
      );
    if (keys.has(key)) fail(`${at}: duplicated key "${key}".`);
    keys.add(key);

    const type = raw.type as FormField['type'];
    if (!FORM_FIELD_TYPES.includes(type)) fail(`${at}: unknown type.`);

    const label =
      text(raw.label, 200, `${at} label`) ?? fail(`${at} needs a label.`);
    const target = (raw.target ??
      defaultTarget({ type })) as FormField['target'];
    if (!target || !FORM_FIELD_TARGETS.includes(target))
      fail(`${at}: unknown target.`);
    if (UNIQUE_TARGETS.has(target)) {
      if (usedTargets.has(target))
        fail(`${at}: "${target}" is already mapped by another field.`);
      usedTargets.add(target);
    }

    let options: string[] | undefined;
    if (
      type === 'select' ||
      type === 'radio' ||
      (type === 'checkbox' && raw.options !== undefined)
    ) {
      if (!Array.isArray(raw.options) || raw.options.length === 0) {
        if (type !== 'checkbox') fail(`${at}: options are required.`);
      } else {
        if (raw.options.length > MAX_OPTIONS) fail(`${at}: too many options.`);
        options = raw.options.map(
          (option, optionIndex) =>
            text(option, 200, `${at} option ${optionIndex + 1}`) ??
            fail(`${at}: empty option.`),
        );
        if (new Set(options).size !== options.length)
          fail(`${at}: duplicated option.`);
      }
    }

    const step =
      raw.step === undefined || raw.step === null
        ? undefined
        : Number(raw.step);
    if (
      step !== undefined &&
      (!Number.isInteger(step) || step < 0 || step >= (cleanSteps?.length ?? 1))
    )
      fail(`${at}: step out of range.`);

    const maxLength =
      raw.maxLength === undefined || raw.maxLength === null
        ? undefined
        : Number(raw.maxLength);
    if (
      maxLength !== undefined &&
      (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 5000)
    )
      fail(`${at}: maxLength must be between 1 and 5000.`);

    return {
      key,
      label,
      type,
      required: type === 'hidden' ? false : raw.required === true,
      ...(options ? { options } : {}),
      placeholder: text(raw.placeholder, 200, `${at} placeholder`),
      helpText: text(raw.helpText, 500, `${at} help text`),
      target,
      ...(step !== undefined ? { step } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
    };
  });

  return { fields, ...(cleanSteps ? { steps: cleanSteps } : {}) };
}

export function validateDestination(input: unknown): FormDestination {
  if (input === undefined || input === null)
    return { ...DEFAULT_FORM_DESTINATION };
  if (!isRecord(input)) fail('destination must be an object.');
  const target = (input.target ??
    DEFAULT_FORM_DESTINATION.target) as FormDestination['target'];
  if (!FORM_DESTINATION_TARGETS.includes(target))
    fail('destination.target is invalid.');
  const uuidOrNull = (value: unknown, label: string) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !UUID.test(value))
      fail(`${label} must be a UUID.`);
    return value;
  };
  const window =
    input.duplicateWindowDays === undefined
      ? DEFAULT_FORM_DESTINATION.duplicateWindowDays
      : Number(input.duplicateWindowDays);
  if (!Number.isInteger(window) || window < 0 || window > 365)
    fail('destination.duplicateWindowDays must be between 0 and 365.');
  return {
    target,
    pipelineId: uuidOrNull(input.pipelineId, 'destination.pipelineId'),
    stageId: uuidOrNull(input.stageId, 'destination.stageId'),
    ownerUserId: uuidOrNull(input.ownerUserId, 'destination.ownerUserId'),
    duplicateWindowDays: window,
    createContact:
      input.createContact === undefined ? true : input.createContact === true,
  };
}

export function validateSecurity(input: unknown): FormSecurity {
  if (input === undefined || input === null)
    return { ...DEFAULT_FORM_SECURITY };
  if (!isRecord(input)) fail('security must be an object.');
  const origins =
    input.allowedOrigins === undefined ? [] : input.allowedOrigins;
  if (!Array.isArray(origins) || origins.length > 50)
    fail('security.allowedOrigins must be a list of at most 50 domains.');
  const allowedOrigins = [
    ...new Set(
      origins.map((origin) => {
        const host =
          typeof origin === 'string' ? origin.trim().toLowerCase() : '';
        if (!ORIGIN_PATTERN.test(host))
          fail(
            `"${String(origin)}" is not a valid domain (use example.com or *.example.com).`,
          );
        return host;
      }),
    ),
  ];
  const minFill =
    input.minFillSeconds === undefined
      ? DEFAULT_FORM_SECURITY.minFillSeconds
      : Number(input.minFillSeconds);
  if (!Number.isInteger(minFill) || minFill < 0 || minFill > 60)
    fail('security.minFillSeconds must be between 0 and 60.');
  return {
    allowedOrigins,
    minFillSeconds: minFill,
    consentText: text(input.consentText, 1000, 'security.consentText'),
  };
}

export function validateAfterSubmit(input: unknown): FormAfterSubmit {
  if (input === undefined || input === null)
    return { ...DEFAULT_FORM_AFTER_SUBMIT };
  if (!isRecord(input)) fail('afterSubmit must be an object.');
  const mode = input.mode ?? 'message';
  if (mode !== 'message' && mode !== 'redirect')
    fail('afterSubmit.mode is invalid.');
  const redirectUrl = text(input.redirectUrl, 1000, 'afterSubmit.redirectUrl');
  if (mode === 'redirect') {
    if (!redirectUrl) fail('afterSubmit.redirectUrl is required for redirect.');
    let parsed: URL;
    try {
      parsed = new URL(redirectUrl);
    } catch {
      fail('afterSubmit.redirectUrl must be an absolute URL.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      fail('afterSubmit.redirectUrl must use http or https.');
  }
  return {
    mode,
    message: text(input.message, 1000, 'afterSubmit.message'),
    redirectUrl: mode === 'redirect' ? redirectUrl : null,
  };
}

/** presentation/tracking: free-form until F2 types them; only shape and size are enforced. */
export function validateLooseObject(
  input: unknown,
  label: string,
): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) fail(`${label} must be an object.`);
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_JSON_BYTES)
    fail(`${label} is too large.`);
  return input;
}

export function assertPublishable(fields: FormFieldsConfig) {
  if (fields.fields.filter((field) => field.type !== 'hidden').length === 0)
    fail('Add at least one visible field before publishing.');
}
