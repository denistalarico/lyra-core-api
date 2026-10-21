import { projectSocialAnalyticsData } from './client-area-social-data.projection';
import { TABLE_SOURCES } from '../../common/analytics-contracts/social-table-sources';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { SOCIAL_METRIC_CATALOG } from '../../common/analytics-contracts/social-metric.catalog';
import type { ChannelId } from '../../common/analytics-contracts/social-channels';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import { SocialAdBreakdownReadService } from '../social-integrations/services/social-ad-breakdown.read.service';
import { SocialOrganicAnalyticsReadService } from '../social-organic/analytics/social-organic-analytics-read.service';
import { SocialOrganicAudienceReadService } from '../social-organic/analytics/social-organic-audience-read.service';
import { SocialOrganicActivityReadService } from '../social-organic/analytics/social-organic-activity-read.service';
import { MetaCampaignHierarchyReadService } from '../social-campaigns/services/meta-campaign-hierarchy-read.service';
import {
  ClientAreaSourcesRegistry,
  AnalyticsSourceUnavailable,
  type AnalyticsSourceInput,
} from './client-area-sources.registry';
import { analyticsPeriod } from './client-area-sources.adapter';
/** Query adapters, not formulas: marginals and presentation continue in the existing Social renderer. */
const PAID_BREAKDOWNS: Record<
  string,
  'age_gender' | 'device_platform' | 'publisher_platform' | 'hourly'
> = {
  audience_age_gender: 'age_gender',
  audience_by_age: 'age_gender',
  audience_by_gender: 'age_gender',
  impressions_by_hour: 'hourly',
  spend_by_hour: 'hourly',
  reach_by_device: 'device_platform',
  spend_by_publisher: 'publisher_platform',
  clicks_by_publisher: 'publisher_platform',
  reach_by_publisher: 'publisher_platform',
  impressions_by_publisher: 'publisher_platform',
};
const ORGANIC_BREAKDOWNS: Record<string, 'gender' | 'city' | 'age_gender'> = {
  followers_gender: 'gender',
  followers_city: 'city',
  organic_audience_age_gender: 'age_gender',
};
const PAID_TABLES = [
  'paid_hierarchy',
  'campaigns',
  'ad_sets',
  'ads',
  'conversions',
  'action_types',
  'ad_interactions',
];
export function socialTableChannels(id: string): readonly ChannelId[] {
  return TABLE_SOURCES.find((source) => source.id === id)?.channels ?? [];
}
@Injectable()
export class ClientAreaSocialMetricsAdapter implements OnModuleInit {
  constructor(
    private readonly registry: ClientAreaSourcesRegistry,
    private readonly paid: SocialAnalyticsReadService,
    private readonly organic: SocialOrganicAnalyticsReadService,
    private readonly breakdowns: SocialAdBreakdownReadService,
    private readonly audience: SocialOrganicAudienceReadService,
    private readonly activity: SocialOrganicActivityReadService,
    private readonly hierarchy: MetaCampaignHierarchyReadService,
  ) {}
  onModuleInit() {
    for (const source of [
      'paid',
      'organic',
      'summary',
      'boost',
      'destination',
      'table',
    ])
      this.registry.register({
        key: `metric.social.${source}`,
        modules: [],
        read: (input) => this.read(input),
      });
  }
  async read(input: AnalyticsSourceInput) {
    return projectSocialAnalyticsData(await this.readCanonical(input));
  }
  private async readCanonical(input: AnalyticsSourceInput) {
    const metric = input.metric!;
    const series = input.query.view === 'series';
    if (series && metric.kind !== 'kpi')
      throw new AnalyticsSourceUnavailable('series_not_supported');
    const period = analyticsPeriod(input),
      since = period.from.slice(0, 10),
      until = period.to.slice(0, 10);
    const canonical = SOCIAL_METRIC_CATALOG.find((m) => m.id === metric.path);
    const channels = canonical?.channels ?? socialTableChannels(metric.path);
    const channel =
      input.query.socialChannel ?? (channels.length === 1 ? channels[0] : null);
    if (channel && !channels.includes(channel))
      throw new BadRequestException('Canal incompatível com a métrica.');
    const connection = async (optional = false) => {
      const rows = await this.paid.listConnections(input.scope);
      const chosen = input.query.connectionId
        ? rows.find((row) => row.id === input.query.connectionId)
        : rows.length === 1
          ? rows[0]
          : null;
      if (input.query.connectionId && !chosen) throw new NotFoundException();
      if (!chosen) {
        if (optional && !rows.length) return null;
        throw new AnalyticsSourceUnavailable(
          rows.length ? 'source_selection_required' : 'source_not_configured',
        );
      }
      return { ...input.scope, connectionId: chosen.id, since, until };
    };
    const asset = async (
      network: 'facebook' | 'instagram',
      optional = false,
    ) => {
      const rows = (await this.organic.listAssets(input.scope)).filter(
        (a) => a.provider === network,
      );
      const requested =
        input.query[
          network === 'facebook' ? 'facebookAssetId' : 'instagramAssetId'
        ];
      const chosen = requested
        ? rows.find((row) => row.id === requested)
        : rows.length === 1
          ? rows[0]
          : null;
      if (requested && !chosen) throw new NotFoundException();
      if (!chosen) {
        if (optional && !rows.length) return null;
        throw new AnalyticsSourceUnavailable(
          rows.length ? 'source_selection_required' : 'source_not_configured',
        );
      }
      return { ...input.scope, assetId: chosen.id, since, until };
    };
    const network = () => {
      if (channel !== 'facebook' && channel !== 'instagram')
        throw new AnalyticsSourceUnavailable('source_selection_required');
      return channel;
    };
    const response = (data: unknown) => ({ mode: 'canonical_sources', data });
    if (metric.kind === 'breakdown') {
      const kind = PAID_BREAKDOWNS[metric.path];
      if (kind)
        return response(
          await this.breakdowns.breakdown({
            ...(await connection()),
            kind,
          } as Parameters<SocialAdBreakdownReadService['breakdown']>[0]),
        );
      const selected = await asset(network());
      if (metric.path === 'best_weekday' || metric.path === 'best_hour')
        return response(await this.activity.activity(selected!));
      if (metric.path === 'post_weekday_performance')
        return response(await this.organic.weekdayPerformance(selected!));
      const organicKind = ORGANIC_BREAKDOWNS[metric.path];
      if (organicKind)
        return response(
          await this.audience.audience({ ...selected!, kind: organicKind }),
        );
      throw new AnalyticsSourceUnavailable('source_not_available');
    }
    if (metric.source === 'social.table') {
      if (PAID_TABLES.includes(metric.path)) {
        const selected = (await connection())!;
        if (metric.path === 'paid_hierarchy')
          return response(
            await this.hierarchy.read({ ...selected, limit: 100 }),
          );
        if (metric.path === 'campaigns')
          return response(await this.paid.campaigns(selected));
        if (metric.path === 'ad_sets')
          return response(await this.paid.adSets(selected));
        if (metric.path === 'ads')
          return response(await this.paid.ads(selected));
        const overview = await this.paid.overview(selected);
        if (metric.path === 'conversions')
          return response({
            period: overview.period,
            currency: overview.currency,
            items: overview.conversions,
          });
        if (metric.path === 'action_types')
          return response({
            period: overview.period,
            currency: overview.currency,
            items: overview.actionTypes,
          });
        return {
          mode: 'canonical_sources',
          sources: { paid: overview, organic: null },
        };
      }
      const selected = (await asset(network()))!;
      if (
        [
          'channel_interactions',
          'post_interactions',
          'reel_interactions',
          'story_interactions',
        ].includes(metric.path)
      )
        return {
          mode: 'canonical_sources',
          sources: {
            paid: null,
            organic: await this.organic.overview(selected),
          },
        };
      if (metric.path === 'organic_stories')
        return response(await this.organic.topStories(selected));
      if (metric.path === 'facebook_reels')
        return response(await this.organic.facebookReels(selected));
      return response(
        await this.organic.topPosts({
          ...selected,
          ...(metric.path === 'organic_reels'
            ? { surface: 'reel' as const }
            : metric.path === 'organic_posts'
              ? { surface: 'feed' as const }
              : {}),
        }),
      );
    }
    if (metric.source === 'social.summary') {
      const selected = await connection(true),
        paid = selected
          ? await (series
              ? this.paid.timeseries(selected)
              : this.paid.overview(selected))
          : null;
      const organicByChannel: Partial<
        Record<'facebook' | 'instagram', unknown>
      > = {};
      for (const source of ['facebook', 'instagram'] as const) {
        const selectedAsset = await asset(source, true);
        if (selectedAsset)
          organicByChannel[source] = await (series
            ? this.organic.timeseries(selectedAsset)
            : this.organic.overview(selectedAsset));
      }
      if (!paid && !Object.keys(organicByChannel).length)
        throw new AnalyticsSourceUnavailable('source_not_configured');
      return {
        mode: 'canonical_sources',
        period: { since, until },
        sources: {
          [series ? 'paidSeries' : 'paid']: paid,
          [series ? 'organicSeries' : 'organic']: null,
          [series ? 'organicSeriesByChannel' : 'organicByChannel']:
            organicByChannel,
        },
      };
    }
    if (metric.source === 'social.organic')
      return {
        mode: 'canonical_sources',
        period: { since, until },
        sources: {
          [series ? 'paidSeries' : 'paid']: null,
          [series ? 'organicSeries' : 'organic']: await (series
            ? this.organic.timeseries((await asset(network()))!)
            : this.organic.overview((await asset(network()))!)),
        },
      };
    return {
      mode: 'canonical_sources',
      period: { since, until },
      sources: {
        [series ? 'paidSeries' : 'paid']: await (series
          ? this.paid.timeseries((await connection())!)
          : this.paid.overview((await connection())!)),
        [series ? 'organicSeries' : 'organic']: null,
      },
    };
  }
}
