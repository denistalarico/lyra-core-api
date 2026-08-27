/* eslint-disable @typescript-eslint/require-await -- resume test doubles expose partial service shapes. */
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import {
  SocialAdBackfillResumeError,
  SocialAdSyncDisabledError,
} from '../sync/social-ad-sync-run.error';
import { SocialAdBackfillResumeService } from './social-ad-backfill-resume.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import type {
  SocialAdBackfillChunkOutcome,
  SocialAdSyncRunService,
} from './social-ad-sync-run.service';

const CONNECTION_ID = 'connection-sp';
const ANCHOR = '2026-08-25';

const SCOPE = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  connectionId: CONNECTION_ID,
  requestedById: 'user-1',
};

function createHarness(
  options: {
    enabled?: boolean;
    backfillDays?: number;
    outcomes?: (string | SocialAdBackfillChunkOutcome)[];
    resolveError?: Error;
  } = {},
) {
  const enqueued: Record<string, unknown>[] = [];

  const config = {
    get enabled() {
      return options.enabled ?? true;
    },
    get backfillDays() {
      return options.backfillDays ?? 90;
    },
    get backfillChunkDays() {
      return 7;
    },
  } as SocialAdSyncConfigService;

  const outcomes: SocialAdBackfillChunkOutcome[] = (options.outcomes ?? []).map(
    (entry) =>
      typeof entry === 'string' ? { until: entry, status: 'succeeded' } : entry,
  );

  const runService = {
    listBackfillChunkOutcomes: jest.fn(async () => outcomes),
    enqueue: jest.fn(async (input: Record<string, unknown>) => {
      enqueued.push(input);

      return { run: { id: `run-${enqueued.length}` }, deduplicated: false };
    }),
  };

  const credentialResolver = {
    resolve: jest.fn(async () => {
      if (options.resolveError) throw options.resolveError;

      return {
        connectionId: CONNECTION_ID,
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        provider: 'meta_ads',
        timezone: 'America/Sao_Paulo',
      } as unknown as ResolvedAdCredential;
    }),
  };

  const service = new SocialAdBackfillResumeService(
    config,
    runService as unknown as SocialAdSyncRunService,
    credentialResolver as unknown as SocialAdCredentialResolver,
  );

  return { service, runService, credentialResolver, enqueued };
}

/** The window ends of a full 90-day plan anchored at D-1, newest first. */
const FULL_PLAN_ENDS = Array.from({ length: 13 }, (_, index) =>
  shift(ANCHOR, -index * 7),
);

describe('SocialAdBackfillResumeService', () => {
  it('queues a fresh backfill run for the stalled window', async () => {
    const harness = createHarness({
      outcomes: [ANCHOR, { until: shift(ANCHOR, -7), status: 'dead_letter' }],
    });

    const result = await harness.service.resume(SCOPE);

    expect(result.run.id).toBe('run-1');
    expect(harness.enqueued).toHaveLength(1);
    expect(harness.enqueued[0]).toMatchObject({
      runKind: 'backfill',
      windowStart: '2026-08-12',
      windowEnd: shift(ANCHOR, -7),
      entityLevels: ['account', 'campaign'],
    });
  });

  it('creates a run of kind backfill, never manual', async () => {
    // A `manual` run of the same days writes the same facts and deliberately
    // does not advance the chain — otherwise "complete" would mean "some facts
    // are present", which is the claim this design rejects.
    const harness = createHarness({
      outcomes: [{ until: ANCHOR, status: 'failed' }],
    });

    await harness.service.resume(SCOPE);

    expect(harness.enqueued[0]).toMatchObject({ runKind: 'backfill' });
  });

  it('records who asked for it', async () => {
    const harness = createHarness({
      outcomes: [{ until: ANCHOR, status: 'dead_letter' }],
    });

    await harness.service.resume(SCOPE);

    // The chain's own chunks carry a null requester. This one did not happen on
    // its own, and the run history is where that difference is visible.
    expect(harness.enqueued[0]).toMatchObject({ requestedById: 'user-1' });
  });

  it('keeps the window inside the existing plan', async () => {
    const harness = createHarness({
      outcomes: [
        ANCHOR,
        shift(ANCHOR, -7),
        { until: shift(ANCHOR, -14), status: 'partial' },
      ],
    });

    await harness.service.resume(SCOPE);

    // Chunk 2 of the plan anchored at ANCHOR, to the day. A window computed
    // from today would straddle two chunks and never mark either covered.
    expect(harness.enqueued[0]).toMatchObject({
      windowStart: '2026-08-05',
      windowEnd: '2026-08-11',
    });
  });

  it('takes scope from the resolved connection, never from the request', async () => {
    const harness = createHarness({
      outcomes: [{ until: ANCHOR, status: 'failed' }],
    });

    await harness.service.resume({
      ...SCOPE,
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
    });

    expect(harness.credentialResolver.resolve).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: CONNECTION_ID,
    });
    expect(harness.enqueued[0]).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      provider: 'meta_ads',
    });
  });

  it('refuses a connection outside the caller scope', async () => {
    const harness = createHarness({
      outcomes: [{ until: ANCHOR, status: 'failed' }],
      resolveError: new SocialAdCredentialError('connection_not_found'),
    });

    // The resolver's own refusal travels unchanged: a cross-tenant id is not
    // found rather than forbidden, so nothing here confirms it exists.
    await expect(harness.service.resume(SCOPE)).rejects.toBeInstanceOf(
      SocialAdCredentialError,
    );
    expect(harness.runService.listBackfillChunkOutcomes).not.toHaveBeenCalled();
    expect(harness.enqueued).toHaveLength(0);
  });

  it('refuses while the runtime is switched off', async () => {
    const harness = createHarness({
      enabled: false,
      outcomes: [{ until: ANCHOR, status: 'dead_letter' }],
    });

    await expect(harness.service.resume(SCOPE)).rejects.toBeInstanceOf(
      SocialAdSyncDisabledError,
    );
    // Not even a scope read: a queue nothing drains would answer success and
    // look exactly like a stuck worker.
    expect(harness.credentialResolver.resolve).not.toHaveBeenCalled();
    expect(harness.enqueued).toHaveLength(0);
  });

  it('refuses when the connection has no chain at all', async () => {
    const harness = createHarness({ outcomes: [] });

    await expect(harness.service.resume(SCOPE)).rejects.toMatchObject({
      code: 'backfill_chain_missing',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('refuses when the chain is already complete', async () => {
    const harness = createHarness({ outcomes: FULL_PLAN_ENDS });

    await expect(harness.service.resume(SCOPE)).rejects.toMatchObject({
      code: 'backfill_chain_complete',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('refuses a chunk that is simply waiting its turn', async () => {
    const harness = createHarness({ outcomes: [ANCHOR] });

    // Chunk 1 has never been attempted. Forcing it now would put two chunks in
    // the queue at once, which is the fairness rule the chain is built on.
    await expect(harness.service.resume(SCOPE)).rejects.toMatchObject({
      code: 'backfill_chain_not_stalled',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('refuses a chunk that is already being retried', async () => {
    const harness = createHarness({
      outcomes: [
        ANCHOR,
        { until: shift(ANCHOR, -7), status: 'dead_letter' },
        { until: shift(ANCHOR, -7), status: 'queued' },
      ],
    });

    await expect(harness.service.resume(SCOPE)).rejects.toMatchObject({
      code: 'backfill_chain_not_stalled',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('refuses when backfill itself is turned off', async () => {
    const harness = createHarness({
      backfillDays: 0,
      outcomes: [{ until: ANCHOR, status: 'failed' }],
    });

    await expect(harness.service.resume(SCOPE)).rejects.toBeInstanceOf(
      SocialAdBackfillResumeError,
    );
    expect(harness.enqueued).toHaveLength(0);
  });

  it('resumes the oldest stalled chunk when several windows are short', async () => {
    const harness = createHarness({
      outcomes: [
        ANCHOR,
        { until: shift(ANCHOR, -7), status: 'partial' },
        { until: shift(ANCHOR, -14), status: 'dead_letter' },
      ],
    });

    await harness.service.resume(SCOPE);

    // The first uncovered chunk in plan order, which is the newest of them —
    // the chain fills recent weeks first, and resuming follows the same order.
    expect(harness.enqueued[0]).toMatchObject({
      windowEnd: shift(ANCHOR, -7),
    });
  });

  it('never enqueues more than one run', async () => {
    const harness = createHarness({
      outcomes: [{ until: ANCHOR, status: 'dead_letter' }],
    });

    await harness.service.resume(SCOPE);

    // One row per call, so a chain that is stalled stays a chain — resuming
    // does not start a parallel one.
    expect(harness.runService.enqueue).toHaveBeenCalledTimes(1);
  });
});

function shift(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}
