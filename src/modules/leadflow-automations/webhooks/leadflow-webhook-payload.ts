import { createHmac } from 'node:crypto';

/**
 * What leaves the platform for a subscribed endpoint, and how it is signed.
 *
 * Both are pure functions on purpose: the envelope shape and the signature are
 * the parts an integrator writes code against, so they have to be verifiable
 * without a database, a network or a running Nest context.
 */

export interface WebhookEnvelopeInput {
  deliveryId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: Date;
  tenantId: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** Selected field names; `['*']` or empty means the whole payload. */
  fields: readonly string[];
}

export interface WebhookEnvelope {
  id: string;
  event: string;
  version: number;
  occurredAt: string;
  tenantId: string;
  workspaceId: string;
  resource: { type: string; id: string };
  data: Record<string, unknown>;
}

/** Selecting nothing means selecting everything — see {@link selectFields}. */
export const ALL_FIELDS = '*';

/**
 * The payload narrowed to the fields the operator ticked.
 *
 * An empty selection is read as "everything" rather than "nothing": an endpoint
 * subscribed to an event and receiving `{}` looks broken, and the event contract
 * grows over time — a `['*']` subscription keeps receiving new fields, while an
 * explicit list is a promise that today's shape is what arrives.
 */
export function selectFields(
  payload: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  if (fields.length === 0 || fields.includes(ALL_FIELDS)) {
    return { ...payload };
  }
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      selected[field] = payload[field];
    }
  }
  return selected;
}

export function buildEnvelope(input: WebhookEnvelopeInput): WebhookEnvelope {
  return {
    id: input.deliveryId,
    event: input.eventName,
    version: input.eventVersion,
    occurredAt: input.occurredAt.toISOString(),
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    resource: { type: input.aggregateType, id: input.aggregateId },
    data: selectFields(input.payload, input.fields),
  };
}

/**
 * `t=<unix>,v1=<hex>` over `${timestamp}.${body}`.
 *
 * The scheme is Stripe's, deliberately: an integrator who has verified one
 * webhook signature before has verified this one. Signing the timestamp along
 * with the body is what makes a captured delivery useless later — without it,
 * anyone who ever saw a valid request could replay it forever.
 */
export function signPayload(
  body: string,
  secret: string,
  timestampSeconds: number,
): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${body}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

export type WebhookAttemptOutcome = 'delivered' | 'retry' | 'dead_letter';

/**
 * What a response means for the next attempt.
 *
 * The split is by whose problem it is. 5xx and transport errors are the
 * endpoint's bad day and will likely differ in a minute; 4xx is a disagreement
 * about the request itself, which repeating cannot fix — except 429, which is
 * the endpoint explicitly asking for later, and 408, which is a timeout wearing
 * a status code.
 */
export function classifyAttempt(
  status: number | null,
  attempts: number,
  maxRetries: number,
): WebhookAttemptOutcome {
  if (status !== null && status >= 200 && status < 300) return 'delivered';
  const retryable =
    status === null || status >= 500 || status === 429 || status === 408;
  if (!retryable) return 'dead_letter';
  return attempts > maxRetries ? 'dead_letter' : 'retry';
}

/**
 * Exponential backoff, capped at an hour.
 *
 * The cap matters more than the curve: without it the sixth retry of a
 * `backoffSeconds: 300` endpoint would land nine hours later, long after anyone
 * would connect the delivery to what caused it.
 */
export function nextAttemptDelaySeconds(
  attempts: number,
  backoffSeconds: number,
): number {
  const base = backoffSeconds > 0 ? backoffSeconds : 30;
  const exponent = Math.max(0, attempts - 1);
  return Math.min(base * 2 ** exponent, 3600);
}
