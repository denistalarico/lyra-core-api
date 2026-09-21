import {
  DASHBOARD_LAYOUT_VERSION,
  DashboardLayoutError,
  emptyDashboardLayout,
  parseDashboardLayout,
} from './dashboard-layout.contract';

function layout(overrides: Record<string, unknown> = {}) {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    sections: [
      {
        id: 'section-meta_ads',
        channel: 'meta_ads',
        title: 'Meta Ads',
        cards: [{ id: 'card-1', kind: 'kpi', size: { w: 3, h: 1 } }],
      },
    ],
    ...overrides,
  };
}

describe('parseDashboardLayout', () => {
  it('accepts a well-formed document', () => {
    const parsed = parseDashboardLayout(layout());

    expect(parsed.version).toBe(DASHBOARD_LAYOUT_VERSION);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].cards[0].id).toBe('card-1');
  });

  it('refuses a version it does not understand', () => {
    // The whole reason the field exists: a reader that meets a future document
    // must refuse it rather than interpret card kinds it has never seen.
    expect(() => parseDashboardLayout(layout({ version: 2 }))).toThrow(
      DashboardLayoutError,
    );
    expect(() => parseDashboardLayout(layout({ version: undefined }))).toThrow(
      DashboardLayoutError,
    );
  });

  it('refuses a card whose kind is unknown', () => {
    expect(() =>
      parseDashboardLayout(
        layout({
          sections: [
            {
              id: 's',
              channel: 'meta_ads',
              title: 'T',
              cards: [{ id: 'c', kind: 'sparkline', size: { w: 3, h: 1 } }],
            },
          ],
        }),
      ),
    ).toThrow(DashboardLayoutError);
  });

  it('refuses a card whose size leaves the grid', () => {
    for (const size of [
      { w: 13, h: 1 },
      { w: 3, h: 9 },
      { w: 0, h: 1 },
      { w: 3.5, h: 1 },
      { w: -2, h: 1 },
    ]) {
      expect(() =>
        parseDashboardLayout(
          layout({
            sections: [
              {
                id: 's',
                channel: 'meta_ads',
                title: 'T',
                cards: [{ id: 'c', kind: 'kpi', size }],
              },
            ],
          }),
        ),
      ).toThrow(DashboardLayoutError);
    }
  });

  it('refuses an unknown channel', () => {
    expect(() =>
      parseDashboardLayout(
        layout({
          sections: [{ id: 's', channel: 'tiktok', title: 'T', cards: [] }],
        }),
      ),
    ).toThrow(DashboardLayoutError);
  });

  it('refuses duplicate ids', () => {
    // Two cards with one id make every later edit ambiguous about which one it
    // addressed.
    expect(() =>
      parseDashboardLayout(
        layout({
          sections: [
            {
              id: 's',
              channel: 'meta_ads',
              title: 'T',
              cards: [
                { id: 'same', kind: 'kpi', size: { w: 3, h: 1 } },
                { id: 'same', kind: 'kpi', size: { w: 3, h: 1 } },
              ],
            },
          ],
        }),
      ),
    ).toThrow(DashboardLayoutError);

    expect(() =>
      parseDashboardLayout(
        layout({
          sections: [
            { id: 'dup', channel: 'meta_ads', title: 'A', cards: [] },
            { id: 'dup', channel: 'facebook', title: 'B', cards: [] },
          ],
        }),
      ),
    ).toThrow(DashboardLayoutError);
  });

  it('keeps the card body but rebuilds the envelope', () => {
    // Etapas 6–8 own the per-kind body, so it must survive a round trip
    // untouched; the envelope is rebuilt so stray top-level keys do not.
    const parsed = parseDashboardLayout({
      version: DASHBOARD_LAYOUT_VERSION,
      sections: [
        {
          id: 's',
          channel: 'meta_ads',
          title: 'T',
          cards: [
            {
              id: 'c',
              kind: 'chart',
              size: { w: 6, h: 4 },
              metricIds: ['spend'],
              chartType: 'bar',
              stacked: false,
            },
          ],
        },
      ],
      somethingElse: 'dropped',
    });

    expect(parsed.sections[0].cards[0].metricIds).toEqual(['spend']);
    expect(parsed.sections[0].cards[0].chartType).toBe('bar');
    expect(parsed).not.toHaveProperty('somethingElse');
  });

  it('refuses values that are not documents at all', () => {
    for (const value of [null, undefined, 'x', 3, [], true]) {
      expect(() => parseDashboardLayout(value)).toThrow(DashboardLayoutError);
    }
  });
});

describe('emptyDashboardLayout', () => {
  it('creates one section per channel, in the order given', () => {
    const built = emptyDashboardLayout(['facebook', 'meta_ads']);

    expect(built.version).toBe(DASHBOARD_LAYOUT_VERSION);
    expect(built.sections.map((section) => section.channel)).toEqual([
      'facebook',
      'meta_ads',
    ]);
    expect(built.sections.every((section) => section.cards.length === 0)).toBe(
      true,
    );
  });

  it('produces a document its own parser accepts', () => {
    expect(() =>
      parseDashboardLayout(emptyDashboardLayout(['meta_ads'])),
    ).not.toThrow();
  });
});
