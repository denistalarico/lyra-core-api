import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  AiCostLedgerService,
  type AiCostEntryView,
  type AiCostFilter,
} from '../ai-costs/ai-cost-ledger.service';
import {
  sumByCurrency,
  type AiCostCurrencyAmount,
} from '../ai-costs/ai-cost-money';
import { PlatformPermissionService } from '../permissions';
import {
  CREATIVE_COST_SOURCE_DOMAIN,
  CreativeCostMaterializer,
  IMAGE_LOGICAL,
  VIDEO_LOGICAL,
  type CreativeCostReconcileResult,
} from './creative-cost.materializer';
import { CreativeProductionReadinessService } from './creative-production-readiness.service';
import { CREATIVE_PRODUCTION_PERMISSIONS as P } from './creative-production.permissions';
import type { CreativeStudioScope } from './creative-studio.scope';

/** One paid provider operation, as the Studio shows it (CS6-F). */
export type CreativeCostOperationView = Pick<
  AiCostEntryView,
  | 'id'
  | 'operationKind'
  | 'provider'
  | 'model'
  | 'outcome'
  | 'occurredAt'
  | 'costStatus'
  | 'amount'
  | 'currency'
  | 'costSource'
  | 'confidence'
  | 'unknownReason'
  | 'pricingVersion'
  | 'usageUnit'
  | 'usageQuantity'
  | 'unitPrice'
>;

/** One logical generation (one image request; one Reel with its extensions). */
export type CreativeCostGenerationView = {
  generationId: string;
  type: 'image' | 'video';
  /** Image: `fresh` | `regeneration` | `variation`. Video: null. */
  originType: string | null;
  /** Video: `generative_reel` | `ugc_avatar`. Image: null. */
  mode: string | null;
  status: string | null;
  occurredAt: string;
  totals: AiCostCurrencyAmount[];
  unknownOperations: number;
  operations: CreativeCostOperationView[];
  /** Versions this generation's outputs became (several for a multi-output image). */
  promotedVersions: { assetId: string; versionId: string }[];
  /** Produced the item's selected version. */
  selected: boolean;
};

export type CreativeVersionCostView = {
  assetId: string;
  versionId: string;
  /** `manual` = uploaded, not generated: AI cost 0, by definition. */
  origin: 'generation' | 'manual';
  /** The generation that produced this version, whole (never split per output). */
  direct: {
    generationId: string | null;
    type: 'image' | 'video' | null;
    /** Outputs that one paid call produced; its cost is shared, not divided. */
    outputs: number;
    totals: AiCostCurrencyAmount[];
    unknownOperations: number;
  };
  /**
   * Direct + every generation whose output this one was a variation of, by
   * the immutable `origin_*` FKs. Regenerations are not lineage: they never
   * consumed the origin's output.
   */
  lineage: {
    generations: {
      generationId: string;
      type: 'image' | 'video';
      relation: 'direct' | 'variation_base';
    }[];
    totals: AiCostCurrencyAmount[];
    unknownOperations: number;
  };
};

export type CreativeContentCostView = {
  contentItemId: string;
  /** Provider currency, unconverted: the platform has no FX. */
  currencyPolicy: 'provider_currency';
  /** Every paid operation attributed to the item, chosen or discarded. */
  contentTotalAiCost: AiCostCurrencyAmount[];
  unknownOperations: number;
  operations: number;
  generations: number;
  selectedVersionAiCost: CreativeVersionCostView | null;
  breakdown: CreativeCostGenerationView[];
  correlation: {
    clientId: string | null;
    companyContextId: string | null;
    projectId: string | null;
    taskId: string | null;
  };
};

const MAX_LINEAGE_DEPTH = 20;

type LogicalRef = { type: 'image' | 'video'; id: string };

/**
 * CS6-B — the Studio's read model over the AI cost ledger. The Studio knows
 * its own provenance (outputs, promotions, origins), so "how much did this
 * content / this version cost" is answered here; Finance only ever sees the
 * provider-neutral ledger.
 *
 * Every figure decomposes into ledger rows (`breakdown[].operations`).
 * Real cost is Finance-gated (`agency.finance.profitability.view…`), on top
 * of the Studio's own view key: generating does not mean seeing money.
 */
@Injectable()
export class CreativeCostService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly ledger: AiCostLedgerService,
    private readonly readiness: CreativeProductionReadinessService,
    private readonly materializer: CreativeCostMaterializer,
    private readonly permissions: PlatformPermissionService,
  ) {}

  async contentCosts(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<CreativeContentCostView> {
    await this.assertCostPermission(ctx);
    const item = await this.readiness.requireContentItem(scope, contentItemId);
    const production = await this.readiness.findProduction(scope, item.id);
    const filter = { ...this.filter(scope), contentItemId: item.id };
    const [summary, entries] = await Promise.all([
      this.ledger.summarize(filter),
      this.ledger.entries(filter),
    ]);
    const totals = summary.get(null);
    const selected = production?.selectedVersionId
      ? await this.versionCostOf(scope, production.selectedVersionId)
      : null;
    return {
      contentItemId: item.id,
      currencyPolicy: 'provider_currency',
      contentTotalAiCost: (totals?.totals ?? []).map(
        ({ currency, amount }) => ({ currency, amount }),
      ),
      unknownOperations: totals?.unknownOperations ?? 0,
      operations: totals?.operations ?? 0,
      generations: totals?.generations ?? 0,
      selectedVersionAiCost: selected,
      breakdown: await this.breakdown(
        entries,
        selected?.direct.generationId ?? null,
      ),
      correlation: {
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        projectId: production?.projectId ?? null,
        taskId: production?.taskId ?? null,
      },
    };
  }

  async versionCosts(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    assetId: string,
    versionId: string,
  ): Promise<CreativeVersionCostView> {
    await this.assertCostPermission(ctx);
    const [owner] = await this.dataSource.query<{ asset_id: string }[]>(
      `SELECT a.id AS asset_id
         FROM social_creative_asset_versions v
         JOIN social_creative_assets a ON a.id = v.creative_asset_id
        WHERE v.id = $1 AND a.id = $2
          AND a.tenant_id = $3 AND a.workspace_id = $4
          AND a.agency_client_id IS NOT DISTINCT FROM $5::uuid
          AND a.company_context_id IS NOT DISTINCT FROM $6::uuid`,
      [
        versionId,
        assetId,
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    if (!owner) throw new NotFoundException('Versão não encontrada.');
    return this.versionCostOf(scope, versionId);
  }

  async reconcile(
    ctx: RequestContext,
    scope: CreativeStudioScope,
  ): Promise<CreativeCostReconcileResult> {
    await this.assertCostPermission(ctx);
    return this.materializer.reconcile(scope);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async versionCostOf(
    scope: CreativeStudioScope,
    versionId: string,
  ): Promise<CreativeVersionCostView> {
    const [version] = await this.dataSource.query<{ asset_id: string }[]>(
      `SELECT creative_asset_id AS asset_id
         FROM social_creative_asset_versions WHERE id = $1`,
      [versionId],
    );
    const direct = await this.producerOf(versionId);
    if (!direct)
      return {
        assetId: version?.asset_id ?? '',
        versionId,
        origin: 'manual',
        direct: {
          generationId: null,
          type: null,
          outputs: 0,
          totals: [],
          unknownOperations: 0,
        },
        lineage: { generations: [], totals: [], unknownOperations: 0 },
      };
    const chain = await this.lineageOf(direct);
    const entries = await this.ledger.entries({
      ...this.filter(scope),
      logical: chain.map((ref) => this.logical(ref)),
    });
    const directLogical = this.logical(direct);
    const directEntries = entries.filter(
      (entry) =>
        entry.logicalType === directLogical.type &&
        entry.logicalId === directLogical.id,
    );
    return {
      assetId: version?.asset_id ?? '',
      versionId,
      origin: 'generation',
      direct: {
        generationId: direct.id,
        type: direct.type,
        outputs: await this.outputCount(direct),
        totals: sumByCurrency(directEntries),
        unknownOperations: directEntries.filter(
          (entry) => entry.costStatus === 'unknown',
        ).length,
      },
      lineage: {
        generations: chain.map((ref, index) => ({
          generationId: ref.id,
          type: ref.type,
          relation: index === 0 ? 'direct' : 'variation_base',
        })),
        totals: sumByCurrency(entries),
        unknownOperations: entries.filter(
          (entry) => entry.costStatus === 'unknown',
        ).length,
      },
    };
  }

  /** The generation an immutable version was promoted from, if any. */
  private async producerOf(versionId: string): Promise<LogicalRef | null> {
    const [image] = await this.dataSource.query<{ id: string }[]>(
      `SELECT generation_id AS id FROM social_creative_generation_outputs
        WHERE promoted_version_id = $1`,
      [versionId],
    );
    if (image) return { type: 'image', id: image.id };
    const [video] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM social_creative_video_generations
        WHERE promoted_version_id = $1`,
      [versionId],
    );
    return video ? { type: 'video', id: video.id } : null;
  }

  /**
   * The direct generation, then each variation's base: the origin output's
   * generation, or the generation that produced the origin version. Stops at
   * a fresh/regenerated image, a manual version or a video.
   */
  private async lineageOf(direct: LogicalRef): Promise<LogicalRef[]> {
    const chain: LogicalRef[] = [direct];
    const seen = new Set([`${direct.type}:${direct.id}`]);
    let current = direct;
    for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
      if (current.type !== 'image') break;
      const [row] = await this.dataSource.query<
        {
          origin_type: string;
          origin_output_generation: string | null;
          origin_version_id: string | null;
        }[]
      >(
        `SELECT g.origin_type, o.generation_id AS origin_output_generation,
                g.origin_version_id
           FROM social_creative_generations g
           LEFT JOIN social_creative_generation_outputs o ON o.id = g.origin_output_id
          WHERE g.id = $1`,
        [current.id],
      );
      if (!row || row.origin_type !== 'variation') break;
      const base: LogicalRef | null = row.origin_output_generation
        ? { type: 'image', id: row.origin_output_generation }
        : row.origin_version_id
          ? await this.producerOf(row.origin_version_id)
          : null;
      if (!base || seen.has(`${base.type}:${base.id}`)) break;
      seen.add(`${base.type}:${base.id}`);
      chain.push(base);
      current = base;
    }
    return chain;
  }

  private async outputCount(ref: LogicalRef): Promise<number> {
    if (ref.type === 'video') return 1;
    const [row] = await this.dataSource.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM social_creative_generation_outputs
        WHERE generation_id = $1`,
      [ref.id],
    );
    return row?.count ?? 0;
  }

  private async breakdown(
    entries: AiCostEntryView[],
    selectedGenerationId: string | null,
  ): Promise<CreativeCostGenerationView[]> {
    const groups = new Map<string, AiCostEntryView[]>();
    for (const entry of entries) {
      const key = `${entry.logicalType}:${entry.logicalId}`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    const imageIds = [...groups.values()]
      .filter((group) => group[0].logicalType === IMAGE_LOGICAL)
      .map((group) => group[0].logicalId);
    const videoIds = [...groups.values()]
      .filter((group) => group[0].logicalType === VIDEO_LOGICAL)
      .map((group) => group[0].logicalId);
    const [images, outputs, videos] = await Promise.all([
      this.rows<{ id: string; status: string; origin_type: string }>(
        imageIds,
        `SELECT id, status, origin_type FROM social_creative_generations
          WHERE id = ANY($1::uuid[])`,
      ),
      this.rows<{
        generation_id: string;
        asset_id: string;
        version_id: string;
      }>(
        imageIds,
        `SELECT generation_id, promoted_creative_asset_id AS asset_id,
                promoted_version_id AS version_id
           FROM social_creative_generation_outputs
          WHERE generation_id = ANY($1::uuid[])
            AND promoted_version_id IS NOT NULL
          ORDER BY output_index`,
      ),
      this.rows<{
        id: string;
        status: string;
        mode: string;
        asset_id: string | null;
        version_id: string | null;
      }>(
        videoIds,
        `SELECT id, status, mode, promoted_creative_asset_id AS asset_id,
                promoted_version_id AS version_id
           FROM social_creative_video_generations
          WHERE id = ANY($1::uuid[])`,
      ),
    ]);
    const imageById = new Map(images.map((row) => [row.id, row]));
    const videoById = new Map(videos.map((row) => [row.id, row]));
    return [...groups.values()].map((group) => {
      const first = group[0];
      const isImage = first.logicalType === IMAGE_LOGICAL;
      const image = isImage ? imageById.get(first.logicalId) : undefined;
      const video = isImage ? undefined : videoById.get(first.logicalId);
      const promotedVersions = isImage
        ? outputs
            .filter((row) => row.generation_id === first.logicalId)
            .map((row) => ({
              assetId: row.asset_id,
              versionId: row.version_id,
            }))
        : video?.version_id && video.asset_id
          ? [{ assetId: video.asset_id, versionId: video.version_id }]
          : [];
      return {
        generationId: first.logicalId,
        type: isImage ? 'image' : 'video',
        originType: image?.origin_type ?? null,
        mode: video?.mode ?? null,
        status: image?.status ?? video?.status ?? null,
        occurredAt: first.occurredAt,
        totals: sumByCurrency(group),
        unknownOperations: group.filter(
          (entry) => entry.costStatus === 'unknown',
        ).length,
        operations: group.map((entry) => ({
          id: entry.id,
          operationKind: entry.operationKind,
          provider: entry.provider,
          model: entry.model,
          outcome: entry.outcome,
          occurredAt: entry.occurredAt,
          costStatus: entry.costStatus,
          amount: entry.amount,
          currency: entry.currency,
          costSource: entry.costSource,
          confidence: entry.confidence,
          unknownReason: entry.unknownReason,
          pricingVersion: entry.pricingVersion,
          usageUnit: entry.usageUnit,
          usageQuantity: entry.usageQuantity,
          unitPrice: entry.unitPrice,
        })),
        promotedVersions,
        selected: first.logicalId === selectedGenerationId,
      };
    });
  }

  private async rows<T>(ids: string[], sql: string): Promise<T[]> {
    return ids.length ? this.dataSource.query<T[]>(sql, [ids]) : [];
  }

  private logical(ref: LogicalRef) {
    return {
      type: ref.type === 'image' ? IMAGE_LOGICAL : VIDEO_LOGICAL,
      id: ref.id,
    };
  }

  /** Full four-part scope: a cost of another company is never read. */
  private filter(scope: CreativeStudioScope): AiCostFilter {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      sourceDomain: CREATIVE_COST_SOURCE_DOMAIN,
    };
  }

  private async assertCostPermission(ctx: RequestContext) {
    if (!ctx.userId)
      throw new BadRequestException(
        'Usuário autenticado é obrigatório para esta ação.',
      );
    await this.permissions.assertCan(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        role: ctx.role ?? 'member',
      },
      P.costView,
    );
  }
}
