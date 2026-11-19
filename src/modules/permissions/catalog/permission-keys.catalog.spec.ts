import { PlatformRoleKey } from '../enums/permission.enums';
import {
  permissionsForModuleAccess,
  resolveModuleAccess,
} from './module-access.catalog';
import {
  getPermissionDefinition,
  isKnownPermissionKey,
} from './permission-keys.catalog';

describe('LeadFlow and Social module access', () => {
  const { Manager, Member } = PlatformRoleKey;

  it('inherits existing product levels when there are no module overrides', () => {
    const levels = resolveModuleAccess(Manager, [
      { appKey: 'social', access: 'manager' },
      { appKey: 'leadflow', access: 'member' },
    ]);
    const keys = permissionsForModuleAccess(Manager, levels);
    expect(keys).toContain('social.planner.calendar.create.manager');
    expect(keys).toContain('leadflow.crm.records.view.assigned');
    expect(keys).not.toContain('leadflow.automations.automation.view.client');
  });

  it('removes blocked module permissions and enforces product and member ceilings', () => {
    const rows = [
      { appKey: 'social', access: 'blocked' },
      { appKey: 'social.planner', access: 'manager' },
      { appKey: 'leadflow.crm', access: 'blocked' },
      { appKey: 'leadflow.inbox', access: 'member' },
      { appKey: 'leadflow.appointments', access: 'manager' },
    ];
    const managerKeys = permissionsForModuleAccess(
      Manager,
      resolveModuleAccess(Manager, rows),
    );
    expect(managerKeys.some((key) => key.startsWith('social.'))).toBe(false);
    expect(managerKeys.some((key) => key.startsWith('leadflow.crm.'))).toBe(
      false,
    );
    expect(managerKeys).toContain('leadflow.inbox.conversation.view.assigned');
    expect(managerKeys).not.toContain(
      'leadflow.inbox.conversation.assign.client',
    );
    expect(managerKeys).toContain('leadflow.appointments.item.update.client');

    const memberKeys = permissionsForModuleAccess(
      Member,
      resolveModuleAccess(Member, rows),
    );
    expect(memberKeys).toContain('leadflow.appointments.item.update.assigned');
    expect(memberKeys).not.toContain(
      'leadflow.appointments.item.update.client',
    );
  });
});

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
    // Media reads sit at the same floor as reading a publication, and media
    // writes at the same floor as creating one — whoever may schedule a post
    // may supply its media, and no lower role gains a write by this addition.
    [
      'social.publishing.media.view.assigned',
      [Member, Manager, Admin, Owner],
      false,
    ],
    ['social.publishing.media.upload.manager', [Manager, Admin, Owner], false],
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
