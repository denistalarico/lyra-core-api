import { PlatformRoleKey } from '../enums/permission.enums';
import {
  getPermissionDefinition,
  isKnownPermissionKey,
} from './permission-keys.catalog';

describe('social publishing and organic analytics permission keys', () => {
  const { Owner, Admin, Manager, Member } = PlatformRoleKey;

  it.each([
    [
      'social.publishing.publication.view.assigned',
      [Member, Manager, Admin, Owner],
      false,
    ],
    [
      'social.publishing.publication.create.manager',
      [Manager, Admin, Owner],
      false,
    ],
    [
      'social.publishing.publication.publish_now.manager',
      [Manager, Admin, Owner],
      false,
    ],
    [
      'social.publishing.publication.cancel.manager',
      [Manager, Admin, Owner],
      false,
    ],
    [
      'social.publishing.publication.delete_external.admin_or_explicit',
      [Admin, Owner],
      true,
    ],
    [
      'social.analytics.organic.view.operational',
      [Manager, Admin, Owner],
      false,
    ],
  ])('%s has the specified role floor', (key, roles, isDangerous) => {
    expect(isKnownPermissionKey(key)).toBe(true);
    expect(getPermissionDefinition(key)).toMatchObject({
      key,
      roles,
      isDangerous,
    });
  });

  it('reuses the existing integrations permission for organic connections', () => {
    expect(
      getPermissionDefinition('social.settings.integrations.manage.admin'),
    ).toMatchObject({ roles: [Admin, Owner] });
    expect(
      isKnownPermissionKey('social.settings.integrations.organic.manage.admin'),
    ).toBe(false);
  });
});
