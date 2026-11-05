import {
  DEFAULT_DASHBOARD_NAME,
  defaultLeadFlowLayout,
} from './leadflow-analytics-dashboards.service';
import {
  leadFlowChannelDefaultLayout,
  leadFlowOverviewDefaultLayout,
} from './leadflow-channel-default-layouts';
import {
  DASHBOARD_CHANNEL_IDS,
  parseDashboardLayout,
} from './dashboard-layout.contract';

describe('LeadFlow channel default layouts', () => {
  it('keeps the dashboard tab named Visão Geral and the KPI section named Resumo', () => {
    expect(DEFAULT_DASHBOARD_NAME).toBe('Visão Geral');
    expect(defaultLeadFlowLayout(['overview']).sections[0].title).toBe(
      'Resumo',
    );
  });

  it('uses the configured Visão Geral snapshot for every new scope', () => {
    expect(defaultLeadFlowLayout([...DASHBOARD_CHANNEL_IDS])).toEqual(
      leadFlowOverviewDefaultLayout(),
    );
  });

  it.each([
    ['service', 'Atendimento', 18, 6],
    ['commercial', 'Comercial', 14, 0],
    ['lead_quality', 'Qualidade dos leads', 7, 2],
    ['automations', 'Automações', 11, 0],
  ] as const)(
    'freezes the configured %s section as the default channel dashboard',
    (channel, title, cardCount, highlightedCount) => {
      const layout = leadFlowChannelDefaultLayout(channel);
      const section = layout.sections[0];

      expect(parseDashboardLayout(layout)).toEqual(layout);
      expect(section).toMatchObject({ channel, title });
      expect(section.cards).toHaveLength(cardCount);
      expect(
        section.cards.filter((card) => card.highlighted === true),
      ).toHaveLength(highlightedCount);
      expect(defaultLeadFlowLayout([channel])).toEqual(layout);
    },
  );

  it('returns a clone so one dashboard cannot mutate the next scope default', () => {
    const first = leadFlowChannelDefaultLayout('service');
    first.sections[0].cards.length = 0;

    expect(
      leadFlowChannelDefaultLayout('service').sections[0].cards,
    ).toHaveLength(18);
  });
});
