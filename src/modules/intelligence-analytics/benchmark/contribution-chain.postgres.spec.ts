import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  LeadFlowProductTelemetryDailyEntity,
  LeadFlowTelemetryAuditEventEntity,
  LeadFlowTelemetryConsentEntity,
  LeadFlowTelemetryConsentNoticeEntity,
  LeadFlowTelemetryIdentityLinkEntity,
} from '../../leadflow-privacy/entities';
import { LeadFlowTelemetryPrivacyService } from '../../leadflow-privacy/services/leadflow-telemetry-privacy.service';
import { TelemetryContributionRegistry } from '../../leadflow-privacy';
import { BusinessModeDimensionAdapter } from '../../leadflow-analytics/intelligence/business-mode-dimension.adapter';
import { BenchmarkService } from './benchmark.service';
import { PaidMediaContributionAdapter } from './paid-media-contribution.adapter';
import { PaidMediaContributionService } from './paid-media-contribution.service';

const run = describePostgresIntegration();

/**
 * The whole chain, end to end, with nothing faked in the middle.
 *
 * `benchmark.postgres.spec` proves the read model over facts inserted directly.
 * That is the right shape for percentile and k-anonymity arithmetic, and it is
 * the wrong shape for I6.1: inserting facts by hand skips exactly the part this
 * slice adds. So this suite starts from **operational rows** — a Meta ad set's
 * daily metrics — and drives the real collector, which resolves the real
 * business mode, calls the real builder and writes through the real consent
 * path. Only then does it ask the real benchmark.
 *
 * What that buys, which nothing else here can: proof that a fact produced by
 * the pipeline is the same shape the reader expects. A cohort key serialized on
 * the write side and parsed on the read side is one string with two owners; if
 * they ever disagree, every number silently becomes unavailable rather than
 * wrong, and no unit test on either side would notice.
 *
 * ## `lyra_agency_test` only
 *
 * Enforced twice over before this file's `describe` body is evaluated —
 * `jest-global-setup` and `describePostgresIntegration` — and this suite adds a
 * third constraint of its own by never touching a row it did not create.
 *
 * ## Cleanup
 *
 * `leadflow_product_telemetry_daily` has no `tenant_id`; the pseudonym is its
 * only handle. Every scope this file creates is tracked so its facts can be
 * removed the same way `eraseContribution` removes them in production.
 */
run('Contribution chain against PostgreSQL', () => {
  const workspaceId = randomUUID();
  const originalEnv = { ...process.env };

  /** Every tenant this spec creates, for teardown. */
  const tenants = new Set<string>();

  const noticeId = randomUUID();
  const NOTICE_HASH = 'c'.repeat(64);
  const PURPOSE = 'platform_product_improvement_v1';

  const COHORT = 'v1|bm=agency_services|p=meta|d=whatsapp';

  /** A day comfortably inside the trailing-30 window and safely complete. */
  const day = (offset: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  };

  const purpose = {
    key: PURPOSE,
    description: 'Neutral platform purpose.',
    requiresApprovedNoticeToOptIn: true,
  };

  const collector = () => {
    const registry = new TelemetryContributionRegistry();

    registry.register(
      new PaidMediaContributionAdapter(
        new PaidMediaContributionService(AgencyDataSource),
        new BusinessModeDimensionAdapter(AgencyDataSource),
        registry,
      ),
    );

    return new LeadFlowTelemetryPrivacyService(
      AgencyDataSource,
      AgencyDataSource.getRepository(LeadFlowTelemetryConsentNoticeEntity),
      AgencyDataSource.getRepository(LeadFlowTelemetryConsentEntity),
      AgencyDataSource.getRepository(LeadFlowTelemetryIdentityLinkEntity),
      AgencyDataSource.getRepository(LeadFlowProductTelemetryDailyEntity),
      AgencyDataSource.getRepository(LeadFlowTelemetryAuditEventEntity),
      registry,
    );
  };

  const ctxFor = (tenantId: string, clientId: string | null = null) => ({
    tenantId,
    workspaceId,
    userId: randomUUID(),
    role: 'owner',
    managedContext: {
      productKey: 'leadflow' as const,
      operatingMode: clientId ? ('client' as const) : ('agency' as const),
      clientId,
      managedTenantId: null,
    },
  });

  // ---------------------------------------------------------------- fixtures

  /**
   * A context with paid-media facts, a business mode and (optionally) consent.
   *
   * Returns the tenant so a test can drive the collector for it. Everything
   * here is an *operational* row — nothing writes to a telemetry table.
   */
  const createContext = async (options: {
    businessModeKey?: string | null;
    /**
     * Reuses an existing tenant instead of creating one.
     *
     * Only the managed-client tests need it, and they need it badly: an agency
     * and its own client must sit under the *same* tenant for the isolation
     * assertion to mean anything.
     */
    tenantId?: string;
    clientId?: string | null;
    currency?: string;
    spend?: string;
    impressions?: string;
    leads?: string;
    days?: number;
    isPartial?: boolean;
    destination?: string | null;
  }) => {
    const tenantId = options.tenantId ?? randomUUID();
    tenants.add(tenantId);

    const connectionId = randomUUID();
    const adsetExternalId = `adset_${connectionId.slice(0, 8)}`;
    const clientId = options.clientId ?? null;

    // A managed client must exist for real: `leadflow_client_settings` carries
    // an FK to it, so a fabricated id would make the client context untestable.
    if (clientId) {
      await AgencyDataSource.query(
        `INSERT INTO agency_clients
           (id, tenant_id, workspace_id, display_name, status, lifecycle_stage,
            health_status)
         VALUES ($1, $2, $3, 'Cliente', 'active', 'active', 'healthy')
         ON CONFLICT (id) DO NOTHING`,
        [clientId, tenantId, workspaceId],
      );
    }

    await AgencyDataSource.query(
      `INSERT INTO social_ad_account_connections
         (id, tenant_id, workspace_id, agency_client_id, provider,
          external_account_id, timezone, currency, connection_status)
       VALUES ($1, $2, $3, $4, 'meta_ads', $5, 'America/Sao_Paulo', $6,
               'connected')`,
      [
        connectionId,
        tenantId,
        workspaceId,
        clientId,
        `act_${connectionId.slice(0, 8)}`,
        options.currency ?? 'BRL',
      ],
    );

    // The ad set entity, so the destination lateral has something to resolve.
    const entityId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO social_ad_entities
         (id, tenant_id, workspace_id, agency_client_id, connection_id,
          provider, entity_level, external_id, name, status, effective_status,
          first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, 'meta_ads', 'adset', $6, 'Conjunto',
               'ACTIVE', 'ACTIVE', now(), now())`,
      [
        entityId,
        tenantId,
        workspaceId,
        clientId,
        connectionId,
        adsetExternalId,
      ],
    );

    if (options.destination !== null) {
      await AgencyDataSource.query(
        `INSERT INTO social_ad_destination_observations
           (id, tenant_id, workspace_id, agency_client_id, connection_id,
            ad_entity_id, provider, destination_type, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'meta_ads', $7, $8::timestamptz)`,
        [
          randomUUID(),
          tenantId,
          workspaceId,
          clientId,
          connectionId,
          entityId,
          options.destination ?? 'whatsapp',
          // Before every contributed day, so the I4.1 temporal rule resolves it
          // rather than falling through to `unknown`.
          `${day(40)}T00:00:00Z`,
        ],
      );
    }

    for (let offset = 1; offset <= (options.days ?? 10); offset += 1) {
      await AgencyDataSource.query(
        `INSERT INTO social_ad_metrics_daily
           (tenant_id, workspace_id, agency_client_id, connection_id, provider,
            source, entity_level, entity_external_id, metric_date,
            account_timezone, currency, attribution_setting, spend, impressions,
            reach, clicks, link_clicks, leads, conversions, conversion_value,
            video_views, is_partial, synced_at)
         VALUES ($1, $2, $3, $4, 'meta_ads', 'paid', 'adset', $5, $6::date,
                 'America/Sao_Paulo', $7, 'account_default', $8, $9,
                 300, 20, 5, $10, 1.000000, 50.000000, 10, $11, now())`,
        [
          tenantId,
          workspaceId,
          clientId,
          connectionId,
          adsetExternalId,
          day(offset),
          options.currency ?? 'BRL',
          options.spend ?? '6.640000',
          options.impressions ?? '1000',
          options.leads ?? '4',
          options.isPartial ?? false,
        ],
      );
    }

    if (options.businessModeKey !== null) {
      await AgencyDataSource.query(
        `INSERT INTO leadflow_client_settings
           (id, tenant_id, workspace_id, context_type, agency_client_id,
            business_mode_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
        [
          randomUUID(),
          tenantId,
          workspaceId,
          clientId ? 'client' : 'agency',
          clientId,
          options.businessModeKey ?? 'agency_services',
        ],
      );
    }

    return { tenantId, clientId, connectionId };
  };

  /** Records a real opt-in through the real service. */
  const optIn = async (tenantId: string, clientId: string | null = null) => {
    await collector().optIn(
      ctxFor(tenantId, clientId),
      { noticeId, purposeKey: PURPOSE, contentHash: NOTICE_HASH },
      purpose,
    );
  };

  const collect = (tenantId: string, clientId: string | null = null) =>
    collector().collectSnapshot(
      ctxFor(tenantId, clientId),
      {
        from: `${day(30)}T00:00:00.000Z`,
        to: `${day(0)}T00:00:00.000Z`,
      },
      purpose,
    );

  const facts = async (tenantId: string, clientId: string | null = null) => {
    const rows = await AgencyDataSource.query<
      Array<{ metric_key: string; dimension_key: string; metric_value: string }>
    >(
      `SELECT fact.metric_key, fact.dimension_key, fact.metric_value
         FROM leadflow_product_telemetry_daily fact
         INNER JOIN leadflow_telemetry_identity_links link
           ON link.scope_pseudonym = fact.scope_pseudonym
        WHERE link.tenant_id = $1
          AND link.agency_client_id IS NOT DISTINCT FROM $2::uuid
        ORDER BY fact.observed_on ASC, fact.metric_key ASC`,
      [tenantId, clientId],
    );
    return rows;
  };

  const reset = async () => {
    for (const tenantId of tenants) {
      await AgencyDataSource.query(
        `DELETE FROM leadflow_product_telemetry_daily
          WHERE scope_pseudonym IN (
            SELECT scope_pseudonym FROM leadflow_telemetry_identity_links
             WHERE tenant_id = $1
          )`,
        [tenantId],
      );
      for (const table of [
        'leadflow_telemetry_identity_links',
        'leadflow_telemetry_consents',
        'leadflow_telemetry_audit_events',
        'leadflow_client_settings',
        'social_ad_metrics_daily',
        'social_ad_destination_observations',
        'social_ad_entities',
        'social_ad_account_connections',
      ]) {
        await AgencyDataSource.query(
          `DELETE FROM ${table} WHERE tenant_id = $1`,
          [tenantId],
        );
      }
    }
    tenants.clear();
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    await AgencyDataSource.query(
      `INSERT INTO leadflow_telemetry_consent_notices
         (id, purpose_key, version, locale, title, body, content_hash,
          categories, retention_days, k_anonymity_threshold,
          legal_review_status, status, effective_at)
       VALUES ($1, $2, 999, 'pt-BR', 'Aviso de teste', 'Corpo de teste', $3,
               '[]'::jsonb, 90, 5, 'approved', 'active', now())`,
      [noticeId, PURPOSE, NOTICE_HASH],
    );
  });

  beforeEach(() => {
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
    process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY = '5';
  });

  afterEach(async () => {
    await reset();
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    await AgencyDataSource.query(
      `DELETE FROM leadflow_telemetry_consent_notices WHERE id = $1`,
      [noticeId],
    );
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  // ------------------------------------------------------------------- tests

  describe('the happy path', () => {
    /**
     * §19: a consenting context contributes, and the fact carries a pseudonym
     * and nothing else.
     *
     * The assertion is over the physical row rather than the service's return
     * value, because what leaves the process is what the row contains.
     */
    it('writes pseudonymous facts from operational rows', async () => {
      const { tenantId } = await createContext({});
      await optIn(tenantId);

      const result = await collect(tenantId);

      // Ten days, five metrics each: an exact count rather than "some", so a
      // metric silently dropping out of the contribution would fail here.
      expect(result.contributionsBySource).toEqual([
        { sourceKey: 'social_paid_media', factsWritten: 50 },
      ]);

      const written = await facts(tenantId);
      const impressions = written.filter(
        (row) => row.metric_key === 'paid_impressions',
      );

      expect(impressions.length).toBeGreaterThan(0);
      expect(impressions[0].dimension_key).toBe(COHORT);
      expect(impressions[0].metric_value).toBe('1000');
    });

    /** §11: BRL 6.64 is 664 minor units, exactly, with no float in between. */
    it('stores spend in exact minor units', async () => {
      const { tenantId } = await createContext({ spend: '6.640000' });
      await optIn(tenantId);
      await collect(tenantId);

      const spend = (await facts(tenantId)).filter(
        (row) => row.metric_key === 'paid_spend_minor_units',
      );

      expect(spend[0].metric_value).toBe('664');
      expect(spend[0].dimension_key).toBe(`${COHORT}|c=BRL`);
    });

    /**
     * §19 again, and the assertion that matters most: no identifier reaches the
     * fact table. Checked by querying the table for the raw ids rather than by
     * inspecting an object, because the column list is what constrains this.
     */
    it('writes no operational identifier into the fact table', async () => {
      const { tenantId, connectionId } = await createContext({});
      await optIn(tenantId);
      await collect(tenantId);

      const [{ count }] = await AgencyDataSource.query<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count
           FROM leadflow_product_telemetry_daily fact
          WHERE fact.dimension_key LIKE '%' || $1 || '%'
             OR fact.metric_key LIKE '%' || $1 || '%'`,
        [connectionId],
      );

      expect(count).toBe('0');

      // The table has exactly one identity column, and it is the pseudonym.
      const columns = await AgencyDataSource.query<
        Array<{ column_name: string }>
      >(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'leadflow_product_telemetry_daily'`,
      );
      const names = columns.map((column) => column.column_name);

      expect(names).toContain('scope_pseudonym');
      for (const forbidden of [
        'tenant_id',
        'workspace_id',
        'agency_client_id',
      ]) {
        expect(names).not.toContain(forbidden);
      }
      expect(tenantId).toBeTruthy();
    });

    /** §10: the same snapshot twice writes the same rows, not double. */
    it('is idempotent across repeated collection', async () => {
      const { tenantId } = await createContext({});
      await optIn(tenantId);

      await collect(tenantId);
      const first = await facts(tenantId);

      await collect(tenantId);
      const second = await facts(tenantId);

      expect(second).toEqual(first);
    });
  });

  describe('eligibility', () => {
    it('contributes nothing for a tenant-custom business mode', async () => {
      const { tenantId } = await createContext({
        businessModeKey: 'meu_modo_proprio',
      });
      await optIn(tenantId);

      const result = await collect(tenantId);

      expect(result.contributionsBySource).toEqual([
        { sourceKey: 'social_paid_media', factsWritten: 0 },
      ]);
      expect(await facts(tenantId)).toEqual([]);
    });

    it('contributes nothing for an unconfigured context', async () => {
      const { tenantId } = await createContext({ businessModeKey: null });
      await optIn(tenantId);

      await collect(tenantId);

      expect(await facts(tenantId)).toEqual([]);
    });

    /** §14: an intraday row is not a day, and never contributes. */
    it('excludes partial facts', async () => {
      const { tenantId } = await createContext({ isPartial: true });
      await optIn(tenantId);

      await collect(tenantId);

      expect(await facts(tenantId)).toEqual([]);
    });

    /**
     * §13: a real zero contributes; a missing fact does not become one.
     *
     * The context reports `leads = 0` for every day — a genuine provider zero —
     * and the row is written. A day with no metrics row at all produces no
     * fact, which is why the count of written days matches the days that exist.
     */
    it('contributes a real zero but not a missing day', async () => {
      const { tenantId } = await createContext({ leads: '0', days: 3 });
      await optIn(tenantId);

      await collect(tenantId);

      const leads = (await facts(tenantId)).filter(
        (row) => row.metric_key === 'paid_provider_leads',
      );

      expect(leads).toHaveLength(3);
      expect(leads.every((row) => row.metric_value === '0')).toBe(true);
    });
  });

  describe('consent', () => {
    it('refuses collection without consent', async () => {
      const { tenantId } = await createContext({});

      await expect(collect(tenantId)).rejects.toThrow();
      expect(await facts(tenantId)).toEqual([]);
    });

    /** §17: the gate alone stops everything, with a valid consent in place. */
    it('refuses collection when the gate is off', async () => {
      const { tenantId } = await createContext({});
      await optIn(tenantId);
      process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'false';

      await expect(collect(tenantId)).rejects.toThrow();
      expect(await facts(tenantId)).toEqual([]);
    });

    /** §15: revoking stops the next snapshot; nothing new is written. */
    it('stops contributing after opt-out', async () => {
      const { tenantId } = await createContext({});
      await optIn(tenantId);
      await collect(tenantId);

      const before = await facts(tenantId);
      expect(before.length).toBeGreaterThan(0);

      await collector().optOut(
        ctxFor(tenantId),
        { reasonCode: 'preference_changed' },
        purpose,
      );

      await expect(collect(tenantId)).rejects.toThrow();
      expect(await facts(tenantId)).toEqual(before);
    });

    /** §15: erasure removes what was contributed. */
    it('erases contributed facts', async () => {
      const { tenantId } = await createContext({});
      await optIn(tenantId);
      await collect(tenantId);

      expect((await facts(tenantId)).length).toBeGreaterThan(0);

      await collector().eraseContribution(
        ctxFor(tenantId),
        { reasonCode: 'user_request' },
        purpose,
      );

      expect(await facts(tenantId)).toEqual([]);
    });

    /**
     * §16: changing the notice invalidates the acceptance of the old one.
     *
     * The consent row stores the hash it was given, so a new active notice for
     * the same purpose leaves the old acceptance matching nothing.
     */
    it('refuses collection after the active notice changes', async () => {
      const { tenantId } = await createContext({});
      await optIn(tenantId);

      const replacementId = randomUUID();
      await AgencyDataSource.query(
        `INSERT INTO leadflow_telemetry_consent_notices
           (id, purpose_key, version, locale, title, body, content_hash,
            categories, retention_days, k_anonymity_threshold,
            legal_review_status, status, effective_at)
         VALUES ($1, $2, 1000, 'pt-BR', 'Aviso novo', 'Corpo novo', $3,
                 '[]'::jsonb, 90, 5, 'approved', 'active', now())`,
        [replacementId, PURPOSE, 'd'.repeat(64)],
      );

      try {
        await expect(collect(tenantId)).rejects.toThrow();
      } finally {
        await AgencyDataSource.query(
          `DELETE FROM leadflow_telemetry_consent_notices WHERE id = $1`,
          [replacementId],
        );
      }
    });

    /**
     * §20: one context's consent never enables another's contribution.
     *
     * Both contexts live under the **same tenant**, which is the only version of
     * this test that proves anything: two different tenants are trivially
     * separated by every predicate in the system, whereas an agency and its own
     * managed client differ by a single nullable column. That column is what
     * `IS NOT DISTINCT FROM` is doing in the consent lookup, and dropping it
     * would let an agency's acceptance start collecting for every client it
     * manages.
     */
    it('isolates a managed client from its agency', async () => {
      const clientId = randomUUID();
      const { tenantId } = await createContext({});
      await createContext({ clientId, tenantId });

      // Only the agency context consents.
      await optIn(tenantId);
      await collect(tenantId);

      await expect(collect(tenantId, clientId)).rejects.toThrow();
      expect(await facts(tenantId, clientId)).toEqual([]);
      expect((await facts(tenantId)).length).toBeGreaterThan(0);
    });

    /**
     * The mirror of the test above: the client consents and the agency does not.
     *
     * Both directions are asserted because the failure modes are different. A
     * predicate that leaked upward would let a client's acceptance collect the
     * agency's own paid media, and no assertion about the downward direction
     * would catch it.
     */
    it('does not let a client consent cover its agency', async () => {
      const clientId = randomUUID();
      const { tenantId } = await createContext({});
      await createContext({ clientId, tenantId });

      await optIn(tenantId, clientId);
      await collect(tenantId, clientId);

      await expect(collect(tenantId)).rejects.toThrow();
      expect(await facts(tenantId)).toEqual([]);
      expect((await facts(tenantId, clientId)).length).toBeGreaterThan(0);
    });

    /**
     * §21: the contributor is the context, not the person.
     *
     * Two different actors collect for the same context; one pseudonym exists
     * and the facts do not double.
     */
    it('gives one context one pseudonym regardless of actor', async () => {
      const { tenantId } = await createContext({});
      await optIn(tenantId);

      await collect(tenantId);
      await collect(tenantId);

      const [{ count }] = await AgencyDataSource.query<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count FROM leadflow_telemetry_identity_links
          WHERE tenant_id = $1`,
        [tenantId],
      );

      expect(count).toBe('1');
    });
  });

  /**
   * §22: the chain terminates in a real benchmark answer.
   *
   * Five consenting contexts, each contributing through the real collector,
   * then the real read path. Nothing is inserted into
   * `leadflow_product_telemetry_daily` by this test — every row there was
   * produced by the pipeline, which is the point.
   */
  describe('the benchmark over contributed facts', () => {
    const contributeContexts = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        const { tenantId } = await createContext({
          impressions: String(1000 + index * 100),
          days: 10,
        });
        await optIn(tenantId);
        await collect(tenantId);
      }
    };

    const benchmark = () =>
      new BenchmarkService(AgencyDataSource).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: {
          businessModeKey: 'agency_services',
          provider: 'meta',
          destination: 'whatsapp',
          currency: null,
        },
        windowKey: 'trailing_30_completed_days_v1',
      });

    it('publishes with five contributors', async () => {
      await contributeContexts(5);

      const result = await benchmark();

      expect(result.available).toBe(true);
      if (!result.available) return;

      expect(result.quality.sampleSize).toBe(5);
      expect(result.percentiles).not.toBeNull();
    });

    it('withholds with four', async () => {
      await contributeContexts(4);

      const result = await benchmark();

      expect(result.available).toBe(false);
      if (result.available) return;

      expect(result.reason).toBe('insufficient_anonymous_sample');
    });

    /**
     * Erasing one contributor drops the sample below k, and the benchmark stops
     * publishing — without anything notifying it. That is the property the
     * pseudonym buys: deletion propagates because there is only one copy.
     */
    it('falls below k when a contributor erases', async () => {
      await contributeContexts(5);
      expect((await benchmark()).available).toBe(true);

      const [first] = [...tenants];
      await collector().eraseContribution(
        ctxFor(first),
        { reasonCode: 'user_request' },
        purpose,
      );

      expect((await benchmark()).available).toBe(false);
    });
  });
});
