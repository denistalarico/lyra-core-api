import type { SocialAdSyncRunStatus } from '../entities/social-ad-sync-run.entity';
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  RETENTION_DAYS_BY_KIND,
  RETENTION_DAYS_BY_STATUS,
  decideRetention,
  retentionDaysFor,
} from './social-ad-retention.policy';

/**
 * The retention rules, as a pure decision.
 *
 * Every boundary is asserted from both sides, because a retention bug is
 * invisible in production: the evidence that would reveal it is what was
 * deleted.
 */

const NOW = new Date('2026-08-28T12:00:00.000Z');

function ageInDays(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function candidate(overrides: {
  runKind?: string;
  status?: SocialAdSyncRunStatus;
  finishedAt?: Date | null;
}) {
  return {
    runKind: overrides.runKind ?? 'daily',
    status: overrides.status ?? ('succeeded' as SocialAdSyncRunStatus),
    finishedAt:
      overrides.finishedAt === undefined ? ageInDays(1) : overrides.finishedAt,
  };
}

describe('social ad sync run retention policy', () => {
  describe('the backfill exemption', () => {
    // The chain stores no flag: deleting these rows makes a finished backfill
    // read as never started, and the next tick re-fetches ninety days.
    it.each<SocialAdSyncRunStatus>([
      'succeeded',
      'partial',
      'failed',
      'dead_letter',
      'cancelled',
      'queued',
      'processing',
    ])('keeps a backfill run that ended %s, however old', (status) => {
      const decision = decideRetention(
        candidate({ runKind: 'backfill', status, finishedAt: ageInDays(3650) }),
        NOW,
      );

      expect(decision).toEqual({ retain: true, reason: 'backfill_exempt' });
    });

    it('exempts backfill before any other rule is consulted', () => {
      // Ten years old, terminal, and with a timestamp — every other rule would
      // delete it. The exemption is checked first for exactly this case.
      const decision = decideRetention(
        candidate({
          runKind: 'backfill',
          status: 'dead_letter',
          finishedAt: ageInDays(3650),
        }),
        NOW,
      );

      expect(decision.retain).toBe(true);
    });
  });

  describe('runs that are not terminal', () => {
    it.each<SocialAdSyncRunStatus>(['queued', 'processing'])(
      'never deletes a %s run, however old',
      (status) => {
        const decision = decideRetention(
          candidate({ status, finishedAt: null }),
          NOW,
        );

        expect(decision).toEqual({ retain: true, reason: 'not_terminal' });
      },
    );

    it('leaves a long-stuck processing run to the stale recovery sweep', () => {
      // `recoverStale` requeues or dead-letters it according to the attempts it
      // has left. Deleting it here would destroy a run mid-flight.
      const decision = decideRetention(
        candidate({ status: 'processing', finishedAt: ageInDays(400) }),
        NOW,
      );

      expect(decision.retain).toBe(true);
    });
  });

  describe('a terminal run without a finish timestamp', () => {
    it.each<SocialAdSyncRunStatus>([
      'succeeded',
      'partial',
      'failed',
      'dead_letter',
      'cancelled',
    ])('keeps a %s run whose finished_at is null', (status) => {
      const decision = decideRetention(
        candidate({ status, finishedAt: null }),
        NOW,
      );

      expect(decision).toEqual({ retain: true, reason: 'missing_finished_at' });
    });
  });

  describe('succeeded runs, by kind', () => {
    it('deletes an intraday run past thirty days', () => {
      const decision = decideRetention(
        candidate({ runKind: 'intraday', finishedAt: ageInDays(31) }),
        NOW,
      );

      expect(decision).toEqual({ retain: false, days: 30, rule: 'kind' });
    });

    it('keeps an intraday run at twenty-nine days', () => {
      const decision = decideRetention(
        candidate({ runKind: 'intraday', finishedAt: ageInDays(29) }),
        NOW,
      );

      expect(decision.retain).toBe(true);
    });

    it('keeps an intraday run exactly at the boundary', () => {
      // The comparison is strictly greater: the boundary day itself is inside
      // the window.
      const decision = decideRetention(
        candidate({ runKind: 'intraday', finishedAt: ageInDays(30) }),
        NOW,
      );

      expect(decision).toEqual({ retain: true, reason: 'within_retention' });
    });

    it.each(['daily', 'manual', 'entities'])(
      'deletes a %s run past ninety days',
      (runKind) => {
        const decision = decideRetention(
          candidate({ runKind, finishedAt: ageInDays(91) }),
          NOW,
        );

        expect(decision).toEqual({ retain: false, days: 90, rule: 'kind' });
      },
    );

    it.each(['daily', 'manual', 'entities'])(
      'keeps a %s run at eighty-nine days',
      (runKind) => {
        const decision = decideRetention(
          candidate({ runKind, finishedAt: ageInDays(89) }),
          NOW,
        );

        expect(decision.retain).toBe(true);
      },
    );
  });

  describe('failure statuses, at every kind', () => {
    it.each<SocialAdSyncRunStatus>([
      'partial',
      'failed',
      'dead_letter',
      'cancelled',
    ])('deletes a %s run past a hundred and eighty days', (status) => {
      const decision = decideRetention(
        candidate({ status, finishedAt: ageInDays(181) }),
        NOW,
      );

      expect(decision).toEqual({ retain: false, days: 180, rule: 'status' });
    });

    it.each<SocialAdSyncRunStatus>([
      'partial',
      'failed',
      'dead_letter',
      'cancelled',
    ])('keeps a %s run at a hundred and seventy-nine days', (status) => {
      const decision = decideRetention(
        candidate({ status, finishedAt: ageInDays(179) }),
        NOW,
      );

      expect(decision.retain).toBe(true);
    });
  });

  describe('status precedence over kind', () => {
    it('keeps a dead-lettered intraday run past its kind period', () => {
      // Thirty days by kind, a hundred and eighty by status. A failure is
      // evidence; a success is a receipt, so the failure wins.
      const decision = decideRetention(
        candidate({
          runKind: 'intraday',
          status: 'dead_letter',
          finishedAt: ageInDays(90),
        }),
        NOW,
      );

      expect(decision).toEqual({ retain: true, reason: 'within_retention' });
    });

    it('deletes it once the status period has elapsed', () => {
      const decision = decideRetention(
        candidate({
          runKind: 'intraday',
          status: 'dead_letter',
          finishedAt: ageInDays(181),
        }),
        NOW,
      );

      expect(decision).toEqual({ retain: false, days: 180, rule: 'status' });
    });

    it.each<SocialAdSyncRunStatus>(['partial', 'failed', 'dead_letter'])(
      'resolves intraday + %s to the status period',
      (status) => {
        expect(retentionDaysFor('intraday', status)).toBe(180);
      },
    );

    it('resolves a succeeded run to its kind period', () => {
      expect(retentionDaysFor('intraday', 'succeeded')).toBe(30);
      expect(retentionDaysFor('daily', 'succeeded')).toBe(90);
    });
  });

  describe('a run kind the policy has never heard of', () => {
    // `run_kind` is an unconstrained varchar by design, so a kind added later
    // reaches this policy before anybody assigns it a period.
    it('falls back to the conservative default rather than the shortest', () => {
      expect(retentionDaysFor('some_future_kind', 'succeeded')).toBe(
        DEFAULT_RETENTION_DAYS,
      );
      expect(DEFAULT_RETENTION_DAYS).toBe(
        Math.max(...Object.values(RETENTION_DAYS_BY_KIND)),
      );
    });

    it('still deletes it eventually', () => {
      const decision = decideRetention(
        candidate({ runKind: 'some_future_kind', finishedAt: ageInDays(91) }),
        NOW,
      );

      expect(decision).toEqual({ retain: false, days: 90, rule: 'kind' });
    });
  });

  it('never retains anything longer than the declared maximum', () => {
    // A guard on the constants themselves: the log line and the production
    // audit both quote this figure.
    expect(MAX_RETENTION_DAYS).toBe(180);
    expect(Math.max(...Object.values(RETENTION_DAYS_BY_STATUS as Record<string, number>))).toBe(
      MAX_RETENTION_DAYS,
    );
  });
});
