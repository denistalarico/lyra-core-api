import { BadRequestException } from '@nestjs/common';

/**
 * How a Meta Graph failure should be treated by whatever called it.
 *
 * Four kinds, because four is what changes behaviour downstream:
 *
 * - `transient`    — nothing is wrong with us; try again later.
 * - `rate_limited` — we are the problem; back off, and for how long is often
 *                    stated in the usage headers rather than in the body.
 * - `auth`         — the credential cannot do this. Retrying is pointless and
 *                    an operator has to act (re-authorize, fix the System User).
 * - `permanent`    — the request itself is wrong. Retrying is pointless and
 *                    retrying forever is a bug.
 *
 * S2.1 only classifies. Nothing here retries, sleeps or schedules — the sync
 * pipeline that will consume these kinds does not exist yet, and a backoff
 * policy written before its caller would be a guess.
 */
export type MetaGraphErrorKind =
  | 'transient'
  | 'rate_limited'
  | 'auth'
  | 'permanent';

/**
 * Why an `auth` failure happened, when Meta says enough to tell.
 *
 * `kind: 'auth'` answers "should I retry?" (no). It does not answer "should the
 * connection be stopped?", and those are different questions with different
 * blast radii. A revoked or expired token means every future call fails until a
 * human re-authorizes, so a scheduler is right to park the connection. A missing
 * permission means the token is perfectly valid and someone has to grant a role
 * or a scope in Business Manager — parking the connection there would present an
 * operator with "your credential is invalid", send them to re-authorize, and
 * hand them the same failure afterwards.
 *
 * - `credential_invalid`  — the token itself is expired, revoked or malformed.
 * - `permission_denied`   — the token is fine; it lacks a permission or a role.
 * - `auth_unclassified`   — Meta refused the credential without saying which.
 *
 * The third value is not a gap to be filled in later by guessing. It is the
 * honest answer when the only evidence is an HTTP 401 with no Meta code, and a
 * future policy should treat it as "alert a human", never as "revoke".
 */
export type MetaGraphAuthReason =
  | 'credential_invalid'
  | 'permission_denied'
  | 'auth_unclassified';

/**
 * Rate-limit signals Meta puts in headers rather than in the body.
 *
 * Percentages only, never the raw header: the business-use-case header is keyed
 * by Business Manager id, and this metadata travels into logs.
 *
 * Observed in production against the internal ad account: Meta sent
 * `X-Business-Use-Case-Usage` and *not* `X-Ad-Account-Usage`, so both fields
 * are independently nullable and no caller may assume either is present.
 */
export type MetaGraphUsage = {
  /** Highest of call/cpu/time percentages across every business bucket. */
  businessUseCasePercent: number | null;
  /** `acc_id_util_pct`, when Meta sends the ad-account header at all. */
  adAccountPercent: number | null;
  /** `estimated_time_to_regain_access`, converted from minutes. */
  regainAccessInMs: number | null;
  /** `Retry-After`, converted from seconds. */
  retryAfterMs: number | null;
};

export const EMPTY_META_GRAPH_USAGE: MetaGraphUsage = {
  businessUseCasePercent: null,
  adAccountPercent: null,
  regainAccessInMs: null,
  retryAfterMs: null,
};

/** Meta codes that mean "slow down", including the Marketing API's 80000 band. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);
const RATE_LIMIT_CODE_RANGE = { min: 80000, max: 80004 };

/**
 * Meta codes that mean the token is expired, revoked or otherwise unusable.
 *
 * 102 is an invalid or expired session; 190 is the OAuthException family, whose
 * subcodes spell out the same story in more detail (463 expired, 467 invalid,
 * 460 password changed, 458 app removed, 459 user checkpointed). All of them
 * need the same remedy: someone re-authorizes the connection.
 */
const CREDENTIAL_INVALID_CODES = new Set([102, 190]);

/**
 * Meta codes that mean the token is valid but is not allowed to do this.
 *
 * - 10  — the app lacks permission for the action.
 * - 200 — the granted permissions do not cover the request (missing scope, or a
 *         System User without a role on the ad account or the Business).
 * - 294 — the endpoint requires `ads_management`. In a read-only product this
 *         one is a design signal too: S2 asks for `ads_read`, so a 294 means a
 *         caller reached a write edge, not that the credential degraded.
 *
 * None of these get better by re-authorizing with the same roles, which is why
 * they must not be filed as "credential invalid".
 */
const PERMISSION_DENIED_CODES = new Set([10, 200, 294]);

/**
 * Subcodes that override their code's usual meaning.
 *
 * 190/492 is an OAuthException by code but an authorization problem in fact —
 * "the session does not have permission to access the object". The token is
 * valid; the identity behind it is not an admin of the object.
 */
const PERMISSION_DENIED_SUBCODES = new Set([492]);

/** Meta codes that mean the credential is the problem, not the request. */
const AUTH_CODES = new Set([
  ...CREDENTIAL_INVALID_CODES,
  ...PERMISSION_DENIED_CODES,
]);

/**
 * A classified Meta Graph failure.
 *
 * Extends `BadRequestException` deliberately. Every S1 caller either catches
 * broadly or lets the exception reach a controller that has answered 400 since
 * the connection flow shipped; changing the base class would change those
 * responses. The classification rides along as data, so the sync pipeline can
 * branch on `kind` without anyone branching on an HTTP status that only ever
 * described the connection endpoints.
 *
 * The message is always safe to persist: it is either a fixed string or a
 * provider message that has been through `sanitizeMetaErrorMessage`.
 */
export class MetaGraphError extends BadRequestException {
  readonly kind: MetaGraphErrorKind;
  readonly httpStatus: number | null;
  readonly metaCode: number | null;
  readonly metaSubcode: number | null;
  readonly usage: MetaGraphUsage;
  /** Set only when `kind === 'auth'`; `null` for every other kind. */
  readonly authReason: MetaGraphAuthReason | null;

  constructor(input: {
    kind: MetaGraphErrorKind;
    safeMessage: string;
    httpStatus?: number | null;
    metaCode?: number | null;
    metaSubcode?: number | null;
    usage?: MetaGraphUsage;
  }) {
    super(input.safeMessage);
    this.name = 'MetaGraphError';
    this.kind = input.kind;
    this.httpStatus = input.httpStatus ?? null;
    this.metaCode = input.metaCode ?? null;
    this.metaSubcode = input.metaSubcode ?? null;
    this.usage = input.usage ?? EMPTY_META_GRAPH_USAGE;
    // Derived here rather than passed in, so there is no second call site to
    // forget: every auth error carries a reason by construction.
    this.authReason =
      input.kind === 'auth'
        ? classifyGraphAuthReason({
            httpStatus: this.httpStatus,
            metaCode: this.metaCode,
            metaSubcode: this.metaSubcode,
          })
        : null;
  }

  /** How long the provider suggests waiting, when it says anything at all. */
  get retryAfterMs(): number | null {
    return this.usage.retryAfterMs ?? this.usage.regainAccessInMs;
  }
}

/**
 * Classifies a failed Graph response.
 *
 * The Meta error code wins over the HTTP status, because the Marketing API
 * answers 400 for most things including rate limits — trusting the status would
 * file "you are throttled" under `permanent` and stop a sync that only needed
 * to wait.
 */
export function classifyGraphResponse(input: {
  httpStatus: number | null;
  metaCode: number | null;
  metaSubcode: number | null;
}): MetaGraphErrorKind {
  const { httpStatus, metaCode } = input;

  if (metaCode !== null) {
    if (isRateLimitCode(metaCode)) return 'rate_limited';
    if (AUTH_CODES.has(metaCode)) return 'auth';
    // 1 (unknown) and 2 (service) are Meta saying it failed, not us.
    if (metaCode === 1 || metaCode === 2) return 'transient';
  }

  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus !== null && httpStatus >= 500) return 'transient';
  if (httpStatus === 401 || httpStatus === 403) return 'auth';

  return 'permanent';
}

/**
 * Separates "the credential is broken" from "the credential is not allowed".
 *
 * Only called for failures already classified as `auth`. The subcode is read
 * before the code, because a subcode is the more specific evidence when Meta
 * bothers to send one.
 *
 * Returns `auth_unclassified` whenever the evidence does not actually support a
 * decision. That is the deliberate part: a policy that stops a connection needs
 * proof the token is dead, and an unexplained 401 is not proof.
 */
export function classifyGraphAuthReason(input: {
  httpStatus: number | null;
  metaCode: number | null;
  metaSubcode: number | null;
}): MetaGraphAuthReason {
  // The HTTP status is accepted to mirror `classifyGraphResponse`, and then
  // deliberately not used: Meta returns 403 for app-level blocks and 401 for
  // expired tokens interchangeably, so the status distinguishes nothing here.
  const { metaCode, metaSubcode } = input;

  if (metaSubcode !== null && PERMISSION_DENIED_SUBCODES.has(metaSubcode)) {
    return 'permission_denied';
  }

  if (metaCode !== null) {
    if (PERMISSION_DENIED_CODES.has(metaCode)) return 'permission_denied';
    if (CREDENTIAL_INVALID_CODES.has(metaCode)) return 'credential_invalid';
  }

  return 'auth_unclassified';
}

function isRateLimitCode(code: number) {
  return (
    RATE_LIMIT_CODES.has(code) ||
    (code >= RATE_LIMIT_CODE_RANGE.min && code <= RATE_LIMIT_CODE_RANGE.max)
  );
}

/**
 * Classifies a request that never produced a response.
 *
 * A timeout and a reset socket are the same thing to a caller: the account is
 * fine, the moment was not. Both are `transient`, and neither message is ever
 * taken from the thrown error — a DNS or TLS failure routinely stringifies the
 * full URL, which carries the access token in its query string.
 */
export function classifyGraphTransportFailure(error: unknown): {
  kind: MetaGraphErrorKind;
  safeMessage: string;
} {
  const name = error instanceof Error ? error.name : '';

  if (name === 'TimeoutError' || name === 'AbortError') {
    return {
      kind: 'transient',
      safeMessage: 'Meta Graph API request timed out.',
    };
  }

  return { kind: 'transient', safeMessage: 'Meta Graph API request failed.' };
}

type HeaderReader = { get(name: string): string | null } | null | undefined;

/**
 * Reads the rate-limit headers, when the response has any.
 *
 * Tolerant by construction: headers are advisory, they are absent on some
 * edges, and a malformed one must never be the reason a read fails. Every
 * failure to parse degrades to `null`, which reads as "no signal" rather than
 * as "plenty of quota".
 */
export function parseMetaGraphUsage(headers: HeaderReader): MetaGraphUsage {
  if (!headers || typeof headers.get !== 'function') {
    return EMPTY_META_GRAPH_USAGE;
  }

  const businessUsage = parseBusinessUseCaseUsage(
    headers.get('x-business-use-case-usage'),
  );

  return {
    businessUseCasePercent: businessUsage.percent,
    adAccountPercent: parseAdAccountUsage(headers.get('x-ad-account-usage')),
    regainAccessInMs: businessUsage.regainAccessInMs,
    retryAfterMs: parseRetryAfter(headers.get('retry-after')),
  };
}

/** The single number a caller should throttle on: the worst of the two. */
export function peakUsagePercent(usage: MetaGraphUsage): number | null {
  const values = [usage.businessUseCasePercent, usage.adAccountPercent].filter(
    (value): value is number => value !== null,
  );

  return values.length ? Math.max(...values) : null;
}

function parseBusinessUseCaseUsage(value: string | null) {
  const parsed = parseJsonObject(value);

  if (!parsed) return { percent: null, regainAccessInMs: null };

  let percent: number | null = null;
  let regainAccessMinutes: number | null = null;

  // Shape: { "<business_id>": [{ type, call_count, total_cputime, ... }] }
  for (const buckets of Object.values(parsed)) {
    if (!Array.isArray(buckets)) continue;

    for (const bucket of buckets) {
      if (typeof bucket !== 'object' || bucket === null) continue;

      const entry = bucket as Record<string, unknown>;

      for (const key of ['call_count', 'total_cputime', 'total_time']) {
        const candidate = readNumber(entry[key]);
        if (candidate !== null && (percent === null || candidate > percent)) {
          percent = candidate;
        }
      }

      const regain = readNumber(entry.estimated_time_to_regain_access);
      if (
        regain !== null &&
        regain > 0 &&
        (regainAccessMinutes === null || regain > regainAccessMinutes)
      ) {
        regainAccessMinutes = regain;
      }
    }
  }

  return {
    percent,
    regainAccessInMs:
      regainAccessMinutes === null ? null : regainAccessMinutes * 60_000,
  };
}

function parseAdAccountUsage(value: string | null) {
  const parsed = parseJsonObject(value);

  return parsed ? readNumber(parsed.acc_id_util_pct) : null;
}

function parseRetryAfter(value: string | null) {
  const seconds = readNumber(value);

  return seconds !== null && seconds >= 0 ? seconds * 1000 : null;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);

    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}
