import 'reflect-metadata';
import { ANY_PERMISSION_KEYS_METADATA } from '../permissions';
import { LeadFlowAnalyticsController } from './leadflow-analytics.controller';

describe('LeadFlow Analytics HTTP contract', () => {
  it('requires an operational or full analytics permission', () => {
    const permissions = Reflect.getMetadata(
      ANY_PERMISSION_KEYS_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      LeadFlowAnalyticsController.prototype.getCommercialJourney,
    ) as unknown;

    expect(permissions).toEqual([
      'leadflow.analytics.reports.view.operational',
      'leadflow.analytics.reports.view.full',
    ]);
  });
});
