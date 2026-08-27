import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import { MetaGraphError } from '../services/meta-graph-error';
import {
  SocialAdInsightsTruncatedError,
  SocialAdInsightsWindowNotClosedError,
  SocialAdInsightsWindowNotIntradayError,
} from './social-ad-insights.error';
import { SocialAdSyncRunPlanError } from './social-ad-sync-run.error';
import {
  classifySocialAdSyncRetry,
  nextAvailableAt,
} from './social-ad-sync-retry';

const NOW = new Date('2026-08-26T12:00:00.000Z');

function graphError(
  kind: 'transient' | 'rate_limited' | 'auth' | 'permanent',
  extra: { metaCode?: number; metaSubcode?: number; httpStatus?: number } = {},
) {
  return new MetaGraphError({
    kind,
    safeMessage: 'Meta Ads campaign insights read failed.',
    ...extra,
  });
}

describe('classifySocialAdSyncRetry', () => {
  it('retries a transient failure', () => {
    expect(classifySocialAdSyncRetry(graphError('transient'))).toMatchObject({
      action: 'backoff',
      code: 'meta_transient',
    });
  });

  it('backs a rate limit off on its own ladder', () => {
    expect(classifySocialAdSyncRetry(graphError('rate_limited'))).toMatchObject(
      {
        action: 'rate_limit',
        code: 'meta_rate_limited',
      },
    );
  });

  it('separates an expired credential from a missing permission', () => {
    // Both are `kind: 'auth'` and both are unretryable, and they are opposite
    // instructions to the person who has to fix them: one re-authorizes, the
    // other grants a role in Business Manager.
    const invalid = classifySocialAdSyncRetry(
      graphError('auth', { metaCode: 190 }),
    );
    const denied = classifySocialAdSyncRetry(
      graphError('auth', { metaCode: 200 }),
    );

    expect(invalid).toMatchObject({
      action: 'stop',
      code: 'meta_credential_invalid',
    });
    expect(denied).toMatchObject({
      action: 'stop',
      code: 'meta_permission_denied',
    });
  });

  it('does not guess a reason Meta did not give', () => {
    expect(
      classifySocialAdSyncRetry(graphError('auth', { httpStatus: 401 })),
    ).toMatchObject({ code: 'meta_auth_unclassified' });
  });

  it('never retries a permanent refusal', () => {
    expect(classifySocialAdSyncRetry(graphError('permanent'))).toMatchObject({
      action: 'stop',
    });
  });

  it('never retries a credential refusal', () => {
    // No code in this vocabulary gets better by being asked again: an unbound
    // account, a removed credential and a drifted internal configuration all
    // wait on a person.
    for (const code of [
      'connection_not_found',
      'token_expired',
      'account_not_bound',
      'internal_account_drift',
      'timezone_missing',
    ] as const) {
      expect(
        classifySocialAdSyncRetry(new SocialAdCredentialError(code)),
      ).toMatchObject({ action: 'stop', code });
    }
  });

  it('stops on a run that cannot describe its own work', () => {
    expect(
      classifySocialAdSyncRetry(
        new SocialAdSyncRunPlanError('run_window_missing'),
      ),
    ).toMatchObject({ action: 'stop', code: 'run_window_missing' });
  });

  it('retries an unclassified failure and names it as one', () => {
    // A database blip mid-write and a bug are indistinguishable from here.
    // Retrying is right for the first and harmless for the second, because
    // every write in this pipeline is an idempotent upsert.
    expect(classifySocialAdSyncRetry(new Error('boom'))).toMatchObject({
      action: 'backoff',
      code: 'internal_error',
    });
  });

  it('reports a truncated window as its own condition', () => {
    expect(
      classifySocialAdSyncRetry(new SocialAdInsightsTruncatedError('campaign')),
    ).toMatchObject({ code: 'insights_window_truncated' });
  });

  it('never carries a provider message into the code', () => {
    const error = new MetaGraphError({
      kind: 'permanent',
      safeMessage: 'Unsupported get request on act_415877197389621.',
    });

    // The code is stored on the run and rendered in the settings UI. Meta's
    // messages carry account ids; the code is a name for a condition.
    expect(classifySocialAdSyncRetry(error).code).toBe('meta_permanent');
  });
});

describe('nextAvailableAt', () => {
  it('doubles a transient wait from thirty seconds', () => {
    const delays = [1, 2, 3, 4, 5].map(
      (attempts) =>
        nextAvailableAt({
          action: 'backoff',
          attempts,
          retryAfterMs: null,
          now: NOW,
        }).getTime() - NOW.getTime(),
    );

    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
  });

  it('climbs the rate-limit ladder in minutes, not seconds', () => {
    const delays = [1, 2, 3, 4, 5, 9].map(
      (attempts) =>
        nextAvailableAt({
          action: 'rate_limit',
          attempts,
          retryAfterMs: null,
          now: NOW,
        }).getTime() - NOW.getTime(),
    );

    // A 30-second retry against a throttle does not fail — it spends quota the
    // account's other reads then do not have.
    expect(delays).toEqual([
      5 * 60_000,
      10 * 60_000,
      20 * 60_000,
      40 * 60_000,
      60 * 60_000,
      // Past the end of the ladder it holds at the ceiling rather than
      // returning undefined.
      60 * 60_000,
    ]);
  });

  it('honours Meta when Meta asks for longer', () => {
    const at = nextAvailableAt({
      action: 'rate_limit',
      attempts: 1,
      retryAfterMs: 90 * 60_000,
      now: NOW,
    });

    expect(at.getTime() - NOW.getTime()).toBe(90 * 60_000);
  });

  it('never lets Meta shorten the wait below our own floor', () => {
    // The provider knows when its quota recovers; undercutting its advice is
    // how a run spends the rest of the business's budget rediscovering it.
    const at = nextAvailableAt({
      action: 'rate_limit',
      attempts: 3,
      retryAfterMs: 1_000,
      now: NOW,
    });

    expect(at.getTime() - NOW.getTime()).toBe(20 * 60_000);
  });

  it('treats a first attempt and a zeroth the same', () => {
    expect(
      nextAvailableAt({
        action: 'backoff',
        attempts: 0,
        retryAfterMs: null,
        now: NOW,
      }).getTime(),
    ).toBe(
      nextAvailableAt({
        action: 'backoff',
        attempts: 1,
        retryAfterMs: null,
        now: NOW,
      }).getTime(),
    );
  });
});

describe('classifySocialAdSyncRetry — window mismatches', () => {
  it('stops a closed run that reached into an unfinished day', () => {
    // Without this branch the error falls through to the unclassified one:
    // five retries, five identical entries in the log, and a cause named
    // `internal_error` rather than after the window that caused it.
    expect(
      classifySocialAdSyncRetry(
        new SocialAdInsightsWindowNotClosedError(
          '2026-08-25',
          'America/Sao_Paulo',
        ),
      ),
    ).toEqual({
      action: 'stop',
      code: 'insights_window_not_closed',
      retryAfterMs: null,
    });
  });

  it('stops an intraday run whose day has turned over', () => {
    // Retrying cannot help: the date it was created for will never be today
    // again. The next bucket's run covers the new day.
    expect(
      classifySocialAdSyncRetry(
        new SocialAdInsightsWindowNotIntradayError(
          '2026-08-27',
          'America/Sao_Paulo',
        ),
      ),
    ).toEqual({
      action: 'stop',
      code: 'insights_window_not_intraday',
      retryAfterMs: null,
    });
  });

  it('still retries a rate limit on the ladder S2.5 established', () => {
    // The new branches must not have moved anything else. A backfill chunk and
    // an intraday pass reach the identical policy a manual run does.
    expect(classifySocialAdSyncRetry(graphError('rate_limited'))).toMatchObject(
      {
        action: 'rate_limit',
      },
    );
    expect(classifySocialAdSyncRetry(graphError('transient'))).toMatchObject({
      action: 'backoff',
    });
  });
});
