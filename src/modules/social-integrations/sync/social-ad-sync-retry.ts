import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import { MetaGraphError } from '../services/meta-graph-error';
import { SocialAdSyncRunPlanError } from './social-ad-sync-run.error';
import { describeSocialAdSyncFailure } from './social-ad-sync.http-error';

/**
 * What the queue should do about a failure.
 *
 * - `backoff`     — nothing is wrong with us; come back in a moment.
 * - `rate_limit`  — we are the problem; come back much later.
 * - `stop`        — retrying changes nothing. A person has to act.
 *
 * The third value is the one worth defending. A queue whose only two states are
 * "retry" and "retry slower" will hammer an expired token five times, write
 * five identical failures into the run log, and present an operator with a
 * connection that failed for five different-looking reasons at five different
 * times. `stop` is how a credential problem stays legible.
 */
export type SocialAdSyncRetryAction = 'backoff' | 'rate_limit' | 'stop';

export type SocialAdSyncRetryPolicy = {
  action: SocialAdSyncRetryAction;
  /** Safe code for `last_error` and `failed_segments`. Never a provider string. */
  code: string;
  /** Meta's own advice about when to come back, when it gave any. */
  retryAfterMs: number | null;
};

/**
 * Transient backoff: 30s, 1m, 2m, 4m, 8m.
 *
 * Doubling from a low floor because a transient failure is usually over in
 * seconds — a reset socket, a Graph 500 — and a first retry ten minutes later
 * would turn a blip into a visibly late sync. The ceiling exists so the last
 * attempt of a long-broken connection is not scheduled into the next day.
 */
const TRANSIENT_BASE_MS = 30_000;
const TRANSIENT_CEILING_MS = 8 * 60_000;

/**
 * Rate-limit backoff: 5, 10, 20, 40, 60 minutes.
 *
 * A different ladder from the transient one because it is a different failure.
 * The Marketing API meters CPU time against a business-wide quota that recovers
 * on the scale of an hour, so a 30-second retry does not fail — it *spends*
 * quota that the account's other reads then do not have, and pushes the whole
 * business further into the penalty. The floor is minutes for that reason.
 */
const RATE_LIMIT_LADDER_MS = [
  5 * 60_000,
  10 * 60_000,
  20 * 60_000,
  40 * 60_000,
  60 * 60_000,
];

/**
 * Reads a failure as a queue decision.
 *
 * The *code* comes from `describeSocialAdSyncFailure`, which is already the one
 * place that turns these two error vocabularies into safe strings — so a code
 * stored on a run and a code returned by the synchronous endpoints mean the
 * same thing. Only the action is decided here.
 */
export function classifySocialAdSyncRetry(
  error: unknown,
): SocialAdSyncRetryPolicy {
  const { code } = describeSocialAdSyncFailure(error);

  if (error instanceof MetaGraphError) {
    switch (error.kind) {
      case 'transient':
        return { action: 'backoff', code, retryAfterMs: error.retryAfterMs };

      case 'rate_limited':
        return { action: 'rate_limit', code, retryAfterMs: error.retryAfterMs };

      case 'auth':
        /**
         * Filed under its reason, not under "auth".
         *
         * `credential_invalid` and `permission_denied` look identical to a retry
         * policy — neither is retryable — and are opposite instructions to the
         * person who has to fix them. One means "re-authorize this connection";
         * the other means "the token is fine, grant this System User a role in
         * Business Manager". Recording both as `meta_auth` would send an
         * operator to re-authorize and hand them the same failure afterwards.
         */
        return {
          action: 'stop',
          code: `meta_${error.authReason ?? 'auth_unclassified'}`,
          retryAfterMs: null,
        };

      case 'permanent':
        return { action: 'stop', code, retryAfterMs: null };
    }
  }

  // Every credential refusal is a stop. There is no code in that vocabulary a
  // retry could fix: an unbound account, a removed credential, a drifted
  // internal configuration and an unreadable timezone all wait on a person.
  if (error instanceof SocialAdCredentialError) {
    return { action: 'stop', code, retryAfterMs: null };
  }

  // A run that cannot describe its own work will describe it the same way next
  // time. The code names the defect rather than the symptom, so the runs list
  // points at the row instead of at the provider.
  if (error instanceof SocialAdSyncRunPlanError) {
    return { action: 'stop', code: error.code, retryAfterMs: null };
  }

  /**
   * Anything else retries with backoff, and then dead-letters.
   *
   * Unclassified covers both a real bug and a database blip mid-write, and the
   * two are indistinguishable from here. Retrying is right for the second and
   * harmless for the first — the writes are idempotent upserts — and the
   * attempt ceiling is what stops a bug from retrying forever. It surfaces as
   * `dead_letter`, which is the state that means "gave up", rather than as a
   * run that silently stopped.
   */
  return { action: 'backoff', code, retryAfterMs: null };
}

/**
 * When a rescheduled run becomes available again.
 *
 * `attempts` is the number already spent, so the first retry reads index 0.
 * Meta's own `Retry-After` never shortens the wait — it only lengthens it. The
 * provider knows when its quota recovers and we do not, and undercutting that
 * advice is how a run spends the rest of the business's quota discovering the
 * same thing again.
 */
export function nextAvailableAt(input: {
  action: Exclude<SocialAdSyncRetryAction, 'stop'>;
  attempts: number;
  retryAfterMs: number | null;
  now: Date;
}): Date {
  const index = Math.max(0, input.attempts - 1);

  const ladder =
    input.action === 'rate_limit'
      ? RATE_LIMIT_LADDER_MS[Math.min(index, RATE_LIMIT_LADDER_MS.length - 1)]
      : Math.min(TRANSIENT_CEILING_MS, TRANSIENT_BASE_MS * 2 ** index);

  const delay = Math.max(ladder, input.retryAfterMs ?? 0);

  return new Date(input.now.getTime() + delay);
}
