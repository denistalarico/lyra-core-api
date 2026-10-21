import {
  parseClientAreaLayout,
  CLIENT_AREA_METRICS,
} from './client-area-layout.contract';
const layout = (channel: string, card: object) => ({
  version: 1,
  sections: [
    {
      id: 's',
      channel,
      title: 'Título',
      cards: [{ id: 'c', size: { w: 2, h: 1 }, ...card }],
    },
  ],
});
describe('CA13 cross-product layout contract', () => {
  it('composes canonical Social and LeadFlow metrics with Agency cards', () => {
    expect(CLIENT_AREA_METRICS.some((m) => m.id === 'social.spend')).toBe(true);
    expect(
      parseClientAreaLayout(
        layout('social.meta_ads', { kind: 'kpi', metric: 'social.spend' }),
      ).sections,
    ).toHaveLength(1);
    expect(
      parseClientAreaLayout(
        layout('leadflow.overview', {
          kind: 'kpi',
          metric: 'leadflow.overview.first_response_rate',
        }),
      ).sections,
    ).toHaveLength(1);
    expect(
      parseClientAreaLayout(
        layout('agency.projects', { kind: 'table', source: 'agency.projects' }),
      ).sections,
    ).toHaveLength(1);
  });
  it('rejects unknown metrics and the Agency-only data-quality section', () => {
    expect(() =>
      parseClientAreaLayout(
        layout('social.meta_ads', { kind: 'kpi', metric: 'invented' }),
      ),
    ).toThrow();
    expect(() =>
      parseClientAreaLayout(
        layout('leadflow.data_quality', { kind: 'insight', body: 'x' }),
      ),
    ).toThrow();
    expect(() =>
      parseClientAreaLayout(
        layout('social.meta_ads', {
          kind: 'chart',
          metricIds: ['social.spend', 'invented'],
        }),
      ),
    ).toThrow();
  });
  it('rejects nested groups, duplicate ids and invalid dimensions', () => {
    expect(() =>
      parseClientAreaLayout(
        layout('social.summary', {
          kind: 'group',
          cards: [{ id: 'x', kind: 'group', size: { w: 2, h: 1 }, cards: [] }],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseClientAreaLayout(
        layout('agency.projects', {
          kind: 'table',
          source: 'agency.projects',
          size: { w: 13, h: 1 },
        }),
      ),
    ).toThrow();
  });
  it('does not admit data quality under a visible section or paid cards under an organic label', () => {
    expect(
      CLIENT_AREA_METRICS.some((m) => m.id === 'leadflow.quality.operational'),
    ).toBe(false);
    expect(() =>
      parseClientAreaLayout(
        layout('leadflow.service', {
          kind: 'table',
          source: 'leadflow.quality.operational',
        }),
      ),
    ).toThrow();
    expect(() =>
      parseClientAreaLayout(
        layout('social.instagram', { kind: 'kpi', metric: 'social.spend' }),
      ),
    ).toThrow();
  });
  it('projects LeadFlow card fields explicitly rather than persisting opaque nested secrets', () => {
    const result = parseClientAreaLayout(
      layout('leadflow.overview', {
        kind: 'kpi',
        metric: 'leadflow.overview.first_response_rate',
        token: 'secret',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
