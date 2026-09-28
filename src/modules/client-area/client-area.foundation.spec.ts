import { NotFoundException } from '@nestjs/common';
import { isKnownPermissionKey } from '../permissions/catalog/permission-keys.catalog';
import { PlatformRoleKey } from '../permissions/enums/permission.enums';
import { ApprovalClientReviewService } from '../social-approvals/approval-client-review.service';
import type { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import {
  CLIENT_AREA_ROLE_PERMISSIONS,
  permissionsForClientAreaRole,
} from './client-area-permissions.catalog';
import {
  assertClientAreaEnabled,
  isClientAreaEnabled,
  resolveClientAreaAccessSecret,
} from './client-area.config';
import { toCompanyAwareScope } from './client-area-scope';
import {
  CLIENT_AREA_PERMISSION_KEYS,
  CLIENT_AREA_ROLES,
  type ClientAreaContext,
} from './client-area.types';

const CLIENT_SECRET = 'client-area-secret-0123456789-abcdefghij';
const AGENCY_SECRET = 'agency-access-secret-0123456789-abcdefgh';

function config(values: Record<string, string | undefined>) {
  return { get: <T>(key: string) => values[key] as T | undefined };
}

describe('CA1 Client Area configuration (fail-closed)', () => {
  it('is OFF by default, with the flag alone, or with the secret alone', () => {
    expect(isClientAreaEnabled(config({}))).toBe(false);
    expect(isClientAreaEnabled(config({ CLIENT_AREA_ENABLED: 'true' }))).toBe(
      false,
    );
    expect(
      isClientAreaEnabled(
        config({ JWT_CLIENT_AREA_ACCESS_SECRET: CLIENT_SECRET }),
      ),
    ).toBe(false);
    expect(
      isClientAreaEnabled(
        config({
          CLIENT_AREA_ENABLED: 'yes',
          JWT_CLIENT_AREA_ACCESS_SECRET: CLIENT_SECRET,
        }),
      ),
    ).toBe(false);
    expect(
      isClientAreaEnabled(
        config({
          CLIENT_AREA_ENABLED: 'true',
          JWT_CLIENT_AREA_ACCESS_SECRET: CLIENT_SECRET,
        }),
      ),
    ).toBe(true);
  });

  it('never falls back to JWT_ACCESS_SECRET', () => {
    expect(
      resolveClientAreaAccessSecret(
        config({
          CLIENT_AREA_ENABLED: 'true',
          JWT_ACCESS_SECRET: AGENCY_SECRET,
        }),
      ),
    ).toBeNull();
  });

  it('refuses a secret equal to an Agency/2FA secret or shorter than 32 chars', () => {
    expect(
      resolveClientAreaAccessSecret(
        config({
          JWT_ACCESS_SECRET: AGENCY_SECRET,
          JWT_CLIENT_AREA_ACCESS_SECRET: AGENCY_SECRET,
        }),
      ),
    ).toBeNull();
    expect(
      resolveClientAreaAccessSecret(
        config({
          JWT_2FA_SECRET: CLIENT_SECRET,
          JWT_CLIENT_AREA_ACCESS_SECRET: CLIENT_SECRET,
        }),
      ),
    ).toBeNull();
    expect(
      resolveClientAreaAccessSecret(
        config({ JWT_CLIENT_AREA_ACCESS_SECRET: 'short' }),
      ),
    ).toBeNull();
  });

  it('answers a coded 404 while disabled', () => {
    expect(() => assertClientAreaEnabled(config({}))).toThrow(
      NotFoundException,
    );
    try {
      assertClientAreaEnabled(config({}));
    } catch (error) {
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'client_area_disabled',
      });
    }
  });
});

describe('CA1 Client Area permission catalog', () => {
  it('grants the CA0 presets with no bypass for client_admin', () => {
    expect([...permissionsForClientAreaRole('client_admin')].sort()).toEqual([
      'client_area.approvals.comment',
      'client_area.approvals.decide',
      'client_area.approvals.view',
    ]);
    expect([...permissionsForClientAreaRole('client_operator')].sort()).toEqual(
      [
        'client_area.approvals.comment',
        'client_area.approvals.decide',
        'client_area.approvals.view',
      ],
    );
    expect(
      permissionsForClientAreaRole('client_viewer').has(
        'client_area.approvals.decide',
      ),
    ).toBe(false);
    expect(Object.isFrozen(CLIENT_AREA_ROLE_PERMISSIONS)).toBe(true);
  });

  it('stays outside the Agency catalog and Agency role names', () => {
    for (const key of CLIENT_AREA_PERMISSION_KEYS) {
      expect(isKnownPermissionKey(key)).toBe(false);
    }
    const agencyRoles = Object.values(PlatformRoleKey) as string[];
    for (const role of CLIENT_AREA_ROLES) {
      expect(agencyRoles).not.toContain(role);
      expect(['owner', 'admin', 'manager', 'member']).not.toContain(role);
    }
  });
});

describe('CA1 toCompanyAwareScope → ApprovalClientReviewService', () => {
  const context: ClientAreaContext = {
    surface: 'client_area',
    userId: '00000000-0000-4000-8000-00000000000a',
    tenantId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-00000000000b',
    membershipId: '00000000-0000-4000-8000-00000000000c',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    agencyClientId: '00000000-0000-4000-8000-000000000003',
    companyContextId: '00000000-0000-4000-8000-000000000004',
    companyDisplayName: 'Empresa A',
    role: 'client_operator',
    permissions: permissionsForClientAreaRole('client_operator'),
    modules: { approvals: true },
  };

  it('produces a full company scope from the validated membership only', () => {
    expect(toCompanyAwareScope(context)).toEqual({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      agencyClientId: context.agencyClientId,
      companyContextId: context.companyContextId,
    });
  });

  it('is accepted by the approvals client boundary with the real person as actor', async () => {
    const approvals = {
      markClientViewed: jest.fn().mockResolvedValue({ id: 'approval' }),
      clientComment: jest.fn().mockResolvedValue({ id: 'comment' }),
      clientApprove: jest.fn().mockResolvedValue({ id: 'approval' }),
      clientRequestChanges: jest.fn().mockResolvedValue({ id: 'approval' }),
    };
    const review = new ApprovalClientReviewService(
      approvals as unknown as SocialApprovalsService,
    );
    const scope = toCompanyAwareScope(context);

    await review.view(scope, 'approval-id', context.userId);
    await review.approve(scope, 'approval-id', context.userId);

    expect(approvals.markClientViewed).toHaveBeenCalledWith(
      scope,
      'approval-id',
      context.userId,
    );
    expect(approvals.clientApprove).toHaveBeenCalledWith(scope, 'approval-id', {
      type: 'user',
      userId: context.userId,
    });
    // Never the membership, company or Agency Client as the actor.
    expect(JSON.stringify(approvals.clientApprove.mock.calls)).not.toContain(
      context.membershipId,
    );
  });
});
