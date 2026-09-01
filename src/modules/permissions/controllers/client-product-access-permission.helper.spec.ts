import { ForbiddenException } from '@nestjs/common';
import { resolveClientProductAccessPermissionKey } from './client-product-access-permission.helper';

describe('resolveClientProductAccessPermissionKey', () => {
  it('binds the social permission for productKey social', () => {
    expect(resolveClientProductAccessPermissionKey('social')).toBe(
      'social.settings.permissions.manage.admin',
    );
  });

  it('binds the leadflow permission for productKey leadflow', () => {
    expect(resolveClientProductAccessPermissionKey('leadflow')).toBe(
      'leadflow.settings.permissions.manage.admin',
    );
  });

  it('never returns a social key for leadflow or vice versa', () => {
    expect(resolveClientProductAccessPermissionKey('leadflow')).not.toContain(
      'social',
    );
    expect(resolveClientProductAccessPermissionKey('social')).not.toContain(
      'leadflow',
    );
  });

  it('rejects a productKey outside the known set — no fallback to either key', () => {
    expect(() => resolveClientProductAccessPermissionKey('agency')).toThrow(
      ForbiddenException,
    );
    expect(() =>
      resolveClientProductAccessPermissionKey('not-a-product'),
    ).toThrow(ForbiddenException);
  });
});
