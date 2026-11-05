import { parseDashboardLayout } from '../dashboard-layout.contract';
import { socialOverviewDefaultLayout } from './social-overview-default-layout';

describe('Social overview default layout', () => {
  it('keeps the configured Visão Geral snapshot for every new scope', () => {
    const layout = socialOverviewDefaultLayout();

    expect(parseDashboardLayout(layout)).toEqual(layout);
    expect(
      layout.sections.map((section) => [
        section.channel,
        section.cards.length,
        section.cards.filter((card) => card.highlighted === true).length,
      ]),
    ).toEqual([
      ['summary', 5, 5],
      ['instagram', 13, 3],
      ['meta_ads', 20, 5],
      ['facebook', 7, 2],
    ]);
  });

  it('returns a clone so one account cannot mutate the next account default', () => {
    const first = socialOverviewDefaultLayout();
    first.sections[0].cards.length = 0;

    expect(socialOverviewDefaultLayout().sections[0].cards).toHaveLength(5);
  });
});
