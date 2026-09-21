import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, type SelectQueryBuilder } from 'typeorm';
import { parseAnalyticsPeriod } from '../../social-integrations/analytics/social-ad-analytics-period';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from '../../social-integrations/entities';
import type { MetaCampaignStatusFilter } from '../dto';
import type {
  MetaAdSetOperationalNode,
  MetaCampaignHierarchyView,
  MetaCampaignNodeMetrics,
  MetaCampaignOperationalNode,
  MetaCampaignOperationalTree,
} from '../views/meta-campaign-hierarchy.view';
import type { SocialCampaignsScope } from './social-boost-template.service';
import { deriveMetaCampaignAttentionReasons } from './meta-campaign-attention';

const META_PROVIDER = 'meta_ads';
const PAID_SOURCE = 'paid';
const ACCOUNT_DEFAULT_ATTRIBUTION = 'account_default';
const EMPTY_METRICS: MetaCampaignNodeMetrics = {
  hasData: false,
  spend: null,
  impressions: null,
  clicks: null,
  leads: null,
  conversions: null,
  hasPartialData: false,
};

type MetricsRow = {
  entity_level: SocialAdEntity['entityLevel'];
  entity_external_id: string;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  leads: string | null;
  conversions: string | null;
  partial_days: string | null;
};

export type MetaCampaignHierarchyInput = SocialCampaignsScope & {
  connectionId: string;
  since: unknown;
  until: unknown;
  status?: MetaCampaignStatusFilter;
  search?: string;
  page?: number;
  limit?: number;
};

/**
 * Operational detail over the local Meta mirror.
 *
 * This service deliberately has no credential resolver or Graph client. A page
 * load can only read rows previously written by the sync pipeline.
 */
@Injectable()
export class MetaCampaignHierarchyReadService {
  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connections: Repository<SocialAdAccountConnectionEntity>,
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entities: Repository<SocialAdEntity>,
    @InjectRepository(SocialAdMetricDailyEntity, 'agency')
    private readonly metrics: Repository<SocialAdMetricDailyEntity>,
  ) {}

  async read(input: MetaCampaignHierarchyInput): Promise<MetaCampaignHierarchyView> {
    const period = parseAnalyticsPeriod({ since: input.since, until: input.until });
    const page = input.page ?? 1;
    const limit = input.limit ?? 25;
    const status = input.status ?? 'all';
    const search = input.search?.trim() || null;
    const connection = await this.findConnection(input);

    const campaignQuery = this.entities
      .createQueryBuilder('campaign')
      .where('campaign.tenant_id = :tenantId', { tenantId: input.tenantId })
      .andWhere('campaign.workspace_id = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere(
        'campaign.agency_client_id IS NOT DISTINCT FROM :agencyClientId',
        { agencyClientId: input.agencyClientId },
      )
      .andWhere('campaign.connection_id = :connectionId', {
        connectionId: connection.id,
      })
      .andWhere('campaign.provider = :provider', { provider: META_PROVIDER })
      .andWhere('campaign.entity_level = :level', { level: 'campaign' });

    this.applyStatusFilter(campaignQuery, status);
    if (search) {
      campaignQuery.andWhere(
        `(LOWER(COALESCE(campaign.name, '')) LIKE :search ESCAPE '\\'
          OR EXISTS (
            SELECT 1
              FROM social_ad_entities child
             WHERE child.tenant_id = campaign.tenant_id
               AND child.workspace_id = campaign.workspace_id
               AND child.agency_client_id IS NOT DISTINCT FROM campaign.agency_client_id
               AND child.connection_id = campaign.connection_id
               AND child.campaign_external_id = campaign.external_id
               AND child.entity_level IN ('adset', 'ad')
               AND LOWER(COALESCE(child.name, '')) LIKE :search ESCAPE '\\'
          ))`,
        { search: `%${escapeLike(search.toLowerCase())}%` },
      );
    }

    const total = await campaignQuery.getCount();
    const campaigns = await campaignQuery
      .orderBy('LOWER(campaign.name)', 'ASC', 'NULLS LAST')
      .addOrderBy('campaign.external_id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const campaignIds = campaigns.map((campaign) => campaign.externalId);
    const [children, metrics, hierarchyFreshness] = await Promise.all([
      this.readChildren(connection.id, input, campaignIds),
      this.readMetrics(connection.id, input, period, campaignIds),
      this.readHierarchyFreshness(connection.id, input),
    ]);

    const adSets = children.filter((entity) => entity.entityLevel === 'adset');
    const ads = children.filter((entity) => entity.entityLevel === 'ad');
    const adsByParent = groupBy(ads, (ad) => ad.parentExternalId);
    const adSetsByCampaign = groupBy(adSets, (adSet) => adSet.campaignExternalId);
    const adsByCampaign = groupBy(ads, (ad) => ad.campaignExternalId);

    const items = campaigns.map((campaign): MetaCampaignOperationalTree => {
      const campaignAdSets = adSetsByCampaign.get(campaign.externalId) ?? [];
      const assignedAdIds = new Set<string>();
      const mappedAdSets = campaignAdSets.map((adSet): MetaAdSetOperationalNode => {
        const childAds = adsByParent.get(adSet.externalId) ?? [];
        childAds.forEach((ad) => assignedAdIds.add(ad.externalId));
        return {
          ...this.toNode(adSet, metrics, connection.lastSyncedAt),
          ads: childAds.map((ad) =>
            this.toNode(ad, metrics, connection.lastSyncedAt),
          ),
        };
      });

      return {
        ...this.toNode(campaign, metrics, connection.lastSyncedAt),
        adSets: mappedAdSets,
        unassignedAds: (adsByCampaign.get(campaign.externalId) ?? [])
          .filter((ad) => !assignedAdIds.has(ad.externalId))
          .map((ad) => this.toNode(ad, metrics, connection.lastSyncedAt)),
      };
    });

    return {
      connectionId: connection.id,
      accountName: connection.accountName,
      currency: connection.currency,
      timezone: connection.timezone ?? '',
      connectionStatus: connection.connectionStatus,
      period,
      filters: { status, search },
      freshness: {
        lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
        hierarchyLastSeenAt: hierarchyFreshness,
        lastSyncError: connection.lastSyncError,
      },
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  private findConnection(input: MetaCampaignHierarchyInput) {
    return this.connections
      .findOne({
        where: {
          id: input.connectionId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId:
            input.agencyClientId === null ? IsNull() : input.agencyClientId,
          companyContextId:
            input.companyContextId == null
              ? IsNull()
              : input.companyContextId,
          provider: META_PROVIDER,
        },
      })
      .then((connection) => {
        if (!connection) throw new NotFoundException('Meta connection not found.');
        return connection;
      });
  }

  private applyStatusFilter(
    query: SelectQueryBuilder<SocialAdEntity>,
    status: MetaCampaignStatusFilter,
  ) {
    if (status === 'active') {
      query
        .andWhere('campaign.archived_at IS NULL')
        .andWhere(
          `UPPER(COALESCE(campaign.effective_status, campaign.status, '')) = 'ACTIVE'`,
        );
    } else if (status === 'paused') {
      query
        .andWhere('campaign.archived_at IS NULL')
        .andWhere(
          `UPPER(COALESCE(campaign.effective_status, campaign.status, '')) LIKE '%PAUSED%'`,
        );
    } else if (status === 'archived') {
      query.andWhere(
        `(campaign.archived_at IS NOT NULL
          OR UPPER(COALESCE(campaign.effective_status, campaign.status, '')) = 'ARCHIVED')`,
      );
    }
  }

  private async readChildren(
    connectionId: string,
    scope: SocialCampaignsScope,
    campaignIds: string[],
  ) {
    if (!campaignIds.length) return [];
    return this.entities
      .createQueryBuilder('entity')
      .where('entity.tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('entity.workspace_id = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere(
        'entity.agency_client_id IS NOT DISTINCT FROM :agencyClientId',
        { agencyClientId: scope.agencyClientId },
      )
      .andWhere('entity.connection_id = :connectionId', { connectionId })
      .andWhere('entity.provider = :provider', { provider: META_PROVIDER })
      .andWhere(`entity.entity_level IN ('adset', 'ad')`)
      .andWhere('entity.campaign_external_id IN (:...campaignIds)', {
        campaignIds,
      })
      .orderBy('entity.entity_level', 'ASC')
      .addOrderBy('LOWER(entity.name)', 'ASC', 'NULLS LAST')
      .addOrderBy('entity.external_id', 'ASC')
      .getMany();
  }

  private async readMetrics(
    connectionId: string,
    scope: SocialCampaignsScope,
    period: { since: string; until: string },
    campaignIds: string[],
  ) {
    const result = new Map<string, MetaCampaignNodeMetrics>();
    if (!campaignIds.length) return result;

    const rows = await this.metrics
      .createQueryBuilder('fact')
      .select('fact.entity_level', 'entity_level')
      .addSelect('fact.entity_external_id', 'entity_external_id')
      .addSelect('SUM(fact.spend)', 'spend')
      .addSelect('SUM(fact.impressions)', 'impressions')
      .addSelect('SUM(fact.clicks)', 'clicks')
      .addSelect('SUM(fact.leads)', 'leads')
      .addSelect('SUM(fact.conversions)', 'conversions')
      .addSelect(
        'COUNT(*) FILTER (WHERE fact.is_partial)',
        'partial_days',
      )
      .where('fact.tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('fact.workspace_id = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere('fact.agency_client_id IS NOT DISTINCT FROM :agencyClientId', {
        agencyClientId: scope.agencyClientId,
      })
      .andWhere('fact.connection_id = :connectionId', { connectionId })
      .andWhere('fact.provider = :provider', { provider: META_PROVIDER })
      .andWhere('fact.source = :source', { source: PAID_SOURCE })
      .andWhere('fact.attribution_setting = :attribution', {
        attribution: ACCOUNT_DEFAULT_ATTRIBUTION,
      })
      .andWhere(`fact.entity_level IN ('campaign', 'adset', 'ad')`)
      .andWhere('fact.campaign_external_id IN (:...campaignIds)', {
        campaignIds,
      })
      .andWhere('fact.metric_date BETWEEN :since AND :until', period)
      .groupBy('fact.entity_level')
      .addGroupBy('fact.entity_external_id')
      .getRawMany<MetricsRow>();

    rows.forEach((row) => {
      result.set(metricKey(row.entity_level, row.entity_external_id), {
        hasData: true,
        spend: row.spend ?? '0',
        impressions: row.impressions ?? '0',
        clicks: row.clicks ?? '0',
        leads: row.leads ?? '0',
        conversions: row.conversions ?? '0',
        hasPartialData: Number(row.partial_days ?? '0') > 0,
      });
    });
    return result;
  }

  private async readHierarchyFreshness(
    connectionId: string,
    scope: SocialCampaignsScope,
  ) {
    const row = await this.entities
      .createQueryBuilder('entity')
      .select('MAX(entity.last_seen_at)', 'last_seen_at')
      .where('entity.tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('entity.workspace_id = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere(
        'entity.agency_client_id IS NOT DISTINCT FROM :agencyClientId',
        { agencyClientId: scope.agencyClientId },
      )
      .andWhere('entity.connection_id = :connectionId', { connectionId })
      .andWhere('entity.provider = :provider', { provider: META_PROVIDER })
      .getRawOne<{ last_seen_at: Date | string | null }>();
    const value = row?.last_seen_at;
    return value ? new Date(value).toISOString() : null;
  }

  private toNode(
    entity: SocialAdEntity,
    metricsByEntity: Map<string, MetaCampaignNodeMetrics>,
    connectionLastSyncedAt: Date | null,
  ): MetaCampaignOperationalNode {
    const metrics =
      metricsByEntity.get(metricKey(entity.entityLevel, entity.externalId)) ??
      EMPTY_METRICS;
    return {
      externalId: entity.externalId,
      name: entity.name,
      status: entity.status,
      effectiveStatus: entity.effectiveStatus,
      archived: entity.archivedAt !== null,
      objective: entity.objective,
      optimizationGoal: entity.optimizationGoal,
      billingEvent: entity.billingEvent,
      destinationType: entity.destinationType,
      destinationRaw: entity.destinationRaw,
      budget: {
        dailyMinor: entity.dailyBudgetMinor,
        lifetimeMinor: entity.lifetimeBudgetMinor,
        remainingMinor: entity.budgetRemainingMinor,
        currency: entity.currency,
      },
      schedule: {
        startsAt: entity.startTime?.toISOString() ?? null,
        stopsAt: entity.stopTime?.toISOString() ?? null,
      },
      freshness: {
        lastSeenAt: entity.lastSeenAt.toISOString(),
        providerUpdatedAt: entity.providerUpdatedTime?.toISOString() ?? null,
      },
      metrics,
      attentionReasons: deriveMetaCampaignAttentionReasons({
        entity,
        metrics,
        connectionLastSyncedAt,
      }),
    };
  }
}

function metricKey(level: string, externalId: string) {
  return `${level}:${externalId}`;
}

function groupBy<T>(items: T[], key: (item: T) => string | null) {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => {
    const value = key(item);
    if (!value) return;
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  });
  return grouped;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
