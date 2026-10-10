import { AgencyClient, AgencyClientCompanyContext } from '../clients/entities';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions, type Repository } from 'typeorm';
import type { RequestContext } from '../../common/context/request-context.interface';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateAiOperationalCosts1799000000000 } from '../../database/migrations/1799000000000-create-ai-operational-costs';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  AiCostLedgerService,
  type AiCostEntryInput,
} from '../ai-costs/ai-cost-ledger.service';
import {
  FinanceBill,
  FinanceBillLine,
  FinanceCostCenter,
  FinanceInvoice,
  FinanceInvoiceStatus,
  FinanceProfitabilityRule,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../finance';
import { FinanceProfitabilityService } from '../finance/services/finance-profitability.service';
import {
  AgencyProject,
  AgencyProjectSettings,
  AgencyTask,
  AgencyTaskChecklistItem,
  AgencyTaskTimeEntry,
} from '../projects';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { TeamMember } from '../team/entities';
import { CreativeCostMaterializer } from './creative-cost.materializer';
import { CreativeCostService } from './creative-cost.service';
import { CreativeProductionReadinessService } from './creative-production-readiness.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
  CreativeProductionEntity,
  CreativeProductionEventEntity,
  CreativeVideoGenerationEntity,
  CreativeVideoOperationEntity,
} from './entities';

const run = describePostgresIntegration();

/**
 * CS6-B against real PostgreSQL: the ledger migration (CHECKs, unique source,
 * immutability trigger, up/down), materialization from the CS3/CS4 rows, exact
 * `numeric` aggregation, correlation and late binding, and the REAL Finance
 * profitability service reading the ledger.
 *
 * Throwaway schema of the guarded `_test` database (`search_path = <schema>,
 * public`), dropped at the end. No provider is called.
 */
run('CS6-B AI cost ledger (real PostgreSQL)', () => {
  const schema = `cs6b_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const own: CreativeStudioScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };
  const scopeA: CreativeStudioScope = {
    ...own,
    agencyClientId: clientId,
    companyContextId: companyA,
  };
  const scopeB: CreativeStudioScope = { ...scopeA, companyContextId: companyB };
  const otherClient: CreativeStudioScope = {
    ...own,
    agencyClientId: otherClientId,
    companyContextId: randomUUID(),
  };
  const operator = randomUUID();
  const ctx: RequestContext = {
    tenantId,
    workspaceId,
    userId: operator,
    role: 'owner',
  };
  const financeCtx = { tenantId, workspaceId, userId: operator };
  const PRICED_AT = new Date('2026-10-07T12:00:00.000Z');

  let db: DataSource;
  let ledger: AiCostLedgerService;
  let materializer: CreativeCostMaterializer;
  let costs: CreativeCostService;
  let finance: FinanceProfitabilityService;
  let generations: Repository<CreativeGenerationEntity>;
  let outputs: Repository<CreativeGenerationOutputEntity>;
  let videos: Repository<CreativeVideoGenerationEntity>;
  let operations: Repository<CreativeVideoOperationEntity>;
  let assets: Repository<CreativeAssetEntity>;
  let versions: Repository<CreativeAssetVersionEntity>;
  let productions: Repository<CreativeProductionEntity>;
  let items: Repository<SocialContentItemEntity>;
  const permissions = {
    can: jest.fn(async () => true),
    assertCan: jest.fn(async (_context: unknown, _key: string) => undefined),
  };

  const ENTITIES = [
    AgencyClient,
    AgencyClientCompanyContext,
    CreativeGenerationEntity,
    CreativeGenerationOutputEntity,
    CreativeVideoGenerationEntity,
    CreativeVideoOperationEntity,
    CreativeAssetEntity,
    CreativeAssetVersionEntity,
    CreativeProductionEntity,
    CreativeProductionEventEntity,
    SocialPlanEntity,
    SocialContentItemEntity,
    FinanceSetting,
    FinanceProfitabilityRule,
    FinanceInvoice,
    FinanceBill,
    FinanceBillLine,
    FinanceCostCenter,
    FinanceRecurringProfile,
    TeamMember,
    AgencyProject,
    AgencyProjectSettings,
    AgencyTask,
    AgencyTaskChecklistItem,
    AgencyTaskTimeEntry,
  ];

  function options(name: string) {
    const base = getAgencyTypeOrmConfig() as Extract<
      DataSourceOptions,
      { type: 'postgres' }
    >;
    return {
      ...base,
      type: 'postgres' as const,
      name,
      entities: ENTITIES,
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      schema,
      extra: { options: `-c search_path=${schema},public`, max: 12 },
    };
  }

  const migration = new CreateAiOperationalCosts1799000000000();
  const up = async () => {
    const runner = db.createQueryRunner();
    await migration.up(runner);
    await runner.release();
  };
  const down = async () => {
    const runner = db.createQueryRunner();
    await migration.down(runner);
    await runner.release();
  };

  beforeAll(async () => {
    const bootstrap = new DataSource(options(`${schema}_boot`));
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.synchronize();
    await bootstrap.destroy();

    db = new DataSource(options(schema));
    await db.initialize();
    await up();
    generations = db.getRepository(CreativeGenerationEntity);
    outputs = db.getRepository(CreativeGenerationOutputEntity);
    videos = db.getRepository(CreativeVideoGenerationEntity);
    operations = db.getRepository(CreativeVideoOperationEntity);
    assets = db.getRepository(CreativeAssetEntity);
    versions = db.getRepository(CreativeAssetVersionEntity);
    productions = db.getRepository(CreativeProductionEntity);
    items = db.getRepository(SocialContentItemEntity);

    ledger = new AiCostLedgerService(db);
    materializer = new CreativeCostMaterializer(db, ledger, {
      workerEnabled: true,
    } as never);
    const readiness = new CreativeProductionReadinessService(
      productions,
      db.getRepository(CreativeProductionEventEntity),
      assets,
      versions,
      {} as never,
      items,
      db.getRepository(SocialPlanEntity),
      {} as never,
      {} as never,
      { register: () => undefined } as never,
    );
    costs = new CreativeCostService(
      db,
      ledger,
      readiness,
      materializer,
      permissions as never,
    );
    finance = new FinanceProfitabilityService(
      db.getRepository(FinanceSetting),
      db.getRepository(FinanceProfitabilityRule),
      db.getRepository(FinanceInvoice),
      db.getRepository(FinanceBill),
      db.getRepository(FinanceBillLine),
      db.getRepository(FinanceCostCenter),
      db.getRepository(TeamMember),
      db.getRepository(FinanceRecurringProfile),
      db.getRepository(AgencyProject),
      db.getRepository(AgencyTask),
      db.getRepository(AgencyTaskChecklistItem),
      db.getRepository(AgencyTaskTimeEntry),
      db.getRepository(AgencyProjectSettings),
      ledger,
      db.getRepository(AgencyClient),
      db.getRepository(AgencyClientCompanyContext),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(async () => {
    permissions.assertCan.mockReset();
    permissions.assertCan.mockResolvedValue(undefined);
    for (const table of [
      'ai_operational_costs',
      'social_creative_generation_outputs',
      'social_creative_generations',
      'social_creative_video_generation_operations',
      'social_creative_video_generations',
      'social_creative_asset_versions',
      'social_creative_assets',
      'social_creative_productions',
      'social_content_items',
      'social_plans',
      'agency_tasks',
      'agency_projects',
      'finance_invoices',
      'finance_settings',
      'team_members',
    ])
      await db.query(`DELETE FROM "${schema}"."${table}"`);
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function item(scope: CreativeStudioScope) {
    const plan = await db.getRepository(SocialPlanEntity).save({
      ...scope,
      title: 'Plano Outubro',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    return items.save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      planId: plan.id,
      title: 'Post de lançamento',
      planningStatus: 'copy_ready',
      updatedById: null,
    });
  }

  const FRESH_USAGE = {
    images: 1,
    input_tokens: 18,
    input_text_tokens: 18,
    input_image_tokens: 0,
    output_tokens: 439,
    output_image_tokens: 439,
    output_text_tokens: 0,
    total_tokens: 457,
  };
  const VARIATION_USAGE = {
    images: 1,
    input_tokens: 1282,
    input_text_tokens: 258,
    input_image_tokens: 1024,
    output_tokens: 439,
    output_image_tokens: 439,
    output_text_tokens: 0,
    total_tokens: 1721,
  };

  function image(
    scope: CreativeStudioScope,
    patch: Partial<CreativeGenerationEntity> = {},
  ) {
    return generations.save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      generationType: 'image',
      status: 'completed',
      prompt: 'caneca azul',
      effectivePrompt: 'caneca azul',
      outputCount: 1,
      aspectRatio: '1:1',
      quality: 'standard',
      maxAttempts: 3,
      attempts: 1,
      provider: 'openai',
      model: 'gpt-image-2.5-flare-2026-09-08',
      usageMetrics: FRESH_USAGE,
      completedAt: PRICED_AT,
      ...patch,
    } as Partial<CreativeGenerationEntity>);
  }

  function video(
    scope: CreativeStudioScope,
    patch: Partial<CreativeVideoGenerationEntity> = {},
  ) {
    return videos.save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      mode: 'generative_reel',
      inputKind: 'prompt',
      status: 'completed',
      aspectRatio: '9:16',
      quality: 'standard',
      provider: 'vidu',
      idempotencyKey: randomUUID(),
      requestFingerprint: 'f'.repeat(64),
      maxStepRetries: 3,
      deadlineAt: new Date(Date.now() + 3_600_000),
      completedAt: PRICED_AT,
      ...patch,
    } as Partial<CreativeVideoGenerationEntity>);
  }

  /** A paid Vidu operation with its CS4 snapshot (credits × US$ 0.005). */
  function viduOp(
    generationId: string,
    sequence: number,
    credits: number,
    patch: Partial<CreativeVideoOperationEntity> = {},
  ) {
    return operations.save({
      generationId,
      sequence,
      kind: sequence === 0 ? 'generate' : 'extend',
      status: 'succeeded',
      provider: 'vidu',
      providerModel: 'viduq3-turbo',
      providerJobId: `job-${randomUUID()}`,
      dispatchStartedAt: PRICED_AT,
      acceptedAt: PRICED_AT,
      completedAt: new Date(PRICED_AT.getTime() + sequence * 60_000),
      billedUnits: `${credits}.000`,
      unitKind: 'vidu_credit',
      unitPrice: '0.00500000',
      pricingVersion: 'vidu.credits.2026-10',
      costAmount: (credits * 0.005).toFixed(6),
      costCurrency: 'USD',
      costSource: 'lyra_calculated',
      ...patch,
    } as Partial<CreativeVideoOperationEntity>);
  }

  async function asset(
    scope: CreativeStudioScope,
    contentItemId: string | null,
  ) {
    const created = await assets.save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      name: 'Peça',
      assetType: 'image',
      contentItemId,
    } as Partial<CreativeAssetEntity>);
    return created;
  }

  async function version(assetId: string, versionNumber = 1) {
    return versions.save({
      creativeAssetId: assetId,
      versionNumber,
      mediaAssetId: randomUUID(),
      source: 'upload',
    });
  }

  /** Output of an image generation, promoted into `versionId` (or not). */
  function output(
    generationId: string,
    outputIndex: number,
    promoted?: { assetId: string; versionId: string },
  ) {
    return outputs.save({
      generationId,
      outputIndex,
      mediaAssetId: null,
      promotionKind: promoted ? 'version' : null,
      promotedCreativeAssetId: promoted?.assetId ?? null,
      promotedVersionId: promoted?.versionId ?? null,
      promotedAt: promoted ? PRICED_AT : null,
    });
  }

  const reconcile = () => materializer.reconcile({ tenantId, workspaceId });
  const rowOf = async (sourceId: string) => {
    const rows = await db.query<Record<string, unknown>[]>(
      `SELECT *, provider_cost::text AS cost_text FROM ai_operational_costs WHERE source_id = $1`,
      [sourceId],
    );
    return rows;
  };
  const count = async () =>
    Number(
      (
        await db.query<{ n: string }[]>(
          'SELECT count(*) AS n FROM ai_operational_costs',
        )
      )[0].n,
    );

  function known(
    sourceId: string,
    amount: string,
    patch: Partial<AiCostEntryInput> = {},
  ): AiCostEntryInput {
    return {
      tenantId,
      workspaceId,
      agencyClientId: null,
      companyContextId: null,
      sourceDomain: 'test.domain',
      sourceType: 'op',
      sourceId,
      logicalType: 'unit',
      logicalId: sourceId,
      operationKind: 'test.op',
      provider: 'acme',
      model: null,
      outcome: 'succeeded',
      usage: { unit: null, quantity: null, metrics: null },
      unitPrice: null,
      pricingVersion: 'acme.2026-10',
      cost: {
        status: 'known',
        amount,
        currency: 'USD',
        source: 'lyra_calculated',
      },
      occurredAt: PRICED_AT,
      correlation: { contentItemId: null, projectId: null, taskId: null },
      metadata: {},
      ...patch,
    };
  }

  // ── migration ────────────────────────────────────────────────────────────

  describe('migration 1799000000000', () => {
    it('is re-runnable and survives down → up → up', async () => {
      await up();
      await down();
      await up();
      await up();
      await ledger.record([known(randomUUID(), '1.000000')]);
      expect(await count()).toBe(1);
    });

    it('CHECKs the known/unknown shape and the ledger vocabulary', async () => {
      const insert = (columns: string, values: string) =>
        db.query(
          `INSERT INTO ai_operational_costs (tenant_id, workspace_id, source_domain,
             source_type, source_id, logical_type, logical_id, operation_kind,
             provider, outcome, occurred_at, ${columns})
           VALUES ($1, $2, 'd', 't', $3, 'l', 'x', 'k', 'p', 'succeeded', now(), ${values})`,
          [tenantId, workspaceId, randomUUID()],
        );
      // Known without money / unknown with money / unknown without a reason.
      await expect(
        insert('cost_status, cost_source', `'known', 'lyra_calculated'`),
      ).rejects.toThrow(/CK_ai_operational_costs_known/);
      await expect(
        insert(
          'cost_status, provider_cost, provider_currency, unknown_reason',
          `'unknown', 0, 'USD', 'outcome_unknown'`,
        ),
      ).rejects.toThrow(/CK_ai_operational_costs_known/);
      await expect(insert('cost_status', `'unknown'`)).rejects.toThrow(
        /CK_ai_operational_costs_known/,
      );
      await expect(
        insert(
          'cost_status, provider_cost, provider_currency, cost_source',
          `'known', 1, 'usd', 'lyra_calculated'`,
        ),
      ).rejects.toThrow(/CK_ai_operational_costs_known/);
      await expect(
        insert(
          'cost_status, provider_cost, provider_currency, cost_source',
          `'known', 1, 'USD', 'guessed'`,
        ),
      ).rejects.toThrow(/CK_ai_operational_costs_source_vocabulary/);
      await expect(
        insert(
          'cost_status, provider_cost, provider_currency, cost_source',
          `'known', -1, 'USD', 'lyra_calculated'`,
        ),
      ).rejects.toThrow(/CK_ai_operational_costs_known/);
    });

    it('keeps economic columns immutable; only unknown → known, once; correlation is writable', async () => {
      const unknownId = randomUUID();
      await ledger.record([
        known(unknownId, '0', {
          cost: { status: 'unknown', reason: 'unpriced' },
        }),
      ]);
      const [row] = await rowOf(unknownId);
      await expect(
        db.query(
          `UPDATE ai_operational_costs SET provider = 'other' WHERE id = $1`,
          [row.id],
        ),
      ).rejects.toThrow(
        /TR_ai_operational_costs_immutable|identity is immutable/,
      );
      // unknown → known (a price version arrived): allowed.
      expect(await ledger.record([known(unknownId, '0.250000')])).toEqual({
        inserted: 0,
        upgraded: 1,
      });
      // known never changes again, not through the service…
      expect(await ledger.record([known(unknownId, '9.000000')])).toEqual({
        inserted: 0,
        upgraded: 0,
      });
      // …and not behind its back.
      await expect(
        db.query(
          `UPDATE ai_operational_costs SET provider_cost = 9 WHERE id = $1`,
          [row.id],
        ),
      ).rejects.toThrow(/only unknown -> known/);
      await expect(
        db.query(
          `UPDATE ai_operational_costs SET cost_status = 'unknown', provider_cost = NULL,
                  provider_currency = NULL, cost_source = NULL, unknown_reason = 'unpriced'
            WHERE id = $1`,
          [row.id],
        ),
      ).rejects.toThrow(/only unknown -> known/);
      expect(
        await ledger.updateCorrelations([
          {
            id: String(row.id),
            contentItemId: randomUUID(),
            projectId: null,
            taskId: null,
          },
        ]),
      ).toBe(1);
      const [after] = await rowOf(unknownId);
      expect(after.cost_text).toBe('0.250000');
      expect(after.correlated_at).not.toBeNull();
    });
  });

  // ── ledger matrix ────────────────────────────────────────────────────────

  describe('materialization from CS3/CS4 rows', () => {
    it('prices an image generation from its tokens with the version in force', async () => {
      const fresh = await image(own);
      const variation = await image(own, {
        originType: 'variation',
        originGenerationId: null,
        usageMetrics: VARIATION_USAGE,
      });
      expect(await reconcile()).toMatchObject({ recorded: 2, upgraded: 0 });
      const [freshRow] = await rowOf(fresh.id);
      // 18 × 5 + 439 × 30 per 1M tokens = US$ 0.013260, exact.
      expect(freshRow).toMatchObject({
        cost_status: 'known',
        cost_text: '0.013260',
        provider_currency: 'USD',
        cost_source: 'lyra_calculated',
        pricing_version: 'openai.images.standard.2026-10-06',
        metadata: expect.objectContaining({ pricingTier: 'standard' }),
        operation_kind: 'image.generate',
        outcome: 'succeeded',
        logical_type: 'image_generation',
        logical_id: fresh.id,
        usage_unit: 'token',
        agency_client_id: null,
      });
      const [variationRow] = await rowOf(variation.id);
      // 258 × 5 + 1024 × 8 + 439 × 30 = US$ 0.022652 — its own row.
      expect(variationRow).toMatchObject({
        cost_text: '0.022652',
        operation_kind: 'image.variation',
      });
    });

    it('copies a Vidu snapshot and keeps a 30 s Reel as ONE logical generation of three costs', async () => {
      const single = await video(own);
      await viduOp(single.id, 0, 100);
      const reel = await video(own);
      await viduOp(reel.id, 0, 160);
      await viduOp(reel.id, 1, 45);
      await viduOp(reel.id, 2, 45);
      await reconcile();
      const singleRows = await db.query(
        `SELECT provider_cost::text AS cost, unit_price::text AS price, usage_quantity::text AS units,
                pricing_version, usage_unit FROM ai_operational_costs WHERE logical_id = $1`,
        [single.id],
      );
      expect(singleRows).toEqual([
        {
          cost: '0.500000',
          price: '0.00500000',
          units: '100.000000',
          pricing_version: 'vidu.credits.2026-10',
          usage_unit: 'vidu_credit',
        },
      ]);
      const summary = (
        await ledger.summarize({
          tenantId,
          workspaceId,
          logical: [{ type: 'video_generation', id: reel.id }],
        })
      ).get(null);
      expect(summary).toMatchObject({
        operations: 3,
        generations: 1,
        totals: [
          {
            currency: 'USD',
            amount: '1.250000',
            operations: 3,
            generations: 1,
          },
        ],
      });
      const kinds = await db.query<{ operation_kind: string }[]>(
        `SELECT operation_kind FROM ai_operational_costs WHERE logical_id = $1 ORDER BY occurred_at`,
        [reel.id],
      );
      expect(kinds.map((row) => row.operation_kind)).toEqual([
        'video.generate',
        'video.extend',
        'video.extend',
      ]);
    });

    it('never re-prices a HeyGen snapshot with today’s table', async () => {
      const ugc = await video(own, { mode: 'ugc_avatar', provider: 'heygen' });
      const op = await operations.save({
        generationId: ugc.id,
        sequence: 0,
        kind: 'generate',
        status: 'succeeded',
        provider: 'heygen',
        providerJobId: 'job-heygen',
        dispatchStartedAt: PRICED_AT,
        completedAt: PRICED_AT,
        billedUnits: '10.345',
        unitKind: 'output_second:avatar_iv:studio_avatar',
        // The historical (third-party) price recorded at the time; the
        // current table says 0.0805 under the same version name.
        unitPrice: '0.06670000',
        pricingVersion: 'heygen.payg.2026-10',
        costAmount: '0.690012',
        costCurrency: 'USD',
        costSource: 'lyra_calculated',
      } as Partial<CreativeVideoOperationEntity>);
      await reconcile();
      const [row] = await rowOf(op.id);
      expect(row).toMatchObject({
        cost_text: '0.690012',
        unit_price: '0.06670000',
        cost_source: 'lyra_calculated',
      });
    });

    it('records failed-but-billed operations as known costs', async () => {
      const paidImage = await image(own, {
        status: 'failed',
        completedAt: null,
        failedAt: PRICED_AT,
        errorCode: 'invalid_output',
      });
      const failedReel = await video(own, {
        status: 'failed',
        failedAt: PRICED_AT,
      });
      const op = await viduOp(failedReel.id, 0, 100, {
        status: 'failed',
        completedAt: null,
        failedAt: PRICED_AT,
        errorCode: 'provider_failed',
      });
      await reconcile();
      expect((await rowOf(paidImage.id))[0]).toMatchObject({
        outcome: 'failed',
        cost_status: 'known',
        cost_text: '0.013260',
      });
      expect((await rowOf(op.id))[0]).toMatchObject({
        outcome: 'failed',
        cost_status: 'known',
        cost_text: '0.500000',
      });
    });

    it('records unknown as unknown (never 0) and leaves never-billed work out', async () => {
      const timedOut = await image(own, {
        status: 'failed',
        completedAt: null,
        failedAt: PRICED_AT,
        errorCode: 'timeout',
        usageMetrics: null,
        provider: null,
        model: null,
      });
      const tooEarly = await image(own, {
        completedAt: new Date('2026-10-01T10:00:00.000Z'),
      });
      const otherModel = await image(own, { model: 'gpt-image-9' });
      const rateLimited = await image(own, {
        status: 'failed',
        completedAt: null,
        failedAt: PRICED_AT,
        errorCode: 'rate_limited',
        usageMetrics: null,
      });
      const queued = await image(own, { status: 'queued', completedAt: null });
      const lost = await video(own, { status: 'failed', failedAt: PRICED_AT });
      const doubt = await viduOp(lost.id, 0, 0, {
        status: 'failed',
        providerJobId: null,
        completedAt: null,
        failedAt: PRICED_AT,
        errorCode: 'timeout',
        billedUnits: null,
        unitKind: null,
        unitPrice: null,
        pricingVersion: null,
        costAmount: null,
        costCurrency: null,
        costSource: null,
      });
      const never = await viduOp(lost.id, 1, 0, {
        status: 'failed',
        providerJobId: null,
        dispatchStartedAt: null,
        completedAt: null,
        failedAt: PRICED_AT,
        costAmount: null,
        costCurrency: null,
        costSource: null,
      });
      await reconcile();
      expect((await rowOf(timedOut.id))[0]).toMatchObject({
        cost_status: 'unknown',
        unknown_reason: 'outcome_unknown',
        provider_cost: null,
        provider: 'unrecorded',
      });
      expect((await rowOf(tooEarly.id))[0]).toMatchObject({
        cost_status: 'unknown',
        unknown_reason: 'unpriced',
        provider_cost: null,
      });
      expect((await rowOf(otherModel.id))[0]).toMatchObject({
        unknown_reason: 'unpriced',
      });
      expect((await rowOf(doubt.id))[0]).toMatchObject({
        cost_status: 'unknown',
        unknown_reason: 'outcome_unknown',
      });
      for (const unbilled of [rateLimited.id, queued.id, never.id])
        expect(await rowOf(unbilled)).toEqual([]);
      const summary = (await ledger.summarize({ tenantId, workspaceId })).get(
        null,
      );
      expect(summary?.unknownOperations).toBe(4);
      expect(summary?.totals).toEqual([]);
    });

    it('filters ledger totals by an explicit client portfolio, excluding internal and other scope costs', async () => {
      await image(scopeA);
      await image(scopeB);
      await image(own);
      await image(otherClient);
      await image({ ...scopeA, tenantId: randomUUID() });
      await image({ ...scopeA, workspaceId: randomUUID() });
      await reconcile();
      const total = (
        await ledger.summarize({
          tenantId,
          workspaceId,
          agencyClientIds: [clientId],
        })
      ).get(null);
      expect(total?.operations).toBe(2);
      expect(
        await ledger.summarize({ tenantId, workspaceId, agencyClientIds: [] }),
      ).toEqual(new Map());
    });

    it('records each paid operation once under replays and concurrent reconciles', async () => {
      const fresh = await image(own);
      const reel = await video(own);
      await viduOp(reel.id, 0, 160);
      await viduOp(reel.id, 1, 45);
      await Promise.all(Array.from({ length: 6 }, () => reconcile()));
      await reconcile();
      expect(await count()).toBe(3);
      expect(await rowOf(fresh.id)).toHaveLength(1);
      const total = (await ledger.summarize({ tenantId, workspaceId })).get(
        null,
      );
      expect(total?.totals).toEqual([
        expect.objectContaining({ currency: 'USD', amount: '1.038260' }),
      ]);
    });

    it('does not create a cost on promotion; the version reaches it through provenance', async () => {
      const content = await item(scopeA);
      const generation = await image(scopeA, { contentItemId: content.id });
      await output(generation.id, 0);
      await reconcile();
      expect(await count()).toBe(1);
      const target = await asset(scopeA, content.id);
      const v1 = await version(target.id);
      await outputs.update(
        { generationId: generation.id },
        {
          promotionKind: 'new_asset',
          promotedCreativeAssetId: target.id,
          promotedVersionId: v1.id,
        },
      );
      await reconcile();
      expect(await count()).toBe(1);
      const cost = await costs.versionCosts(ctx, scopeA, target.id, v1.id);
      expect(cost).toMatchObject({
        origin: 'generation',
        direct: {
          generationId: generation.id,
          totals: [{ currency: 'USD', amount: '0.013260' }],
        },
      });
    });

    it('sums exactly in numeric, never through a float', async () => {
      await ledger.record(
        ['0.100000', '0.200000', '0.000001'].map((amount) =>
          known(randomUUID(), amount),
        ),
      );
      const total = (await ledger.summarize({ tenantId, workspaceId })).get(
        null,
      );
      expect(total?.totals[0].amount).toBe('0.300001');
    });
  });

  // ── correlation ──────────────────────────────────────────────────────────

  describe('correlation and late binding', () => {
    it('own-scope cost has no client and is internal in Finance', async () => {
      const content = await item(own);
      await image(own, { contentItemId: content.id, completedAt: new Date() });
      await reconcile();
      const [row] = await db.query(`SELECT * FROM ai_operational_costs`);
      expect(row).toMatchObject({
        agency_client_id: null,
        content_item_id: content.id,
      });
      const overview = await finance.getOverview(financeCtx);
      expect(overview.clients).toEqual([]);
      expect(overview.summary.aiCost.internal.operations).toBe(1);
    });

    it('separates the content total (every attempt) from the selected version cost', async () => {
      const content = await item(scopeA);
      const chosen = await image(scopeA, { contentItemId: content.id });
      const discarded = await image(scopeA, {
        contentItemId: content.id,
        originType: 'regeneration',
        originGenerationId: null,
      });
      const reel = await video(scopeA, { contentItemId: content.id });
      await viduOp(reel.id, 0, 100);
      const piece = await asset(scopeA, content.id);
      const v1 = await version(piece.id);
      await output(chosen.id, 0, { assetId: piece.id, versionId: v1.id });
      await output(discarded.id, 0);
      await productions.save({
        ...scopeA,
        contentItemId: content.id,
        selectedCreativeAssetId: piece.id,
        selectedVersionId: v1.id,
      });
      await reconcile();
      const view = await costs.contentCosts(ctx, scopeA, content.id);
      expect(view.contentTotalAiCost).toEqual([
        { currency: 'USD', amount: '0.526520' },
      ]);
      expect(view).toMatchObject({
        operations: 3,
        generations: 3,
        unknownOperations: 0,
        currencyPolicy: 'provider_currency',
        correlation: { clientId, companyContextId: companyA, projectId: null },
      });
      expect(view.selectedVersionAiCost).toMatchObject({
        versionId: v1.id,
        direct: {
          generationId: chosen.id,
          totals: [{ currency: 'USD', amount: '0.013260' }],
        },
      });
      const byId = new Map(view.breakdown.map((g) => [g.generationId, g]));
      expect(byId.get(chosen.id)).toMatchObject({
        selected: true,
        promotedVersions: [{ assetId: piece.id, versionId: v1.id }],
      });
      expect(byId.get(discarded.id)).toMatchObject({
        selected: false,
        originType: 'regeneration',
      });
      expect(byId.get(reel.id)).toMatchObject({
        type: 'video',
        operations: [
          expect.objectContaining({
            costSource: 'lyra_calculated',
            confidence: 'calculated',
            pricingVersion: 'vidu.credits.2026-10',
          }),
        ],
      });
    });

    it('follows variation lineage by FK, never regenerations; manual versions cost 0', async () => {
      const piece = await asset(scopeA, null);
      const base = await image(scopeA);
      const vBase = await version(piece.id, 1);
      await output(base.id, 0, { assetId: piece.id, versionId: vBase.id });
      const variation = await image(scopeA, {
        originType: 'variation',
        originVersionId: vBase.id,
        usageMetrics: VARIATION_USAGE,
      });
      const vVariation = await version(piece.id, 2);
      await output(variation.id, 0, {
        assetId: piece.id,
        versionId: vVariation.id,
      });
      const manual = await version(piece.id, 3);
      await reconcile();
      const cost = await costs.versionCosts(
        ctx,
        scopeA,
        piece.id,
        vVariation.id,
      );
      expect(cost.direct.totals).toEqual([
        { currency: 'USD', amount: '0.022652' },
      ]);
      expect(cost.lineage).toMatchObject({
        totals: [{ currency: 'USD', amount: '0.035912' }],
        generations: [
          { generationId: variation.id, relation: 'direct' },
          { generationId: base.id, relation: 'variation_base' },
        ],
      });
      expect(
        await costs.versionCosts(ctx, scopeA, piece.id, manual.id),
      ).toMatchObject({ origin: 'manual', direct: { totals: [] } });
    });

    it('binds task and project linked later, keeps them when the task is deleted, drops them on unlink', async () => {
      const content = await item(scopeA);
      const generation = await image(scopeA, {
        contentItemId: content.id,
        completedAt: new Date(),
      });
      await reconcile();
      expect((await rowOf(generation.id))[0]).toMatchObject({
        content_item_id: content.id,
        project_id: null,
        task_id: null,
      });
      const project = await db.getRepository(AgencyProject).save({
        tenantId,
        workspaceId,
        clientId,
        name: 'Campanha',
      });
      const task = await db.getRepository(AgencyTask).save({
        tenantId,
        workspaceId,
        projectId: project.id,
        createdById: operator,
        title: 'Arte',
      });
      // The CS5 link (what linkTask writes), then the hook.
      await productions.save({
        ...scopeA,
        contentItemId: content.id,
        taskId: task.id,
        projectId: project.id,
        taskLinkKind: 'linked',
      });
      expect(await materializer.refreshContentItem(scopeA, content.id)).toBe(1);
      expect((await rowOf(generation.id))[0]).toMatchObject({
        project_id: project.id,
        task_id: task.id,
      });
      const overview = await finance.getOverview(financeCtx);
      expect(
        overview.projects.find((p) => p.id === project.id)?.aiCost.operations,
      ).toBe(1);
      // The Agency owner hard-deletes the task: the cost stays where it was.
      await db.getRepository(AgencyTask).delete({ id: task.id });
      await reconcile();
      expect((await rowOf(generation.id))[0]).toMatchObject({
        project_id: project.id,
        task_id: task.id,
        cost_status: 'known',
      });
      // Unlink: the link is gone, so is the correlation; the cost is not.
      await productions.update(
        { contentItemId: content.id },
        { taskId: null, projectId: null, taskLinkKind: null },
      );
      await materializer.refreshContentItem(scopeA, content.id);
      expect((await rowOf(generation.id))[0]).toMatchObject({
        project_id: null,
        task_id: null,
        cost_text: '0.013260',
      });
    });

    it('attributes a standalone generation to the item only through its promotion', async () => {
      const content = await item(scopeA);
      const standalone = await image(scopeA);
      await output(standalone.id, 0);
      await reconcile();
      expect((await rowOf(standalone.id))[0].content_item_id).toBeNull();
      const piece = await asset(scopeA, content.id);
      const v1 = await version(piece.id);
      await outputs.update(
        { generationId: standalone.id },
        { promotedCreativeAssetId: piece.id, promotedVersionId: v1.id },
      );
      expect((await reconcile()).correlated).toBe(1);
      expect((await rowOf(standalone.id))[0].content_item_id).toBe(content.id);
    });

    it('isolates companies and clients: 404 across companies, no foreign sums', async () => {
      const content = await item(scopeA);
      const generation = await image(scopeA, {
        contentItemId: content.id,
        completedAt: new Date(),
      });
      const piece = await asset(scopeA, content.id);
      const v1 = await version(piece.id);
      await output(generation.id, 0, { assetId: piece.id, versionId: v1.id });
      const foreign = await image(otherClient, { completedAt: new Date() });
      await reconcile();
      await expect(
        costs.contentCosts(ctx, scopeB, content.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        costs.versionCosts(ctx, scopeB, piece.id, v1.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      const overview = await finance.getOverview(financeCtx);
      const mine = overview.clients.find((c) => c.id === clientId);
      const theirs = overview.clients.find((c) => c.id === otherClientId);
      expect(mine?.aiCost.operations).toBe(1);
      expect(theirs?.aiCost.operations).toBe(1);
      expect((await rowOf(foreign.id))[0].agency_client_id).toBe(otherClientId);
    });

    it('requires the Finance profitability key to see real cost', async () => {
      const content = await item(scopeA);
      permissions.assertCan.mockRejectedValueOnce(new ForbiddenException());
      await expect(
        costs.contentCosts(ctx, scopeA, content.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(permissions.assertCan).toHaveBeenCalledWith(
        expect.objectContaining({ userId: operator }),
        'agency.finance.profitability.view.finance_or_owner',
      );
    });
  });

  // ── profitability (real Finance) ─────────────────────────────────────────

  describe('Finance profitability over the ledger', () => {
    it('resolves overdue contact invoices to the client without mixing tenant or workspace ownership', async () => {
      const contact = randomUUID();
      const foreignTenant = randomUUID();
      const foreignWorkspace = randomUUID();
      await db.getRepository(AgencyClient).save([
        {
          id: clientId,
          tenantId,
          workspaceId,
          displayName: 'Cliente',
          metadata: { contactId: contact },
        },
        {
          tenantId: foreignTenant,
          workspaceId,
          displayName: 'Outro tenant',
          metadata: { contactId: contact },
        },
        {
          tenantId,
          workspaceId: foreignWorkspace,
          displayName: 'Outro workspace',
          metadata: { contactId: contact },
        },
      ]);
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - 60);
      const day = date.toISOString().slice(0, 10);
      await db
        .getRepository(FinanceInvoice)
        .save([
          ...['H-1', 'H-2'].map((invoiceNumber) => ({
            tenantId,
            workspaceId,
            invoiceNumber,
            customerId: contact,
            status: FinanceInvoiceStatus.Issued,
            totalAmount: '1000',
            balanceDue: '1000',
            issueDate: day,
            dueDate: day,
          })),
          {
            tenantId: foreignTenant,
            workspaceId,
            invoiceNumber: 'H-foreign',
            customerId: contact,
            status: FinanceInvoiceStatus.Issued,
            totalAmount: '9000',
            balanceDue: '9000',
            issueDate: day,
            dueDate: day,
          },
          {
            tenantId,
            workspaceId: foreignWorkspace,
            invoiceNumber: 'H-workspace',
            customerId: contact,
            status: FinanceInvoiceStatus.Issued,
            totalAmount: '9000',
            balanceDue: '9000',
            issueDate: day,
            dueDate: day,
          },
        ]);
      const overview = await finance.getOverview(financeCtx);
      expect(overview.clients).toHaveLength(1);
      expect(overview.clients[0]).toMatchObject({
        id: clientId,
        health: 'risk',
        delinquency: {
          overdueInvoiceCount: 2,
          overdueBalance: 2000,
          oldestOverdueDays: 60,
        },
      });
      const month = day.slice(0, 7);
      const monthly = await finance.getClientMonthlyProfitability(
        financeCtx,
        clientId,
        { startMonth: month, endMonth: month },
      );
      expect(monthly.series[0].revenue).toBe(2000);
    });

    async function workspaceWithLabor(baseCurrency: string) {
      await db.getRepository(FinanceSetting).save({
        tenantId,
        workspaceId,
        baseCurrency,
      });
      const member = await db.getRepository(TeamMember).save({
        tenantId,
        workspaceId,
        displayName: 'Ana',
        hourlyCost: '50.00',
      } as Partial<TeamMember>);
      const project = await db.getRepository(AgencyProject).save({
        tenantId,
        workspaceId,
        clientId,
        name: 'Campanha',
      });
      const task = await db.getRepository(AgencyTask).save({
        tenantId,
        workspaceId,
        projectId: project.id,
        createdById: operator,
        title: 'Arte',
        assigneeId: member.id,
        trackedMinutes: 120,
      } as Partial<AgencyTask>);
      await db.getRepository(FinanceInvoice).save({
        tenantId,
        workspaceId,
        invoiceNumber: 'F-1',
        customerId: clientId,
        status: FinanceInvoiceStatus.Issued,
        totalAmount: '1000.00',
        issueDate: new Date().toISOString().slice(0, 10),
      } as Partial<FinanceInvoice>);
      const content = await item(scopeA);
      await productions.save({
        ...scopeA,
        contentItemId: content.id,
        taskId: task.id,
        projectId: project.id,
        taskLinkKind: 'linked',
      });
      const reel = await video(scopeA, { contentItemId: content.id });
      const now = Date.now();
      await viduOp(reel.id, 0, 160, { completedAt: new Date(now) });
      await viduOp(reel.id, 1, 45, { completedAt: new Date(now) });
      await viduOp(reel.id, 2, 45, { completedAt: new Date(now) });
      // A year ago: outside this period — and older than every image price
      // version, so it is an `unknown` cost, never a free one.
      await image(scopeA, {
        contentItemId: content.id,
        completedAt: new Date(now - 400 * 86_400_000),
      });
      await reconcile();
      return { project, task, reel };
    }

    it('BRL workspace: USD AI cost is reported per currency and not converted', async () => {
      const { project } = await workspaceWithLabor('BRL');
      const overview = await finance.getOverview(financeCtx);
      const client = overview.clients.find((c) => c.id === clientId)!;
      expect(client.laborCost).toBe(100);
      expect(client.aiCost).toMatchObject({
        totals: [
          {
            currency: 'USD',
            amount: '1.250000',
            operations: 3,
            generations: 1,
          },
        ],
        includedInGrossProfit: 0,
        excludedFromGrossProfit: [{ currency: 'USD', amount: '1.250000' }],
      });
      expect(client.grossProfit).toBe(900);
      const projectRow = overview.projects.find((p) => p.id === project.id)!;
      expect(projectRow.aiCost.totals[0].amount).toBe('1.250000');
    });

    it('USD workspace: human + AI coexist in the margin, period-filtered, counted once', async () => {
      const { project, task } = await workspaceWithLabor('USD');
      const overview = await finance.getOverview(financeCtx);
      const client = overview.clients.find((c) => c.id === clientId)!;
      // 1000 revenue − 100 labor − 1.25 AI (last year's image is out).
      expect(client.aiCost.includedInGrossProfit).toBe(1.25);
      expect(client.aiCost).toMatchObject({
        operations: 3,
        unknownOperations: 0,
      });
      expect(client.grossProfit).toBe(898.75);
      expect(overview.summary.grossProfit).toBe(898.75);
      const projectRow = overview.projects.find((p) => p.id === project.id)!;
      expect(projectRow.grossProfit).toBe(-101.25);
      // Drill-down: the project's figure decomposes into its operations.
      const drill = await finance.getAiCostDrilldown(financeCtx, {
        projectId: project.id,
        limit: 2,
      });
      expect(drill.summary.totals[0].amount).toBe('1.250000');
      expect(drill.items).toHaveLength(2);
      expect(drill.nextCursor).not.toBeNull();
      const rest = await finance.getAiCostDrilldown(financeCtx, {
        projectId: project.id,
        cursor: drill.nextCursor!,
      });
      const all = [...drill.items, ...rest.items];
      expect(all.map((entry) => entry.amount).sort()).toEqual([
        '0.225000',
        '0.225000',
        '0.800000',
      ]);
      expect(all.every((entry) => entry.taskId === task.id)).toBe(true);
      // The monthly series puts the year-old image in its own month only.
      const series = await finance.getClientMonthlyProfitability(
        financeCtx,
        clientId,
        {
          months: 24,
        },
      );
      expect(series.summary.aiCost).toMatchObject({
        operations: 4,
        unknownOperations: 1,
        totals: [expect.objectContaining({ amount: '1.250000' })],
      });
      const yearAgo = new Date(Date.now() - 400 * 86_400_000)
        .toISOString()
        .slice(0, 7);
      expect(
        series.series.find((point) => point.month === yearAgo)?.aiCost
          .unknownOperations,
      ).toBe(1);
    });
  });
});
