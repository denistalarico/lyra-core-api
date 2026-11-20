import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { parseAnalyticsPeriod } from '../../social-integrations/analytics/social-ad-analytics-period';
import type { SocialAdSearchTermKind } from '../../social-integrations/entities/social-ad-search-term-daily.entity';
import {
  formatScaledAmount,
  parseScaledAmount,
} from '../../social-integrations/sync/metric-number';
import type {
  GoogleCampaignDetailMeasures,
  GoogleCampaignDetailsView,
} from '../views/google-campaign-details.view';
import type { SocialCampaignsScope } from './social-boost-template.service';

const PROVIDER = 'google_ads';
const CAMPAIGN_ID_PATTERN = /^\d{1,20}$/;
/** Terms are a ranking: the panel shows the top of it, never the long tail. */
const TERMS_LIMIT = 100;

/** `segments.ad_network_type` (fields/v25/segments), lowercased on ingest. */
const NETWORK_LABELS: Record<string, string> = {
  search: 'Pesquisa Google',
  search_partners: 'Parceiros de pesquisa',
  content: 'Rede de Display',
  youtube: 'YouTube',
  discover: 'Discover',
  gmail: 'Gmail',
  maps: 'Google Maps',
  google_tv: 'Google TV',
  google_owned_channels: 'Canais do Google',
  mixed: 'Vários canais',
  unknown: 'Não informado',
  unspecified: 'Não informado',
};

export type GoogleCampaignDetailsInput = SocialCampaignsScope & {
  connectionId: string;
  campaignId: string;
  since: unknown;
  until: unknown;
  termKind?: SocialAdSearchTermKind;
};

type MeasureRow = {
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  conversions: string | null;
  conversion_value: string | null;
  partial_days?: string | null;
};

type BreakdownRow = MeasureRow & {
  breakdown_kind: 'ad_network' | 'conversion_action';
  breakdown_key: string;
  label: string | null;
  category: string | null;
};

type TermRow = MeasureRow & { term_text: string };

const scaled = (value: string | null | undefined) =>
  parseScaledAmount(value ?? '0') ?? 0n;

/** A decimal string; `null` stays `null` (not reported is not zero). */
const amount = (value: string | null | undefined) =>
  value == null ? null : formatScaledAmount(scaled(value));

const count = (value: string | null | undefined) =>
  value == null ? '0' : String(BigInt(value));

function measures(row: MeasureRow | undefined): GoogleCampaignDetailMeasures {
  return {
    spend: amount(row?.spend ?? '0') ?? '0.000000',
    impressions: count(row?.impressions),
    clicks: count(row?.clicks),
    conversions: amount(row?.conversions ?? '0') ?? '0.000000',
    conversionValue: amount(row?.conversion_value ?? '0') ?? '0.000000',
  };
}

/** Total minus the detailed part, never negative (D-G3 contract). */
function remainder(total: string, parts: string[]): string {
  const rest = parts.reduce((sum, part) => sum - scaled(part), scaled(total));
  return formatScaledAmount(rest > 0n ? rest : 0n);
}

/**
 * GA-DET: the "Detalhamento" panel of one Google Ads campaign, read from the
 * local mirror only (D-G7). No credential resolver and no provider client: a
 * page load reads rows the sync already wrote, nothing else.
 *
 * Every query binds the full server-resolved scope, and the connection is
 * found with the exact scope (`companyContextId` included) before anything
 * else is read, like the hierarchy.
 */
@Injectable()
export class GoogleCampaignDetailsReadService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async read(
    input: GoogleCampaignDetailsInput,
  ): Promise<GoogleCampaignDetailsView> {
    const period = parseAnalyticsPeriod({
      since: input.since,
      until: input.until,
    });
    if (!CAMPAIGN_ID_PATTERN.test(input.campaignId)) {
      throw new NotFoundException('Google Ads campaign not found.');
    }

    const connectionId = await this.findConnection(input);
    const scope = [
      input.tenantId,
      input.workspaceId,
      input.agencyClientId,
      connectionId,
      input.campaignId,
    ];

    const [campaign] = await this.dataSource.query<
      Array<{ channel_type: string | null }>
    >(
      `SELECT entity.metadata->>'channelType' AS channel_type
         FROM social_ad_entities entity
        WHERE entity.tenant_id = $1
          AND entity.workspace_id = $2
          AND entity.agency_client_id IS NOT DISTINCT FROM $3::uuid
          AND entity.connection_id = $4
          AND entity.provider = '${PROVIDER}'
          AND entity.entity_level = 'campaign'
          AND entity.external_id = $5
        LIMIT 1`,
      scope,
    );
    if (!campaign) {
      throw new NotFoundException('Google Ads campaign not found.');
    }
    const channelType = campaign.channel_type ?? null;
    const termKind: SocialAdSearchTermKind =
      input.termKind ??
      (channelType === 'PERFORMANCE_MAX' ? 'pmax_category' : 'search_term');

    const [totalsRows, breakdownRows, termRows] = await Promise.all([
      this.dataSource.query<MeasureRow[]>(
        `SELECT SUM(fact.spend) AS spend,
                SUM(fact.impressions) AS impressions,
                SUM(fact.clicks) AS clicks,
                SUM(fact.conversions) AS conversions,
                SUM(fact.conversion_value) AS conversion_value,
                COUNT(*) FILTER (WHERE fact.is_partial) AS partial_days
           FROM social_ad_metrics_daily fact
          WHERE fact.tenant_id = $1
            AND fact.workspace_id = $2
            AND fact.agency_client_id IS NOT DISTINCT FROM $3::uuid
            AND fact.connection_id = $4
            AND fact.provider = '${PROVIDER}'
            AND fact.source = 'paid'
            AND fact.attribution_setting = 'account_default'
            AND fact.entity_level = 'campaign'
            AND fact.entity_external_id = $5
            AND fact.metric_date BETWEEN $6 AND $7`,
        [...scope, period.since, period.until],
      ),
      this.dataSource.query<BreakdownRow[]>(
        `SELECT b.breakdown_kind,
                b.breakdown_key,
                (ARRAY_AGG(b.actions->>'label' ORDER BY b.metric_date DESC))[1] AS label,
                (ARRAY_AGG(b.actions->>'category' ORDER BY b.metric_date DESC))[1] AS category,
                SUM(b.spend) AS spend,
                SUM(b.impressions) AS impressions,
                SUM(b.clicks) AS clicks,
                SUM(b.conversions) AS conversions,
                SUM(b.conversion_value) AS conversion_value
           FROM social_ad_breakdown_daily b
          WHERE b.tenant_id = $1
            AND b.workspace_id = $2
            AND b.agency_client_id IS NOT DISTINCT FROM $3::uuid
            AND b.connection_id = $4
            AND b.provider = '${PROVIDER}'
            AND b.entity_level = 'campaign'
            AND b.entity_external_id = $5
            AND b.breakdown_kind IN ('ad_network', 'conversion_action')
            AND b.metric_date BETWEEN $6 AND $7
          GROUP BY b.breakdown_kind, b.breakdown_key`,
        [...scope, period.since, period.until],
      ),
      this.dataSource.query<TermRow[]>(
        `SELECT MAX(t.term_text) AS term_text,
                SUM(t.impressions) AS impressions,
                SUM(t.clicks) AS clicks,
                SUM(t.spend) AS spend,
                SUM(t.conversions) AS conversions,
                SUM(t.conversion_value) AS conversion_value
           FROM social_ad_search_terms_daily t
          WHERE t.tenant_id = $1
            AND t.workspace_id = $2
            AND t.agency_client_id IS NOT DISTINCT FROM $3::uuid
            AND t.connection_id = $4
            AND t.provider = '${PROVIDER}'
            AND t.campaign_external_id = $5
            AND t.term_kind = $6
            AND t.metric_date BETWEEN $7 AND $8
          GROUP BY t.term_hash
          ORDER BY SUM(t.conversions) DESC, SUM(t.clicks) DESC,
                   SUM(t.impressions) DESC, MAX(t.term_text) ASC
          LIMIT ${TERMS_LIMIT}`,
        [...scope, termKind, period.since, period.until],
      ),
    ]);

    const totals = measures(totalsRows[0]);
    const channels = breakdownRows
      .filter((row) => row.breakdown_kind === 'ad_network')
      .map((row) => ({
        key: row.breakdown_key,
        label: NETWORK_LABELS[row.breakdown_key] ?? row.breakdown_key,
        ...measures(row),
      }))
      .sort((a, b) => Number(scaled(b.spend) - scaled(a.spend)));
    const conversionActions = breakdownRows
      .filter((row) => row.breakdown_kind === 'conversion_action')
      .map((row) => {
        const measured = measures(row);
        return {
          id: row.breakdown_key,
          label: row.label || row.breakdown_key,
          category: row.category ?? null,
          conversions: measured.conversions,
          conversionValue: measured.conversionValue,
          // The conversion-action segment cannot carry cost (§5.5): no CPA.
          spend: null,
        };
      })
      .sort((a, b) => Number(scaled(b.conversions) - scaled(a.conversions)));

    return {
      campaignId: input.campaignId,
      channelType,
      period,
      hasPartialData: Number(totalsRows[0]?.partial_days ?? '0') > 0,
      totals,
      channels,
      conversionActions,
      terms: {
        // `campaign_search_term_insight` accepts `segments.date` in v25, so
        // every kind is stored per day (D-G4; no period fallback needed).
        grain: 'daily',
        kind: termKind,
        rows: termRows.map((row) => {
          const measured = measures(row);
          return {
            text: row.term_text,
            impressions: measured.impressions,
            clicks: measured.clicks,
            conversions: measured.conversions,
            // NULL for PMax categories: Google reports no cost there.
            spend: amount(row.spend),
          };
        }),
      },
      unattributed: {
        conversions: remainder(
          totals.conversions,
          channels.map((row) => row.conversions),
        ),
        spend: remainder(
          totals.spend,
          channels.map((row) => row.spend),
        ),
      },
    };
  }

  private async findConnection(
    input: GoogleCampaignDetailsInput,
  ): Promise<string> {
    const [connection] = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT connection.id
         FROM social_ad_account_connections connection
        WHERE connection.id = $1
          AND connection.tenant_id = $2
          AND connection.workspace_id = $3
          AND connection.agency_client_id IS NOT DISTINCT FROM $4::uuid
          AND connection.company_context_id IS NOT DISTINCT FROM $5::uuid
          AND connection.provider = '${PROVIDER}'
        LIMIT 1`,
      [
        input.connectionId,
        input.tenantId,
        input.workspaceId,
        input.agencyClientId,
        input.companyContextId ?? null,
      ],
    );
    if (!connection) {
      throw new NotFoundException('Google Ads connection not found.');
    }
    return connection.id;
  }
}
