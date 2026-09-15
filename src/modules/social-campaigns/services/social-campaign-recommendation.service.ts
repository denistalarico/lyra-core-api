import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { SocialAnalyticsReadService } from '../../social-integrations/services/social-analytics-read.service';
import type { GenerateSocialCampaignRecommendationDto } from '../dto';
import {
  SocialCampaignRecommendationEntity,
  type SocialCampaignRecommendationConfidence,
} from '../entities';
import { SocialCampaignMonitorService } from './social-campaign-monitor.service';
import { SocialCampaignRecommendationConfigService } from './social-campaign-recommendation-config.service';
import {
  socialCampaignRecommendationErrorCode,
  SocialCampaignRecommendationError,
} from './social-campaign-recommendation.errors';
import {
  SocialCampaignRecommendationProvider,
  SOCIAL_CAMPAIGN_RECOMMENDATION_PROMPT_VERSION,
  type SocialCampaignRecommendationUsage,
} from './social-campaign-recommendation.provider';
import type { SocialCampaignsScope } from './social-boost-template.service';

type EvidenceEntry = { label: string; value: string; unit: string | null };
type EvidencePacket = Record<string, unknown> & {
  evidenceIndex: Record<string, EvidenceEntry>;
};

@Injectable()
export class SocialCampaignRecommendationService {
  private readonly logger = new Logger(SocialCampaignRecommendationService.name);

  constructor(
    @InjectRepository(SocialCampaignRecommendationEntity, 'agency')
    private readonly recommendations: Repository<SocialCampaignRecommendationEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly analytics: SocialAnalyticsReadService,
    private readonly monitor: SocialCampaignMonitorService,
    private readonly provider: SocialCampaignRecommendationProvider,
    private readonly config: SocialCampaignRecommendationConfigService,
  ) {}

  availability() {
    return {
      mode: this.config.mode,
      available: this.config.mode !== 'disabled',
      advisoryOnly: true,
      providerWritesAllowed: false,
      maxRecommendations: 6,
    };
  }

  async list(scope: SocialCampaignsScope, connectionId: string, limit = 10) {
    await this.analytics.freshness({ ...scope, connectionId });
    const items = await this.recommendations.find({
      where: {
        ...this.scopeWhere(scope),
        connectionId,
        status: 'succeeded',
      },
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(20, limit)),
    });
    return { items: items.map((item) => this.toView(item)), total: items.length };
  }

  async generate(
    scope: SocialCampaignsScope,
    userId: string | null,
    dto: GenerateSocialCampaignRecommendationDto,
  ) {
    if (this.config.mode === 'disabled') {
      throw new ServiceUnavailableException(
        'Campaign recommendation generation is disabled.',
      );
    }

    const duplicate = await this.findByRequest(scope, dto.requestId);
    if (duplicate) return this.existingResult(duplicate);

    const [overview, campaigns, freshness, monitor] = await Promise.all([
      this.analytics.overview({
        ...scope,
        connectionId: dto.connectionId,
        since: dto.since,
        until: dto.until,
      }),
      this.analytics.campaigns({
        ...scope,
        connectionId: dto.connectionId,
        since: dto.since,
        until: dto.until,
        sort: 'spend',
        direction: 'desc',
      }),
      this.analytics.freshness({ ...scope, connectionId: dto.connectionId }),
      this.monitor.overview(scope, dto.connectionId),
    ]);

    const evidence = buildEvidencePacket(overview, campaigns, freshness, monitor);
    if (Object.keys(evidence.evidenceIndex).length === 0) {
      throw new ServiceUnavailableException(
        'There is not enough local evidence to generate recommendations.',
      );
    }
    const evidenceHash = createHash('sha256')
      .update(JSON.stringify(evidence))
      .digest('hex');
    const confidenceCeiling = calculateConfidenceCeiling(overview, campaigns, freshness);
    const run = await this.reserveRun(scope, userId, dto, evidence, evidenceHash);

    try {
      const result = await this.provider.generate({
        requestId: dto.requestId,
        evidence,
        evidenceKeys: Object.keys(evidence.evidenceIndex),
        confidenceCeiling,
      });
      run.status = 'succeeded';
      run.summary = result.summary;
      run.recommendations = result.recommendations;
      run.provider = result.provider;
      run.model = result.model;
      run.promptVersion = result.promptVersion;
      run.inputTokens = result.usage.inputTokens ?? null;
      run.cachedInputTokens = result.usage.cachedInputTokens ?? null;
      run.outputTokens = result.usage.outputTokens ?? null;
      run.costCents = this.estimateCostCents(result.usage);
      run.costIsEstimated = true;
      run.latencyMs = result.latencyMs;
      run.attempts = result.attempts;
      run.completedAt = new Date();
      return this.toView(await this.recommendations.save(run));
    } catch (error) {
      const code = socialCampaignRecommendationErrorCode(error);
      this.logger.warn(`Campaign recommendation ${run.id} failed: ${code}`);
      run.status = 'failed';
      run.failureCode = code;
      run.completedAt = new Date();
      run.attempts =
        error instanceof SocialCampaignRecommendationError ? error.attempts : 1;
      await this.recommendations.save(run);
      throw new ServiceUnavailableException(
        'Campaign recommendation generation is temporarily unavailable.',
      );
    }
  }

  private async reserveRun(
    scope: SocialCampaignsScope,
    userId: string | null,
    dto: GenerateSocialCampaignRecommendationDto,
    evidence: EvidencePacket,
    evidenceHash: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const lockKey = `${scope.tenantId}:${scope.workspaceId}:${scope.agencyClientId ?? 'agency'}:campaign-recommendations`;
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

      const existing = await manager
        .getRepository(SocialCampaignRecommendationEntity)
        .findOne({ where: { requestId: dto.requestId, ...this.scopeWhere(scope) } });
      if (existing) return this.existingRun(existing);

      const [usage] = await manager.query<Array<{ cost_cents: string }>>(
        `SELECT COALESCE(SUM(cost_cents), 0)::text AS cost_cents
           FROM social_campaign_recommendations
          WHERE tenant_id = $1
            AND workspace_id = $2
            AND agency_client_id IS NOT DISTINCT FROM $3::uuid
            AND created_at >= date_trunc('day', now())`,
        [scope.tenantId, scope.workspaceId, scope.agencyClientId],
      );
      const spent = Number(usage?.cost_cents ?? 0);
      if (spent + this.config.reserveCents > this.config.dailyBudgetCents) {
        throw new ServiceUnavailableException(
          'The daily Campaign recommendations budget has been reached.',
        );
      }

      const repository = manager.getRepository(SocialCampaignRecommendationEntity);
      return repository.save(
        repository.create({
          ...scope,
          connectionId: dto.connectionId,
          requestId: dto.requestId,
          status: 'processing',
          periodSince: dto.since,
          periodUntil: dto.until,
          evidenceHash,
          evidenceSnapshot: evidence,
          summary: null,
          recommendations: [],
          provider: null,
          model: null,
          promptVersion: SOCIAL_CAMPAIGN_RECOMMENDATION_PROMPT_VERSION,
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          costCents: this.config.reserveCents,
          costIsEstimated: true,
          latencyMs: null,
          attempts: 0,
          failureCode: null,
          requestedById: userId,
          completedAt: null,
        }),
      );
    });
  }

  private existingRun(existing: SocialCampaignRecommendationEntity): never {
    if (existing.status === 'processing') {
      throw new ConflictException('Campaign recommendation is already processing.');
    }
    throw new ConflictException('Campaign recommendation request was already used.');
  }

  private existingResult(existing: SocialCampaignRecommendationEntity) {
    if (existing.status === 'succeeded') return this.toView(existing);
    return this.existingRun(existing);
  }

  private findByRequest(scope: SocialCampaignsScope, requestId: string) {
    return this.recommendations.findOne({
      where: { requestId, ...this.scopeWhere(scope) },
    });
  }

  private scopeWhere(scope: SocialCampaignsScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private estimateCostCents(usage: SocialCampaignRecommendationUsage) {
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cents =
      (input * this.config.inputCentsPerMillionTokens) / 1_000_000 +
      (output * this.config.outputCentsPerMillionTokens) / 1_000_000;
    return Math.max(this.config.reserveCents, Math.ceil(cents));
  }

  private toView(entity: SocialCampaignRecommendationEntity) {
    const evidence = entity.evidenceSnapshot as EvidencePacket;
    return {
      id: entity.id,
      connectionId: entity.connectionId,
      status: entity.status,
      period: { since: entity.periodSince, until: entity.periodUntil },
      summary: entity.summary,
      recommendations: entity.recommendations,
      evidenceHash: entity.evidenceHash,
      evidenceIndex: evidence.evidenceIndex ?? {},
      provenance: {
        source: 'lyra_social_local_read_model',
        provider: entity.provider,
        model: entity.model,
        promptVersion: entity.promptVersion,
        inputTokens: entity.inputTokens,
        cachedInputTokens: entity.cachedInputTokens,
        outputTokens: entity.outputTokens,
        costCents: entity.costCents,
        costIsEstimated: entity.costIsEstimated,
        generatedAt: entity.completedAt?.toISOString() ?? null,
      },
      advisoryOnly: true,
    };
  }
}

function buildEvidencePacket(
  overview: Awaited<ReturnType<SocialAnalyticsReadService['overview']>>,
  campaigns: Awaited<ReturnType<SocialAnalyticsReadService['campaigns']>>,
  freshness: Awaited<ReturnType<SocialAnalyticsReadService['freshness']>>,
  monitor: Awaited<ReturnType<SocialCampaignMonitorService['overview']>>,
): EvidencePacket {
  const evidenceIndex: Record<string, EvidenceEntry> = {};
  const add = (key: string, label: string, value: unknown, unit: string | null) => {
    if (value === null || value === undefined) return;
    evidenceIndex[key] = { label, value: String(value), unit };
  };

  const metricKeys = [
    'spend',
    'impressions',
    'clicks',
    'linkClicks',
    'leads',
    'conversions',
    'conversionValue',
    'videoViews',
    'ctr',
    'cpc',
    'cpm',
    'cpl',
    'cpa',
    'roas',
  ] as const;
  const currencyMetrics = new Set<string>([
    'spend',
    'conversionValue',
    'cpc',
    'cpm',
    'cpl',
    'cpa',
  ]);
  const ratioMetrics = new Set<string>(['ctr', 'roas']);
  for (const key of metricKeys) {
    const unit = currencyMetrics.has(key)
      ? overview.currency
      : ratioMetrics.has(key)
        ? 'ratio'
        : 'count';
    add(`account.current.${key}`, `Conta · ${key} no período`, overview.current[key], unit);
    add(
      `account.previous.${key}`,
      `Conta · ${key} no período anterior`,
      overview.previous[key],
      unit,
    );
  }

  const campaignEvidence = campaigns.items.slice(0, 20).map((campaign, index) => {
    const reference = `campaign_${index + 1}`;
    for (const key of ['spend', 'impressions', 'clicks', 'leads', 'conversions', 'ctr', 'cpc', 'cpl', 'roas'] as const) {
      add(
        `${reference}.${key}`,
        `${campaign.name?.slice(0, 160) || `Campanha ${index + 1}`} · ${key}`,
        campaign[key],
        currencyMetrics.has(key)
          ? overview.currency
          : ratioMetrics.has(key)
            ? 'ratio'
            : 'count',
      );
    }
    return {
      reference,
      name: campaign.name?.slice(0, 160) ?? null,
      status: campaign.effectiveStatus ?? campaign.status,
      objective: campaign.objective,
      archived: campaign.archived,
      hasPartialData: campaign.hasPartialData,
    };
  });

  const alertEvidence = monitor.alerts.map((alert, index) => {
    const key = `monitor.alert_${index + 1}`;
    add(key, `Alerta · ${alert.type}`, alert.currentValueMinor, alert.currency);
    return { key, type: alert.type, status: alert.status, thresholdMinor: alert.thresholdMinor };
  });

  return {
    schemaVersion: 'campaign-recommendation-evidence-v1',
    period: overview.period,
    comparisonPeriod: overview.comparisonPeriod,
    currency: overview.currency,
    account: {
      current: overview.current,
      previous: overview.previous,
      change: overview.change,
      hasPartialData: overview.hasPartialData,
      lastFactDate: overview.lastFactDate,
    },
    campaigns: campaignEvidence,
    monitor: {
      policy: monitor.policy
        ? {
            enabled: monitor.policy.enabled,
            dailySpendLimitMinor: monitor.policy.dailySpendLimitMinor,
            monthlySpendLimitMinor: monitor.policy.monthlySpendLimitMinor,
            balanceFloorMinor: monitor.policy.balanceFloorMinor,
          }
        : null,
      alerts: alertEvidence,
    },
    freshness: {
      lastSyncedAt: freshness.lastSyncedAt,
      latestMetricDate: freshness.metrics.latestMetricDate,
      latestMetricsSyncedAt: freshness.metrics.latestMetricsSyncedAt,
      hasPartialData: freshness.hasPartialData,
      backfillComplete: freshness.backfill.complete,
    },
    evidenceIndex,
  };
}

function calculateConfidenceCeiling(
  overview: Awaited<ReturnType<SocialAnalyticsReadService['overview']>>,
  campaigns: Awaited<ReturnType<SocialAnalyticsReadService['campaigns']>>,
  freshness: Awaited<ReturnType<SocialAnalyticsReadService['freshness']>>,
): SocialCampaignRecommendationConfidence {
  if (!overview.lastFactDate || campaigns.items.length === 0) return 'low';
  if (
    overview.hasPartialData ||
    freshness.hasPartialData ||
    overview.lastFactDate < overview.period.until ||
    !freshness.backfill.complete
  ) {
    return 'medium';
  }
  return 'high';
}
