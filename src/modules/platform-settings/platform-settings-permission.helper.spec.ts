import { ForbiddenException } from '@nestjs/common';
import { resolveBusinessProfilePermissionKey } from './platform-settings-permission.helper';

describe('resolveBusinessProfilePermissionKey', () => {
  it('binds the social permission for a social product context', () => {
    expect(resolveBusinessProfilePermissionKey('social', 'view')).toBe(
      'social.settings.general.view.admin',
    );
    expect(resolveBusinessProfilePermissionKey('social', 'update')).toBe(
      'social.settings.general.update.admin',
    );
  });

  it('binds the leadflow permission for a leadflow product context', () => {
    expect(resolveBusinessProfilePermissionKey('leadflow', 'view')).toBe(
      'leadflow.settings.general.view.admin',
    );
    expect(resolveBusinessProfilePermissionKey('leadflow', 'update')).toBe(
      'leadflow.settings.general.update.admin',
    );
  });

  it('never returns a social key for a leadflow context or vice versa', () => {
    expect(
      resolveBusinessProfilePermissionKey('leadflow', 'view'),
    ).not.toContain('social');
    expect(resolveBusinessProfilePermissionKey('social', 'view')).not.toContain(
      'leadflow',
    );
  });

  it('rejects an agency-mode productKey — there is no product to bind to', () => {
    expect(() => resolveBusinessProfilePermissionKey('agency', 'view')).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a missing productKey', () => {
    expect(() =>
      resolveBusinessProfilePermissionKey(undefined, 'view'),
    ).toThrow(ForbiddenException);
  });
});
