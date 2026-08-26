import { BadRequestException, Logger } from '@nestjs/common';
import { createResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import type { NormalizedAdMetricDaily } from '../sync/meta-ads-insights.contract';
import { MetaGraphError } from './meta-graph-error';
import type { MetaAdsInsightsReaderService } from './meta-ads-insights-reader.service';
import { SocialAdInsightsSyncService } from './social-ad-insights-sync.service';
import type { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';

const ACCOUNT_ID = 'act_415877197389621';
const SECRET_TOKEN = 'EAA-super-secret-system-user-token';

const INPUT = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  connectionId: 'connection-id',
  since: '2026-07-06',
  until: '2026-07-22',
};

function row(level: 'account' | 'campaign'): NormalizedAdMetricDaily {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    connectionId: 'connection-id',
    provider: 'meta_ads',
    source: 'paid',
    entityLevel: level,
    entityExternalId: level === 'account' ? ACCOUNT_ID : '120244382299410411',
    campaignExternalId: level === 'account' ? null : '120244382299410411',
    metricDate: '2026-07-10',
    accountTimezone: 'America/Sao_Paulo',
    currency: 'BRL',
    attributionSetting: 'account_default',
    spend: '11.510000',
    impressions: '412',
    reach: '380',
    clicks: '5',
    linkClicks: '3',
    leads: '2',
    conversions: '2.000000',
    conversionValue: '0.000000',
    videoViews: '72',
    actions: { counts: {}, values: {} },
    isPartial: false,
    syncedAt: new Date(),
  };
}

function createHarness(
  options: {
    resolveFailure?: Error;
    readFailure?: { level: 'account' | 'campaign'; error: Error };
    truncatedLevel?: 'account' | 'campaign';
    authorizationMethod?: 'business_login' | 'internal_system_user';
    accessToken?: string;
  } = {},
) {
  const reads: string[] = [];
  const writes: NormalizedAdMetricDaily[][] = [];

  const resolver = {
    resolve: jest.fn(() => {
      if (options.resolveFailure) return Promise.reject(options.resolveFailure);

      return Promise.resolve(
        createResolvedAdCredential({
          connectionId: 'connection-id',
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          agencyClientId: null,
          provider: 'meta_ads',
          authorizationMethod: options.authorizationMethod ?? 'business_login',
          externalAccountId: ACCOUNT_ID,
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          credentialVersion: 1,
          tokenExpiresAt: null,
          accessToken: options.accessToken ?? SECRET_TOKEN,
        }),
      );
    }),
  };

  const reader = {
    read: jest.fn(
      (input: { level: 'account' | 'campaign'; syncedAt: Date }) => {
        reads.push(input.level);

        if (options.readFailure?.level === input.level) {
          return Promise.reject(options.readFailure.error);
        }

        return Promise.resolve({
          rows: [row(input.level)],
          truncated: options.truncatedLevel === input.level,
          skipped: 0,
        });
      },
    ),
  };

  const writer = {
    upsert: jest.fn((rows: NormalizedAdMetricDaily[]) => {
      writes.push(rows);
      return Promise.resolve(rows.length);
    }),
  };

  return {
    service: new SocialAdInsightsSyncService(
      resolver as unknown as SocialAdCredentialResolver,
      reader as unknown as MetaAdsInsightsReaderService,
      writer as unknown as SocialAdMetricsWriterService,
    ),
    resolver,
    reader,
    writer,
    reads,
    writes,
  };
}

describe('SocialAdInsightsSyncService — the happy path', () => {
  it('ingests account and campaign, in that order', async () => {
    const harness = createHarness();

    const summary = await harness.service.syncInsights(INPUT);

    expect(harness.reads).toEqual(['account', 'campaign']);
    expect(summary.status).toBe('completed');
    expect(summary.rowsWritten).toBe(2);
    expect(summary.levels.map((level) => level.level)).toEqual([
      'account',
      'campaign',
    ]);
  });

  it('reads no other level, whatever the caller asked for', async () => {
    const harness = createHarness();

    await harness.service.syncInsights({
      ...INPUT,
      // Not part of the input type; ad set and ad insights multiply the row
      // count and that volume decision has not been made yet.
      levels: ['adset', 'ad'],
    } as never);

    expect(harness.reads).toEqual(['account', 'campaign']);
  });

  it('stamps every row of the run with one synced_at', async () => {
    const harness = createHarness();

    await harness.service.syncInsights(INPUT);

    const [first] = harness.reader.read.mock.calls[0] as [{ syncedAt: Date }];
    const [second] = harness.reader.read.mock.calls[1] as [{ syncedAt: Date }];

    // "How fresh is this number" must have one answer per ingest, whichever
    // level wrote the row and however long the walk took.
    expect(first.syncedAt).toBe(second.syncedAt);
  });

  it('resolves the credential once, and never per level', async () => {
    const harness = createHarness();

    await harness.service.syncInsights(INPUT);

    expect(harness.resolver.resolve).toHaveBeenCalledTimes(1);
    expect(harness.resolver.resolve).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-id',
    });
  });

  it('describes the measurement contract in the summary', async () => {
    const harness = createHarness();

    const summary = await harness.service.syncInsights(INPUT);

    expect(summary).toMatchObject({
      since: '2026-07-06',
      until: '2026-07-22',
      days: 17,
      source: 'paid',
      attributionSetting: 'account_default',
      accountTimezone: 'America/Sao_Paulo',
      currency: 'BRL',
      externalAccountId: ACCOUNT_ID,
    });
  });

  it('ingests both authorization methods through one identical pipeline', async () => {
    const business = createHarness({ authorizationMethod: 'business_login' });
    const internal = createHarness({
      authorizationMethod: 'internal_system_user',
      accessToken: 'a-different-token',
    });

    const first = await business.service.syncInsights(INPUT);
    const second = await internal.service.syncInsights(INPUT);

    expect(first.levels).toEqual(second.levels);
    expect(first.rowsWritten).toBe(second.rowsWritten);
  });
});

describe('SocialAdInsightsSyncService — window validation', () => {
  it('refuses an unusable window before spending any provider quota', async () => {
    const harness = createHarness();

    await expect(
      harness.service.syncInsights({ ...INPUT, until: '2026-07-05' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Answering the caller's own mistake must not cost a Graph call, and must
    // not reveal whether the connection exists.
    expect(harness.resolver.resolve).not.toHaveBeenCalled();
    expect(harness.reader.read).not.toHaveBeenCalled();
  });

  it('refuses a window that reaches into the account current day', async () => {
    const harness = createHarness();
    // 15:00 in São Paulo: the account is mid-day, not done with it.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T18:00:00Z'));

    try {
      await expect(
        harness.service.syncInsights({
          ...INPUT,
          since: '2026-08-20',
          until: '2026-08-26',
        }),
      ).rejects.toMatchObject({
        name: 'SocialAdInsightsWindowNotClosedError',
        maxUntil: '2026-08-25',
        timezone: 'America/Sao_Paulo',
      });

      // Refused before anything was read or written: an open day stored under
      // `is_partial = false` never corrects itself.
      expect(harness.reader.read).not.toHaveBeenCalled();
      expect(harness.writes).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('checks the boundary only after the scoped credential lookup', async () => {
    const harness = createHarness({
      resolveFailure: new SocialAdCredentialError('connection_not_found'),
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T18:00:00Z'));

    try {
      // A connection in somebody else's tenant answers "not found" even for a
      // window that is also open — otherwise the two refusals would tell a
      // caller which connections exist, and what timezone they run in.
      await expect(
        harness.service.syncInsights({
          ...INPUT,
          since: '2026-08-20',
          until: '2026-08-26',
        }),
      ).rejects.toMatchObject({ code: 'connection_not_found' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('accepts the latest settled day of the account', async () => {
    const harness = createHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T18:00:00Z'));

    try {
      const summary = await harness.service.syncInsights({
        ...INPUT,
        since: '2026-08-20',
        until: '2026-08-25',
      });

      expect(summary.status).toBe('completed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses a window longer than the allowed span', async () => {
    const harness = createHarness();

    await expect(
      harness.service.syncInsights({
        ...INPUT,
        since: '2026-01-01',
        until: '2026-12-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SocialAdInsightsSyncService — failure', () => {
  it('throws when the first level fails, since nothing was stored', async () => {
    const harness = createHarness({
      readFailure: {
        level: 'account',
        error: new MetaGraphError({
          kind: 'rate_limited',
          safeMessage: 'Meta Ads account insights read failed.',
        }),
      },
    });

    await expect(harness.service.syncInsights(INPUT)).rejects.toBeInstanceOf(
      MetaGraphError,
    );

    expect(harness.writes).toHaveLength(0);
  });

  it('keeps the facts it wrote when a later level fails, and says which', async () => {
    const harness = createHarness({
      readFailure: {
        level: 'campaign',
        error: new MetaGraphError({
          kind: 'transient',
          safeMessage: 'Meta Ads campaign insights read failed.',
        }),
      },
    });

    const summary = await harness.service.syncInsights(INPUT);

    // Throwing here would report a failed request for a run whose account days
    // are now in the table — and the obvious response to a failed request is to
    // run it again, which should be the caller's informed choice.
    expect(summary.status).toBe('partial');
    expect(summary.rowsWritten).toBe(1);
    expect(summary.levels).toEqual([
      expect.objectContaining({ level: 'account', status: 'completed' }),
      expect.objectContaining({
        level: 'campaign',
        status: 'failed',
        code: 'meta_transient',
      }),
    ]);
  });

  it('never marks a stored row partial because another level failed', async () => {
    const harness = createHarness({
      readFailure: {
        level: 'campaign',
        error: new Error('boom'),
      },
    });

    await harness.service.syncInsights(INPUT);

    // `is_partial` describes whether that day was still open when it was
    // collected. A failure elsewhere in the run does not change that.
    expect(harness.writes[0].every((written) => !written.isPartial)).toBe(true);
  });

  it('gives an unclassified failure a code that says it is a bug', async () => {
    const harness = createHarness({
      readFailure: {
        level: 'campaign',
        error: new Error('undefined is not a function'),
      },
    });

    const summary = await harness.service.syncInsights(INPUT);

    expect(summary.levels[1]).toMatchObject({
      code: 'internal_error',
      message: 'The sync failed.',
    });
    // The original message went through no sanitizer, so it is not repeated.
    expect(JSON.stringify(summary)).not.toContain(
      'undefined is not a function',
    );
  });

  it('propagates a connection that is not in scope', async () => {
    const harness = createHarness({
      resolveFailure: new SocialAdCredentialError('connection_not_found'),
    });

    await expect(harness.service.syncInsights(INPUT)).rejects.toMatchObject({
      code: 'connection_not_found',
    });
  });
});

describe('SocialAdInsightsSyncService — truncation', () => {
  it('writes nothing for a level that returned only a prefix', async () => {
    const harness = createHarness({ truncatedLevel: 'account' });

    await expect(harness.service.syncInsights(INPUT)).rejects.toMatchObject({
      name: 'SocialAdInsightsTruncatedError',
    });

    // A half-written window is worse than an unwritten one: the days that
    // landed look complete, and the missing ones are indistinguishable from
    // days with no delivery.
    expect(harness.writes).toHaveLength(0);
    expect(harness.reads).toEqual(['account']);
  });

  it('keeps earlier levels when a later one truncates', async () => {
    const harness = createHarness({ truncatedLevel: 'campaign' });

    const summary = await harness.service.syncInsights(INPUT);

    expect(summary.status).toBe('partial');
    expect(summary.rowsWritten).toBe(1);
    expect(summary.levels[1]).toMatchObject({
      status: 'failed',
      code: 'insights_window_truncated',
    });
    expect(harness.writes).toHaveLength(1);
  });
});

describe('SocialAdInsightsSyncService — disclosure', () => {
  it('puts no token in the summary or in the log', async () => {
    const logged: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logged.push(String(message));
      });

    const harness = createHarness({ accessToken: SECRET_TOKEN });

    try {
      const summary = await harness.service.syncInsights(INPUT);

      expect(JSON.stringify(summary)).not.toContain(SECRET_TOKEN);
      expect(logged.join('\n')).not.toContain(SECRET_TOKEN);
      expect(logged.join('\n')).toContain('connection-id');
    } finally {
      spy.mockRestore();
    }
  });
});
