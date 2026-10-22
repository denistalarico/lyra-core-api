import { IsNull } from 'typeorm';
import { clientProjectWhere } from '../projects/client-area/projects-client-area.context';
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
      'overview',
      'settings',
      'social_campaigns',
      'social_creative_studio',
      'social_planner',
    ]);
    const all = resolveSelfMemberAccess(true, new Set(['social', 'leadflow']));
    for (const key of [
      'approvals',
      'conversations',
      'agency_billing',
      'analytics',
    ] as const)
      expect(all[key]).toMatchObject({
        available: false,
        reason: 'company_bound',
      });
    expect(all.leadflow_inbox).toEqual({ available: true, level: 'manager' });
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
