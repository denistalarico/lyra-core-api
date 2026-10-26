import 'reflect-metadata';
import { ANY_PERMISSION_KEYS_METADATA } from '../permissions';
import { LeadFlowAnalyticsController } from './leadflow-analytics.controller';

describe('LeadFlow Analytics HTTP contract', () => {
  it.each([
    'getCommercialJourney',
    'getOperationalOverview',
    'listViews',
    'createView',
    'updateView',
    'removeView',
    'getRecommendations',
  ] as const)(
    'requires an operational or full analytics permission on %s',
    (handler) => {
      const permissions = Reflect.getMetadata(
        ANY_PERMISSION_KEYS_METADATA,
        LeadFlowAnalyticsController.prototype[handler],
      ) as unknown;

      expect(permissions).toEqual([
        'leadflow.analytics.reports.view.operational',
        'leadflow.analytics.reports.view.full',
      ]);
    },
  );

  it.each([
    'generateRecommendations',
    'decideRecommendation',
    'evaluateRecommendation',
    'rollbackRecommendation',
  ] as const)('requires full analytics permission on %s', (handler) => {
    const permission = Reflect.getMetadata(
      'permissions:permission_key',
      LeadFlowAnalyticsController.prototype[handler],
    ) as unknown;

    expect(permission).toBe('leadflow.analytics.recommendations.manage.admin');
  });

  it('keeps the operational endpoint separate from the commercial cohort', () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      LeadFlowAnalyticsController.prototype.getOperationalOverview,
    ).not.toBe(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      LeadFlowAnalyticsController.prototype.getCommercialJourney,
    );
  });

  it('no longer serves the legacy report PDF (AN-LF2 moved it)', () => {
    expect(
      Object.getOwnPropertyNames(LeadFlowAnalyticsController.prototype),
    ).not.toContain('renderReportPdf');
  });
});
