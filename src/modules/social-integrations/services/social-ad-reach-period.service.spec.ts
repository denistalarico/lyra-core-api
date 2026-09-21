import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { createResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import type { SocialAdReachPeriodEntity } from '../entities/social-ad-reach-period.entity';
import { SocialAdReachMeasurementDisabledError } from '../sync/social-ad-reach-period.error';
import type { MetaAdsReachReaderService } from './meta-ads-reach-reader.service';
import type { SocialAdReachPeriodConfigService } from './social-ad-reach-period-config.service';
import { SocialAdReachPeriodService } from './social-ad-reach-period.service';

const ACCOUNT_ID = 'act_415877197389621';
const SECRET_TOKEN = 'EAA-super-secret-system-user-token';
const TIMEZONE = 'America/Sao_Paulo';

const SCOPE = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  connectionId: 'connection-id',
};

/** A row as the cache holds one. Only the three columns the lookup selects. */
type CachedRow = {
  reach: string | null;
  measuredAt: Date;
  isPartial: boolean;
};

function credential(accessToken = SECRET_TOKEN) {
  return createResolvedAdCredential({
    connectionId: 'connection-id',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    provider: 'meta_ads',
    authorizationMethod: 'business_login',
    externalAccountId: ACCOUNT_ID,
    currency: 'BRL',
    timezone: TIMEZONE,
    credentialVersion: 1,
    tokenExpiresAt: null,
    accessToken,
  });
}

function createHarness(
  options: {
    enabled?: boolean;
    cached?: CachedRow | null;
    /** Keyed `since..until`, so one pass can hit some ranges and miss others. */
    cachedByRange?: Record<string, CachedRow>;
    resolveFailure?: Error;
    measureFailure?: Error;
    truncated?: boolean;
    reach?: string | null;
  } = {},
) {
  const lookups: Record<string, unknown>[] = [];
  const measured: { since: string; until: string }[] = [];
  const inserted: Record<string, unknown>[] = [];
  const conflictTargets: string[][] = [];
  const refreshedColumns: string[][] = [];

  const repository = {
    findOne: jest.fn((query: { where: Record<string, unknown> }) => {
      lookups.push(query.where);

      const key = `${String(query.where.periodSince)}..${String(
        query.where.periodUntil,
      )}`;

      const row = options.cachedByRange?.[key] ?? options.cached ?? null;

      return Promise.resolve(row);
    }),
    createQueryBuilder: jest.fn(() => {
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (rows: Record<string, unknown>[]) => {
          inserted.push(...rows);
          return builder;
        },
        orUpdate: (refreshed: string[], identity: string[]) => {
          refreshedColumns.push(refreshed);
          conflictTargets.push(identity);
          return builder;
        },
        updateEntity: () => builder,
        execute: () => Promise.resolve({}),
      };

      return builder;
    }),
  };

  const resolver = {
    resolve: jest.fn(() => {
      if (options.resolveFailure) return Promise.reject(options.resolveFailure);

      return Promise.resolve(credential());
    }),
  };

  const config = { enabled: options.enabled ?? true };

  const reader = {
    measure: jest.fn((input: { window: { since: string; until: string } }) => {
      measured.push({ ...input.window });

      if (options.measureFailure) {
        return Promise.reject(options.measureFailure);
      }

      return Promise.resolve({
        reach: options.reach === undefined ? '9140' : options.reach,
        apiCalls: 1,
        truncated: options.truncated ?? false,
      });
    }),
  };

  return {
    service: new SocialAdReachPeriodService(
      repository as unknown as Repository<SocialAdReachPeriodEntity>,
      resolver as unknown as SocialAdCredentialResolver,
      config as unknown as SocialAdReachPeriodConfigService,
      reader as unknown as MetaAdsReachReaderService,
    ),
    repository,
    resolver,
    reader,
    lookups,
    measured,
    inserted,
    conflictTargets,
    refreshedColumns,
  };
}

describe('SocialAdReachPeriodService — the gate', () => {
  it('refuses to measure when the switch is off, before any lookup', async () => {
    const harness = createHarness({ enabled: false });

    await expect(
      harness.service.resolve({
        ...SCOPE,
        since: '2026-08-01',
        until: '2026-08-31',
      }),
    ).rejects.toBeInstanceOf(SocialAdReachMeasurementDisabledError);

    // Ahead of the credential lookup on purpose: the gate is a property of the
    // deployment, so answering it reveals nothing about whether the connection
    // exists — and costs nothing.
    expect(harness.resolver.resolve).not.toHaveBeenCalled();
    expect(harness.reader.measure).not.toHaveBeenCalled();
  });

  it('refuses to prewarm a connection when the switch is off', async () => {
    const harness = createHarness({ enabled: false });

    await expect(
      harness.service.prewarmConnection(SCOPE),
    ).rejects.toBeInstanceOf(SocialAdReachMeasurementDisabledError);

    expect(harness.resolver.resolve).not.toHaveBeenCalled();
  });
});

describe('SocialAdReachPeriodService — resolve', () => {
  it('refuses a range that is not two real calendar days', async () => {
    const harness = createHarness();

    await expect(
      harness.service.resolve({
        ...SCOPE,
        since: '2026-02-30',
        until: '2026-03-05',
      }),
    ).rejects.toThrow();

    // Validated before the credential is resolved: a malformed range is the
    // caller's mistake and must cost no provider quota.
    expect(harness.resolver.resolve).not.toHaveBeenCalled();
  });

  it('refuses a range that runs backwards', async () => {
    const harness = createHarness();

    await expect(
      harness.service.resolve({
        ...SCOPE,
        since: '2026-08-31',
        until: '2026-08-01',
      }),
    ).rejects.toThrow();
  });

  it('measures a range nobody has measured yet, and stores it', async () => {
    const harness = createHarness({ cached: null });

    const result = await harness.service.resolve({
      ...SCOPE,
      since: '2026-08-01',
      until: '2026-08-31',
    });

    expect(harness.measured).toEqual([
      { since: '2026-08-01', until: '2026-08-31' },
    ]);
    expect(result.reach).toBe('9140');
    expect(result.fromCache).toBe(false);
    expect(harness.inserted).toHaveLength(1);
  });

  it('serves a final measurement from the cache with no provider call', async () => {
    const measuredAt = new Date('2026-09-01T08:00:00.000Z');
    const harness = createHarness({
      cached: { reach: '4210', measuredAt, isPartial: false },
    });

    const result = await harness.service.resolve({
      ...SCOPE,
      since: '2026-08-01',
      until: '2026-08-31',
    });

    // The acceptance criterion of Etapa 2B: the second request for a range costs
    // Meta nothing. A closed range's audience does not change, so there is
    // nothing a re-measurement could learn.
    expect(harness.reader.measure).not.toHaveBeenCalled();
    expect(result).toEqual({
      connectionId: 'connection-id',
      since: '2026-08-01',
      until: '2026-08-31',
      reach: '4210',
      isPartial: false,
      measuredAt: measuredAt.toISOString(),
      fromCache: true,
    });
  });

  it('re-measures a partial row rather than serving its subtotal', async () => {
    const harness = createHarness({
      cached: {
        reach: '1200',
        measuredAt: new Date('2026-09-20T09:00:00.000Z'),
        isPartial: true,
      },
      reach: '1850',
    });

    const result = await harness.service.resolve({
      ...SCOPE,
      since: '2026-09-14',
      until: '2026-09-20',
    });

    // A row whose `period_until` was the account's today is a subtotal that has
    // since grown. Serving it would present a number that is quietly too low.
    expect(harness.reader.measure).toHaveBeenCalledTimes(1);
    expect(result.reach).toBe('1850');
    expect(result.fromCache).toBe(false);
  });

  it('looks a measurement up by equality on both endpoints', async () => {
    const harness = createHarness({ cached: null });

    await harness.service.resolve({
      ...SCOPE,
      since: '2026-08-01',
      until: '2026-08-31',
    });

    // The rule the cache's correctness rests on. A range scan would match a
    // range nested inside the requested one and report its smaller reach under
    // the larger period's label — undetectable by anybody reading the dashboard.
    expect(harness.lookups[0]).toMatchObject({
      periodSince: '2026-08-01',
      periodUntil: '2026-08-31',
      entityLevel: 'account',
      entityExternalId: ACCOUNT_ID,
      connectionId: 'connection-id',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
    });
  });

  it('stores null rather than zero when Meta reported no reach', async () => {
    const harness = createHarness({ cached: null, reach: null });

    const result = await harness.service.resolve({
      ...SCOPE,
      since: '2026-08-01',
      until: '2026-08-31',
    });

    // Meta omits `reach` for some ranges, and an account that genuinely reached
    // nobody sends `"0"`. Coercing the first into the second turns a missing
    // measurement into a confident claim.
    expect(result.reach).toBeNull();
    expect(harness.inserted[0]).toMatchObject({ reach: null });
  });

  it('refuses a measurement Meta answered with more than one row', async () => {
    const harness = createHarness({ cached: null, truncated: true });

    await expect(
      harness.service.resolve({
        ...SCOPE,
        since: '2026-08-01',
        until: '2026-08-31',
      }),
    ).rejects.toThrow(/more rows than a period read has/);

    // Nothing stored. A period read has exactly one row; taking the first of an
    // unexpected shape is how a campaign's reach becomes an account's.
    expect(harness.inserted).toHaveLength(0);
  });

  it('never stores a measurement under a scope the caller supplied', async () => {
    const harness = createHarness({ cached: null });

    await harness.service.resolve({
      ...SCOPE,
      // The resolver returns `tenant-a`; a stored row must follow the credential
      // rather than the argument, or a member could write into another tenant.
      tenantId: 'tenant-b',
      workspaceId: 'workspace-b',
      since: '2026-08-01',
      until: '2026-08-31',
    });

    expect(harness.inserted[0]).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
    });
  });

  it('upserts on the measurement identity, refreshing only what a re-read changes', async () => {
    const harness = createHarness({ cached: null });

    await harness.service.resolve({
      ...SCOPE,
      since: '2026-08-01',
      until: '2026-08-31',
    });

    expect(harness.conflictTargets[0]).toEqual([
      'tenant_id',
      'workspace_id',
      'connection_id',
      'entity_level',
      'entity_external_id',
      'period_since',
      'period_until',
    ]);

    // `created_at` must never be refreshed: it answers "when did Lyra first
    // measure this range", and a re-read of a partial range would reset it.
    expect(harness.refreshedColumns[0]).not.toContain('created_at');
    expect(harness.refreshedColumns[0]).toContain('reach');
    expect(harness.refreshedColumns[0]).toContain('is_partial');
    expect(harness.refreshedColumns[0]).toContain('measured_at');
  });

  it('lets a credential refusal travel unchanged', async () => {
    const harness = createHarness({
      resolveFailure: new SocialAdCredentialError('connection_not_found'),
    });

    await expect(
      harness.service.resolve({
        ...SCOPE,
        since: '2026-08-01',
        until: '2026-08-31',
      }),
    ).rejects.toBeInstanceOf(SocialAdCredentialError);

    expect(harness.reader.measure).not.toHaveBeenCalled();
  });
});

describe('SocialAdReachPeriodService — prewarm', () => {
  beforeAll(() => {
    // The summary is logged as one line, and the assertions below do not read it.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('measures all six presets for a cold account', async () => {
    const harness = createHarness({ cached: null });

    const summary = await harness.service.prewarm({
      credential: credential(),
      now: new Date('2026-09-20T15:00:00.000Z'),
    });

    expect(summary.presets.map((one) => one.preset)).toEqual([
      'today',
      'last_7',
      'last_30',
      'last_90',
      'month_current',
      'month_previous',
    ]);
    expect(summary.measured).toBe(6);
    expect(summary.failed).toBe(0);
    // One request per preset, which is the whole daily provider cost per
    // account — the figure §6 of the plan reasons about.
    expect(summary.apiCalls).toBe(6);
  });

  it('marks the rolling presets partial and the previous month final', async () => {
    const harness = createHarness({ cached: null });

    const summary = await harness.service.prewarm({
      credential: credential(),
      now: new Date('2026-09-20T15:00:00.000Z'),
    });

    const byPreset = new Map(
      summary.presets.map((one) => [one.preset, one.isPartial]),
    );

    expect(byPreset.get('today')).toBe(true);
    expect(byPreset.get('last_7')).toBe(true);
    expect(byPreset.get('month_current')).toBe(true);
    // The one preset that is immutable the moment the month ends, and therefore
    // the one that is measured exactly once, ever.
    expect(byPreset.get('month_previous')).toBe(false);
  });

  it('re-measures only what is still moving on a second pass', async () => {
    const final = {
      reach: '7700',
      measuredAt: new Date('2026-09-01T08:00:00.000Z'),
      isPartial: false,
    };

    const harness = createHarness({
      // The previous month is already final in the cache; everything else is
      // either absent or still moving.
      cachedByRange: { '2026-08-01..2026-08-31': final },
    });

    const summary = await harness.service.prewarm({
      credential: credential(),
      now: new Date('2026-09-20T15:00:00.000Z'),
    });

    expect(summary.cached).toBe(1);
    expect(summary.measured).toBe(5);
    expect(summary.apiCalls).toBe(5);
    expect(
      summary.presets.find((one) => one.preset === 'month_previous'),
    ).toMatchObject({ status: 'cached', reach: '7700' });
  });

  it('reports a failed preset without failing the pass', async () => {
    const harness = createHarness({
      cached: null,
      measureFailure: new SocialAdCredentialError('token_expired'),
    });

    const summary = await harness.service.prewarm({
      credential: credential(),
      now: new Date('2026-09-20T15:00:00.000Z'),
    });

    // Each preset is an independent measurement of an independent range, and the
    // number they produce is one a dashboard can live without. A throw here
    // would make a nightly pass look like a broken sync.
    expect(summary.failed).toBe(6);
    expect(summary.measured).toBe(0);
    expect(summary.presets[0]).toMatchObject({
      status: 'failed',
      reach: null,
      code: 'token_expired',
    });
  });

  it('resolves the presets in the account timezone, not the process one', async () => {
    const harness = createHarness({ cached: null });

    // 01:00 UTC on the 21st is still the 20th in São Paulo, which is the zone
    // that defines this account's days. Resolving against UTC would shift every
    // preset by one day — and, for `month_previous` on the 1st, by a month.
    const summary = await harness.service.prewarm({
      credential: credential(),
      now: new Date('2026-09-21T01:00:00.000Z'),
    });

    expect(summary.today).toBe('2026-09-20');
    expect(summary.presets.find((one) => one.preset === 'today')).toMatchObject(
      { since: '2026-09-20', until: '2026-09-20' },
    );
  });
});
