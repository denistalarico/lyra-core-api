import {
  resolveMemberAccess,
  permissionsForMemberAccess,
} from './client-area-permissions.catalog';
import { projectAgencyPermissions } from './client-area-agency-permission-projection';
import { CLIENT_AREA_MODULE_KEYS } from './client-area.types';

describe('CA7 access model v2', () => {
  const enabled = Object.fromEntries(
    CLIENT_AREA_MODULE_KEYS.map((key) => [key, true]),
  );
  it('gives the Owner manager only in available modules and billing only to Owner', () => {
    const owner = resolveMemberAccess('client_owner', enabled, {});
    const member = resolveMemberAccess('client_member', enabled, {
      agency_billing: 'manager',
      agency_projects: 'operator',
    });
    expect(owner.agency_billing).toEqual({ available: true, level: 'manager' });
    expect(member.agency_billing.available).toBe(false);
    expect(member.agency_projects).toEqual({
      available: true,
      level: 'operator',
    });
    expect(member.social_planner.available).toBe(false);
  });
  it('does not let an Owner reopen a company-disabled module', () => {
    expect(
      resolveMemberAccess('client_owner', { ...enabled, approvals: false }, {})
        .approvals.available,
    ).toBe(false);
  });
  it('derives the existing facade keys strictly from levels', () => {
    const access = resolveMemberAccess('client_member', enabled, {
      approvals: 'viewer',
      conversations: 'operator',
    });
    expect([...permissionsForMemberAccess(access)].sort()).toEqual([
      'client_area.approvals.view',
      'client_area.conversations.send',
      'client_area.conversations.view',
    ]);
  });
  it('allows operator editing any card but confines archive/delete to created_by_me', () => {
    const access = resolveMemberAccess('client_member', enabled, {
      agency_projects: 'operator',
    });
    const projection = projectAgencyPermissions(
      'agency_projects',
      access.agency_projects.level,
    );
    expect(
      projection.find(
        (p) =>
          p.key === 'agency.tasks.task.update.assigned' &&
          p.methods.includes('PATCH'),
      ),
    ).toMatchObject({ scope: 'client' });
    expect(
      projection.find(
        (p) =>
          p.key === 'agency.tasks.task.update.assigned' &&
          p.methods.includes('DELETE'),
      ),
    ).toMatchObject({ scope: 'created_by_me' });
    expect(
      projection.find(
        (p) =>
          p.key === 'agency.tasks.task.manage.department' &&
          p.methods.includes('DELETE'),
      ),
    ).toMatchObject({ scope: 'created_by_me' });
  });
  it('never projects workspace settings, owner_only, automations or dangerous keys', () => {
    for (const module of CLIENT_AREA_MODULE_KEYS)
      for (const level of ['viewer', 'operator', 'manager'] as const) {
        for (const { key } of projectAgencyPermissions(module, level))
          expect(key).not.toMatch(
            /owner_only|danger_zone|settings.users|automations|stages.manage/,
          );
      }
  });
});

import { ClientAreaConsentService } from './services/client-area-consent.service';
import {
  AuditChangeService,
  recordChange,
} from './services/audit-change.service';
import { ClientAreaManagementService } from './services/client-area-management.service';
import { ClientAreaMembershipEntity } from './entities/client-area-membership.entity';
import { LeadFlowTelemetryConsentNoticeEntity } from '../leadflow-privacy/entities/leadflow-telemetry-consent-notice.entity';
import { LeadFlowTelemetryConsentEntity } from '../leadflow-privacy/entities/leadflow-telemetry-consent.entity';
import type { ClientAreaContext } from './client-area.types';
import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

const scope = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  agencyClientId: 'client',
  companyContextId: 'company',
};
describe('CA7 company module gate matrix', () => {
  it.each(
    [false, true].flatMap((product) =>
      [false, true].flatMap((toggle) =>
        [false, true].flatMap((consent) =>
          ['viewer', 'operator', 'manager', null].map((level) => ({
            product,
            toggle,
            consent,
            level,
          })),
        ),
      ),
    ),
  )(
    'product=$product module=$toggle consent=$consent level=$level',
    async ({ product, toggle, consent, level }) => {
      const config = {
        get: (key: string) =>
          key === 'CLIENT_AREA_ENABLED'
            ? 'true'
            : key === 'JWT_CLIENT_AREA_ACCESS_SECRET'
              ? 'x'.repeat(40)
              : undefined,
      };
      const fake = { findOne: jest.fn().mockResolvedValue(null) };
      const settings = {
        ...scope,
        enabled: true,
        moduleSettings: {
          social_planner: { enabled: toggle, defaultLevel: 'viewer' },
          conversations: { enabled: true, defaultLevel: 'viewer' },
        },
      };
      const service = new ClientAreaManagementService(
        config as never,
        { findOne: () => Promise.resolve({ enabled: true }) } as never,
        { findOne: () => Promise.resolve(settings) } as never,
        fake as never,
        fake as never,
        fake as never,
        {
          findOne: () =>
            Promise.resolve({
              id: 'client',
              status: 'active',
              managedTenantId: 'managed',
            }),
        } as never,
        fake as never,
        fake as never,
        fake as never,
        fake as never,
        fake as never,
        fake as never,
        {
          find: () =>
            Promise.resolve([
              {
                productKey: 'social',
                status: 'active',
                currentPeriodEnd: null,
              },
            ]),
        } as never,
        fake as never,
        {
          find: () =>
            Promise.resolve(product ? [{ productKey: 'social' }] : []),
        } as never,
        {
          state: () =>
            Promise.resolve({ status: consent ? 'accepted' : 'required' }),
        } as never,
      );
      const modules = await service.resolveCompanyModules(scope);
      const levels = level
        ? { social_planner: level as 'viewer' | 'operator' | 'manager' }
        : {};
      expect(
        resolveMemberAccess('client_member', modules, levels).social_planner
          .available,
      ).toBe(product && toggle && consent && !!level);
    },
  );
});

describe('CA7 consent and safe audit', () => {
  const notice = {
    id: 'notice',
    purposeKey: 'client_area_essential_processing',
    version: 1,
    contentHash: 'a'.repeat(64),
    legalReviewStatus: 'approved',
  };
  const consent = {
    status: 'opted_in',
    noticeId: 'notice',
    noticeVersion: 1,
    noticeContentHash: 'a'.repeat(64),
  };
  const owner = {
    ...scope,
    surface: 'client_area',
    role: 'client_owner',
    userId: 'user',
    membershipId: 'membership',
  } as ClientAreaContext;
  const dto = {
    purposeKey: notice.purposeKey,
    decision: 'accept' as const,
    noticeId: notice.id,
    contentHash: notice.contentHash,
  };
  function service(
    overrides: { notice?: object; consent?: object | null; role?: string } = {},
  ) {
    const insert = jest.fn();
    const manager = {
      query: jest.fn(),
      getRepository: (entity: unknown) => ({
        findOne: jest
          .fn()
          .mockResolvedValue(
            entity === LeadFlowTelemetryConsentNoticeEntity
              ? (overrides.notice ?? notice)
              : entity === LeadFlowTelemetryConsentEntity
                ? overrides.consent === undefined
                  ? consent
                  : overrides.consent
                : entity === ClientAreaMembershipEntity
                  ? overrides.role === 'member'
                    ? null
                    : { id: 'membership' }
                  : null,
          ),
        insert,
      }),
    };
    return {
      value: new ClientAreaConsentService(
        {
          manager,
          transaction: (fn: (m: unknown) => unknown) => fn(manager),
        } as never,
        { record: jest.fn() } as never,
      ),
      insert,
    };
  }
  it('only accepts consent to the current version and hash and reopens on a new notice', async () => {
    expect((await service().value.state(scope)).status).toBe('accepted');
    expect(
      (await service({ notice: { ...notice, version: 2 } }).value.state(scope))
        .status,
    ).toBe('required');
    expect(
      (
        await service({
          notice: { ...notice, contentHash: 'b'.repeat(64) },
        }).value.state(scope)
      ).status,
    ).toBe('required');
    expect(
      (
        await service({
          consent: { ...consent, status: 'opted_out' },
        }).value.state(scope)
      ).status,
    ).toBe('revoked');
  });
  it('does not open products or accept a legal placeholder', async () => {
    const { value } = service({
      notice: { ...notice, legalReviewStatus: 'pending' },
    });
    expect((await value.state(scope)).status).toBe('notice_unavailable');
    await expect(value.decide(owner, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('denies non-Owner, stale ownership, stale notice and declining essential processing', async () => {
    await expect(
      service().value.decide({ ...owner, role: 'client_member' }, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service({ role: 'member' }).value.decide(owner, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service().value.decide(owner, { ...dto, noticeId: 'old' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service().value.decide(owner, { ...dto, decision: 'decline' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('redacts all diff values except service-allowlisted fields', () => {
    expect(
      recordChange(
        { password: 'old', level: 'viewer' },
        { password: 'secret', level: 'operator' },
        ['level'],
      ),
    ).toEqual({
      changedFields: ['password', 'level'],
      diff: { level: { before: 'viewer', after: 'operator' } },
    });
  });
  it('logs and counts lost audit writes without failing the mutation', async () => {
    const repo = {
      insert: jest.fn().mockRejectedValue(new Error('storage down')),
    };
    const value = new AuditChangeService(repo as never, {} as never);
    await expect(
      value.record({
        tenantId: 'tenant',
        actorSurface: 'client_area',
        moduleKey: 'settings',
        entityType: 'test',
        action: 'update',
        requestId: 'request-id',
      }),
    ).resolves.toBeUndefined();
    expect(value.failedWrites).toBe(1);
  });
});
