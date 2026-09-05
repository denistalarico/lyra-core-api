import { ConflictException } from '@nestjs/common';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LEADFLOW_PRODUCT_TELEMETRY_PURPOSE } from '../dto/telemetry-consent.dto';
import { LeadFlowTelemetryPrivacyService } from './leadflow-telemetry-privacy.service';
import {
  TelemetryContributionRegistry,
  type TelemetryContribution,
  type TelemetryContributionSource,
} from './telemetry-contribution.port';

/**
 * The I6.1 wiring, from the consent owner's side.
 *
 * These tests assert the thing the whole slice is for: a contributing domain is
 * reached **only** through the collector, **only** after every gate has passed,
 * and never on its own. The paid-media arithmetic is proven elsewhere; here the
 * source is a spy, because what matters is whether it is called at all.
 */
const tenantId = '3fcf6e35-9881-4713-b704-795956eec0c8';
const workspaceId = 'b9c311c3-96e9-4bc4-b2a4-f02763063b1b';
const userId = 'c821ac23-bf9f-46aa-87b9-fe1b34351941';
const noticeId = '83f31024-cce4-4397-87ea-3527a9e9aa73';
const contentHash = 'a'.repeat(64);
const pseudonym = '58135121-52ef-4c45-82cb-6c41b1ea8a3f';

function repositoryMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
    save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    remove: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
  };
}

const approvedNotice = {
  id: noticeId,
  purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  version: 1,
  locale: 'pt-BR',
  title: 'Telemetria agregada',
  body: 'Texto técnico.',
  contentHash,
  categories: [],
  retentionDays: 90,
  kAnonymityThreshold: 5,
  legalReviewStatus: 'approved' as const,
  status: 'active' as const,
  effectiveAt: new Date('2026-07-30T00:00:00.000Z'),
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
};

const validConsent = {
  tenantId,
  workspaceId,
  contextType: LeadFlowSettingsContextType.Agency,
  agencyClientId: null,
  noticeId,
  status: 'opted_in' as const,
  noticeVersion: 1,
  noticeContentHash: contentHash,
  occurredAt: new Date('2026-07-30T12:00:00.000Z'),
  createdAt: new Date('2026-07-30T12:00:00.000Z'),
};

const ctx = {
  tenantId,
  workspaceId,
  userId,
  role: 'owner',
  managedContext: {
    productKey: 'leadflow' as const,
    operatingMode: 'agency' as const,
    clientId: null,
    managedTenantId: null,
  },
};

/** A contributing domain that records how it was called. */
function spySource(
  key = 'social_paid_media',
  rows: TelemetryContribution[] = [
    {
      observedOn: '2026-09-01',
      metricKey: 'paid_impressions',
      dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
      metricValue: '4200',
    },
  ],
): TelemetryContributionSource & { calls: jest.Mock } {
  const calls = jest.fn().mockResolvedValue(rows);

  return {
    contributionSourceKey: key,
    buildContributions: calls,
    calls,
  };
}

function createFixture(sources: TelemetryContributionSource[] = []) {
  const dataSource = { query: jest.fn(), transaction: jest.fn() };
  const notices = repositoryMock();
  const consents = repositoryMock();
  const identities = repositoryMock();
  const dailyFacts = repositoryMock();
  const auditEvents = repositoryMock();
  const registry = new TelemetryContributionRegistry();

  for (const source of sources) registry.register(source);

  const service = new LeadFlowTelemetryPrivacyService(
    dataSource as never,
    notices as never,
    consents as never,
    identities as never,
    dailyFacts as never,
    auditEvents as never,
    registry,
  );

  // No automation runs: the contributed rows are then unambiguously the ones
  // under test rather than mixed with LeadFlow's own two metrics.
  dataSource.query.mockResolvedValue([]);
  identities.findOne.mockResolvedValue({
    tenantId,
    workspaceId,
    contextType: LeadFlowSettingsContextType.Agency,
    agencyClientId: null,
    scopePseudonym: pseudonym,
    lastCollectedAt: null,
    optedOutAt: null,
  });

  return {
    service,
    registry,
    dataSource,
    notices,
    consents,
    identities,
    dailyFacts,
    auditEvents,
  };
}

/** A period whose days are all safely in the past. */
const period = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-09-03T00:00:00.000Z',
};

describe('telemetry contribution wiring', () => {
  const previousGate = process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T09:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    if (previousGate === undefined) {
      delete process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;
    } else {
      process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = previousGate;
    }
    jest.clearAllMocks();
  });

  const enable = () => {
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
  };

  describe('fail-closed ordering', () => {
    /**
     * §3: an unconsented context must not cause cross-domain work.
     *
     * Each of these asserts two separate things — collection is refused, and
     * the contributing domain was never asked. The second is the one that is
     * easy to lose: a refactor that gathered contributions before checking
     * consent would still refuse correctly, while querying Social's tables for
     * every context on every call.
     */
    it('asks no domain when the gate is off', async () => {
      const source = spySource();
      const fixture = createFixture([source]);

      await expect(
        fixture.service.collectSnapshot(ctx, period),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(source.calls).not.toHaveBeenCalled();
      expect(fixture.dailyFacts.upsert).not.toHaveBeenCalled();
      expect(fixture.identities.save).not.toHaveBeenCalled();
    });

    it('asks no domain when the notice is pending', async () => {
      enable();
      const source = spySource();
      const fixture = createFixture([source]);
      fixture.notices.findOne.mockResolvedValue({
        ...approvedNotice,
        legalReviewStatus: 'pending',
      });
      fixture.consents.findOne.mockResolvedValue(validConsent);

      await expect(
        fixture.service.collectSnapshot(ctx, period),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(source.calls).not.toHaveBeenCalled();
    });

    it('asks no domain without a consent', async () => {
      enable();
      const source = spySource();
      const fixture = createFixture([source]);
      fixture.notices.findOne.mockResolvedValue(approvedNotice);
      fixture.consents.findOne.mockResolvedValue(null);

      await expect(
        fixture.service.collectSnapshot(ctx, period),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(source.calls).not.toHaveBeenCalled();
    });

    /**
     * §4: a legacy acceptance is not consent for the platform purpose.
     *
     * The lookup is filtered by `purposeKey`, so a scope holding only the
     * LeadFlow row resolves to *no* consent for the platform purpose. Modelled
     * here the way the repository behaves: the filtered query returns nothing.
     */
    it('asks no domain when only the legacy purpose is accepted', async () => {
      enable();
      const source = spySource();
      const fixture = createFixture([source]);
      fixture.notices.findOne.mockResolvedValue(approvedNotice);
      fixture.consents.findOne.mockImplementation(
        (options: { where: { purposeKey: string } }) =>
          Promise.resolve(
            options.where.purposeKey === LEADFLOW_PRODUCT_TELEMETRY_PURPOSE
              ? validConsent
              : null,
          ),
      );

      await expect(
        fixture.service.collectSnapshot(ctx, period, {
          key: 'platform_product_improvement_v1',
          description: 'Neutral purpose.',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(source.calls).not.toHaveBeenCalled();
    });

    it('asks no domain for an opted-out context', async () => {
      enable();
      const source = spySource();
      const fixture = createFixture([source]);
      fixture.notices.findOne.mockResolvedValue(approvedNotice);
      fixture.consents.findOne.mockResolvedValue(validConsent);
      fixture.identities.findOne.mockResolvedValue({
        scopePseudonym: pseudonym,
        optedOutAt: new Date('2026-09-05T00:00:00.000Z'),
      });

      await expect(
        fixture.service.collectSnapshot(ctx, period),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(source.calls).not.toHaveBeenCalled();
    });
  });

  describe('with a valid consent', () => {
    const consented = (sources: TelemetryContributionSource[]) => {
      enable();
      const fixture = createFixture(sources);
      fixture.notices.findOne.mockResolvedValue(approvedNotice);
      fixture.consents.findOne.mockResolvedValue(validConsent);
      return fixture;
    };

    it('writes the contributed rows under the scope pseudonym', async () => {
      const source = spySource();
      const fixture = consented([source]);

      const result = await fixture.service.collectSnapshot(ctx, period);

      expect(source.calls).toHaveBeenCalledTimes(1);

      const [facts] = fixture.dailyFacts.upsert.mock.calls[0] as [
        Array<Record<string, unknown>>,
      ];
      const contributed = facts.find(
        (fact) => fact.metricKey === 'paid_impressions',
      );

      expect(contributed).toMatchObject({
        scopePseudonym: pseudonym,
        observedOn: '2026-09-01',
        dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
        metricValue: '4200',
      });
      expect(result.contributionsBySource).toEqual([
        { sourceKey: 'social_paid_media', factsWritten: 1 },
      ]);
    });

    /**
     * §19: a written fact carries the pseudonym and nothing else.
     *
     * Asserted over the serialized row rather than field by field, so a future
     * column added to the fact would have to pass this too.
     */
    it('writes no tenant, workspace or client identifier', async () => {
      const fixture = consented([spySource()]);

      await fixture.service.collectSnapshot(ctx, period);

      const [facts] = fixture.dailyFacts.upsert.mock.calls[0] as [unknown];
      const serialized = JSON.stringify(facts);

      for (const identifier of [tenantId, workspaceId, userId, noticeId]) {
        expect(serialized).not.toContain(identifier);
      }
      expect(serialized).toContain(pseudonym);
    });

    /**
     * §10: idempotency is the existing unique index, not a new mechanism.
     *
     * The conflict paths must stay exactly the columns of
     * `UQ_lf_product_telemetry_daily_fact`; a contributed row is deduplicated
     * by the same rule as a LeadFlow one.
     */
    it('reuses the existing upsert conflict paths', async () => {
      const fixture = consented([spySource()]);

      await fixture.service.collectSnapshot(ctx, period);

      const [, options] = fixture.dailyFacts.upsert.mock.calls[0] as [
        unknown,
        { conflictPaths: string[] },
      ];

      expect(options.conflictPaths).toEqual([
        'scopePseudonym',
        'observedOn',
        'metricKey',
        'dimensionKey',
      ]);
    });

    it('creates no second pseudonym for a scope that has one', async () => {
      const fixture = consented([spySource()]);

      await fixture.service.collectSnapshot(ctx, period);

      expect(fixture.identities.create).not.toHaveBeenCalled();
    });

    /**
     * §9: no retro-backfill.
     *
     * The domain is asked for the requested period only. A collector that
     * widened the window — "catch up since consent" — would sweep months of
     * Social history into the first snapshot after the gate was turned on.
     */
    it('asks only for the requested period', async () => {
      const source = spySource();
      const fixture = consented([source]);

      await fixture.service.collectSnapshot(ctx, period);

      expect(source.calls).toHaveBeenCalledWith({
        scope: { tenantId, workspaceId, agencyClientId: null },
        since: '2026-09-01',
        until: '2026-09-02',
      });
    });

    /**
     * §8: today never contributes.
     *
     * The requested period runs into the current day; the window handed to the
     * domain stops at yesterday. Contributing a day that is still happening
     * would put a nine-hour day into a distribution of complete ones.
     */
    it('clamps the window to completed days', async () => {
      const source = spySource();
      const fixture = consented([source]);

      await fixture.service.collectSnapshot(ctx, {
        from: '2026-09-08T00:00:00.000Z',
        to: '2026-09-10T09:00:00.000Z',
      });

      expect(source.calls).toHaveBeenCalledWith(
        expect.objectContaining({ since: '2026-09-08', until: '2026-09-09' }),
      );
    });

    it('asks for nothing when the period contains no completed day', async () => {
      const source = spySource();
      const fixture = consented([source]);

      await fixture.service.collectSnapshot(ctx, {
        from: '2026-09-10T00:00:00.000Z',
        to: '2026-09-10T09:00:00.000Z',
      });

      expect(source.calls).not.toHaveBeenCalled();
    });

    /**
     * A failing domain takes only itself out.
     *
     * Telemetry is the optional part of the platform; one domain's broken query
     * must not discard the rows another built correctly, and must not fail the
     * caller's request.
     */
    it('survives a failing contribution source', async () => {
      const healthy = spySource('other_domain', [
        {
          observedOn: '2026-09-01',
          metricKey: 'paid_clicks',
          dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
          metricValue: '7',
        },
      ]);
      const broken: TelemetryContributionSource = {
        contributionSourceKey: 'social_paid_media',
        buildContributions: jest.fn().mockRejectedValue(new Error('boom')),
      };
      const fixture = consented([broken, healthy]);

      const result = await fixture.service.collectSnapshot(ctx, period);

      expect(result.contributionsBySource).toEqual(
        expect.arrayContaining([
          { sourceKey: 'social_paid_media', factsWritten: 0 },
          { sourceKey: 'other_domain', factsWritten: 1 },
        ]),
      );
      expect(fixture.dailyFacts.upsert).toHaveBeenCalled();
    });

    it('records each source in the audit trail', async () => {
      const fixture = consented([spySource()]);

      await fixture.service.collectSnapshot(ctx, period);

      const [event] = fixture.auditEvents.create.mock.calls[0] as [
        { details: Record<string, unknown> },
      ];

      expect(event.details).toMatchObject({
        contributed_social_paid_media: 1,
      });
    });

    /** §21: the contributor is the context, so the actor never reaches a fact. */
    it('passes no actor to the contributing domain', async () => {
      const source = spySource();
      const fixture = consented([source]);

      await fixture.service.collectSnapshot(ctx, period);

      const [input] = source.calls.mock.calls[0] as [
        { scope: Record<string, unknown> },
      ];

      expect(Object.keys(input.scope).sort()).toEqual([
        'agencyClientId',
        'tenantId',
        'workspaceId',
      ]);
    });

    /** A managed client's scope reaches the domain as its own, not the agency's. */
    it('carries the managed client through', async () => {
      const source = spySource();
      const fixture = consented([source]);

      await fixture.service.collectSnapshot(
        {
          ...ctx,
          managedContext: {
            productKey: 'leadflow' as const,
            operatingMode: 'client' as const,
            clientId: 'ac7bfc7f-5f38-4b3c-9a63-9e2b3f0a1d55',
            managedTenantId: null,
          },
        },
        period,
      );

      const [input] = source.calls.mock.calls[0] as [
        { scope: { agencyClientId: string | null } },
      ];

      expect(input.scope.agencyClientId).toBe(
        'ac7bfc7f-5f38-4b3c-9a63-9e2b3f0a1d55',
      );
    });
  });

  /**
   * §25: the collector works with no domain registered.
   *
   * This is the pre-I6.1 behaviour, and it must remain reachable — it is what
   * makes removing the wiring a safe operation rather than a broken one.
   */
  it('collects LeadFlow counts alone when no domain is registered', async () => {
    enable();
    const fixture = createFixture([]);
    fixture.notices.findOne.mockResolvedValue(approvedNotice);
    fixture.consents.findOne.mockResolvedValue(validConsent);
    fixture.dataSource.query.mockResolvedValue([
      { observed_on: '2026-09-01', status: 'succeeded', total: '3' },
    ]);

    const result = await fixture.service.collectSnapshot(ctx, period);

    expect(result.contributionsBySource).toEqual([]);
    expect(result.terminalRuns).toBe(3);
    expect(result.factsWritten).toBe(2);
  });

  describe('the registry', () => {
    it('ignores a duplicate registration of the same source key', () => {
      const registry = new TelemetryContributionRegistry();
      const source = spySource();

      registry.register(source);
      registry.register(source);
      registry.register(spySource());

      expect(registry.all()).toHaveLength(1);
    });

    it('keeps distinct domains', () => {
      const registry = new TelemetryContributionRegistry();

      registry.register(spySource('social_paid_media'));
      registry.register(spySource('another_domain'));

      expect(registry.all()).toHaveLength(2);
    });
  });
});
