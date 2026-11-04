import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

jest.mock('./agency-settings.service', () => ({
  AgencySettingsService: class AgencySettingsService {},
}));

import { AgencySettingsController } from './agency-settings.controller';

function hasRoute(path: string, method: RequestMethod) {
  return Object.getOwnPropertyNames(AgencySettingsController.prototype).some(
    (propertyName) => {
      const handler = AgencySettingsController.prototype[
        propertyName as keyof AgencySettingsController
      ];

      return (
        typeof handler === 'function' &&
        Reflect.getMetadata(PATH_METADATA, handler) === path &&
        Reflect.getMetadata(METHOD_METADATA, handler) === method
      );
    },
  );
}

describe('AgencySettingsController subscriptions routes', () => {
  it('does not expose PATCH /agency/settings/subscriptions', () => {
    expect(hasRoute('subscriptions', RequestMethod.PATCH)).toBe(false);
  });

  it('keeps GET /agency/settings/subscriptions available', () => {
    expect(hasRoute('subscriptions', RequestMethod.GET)).toBe(true);
  });
});
