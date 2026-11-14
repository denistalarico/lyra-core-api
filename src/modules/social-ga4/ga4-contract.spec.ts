import {
  ANALYTICS_CHANNELS,
  findChannel,
} from '../../common/analytics-contracts/social-channels';
import {
  findMetric,
  isMetricId,
  metricsForChannel,
} from '../../common/analytics-contracts/social-metric.catalog';
import {
  TABLE_SOURCES,
  tableSourcesForChannel,
} from '../../common/analytics-contracts/social-table-sources';
import { parseDashboardLayout } from '../social-analytics-dashboards/dashboard-layout.contract';
import { socialChannelDefaultLayout } from '../social-analytics-dashboards/defaults/social-channel-default-layouts';

describe('GA4 analytics contract', () => {
  it('lists Google Analytics as an integrated channel with its own icon', () => {
    expect(findChannel('ga4')).toMatchObject({
      label: 'Google Analytics',
      icon: '/integrations/webp/analytics.webp',
      integrated: true,
    });
  });

  it('keeps ga4 as one entry of the channel list', () => {
    expect(
      ANALYTICS_CHANNELS.filter((channel) => channel.id === 'ga4'),
    ).toHaveLength(1);
  });

  it('offers nine ga_ metrics on the ga4 channel only', () => {
    expect(
      metricsForChannel('ga4')
        .map((metric) => metric.id)
        .sort(),
    ).toEqual([
      'ga_avg_session_duration',
      'ga_engaged_sessions',
      'ga_engagement_rate',
      'ga_key_events',
      'ga_new_users',
      'ga_page_views',
      'ga_revenue',
      'ga_sessions',
      'ga_users',
    ]);
  });

  it('keeps ga_ metrics off the paid channel', () => {
    expect(
      metricsForChannel('meta_ads').some((m) => m.id.startsWith('ga_')),
    ).toBe(false);
  });

  it.each(['ga_engagement_rate', 'ga_avg_session_duration', 'ga_users'])(
    'marks %s as not additive',
    (id) => {
      expect(findMetric(id as 'ga_users')?.additive).toBe(false);
    },
  );

  it.each(['ga_sessions', 'ga_key_events', 'ga_revenue', 'ga_page_views'])(
    'marks %s as additive',
    (id) => {
      expect(findMetric(id as 'ga_sessions')?.additive).toBe(true);
    },
  );

  it('sources every ga_ metric from ga4', () => {
    expect(
      metricsForChannel('ga4').every((metric) => metric.source === 'ga4'),
    ).toBe(true);
  });

  it('offers the four GA4 tables on the ga4 channel', () => {
    expect(tableSourcesForChannel('ga4').map((source) => source.id)).toEqual([
      'ga4_channels',
      'ga4_source_medium',
      'ga4_campaigns',
      'ga4_landing_pages',
    ]);
  });

  it('keeps GA4 tables off every other channel', () => {
    expect(
      TABLE_SOURCES.filter((source) => source.kind === 'ga4').every(
        (source) => source.channels.join() === 'ga4',
      ),
    ).toBe(true);
  });

  it('seeds a default layout the backend accepts', () => {
    expect(() =>
      parseDashboardLayout(socialChannelDefaultLayout('ga4')),
    ).not.toThrow();
  });

  it('seeds only metrics and table columns that exist', () => {
    const section = socialChannelDefaultLayout('ga4').sections[0];
    const metrics = section.cards.flatMap((card) => {
      const raw = card as Record<string, unknown>;
      return [
        ...(typeof raw.metric === 'string' ? [raw.metric] : []),
        ...(Array.isArray(raw.metricIds) ? (raw.metricIds as string[]) : []),
        ...(Array.isArray(raw.steps)
          ? (raw.steps as Array<{ metric: string }>).map((step) => step.metric)
          : []),
      ];
    });

    expect(metrics.every((metric) => isMetricId(metric))).toBe(true);
  });

  it('seeds the table columns each source actually declares', () => {
    const section = socialChannelDefaultLayout('ga4').sections[0];
    const tables = section.cards.filter(
      (card) => (card as Record<string, unknown>).kind === 'table',
    ) as unknown as Array<{ source: string; columns: Array<{ id: string }> }>;

    expect(
      tables.every((table) => {
        const declared =
          TABLE_SOURCES.find((s) => s.id === table.source)?.columns.map(
            (c) => c.id,
          ) ?? [];
        return table.columns.every((column) => declared.includes(column.id));
      }),
    ).toBe(true);
  });
});
