import { isMetricId } from '../../../common/analytics-contracts/social-metric.catalog';
import { TABLE_SOURCES } from '../../../common/analytics-contracts/social-table-sources';
import { parseDashboardLayout } from '../dashboard-layout.contract';
import { socialOverviewDefaultLayout } from './social-overview-default-layout';
import {
  SOCIAL_CHANNEL_DEFAULT_SECTIONS,
  socialChannelDefaultLayout,
  type SocialChannelDefaultId,
} from './social-channel-default-layouts';

const CHANNELS: SocialChannelDefaultId[] = [
  'meta_ads',
  'instagram',
  'facebook',
];

describe('social channel default layouts', () => {
  it.each(CHANNELS)('%s passes the layout contract unchanged', (channel) => {
    const layout = socialChannelDefaultLayout(channel);

    expect(parseDashboardLayout(layout)).toEqual(layout);
    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].id).toBe(`section-${channel}`);
    expect(layout.sections[0].channel).toBe(channel);
  });

  it('keeps the Visão Geral sections of 2026-10-26 as they were', () => {
    // Top-level cards per block, as read from the agency root (AN-11).
    expect(SOCIAL_CHANNEL_DEFAULT_SECTIONS.meta_ads.cards).toHaveLength(30);
    expect(SOCIAL_CHANNEL_DEFAULT_SECTIONS.instagram.cards).toHaveLength(21);
    expect(SOCIAL_CHANNEL_DEFAULT_SECTIONS.facebook.cards).toHaveLength(14);

    const groups = (channel: SocialChannelDefaultId) =>
      SOCIAL_CHANNEL_DEFAULT_SECTIONS[channel].cards.filter(
        (card) => card.kind === 'group',
      ).length;
    expect(groups('instagram')).toBe(3);
    expect(groups('facebook')).toBe(2);

    for (const channel of CHANNELS) {
      const { cards } = SOCIAL_CHANNEL_DEFAULT_SECTIONS[channel];
      expect(cards.some((card) => card.highlighted === true)).toBe(true);
    }
  });

  it('hands out a copy, so a seeded row never shares the default', () => {
    const layout = socialChannelDefaultLayout('meta_ads');
    layout.sections[0].cards.pop();

    expect(
      socialChannelDefaultLayout('meta_ads').sections[0].cards,
    ).toHaveLength(30);
  });

  /** AN-FE (§6.5): every metric, table source and column the defaults name exists. */
  const flatten = (
    cards: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> =>
    cards.flatMap((card) =>
      Array.isArray(card.cards)
        ? flatten(card.cards as Array<Record<string, unknown>>)
        : [card],
    );
  const refs = (cards: Array<Record<string, unknown>>) => {
    const flat = flatten(cards);
    return {
      metrics: flat.flatMap((card) => [
        ...(typeof card.metric === 'string' ? [card.metric] : []),
        ...(Array.isArray(card.metricIds) ? (card.metricIds as string[]) : []),
        ...(Array.isArray(card.steps)
          ? (card.steps as Array<{ metric: string }>).map((step) => step.metric)
          : []),
      ]),
      tables: flat.filter((card) => card.kind === 'table') as Array<{
        source: string;
        columns: Array<{ id: string }>;
      }>,
    };
  };
  const declared = (source: string) =>
    TABLE_SOURCES.find((entry) => entry.id === source)?.columns.map(
      (column) => column.id,
    );

  it('seeds Google Ads with the CRM, the asset groups and the ad-to-sale funnel', () => {
    const { cards } = SOCIAL_CHANNEL_DEFAULT_SECTIONS.google_ads;
    const { metrics, tables } = refs(cards);

    expect(metrics.every((metric) => isMetricId(metric))).toBe(true);
    expect(metrics).toEqual(
      expect.arrayContaining(['conversion_rate', 'crm_leads', 'crm_won']),
    );
    expect(tables.map((table) => table.source)).toEqual([
      'paid_hierarchy',
      'asset_groups',
      'crm_campaigns',
    ]);
    for (const table of tables)
      expect(
        table.columns.every((column) =>
          declared(table.source)?.includes(column.id),
        ),
      ).toBe(true);
    expect(
      parseDashboardLayout(socialChannelDefaultLayout('google_ads')),
    ).toEqual(socialChannelDefaultLayout('google_ads'));
  });

  it('gives Resumo a "Leads e vendas" sub-block of summary CRM figures', () => {
    const summary = socialOverviewDefaultLayout().sections[0];
    const group = summary.cards.find((card) => card.kind === 'group') as
      | (Record<string, unknown> & { cards: Array<Record<string, unknown>> })
      | undefined;

    expect(group?.category).toBe('leads');
    const { metrics, tables } = refs(group!.cards);
    expect(metrics).toHaveLength(8);
    expect(
      metrics.every(
        (metric) => metric.startsWith('summary_crm_') && isMetricId(metric),
      ),
    ).toBe(true);
    expect(tables.map((table) => table.source)).toEqual(['crm_campaigns']);
    expect(
      tables[0].columns.every((column) =>
        declared('crm_campaigns')?.includes(column.id),
      ),
    ).toBe(true);
  });
});
