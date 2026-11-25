import { IsNull } from 'typeorm';
import { clientProjectWhere } from '../projects/client-area/projects-client-area.context';
import { clientAreaUiPermissions } from './client-area-agency-permission-projection';
import { clientAreaSelfSettingsUiPermissions } from './client-area-settings-ui-permissions';
import {
  isClientAreaSelfModulesEnabled,
  resolveSelfMemberAccess,
} from './client-area-self-modules';

const available = (access: ReturnType<typeof resolveSelfMemberAccess>) =>
  Object.entries(access)
    .filter(([, state]) => state.available)
    .map(([key]) => key)
    .sort();

describe('CA15 self modules', () => {
  it('keeps only the self overview while the flag is off', () => {
    expect(
      available(
        resolveSelfMemberAccess(false, new Set(['social', 'leadflow'])),
      ),
    ).toEqual(['overview']);
    expect(isClientAreaSelfModulesEnabled({ get: () => undefined })).toBe(
      false,
    );
    expect(isClientAreaSelfModulesEnabled({ get: () => ' TRUE ' })).toBe(true);
  });

  it('opens product modules only for contracted products, never company-bound ones', () => {
    expect(
      available(resolveSelfMemberAccess(true, new Set(['social']))),
    ).toEqual([
      'agency_projects',
      'approvals',
      'overview',
      'settings',
      'social_campaigns',
      'social_creative_studio',
      'social_planner',
    ]);
    const all = resolveSelfMemberAccess(true, new Set(['social', 'leadflow']));
    for (const key of [
      'conversations',
      'agency_billing',
      'analytics',
    ] as const)
      expect(all[key]).toMatchObject({
        available: false,
        reason: 'company_bound',
      });
    expect(all.leadflow_inbox).toEqual({ available: true, level: 'manager' });
    // D-24: approvals run over the own scope and need Social contracted.
    expect(all.approvals).toEqual({ available: true, level: 'manager' });
  });

  it('F2 (D-02): projects the Owner view in the self-context, minus invariant 7', () => {
    const access = resolveSelfMemberAccess(
      true,
      new Set(['social', 'leadflow']),
    );
    const keys = new Set([
      ...clientAreaSelfSettingsUiPermissions(access),
      ...clientAreaUiPermissions(access, 'client_owner'),
    ]);
    for (const key of [
      'leadflow.crm.pipeline.manage.admin',
      'leadflow.crm.stage.manage.manager_or_admin',
      'leadflow.settings.general.update.admin',
      'social.planner.calendar.delete.owner_or_admin_explicit',
      'social.creative.content.delete.owner_or_admin_explicit',
      'client_area.settings.business.manage',
      'client_area.settings.audit.view',
      'client_area.settings.integrations.meta_ads.manage',
      'client_area.settings.integrations.social_organic.manage',
      'client_area.settings.integrations.inbox.manage',
    ])
      expect([key, keys.has(key)]).toEqual([key, true]);
    for (const key of [
      'client_area.settings.members.manage',
      'client_area.settings.consent.decide',
      'client_area.settings.requests.invitation.create',
      'client_area.settings.requests.deletion.create',
      'client_area.agency_billing.view',
    ])
      expect([key, keys.has(key)]).toEqual([key, false]);
  });

  it('confines the self Projects scope to internal projects (D-CA15-2)', () => {
    expect(
      clientProjectWhere({
        tenantId: 't',
        workspaceId: 'w',
        userId: 'u',
        clientArea: { agencyClientId: null },
      }),
    ).toEqual({ clientId: IsNull() });
    expect(
      clientProjectWhere({
        tenantId: 't',
        workspaceId: 'w',
        userId: 'u',
        clientArea: { agencyClientId: 'c' },
      }),
    ).toEqual({ clientId: 'c' });
    expect(
      clientProjectWhere({ tenantId: 't', workspaceId: 'w', userId: 'u' }),
    ).toEqual({});
  });
});
