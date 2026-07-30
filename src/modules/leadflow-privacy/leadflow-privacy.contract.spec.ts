import 'reflect-metadata';
import { PERMISSION_KEY_METADATA } from '../permissions';
import { LeadFlowPrivacyController } from './leadflow-privacy.controller';
import { LEADFLOW_PRIVACY_PERMISSIONS } from './leadflow-privacy.permissions';

describe('LeadFlow privacy HTTP contract', () => {
  it('keeps transparency behind the telemetry view permission', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        LeadFlowPrivacyController.prototype.getStatus,
      ),
    ).toBe(LEADFLOW_PRIVACY_PERMISSIONS.view);
  });

  it.each(['optIn', 'optOut', 'collectSnapshot', 'eraseContribution'] as const)(
    'keeps %s behind owner-only management',
    (handler) => {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY_METADATA,
          LeadFlowPrivacyController.prototype[handler],
        ),
      ).toBe(LEADFLOW_PRIVACY_PERMISSIONS.manage);
    },
  );
});
