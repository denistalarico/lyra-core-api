// Lyra Social S1.4.9 §12 — product-bound authorization for Brand Kit.
// Same rule S1.4.0/S1.4.7/S1.4.8 established: one key per productKey+verb,
// never an OR across products.

import { ForbiddenException } from '@nestjs/common';
import { getPermissionDefinition } from '../permissions/catalog/permission-keys.catalog';
import {
  BRAND_KIT_ANY_PERMISSIONS,
  resolveBrandKitPermissionKey,
} from './brand-kit-permission.helper';

describe('resolveBrandKitPermissionKey', () => {
  it('binds the Social catalog keys for a Social context', () => {
    expect(resolveBrandKitPermissionKey('social', 'view')).toBe(
      'social.brandkit.asset.view.client',
    );
    expect(resolveBrandKitPermissionKey('social', 'update')).toBe(
      'social.brandkit.assets.manage.manager_or_admin',
    );
    expect(resolveBrandKitPermissionKey('social', 'delete')).toBe(
      'social.brandkit.asset.delete.owner_or_admin_explicit',
    );
  });

  it('keeps the three verbs distinct — view never grants write or delete', () => {
    const view = resolveBrandKitPermissionKey('social', 'view');
    const update = resolveBrandKitPermissionKey('social', 'update');
    const remove = resolveBrandKitPermissionKey('social', 'delete');

    expect(new Set([view, update, remove]).size).toBe(3);
    expect(remove).toContain('owner_or_admin_explicit');
  });

  it('every key it can return really exists in the permission catalog', () => {
    for (const key of BRAND_KIT_ANY_PERMISSIONS) {
      expect(getPermissionDefinition(key)).toBeDefined();
    }
  });

  it('refuses a LeadFlow context — no leadflow.brandkit.* key exists to bind', () => {
    // Inventing one would look like authorization while granting nothing,
    // since no role matrix references it. Failing closed is the honest state.
    expect(() => resolveBrandKitPermissionKey('leadflow', 'view')).toThrow(
      ForbiddenException,
    );
    expect(() => resolveBrandKitPermissionKey('leadflow', 'delete')).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an agency-shell context and a missing context', () => {
    expect(() => resolveBrandKitPermissionKey('agency', 'view')).toThrow(
      ForbiddenException,
    );
    expect(() => resolveBrandKitPermissionKey(undefined, 'update')).toThrow(
      ForbiddenException,
    );
  });

  it('never returns a LeadFlow key for any verb', () => {
    for (const verb of ['view', 'update', 'delete'] as const) {
      expect(resolveBrandKitPermissionKey('social', verb)).not.toContain(
        'leadflow',
      );
    }
  });
});
