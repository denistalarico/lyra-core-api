import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AiCostLedgerService,
  type AiCostEntryInput,
} from '../ai-costs/ai-cost-ledger.service';
import type { AiCostSource } from '../ai-costs/entities';
import { CreativeGenerationConfigService } from './creative-generation-config';
import { priceImageGeneration } from './creative-image-pricing';
import type { CreativeStudioScope } from './creative-studio.scope';

export const CREATIVE_COST_SOURCE_DOMAIN = 'social.creative_studio';
export const IMAGE_COST_SOURCE = 'image_generation';
export const VIDEO_COST_SOURCE = 'video_operation';
export const IMAGE_LOGICAL = 'image_generation';
export const VIDEO_LOGICAL = 'video_generation';

const BATCH = 200;
const MAX_ROUNDS = 50;

/**
 * Image generation failures that prove the provider was never asked for
 * billable work: provider disabled, a frozen reference missing (checked before
 * the call), a 429, or a refusal. Any other failure without usage may have
 * been processed and billed — recorded as `unknown`, never as free.
 */
const IMAGE_UNBILLED_FAILURES = [
  'unavailable',
  'reference_unavailable',
  'rate_limited',
  'rejected',
];

type WorkspaceFilter = { tenantId: string; workspaceId: string } | null;

export type CreativeCostReconcileResult = {
  recorded: number;
  upgraded: number;
  correlated: number;
};

type ImageSourceRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  agency_client_id: string | null;
  company_context_id: string | null;
  status: 'completed' | 'failed';
  origin_type: string;
  provider: string | null;
  model: string | null;
  usage_metrics: Record<string, number> | null;
  error_code: string | null;
  attempts: number;
  output_count: number;
  occurred_at: Date;
};

type VideoSourceRow = {
  id: string;
  generation_id: string;
  sequence: number;
  kind: string;
  status: 'succeeded' | 'failed';
  provider: string;
  provider_model: string | null;
  provider_job_id: string | null;
  billed_units: string | null;
  unit_kind: string | null;
  unit_price: string | null;
  pricing_version: string | null;
  cost_amount: string | null;
  cost_currency: string | null;
  cost_source: AiCostSource | null;
  usage_metrics: Record<string, number> | null;
  error_code: string | null;
  submit_attempts: number;
  duration_seconds: number | null;
  output_duration_seconds: string | null;
  occurred_at: Date;
  tenant_id: string;
  workspace_id: string;
  agency_client_id: string | null;
  company_context_id: string | null;
  mode: string;
};

/**
 * CS6-B — materializes the Creative Studio's paid operations into the
 * provider-neutral AI cost ledger, and keeps their correlation current.
 *
 * Decision (documented in the CS6-B report): a reconciling projection over
 * the Studio's own rows, not a write inside the CS3/CS4 workers.
 *
 *   - Image: one row per terminal generation (one paid call per attempt,
 *     usage summed by the worker). Priced by the versioned token table in
 *     force at `occurred_at` (`creative-image-pricing.ts`).
 *   - Video: one row per terminal, dispatched operation. The CS4 snapshot is
 *     copied as is — units, unit price, version, amount, currency, source —
 *     never recomputed. A generation's operations share one logical id: a
 *     30 s Reel is one Reel with three costs.
 *   - Promotion creates nothing: the cost reaches a version through the
 *     Studio's provenance (output/generation → version) at read time.
 *
 * Idempotent by the ledger key; safe to run concurrently and repeatedly.
 * Runs on an interval in worker processes and on demand (`reconcile`).
 */
@Injectable()
export class CreativeCostMaterializer {
  private readonly logger = new Logger(CreativeCostMaterializer.name);
  private running = false;
  /** Price tables only change with a deploy: re-price unknowns once per boot. */
  private upgradedSinceBoot = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly ledger: AiCostLedgerService,
    private readonly generationConfig: CreativeGenerationConfigService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (!this.generationConfig.workerEnabled || this.running) return;
    this.running = true;
    try {
      const result = await this.run(null, !this.upgradedSinceBoot);
      this.upgradedSinceBoot = true;
      if (result.recorded || result.upgraded || result.correlated)
        this.logger.log(
          `creative cost cycle recorded=${result.recorded} upgraded=${result.upgraded} correlated=${result.correlated}`,
        );
    } catch (error) {
      this.logger.error(
        `creative cost cycle failed: ${(error as Error)?.name ?? typeof error}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** On demand, one workspace: missing rows, unknown → known, correlation. */
  reconcile(scope: {
    tenantId: string;
    workspaceId: string;
  }): Promise<CreativeCostReconcileResult> {
    return this.run(
      { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      true,
    );
  }

  /**
   * Late binding: re-projects project/task of the costs already attributed to
   * one content item (task linked, created or unlinked). Best effort — the
   * periodic pass repairs anything this misses.
   */
  async refreshContentItem(
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<number> {
    try {
      return await this.correlate(
        { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
        contentItemId,
      );
    } catch (error) {
      this.logger.warn(
        `creative cost correlation item=${contentItemId} failed: ${(error as Error)?.name ?? typeof error}`,
      );
      return 0;
    }
  }

  private async run(
    filter: WorkspaceFilter,
    upgrade: boolean,
  ): Promise<CreativeCostReconcileResult> {
    let recorded = 0;
    let upgraded = 0;
    for (const source of ['image', 'video'] as const) {
      for (const mode of upgrade
        ? (['missing', 'unknown'] as const)
        : (['missing'] as const)) {
        // `unknown` rows that stay unknown are visited once per pass (keyset).
        let after = '';
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          const entries =
            source === 'image'
              ? await this.imageEntries(filter, mode, after)
              : await this.videoEntries(filter, mode, after);
          if (!entries.length) break;
          const outcome = await this.ledger.record(entries);
          recorded += outcome.inserted;
          upgraded += outcome.upgraded;
          after = entries[entries.length - 1].sourceId;
          if (entries.length < BATCH) break;
        }
      }
    }
    const correlated = await this.correlate(filter, null);
    return { recorded, upgraded, correlated };
  }

  // ── image ───────────────────────────────────────────────────────────────

  private async imageEntries(
    filter: WorkspaceFilter,
    mode: 'missing' | 'unknown',
    after: string,
  ): Promise<AiCostEntryInput[]> {
    const params: unknown[] = [
      CREATIVE_COST_SOURCE_DOMAIN,
      IMAGE_COST_SOURCE,
      IMAGE_UNBILLED_FAILURES,
      after,
    ];
    const scope = filter
      ? `AND g.tenant_id = $${params.push(filter.tenantId)} AND g.workspace_id = $${params.push(filter.workspaceId)}`
      : '';
    const ledger =
      mode === 'missing'
        ? `NOT EXISTS (SELECT 1 FROM ai_operational_costs c
                        WHERE c.source_domain = $1 AND c.source_type = $2
                          AND c.source_id = g.id::text)`
        : `EXISTS (SELECT 1 FROM ai_operational_costs c
                    WHERE c.source_domain = $1 AND c.source_type = $2
                      AND c.source_id = g.id::text AND c.cost_status = 'unknown')`;
    const rows = await this.dataSource.query<ImageSourceRow[]>(
      `SELECT g.id, g.tenant_id, g.workspace_id, g.agency_client_id,
              g.company_context_id, g.status, g.origin_type, g.provider, g.model,
              g.usage_metrics, g.error_code, g.attempts, g.output_count,
              COALESCE(g.completed_at, g.failed_at, g.updated_at) AS occurred_at
         FROM social_creative_generations g
        WHERE g.status IN ('completed', 'failed')
          AND (g.usage_metrics IS NOT NULL OR g.status = 'completed'
               OR g.error_code IS NULL OR NOT (g.error_code = ANY($3::text[])))
          AND g.id::text > $4
          ${scope}
          AND ${ledger}
        ORDER BY g.id::text
        LIMIT ${BATCH}`,
      params,
    );
    return rows.map((row) => this.imageEntry(row));
  }

  private imageEntry(row: ImageSourceRow): AiCostEntryInput {
    const occurredAt = new Date(row.occurred_at);
    const provider = row.provider ?? 'unrecorded';
    const priced = priceImageGeneration({
      provider,
      model: row.model,
      metrics: row.usage_metrics,
      occurredAt,
    });
    // No usage on a call that may have run: the outcome is what is unknown.
    const cost: AiCostEntryInput['cost'] =
      priced.status === 'known'
        ? {
            status: 'known',
            amount: priced.amount,
            currency: priced.currency,
            source: 'lyra_calculated',
          }
        : {
            status: 'unknown',
            reason:
              priced.reason === 'usage_missing' && row.status === 'failed'
                ? 'outcome_unknown'
                : priced.reason,
          };
    const tokens = row.usage_metrics?.total_tokens;
    return {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      agencyClientId: row.agency_client_id,
      companyContextId: row.company_context_id,
      sourceDomain: CREATIVE_COST_SOURCE_DOMAIN,
      sourceType: IMAGE_COST_SOURCE,
      sourceId: row.id,
      logicalType: IMAGE_LOGICAL,
      logicalId: row.id,
      operationKind: `image.${row.origin_type === 'fresh' ? 'generate' : row.origin_type}`,
      provider,
      model: row.model,
      outcome: row.status === 'completed' ? 'succeeded' : 'failed',
      usage: {
        unit: row.usage_metrics ? 'token' : null,
        quantity:
          priced.status === 'known'
            ? priced.tokens
            : Number.isSafeInteger(tokens)
              ? String(tokens)
              : null,
        metrics: row.usage_metrics,
      },
      unitPrice: null,
      pricingVersion: priced.status === 'known' ? priced.version : null,
      cost,
      occurredAt,
      correlation: { contentItemId: null, projectId: null, taskId: null },
      metadata: {
        attempts: row.attempts,
        outputCount: row.output_count,
        originType: row.origin_type,
        errorCode: row.error_code,
        ...(priced.status === 'known'
          ? { pricingTier: priced.tier, ratesPerMillionTokens: priced.rates }
          : {}),
      },
    };
  }

  // ── video ───────────────────────────────────────────────────────────────

  private async videoEntries(
    filter: WorkspaceFilter,
    mode: 'missing' | 'unknown',
    after: string,
  ): Promise<AiCostEntryInput[]> {
    const params: unknown[] = [
      CREATIVE_COST_SOURCE_DOMAIN,
      VIDEO_COST_SOURCE,
      after,
    ];
    const scope = filter
      ? `AND g.tenant_id = $${params.push(filter.tenantId)} AND g.workspace_id = $${params.push(filter.workspaceId)}`
      : '';
    const ledger =
      mode === 'missing'
        ? `NOT EXISTS (SELECT 1 FROM ai_operational_costs c
                        WHERE c.source_domain = $1 AND c.source_type = $2
                          AND c.source_id = op.id::text)`
        : `EXISTS (SELECT 1 FROM ai_operational_costs c
                    WHERE c.source_domain = $1 AND c.source_type = $2
                      AND c.source_id = op.id::text AND c.cost_status = 'unknown')`;
    const rows = await this.dataSource.query<VideoSourceRow[]>(
      `SELECT op.id, op.generation_id, op.sequence, op.kind, op.status,
              op.provider, op.provider_model, op.provider_job_id,
              op.billed_units::text AS billed_units, op.unit_kind,
              op.unit_price::text AS unit_price, op.pricing_version,
              op.cost_amount::text AS cost_amount, op.cost_currency,
              op.cost_source, op.usage_metrics, op.error_code,
              op.submit_attempts, op.duration_seconds,
              op.output_duration_seconds::text AS output_duration_seconds,
              COALESCE(op.completed_at, op.failed_at, op.accepted_at, op.updated_at) AS occurred_at,
              g.tenant_id, g.workspace_id, g.agency_client_id,
              g.company_context_id, g.mode
         FROM social_creative_video_generation_operations op
         JOIN social_creative_video_generations g ON g.id = op.generation_id
        WHERE op.status IN ('succeeded', 'failed')
          AND (op.provider_job_id IS NOT NULL OR op.dispatch_started_at IS NOT NULL)
          AND op.id::text > $3
          ${scope}
          AND ${ledger}
        ORDER BY op.id::text
        LIMIT ${BATCH}`,
      params,
    );
    return rows.map((row) => this.videoEntry(row));
  }

  private videoEntry(row: VideoSourceRow): AiCostEntryInput {
    // The CS4 snapshot is the cost. Without it: a job that ran but reported
    // nothing billable is `usage_missing`; a dispatch Lyra lost track of
    // (no job id) is `outcome_unknown` — it may or may not have been bought.
    const cost: AiCostEntryInput['cost'] =
      row.cost_amount !== null && row.cost_currency !== null && row.cost_source
        ? {
            status: 'known',
            amount: row.cost_amount,
            currency: row.cost_currency.trim(),
            source: row.cost_source,
          }
        : {
            status: 'unknown',
            reason:
              row.provider_job_id === null || row.status === 'failed'
                ? 'outcome_unknown'
                : 'usage_missing',
          };
    return {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      agencyClientId: row.agency_client_id,
      companyContextId: row.company_context_id,
      sourceDomain: CREATIVE_COST_SOURCE_DOMAIN,
      sourceType: VIDEO_COST_SOURCE,
      sourceId: row.id,
      logicalType: VIDEO_LOGICAL,
      logicalId: row.generation_id,
      operationKind: `video.${row.kind}`,
      provider: row.provider,
      model: row.provider_model,
      outcome: row.status,
      usage: {
        unit: row.unit_kind,
        quantity: row.billed_units,
        metrics: row.usage_metrics,
      },
      unitPrice: row.unit_price,
      pricingVersion: row.pricing_version,
      cost,
      occurredAt: new Date(row.occurred_at),
      correlation: { contentItemId: null, projectId: null, taskId: null },
      metadata: {
        mode: row.mode,
        sequence: row.sequence,
        submitAttempts: row.submit_attempts,
        plannedSeconds: row.duration_seconds,
        outputSeconds: row.output_duration_seconds,
        providerOperationId: row.provider_job_id,
        errorCode: row.error_code,
      },
    };
  }

  // ── correlation ─────────────────────────────────────────────────────────

  /**
   * Desired correlation of each Studio cost, from explicit links only:
   *
   *   content item = the generation's own item (frozen at enqueue), else the
   *                  item of the asset its output was promoted into — only
   *                  when that is unambiguous (one item across outputs);
   *   project/task = the item's production link (`social_creative_productions`,
   *                  same full scope as the cost). A task hard-deleted later
   *                  keeps its id here: the cost stays where it was.
   *
   * Nothing is inferred from titles, dates or "latest". Only rows whose
   * correlation differs are written.
   */
  private async correlate(
    filter: WorkspaceFilter,
    contentItemId: string | null,
  ): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const params: unknown[] = [
        CREATIVE_COST_SOURCE_DOMAIN,
        IMAGE_LOGICAL,
        VIDEO_LOGICAL,
      ];
      const scope = filter
        ? `AND c.tenant_id = $${params.push(filter.tenantId)} AND c.workspace_id = $${params.push(filter.workspaceId)}`
        : '';
      const item = contentItemId
        ? `AND c.content_item_id = $${params.push(contentItemId)}::uuid`
        : '';
      const rows = await this.dataSource.query<
        {
          id: string;
          content_item_id: string | null;
          project_id: string | null;
          task_id: string | null;
        }[]
      >(
        `WITH costs AS (
           SELECT c.id, c.tenant_id, c.workspace_id, c.agency_client_id,
                  c.company_context_id, c.content_item_id AS current_item,
                  c.project_id AS current_project, c.task_id AS current_task,
                  CASE c.logical_type
                    WHEN $2 THEN (
                      SELECT COALESCE(g.content_item_id, (
                        SELECT CASE WHEN count(DISTINCT a.content_item_id) = 1
                                    THEN (array_agg(a.content_item_id))[1] END
                          FROM social_creative_generation_outputs o
                          JOIN social_creative_assets a
                            ON a.id = o.promoted_creative_asset_id
                           AND a.tenant_id = g.tenant_id
                           AND a.workspace_id = g.workspace_id
                         WHERE o.generation_id = g.id
                           AND a.content_item_id IS NOT NULL))
                        FROM social_creative_generations g
                       WHERE g.id = c.logical_id::uuid)
                    WHEN $3 THEN (
                      SELECT COALESCE(v.content_item_id, a.content_item_id)
                        FROM social_creative_video_generations v
                        LEFT JOIN social_creative_assets a
                          ON a.id = v.promoted_creative_asset_id
                         AND a.tenant_id = v.tenant_id
                         AND a.workspace_id = v.workspace_id
                       WHERE v.id = c.logical_id::uuid)
                  END AS item
             FROM ai_operational_costs c
            WHERE c.source_domain = $1 ${scope} ${item}
         )
         SELECT costs.id, costs.item AS content_item_id,
                p.project_id, p.task_id
           FROM costs
           LEFT JOIN social_creative_productions p
             ON p.content_item_id = costs.item
            AND p.tenant_id = costs.tenant_id
            AND p.workspace_id = costs.workspace_id
            AND p.agency_client_id IS NOT DISTINCT FROM costs.agency_client_id
            AND p.company_context_id IS NOT DISTINCT FROM costs.company_context_id
          WHERE (costs.item, p.project_id, p.task_id) IS DISTINCT FROM
                (costs.current_item, costs.current_project, costs.current_task)
          LIMIT ${BATCH}`,
        params,
      );
      if (!rows.length) break;
      total += await this.ledger.updateCorrelations(
        rows.map((row) => ({
          id: row.id,
          contentItemId: row.content_item_id,
          projectId: row.project_id,
          taskId: row.task_id,
        })),
      );
      if (rows.length < BATCH) break;
    }
    return total;
  }
}
