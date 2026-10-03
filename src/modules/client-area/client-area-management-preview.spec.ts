import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ClientAreaManagementService } from './services/client-area-management.service';

/**
 * CA3.1 — focused unit coverage of the preview projection/read-only refresh.
 * Repos are mocked (the PostgreSQL FK chain is already covered by the CA3
 * migration test); this spec is about the service's own logic: re-validating
 * on every call, never writing an audit row from `previewContext`, and
 * matching the `preview()`/`previewContext()` projection shapes.
 */
describe('CA3.1 ClientAreaManagementService preview', () => {
  const TENANT = 'tenant-1';
  const WORKSPACE = 'workspace-1';
  const CLIENT = 'client-1';
  const COMPANY = 'company-1';
  const MEMBERSHIP = 'membership-1';
  const ACTOR = 'actor-1';
  const TARGET_USER = 'user-1';

  function buildService(
    overrides: {
      membership?: Record<string, unknown> | null;
      company?: Record<string, unknown> | null;
      settingsEnabled?: boolean;
      eligible?: boolean;
    } = {},
  ) {
    const config = {
      get: (key: string) =>
        key === 'CLIENT_AREA_ENABLED'
          ? 'true'
          : key === 'JWT_CLIENT_AREA_ACCESS_SECRET'
            ? 'a'.repeat(40)
            : undefined,
    } as unknown as ConfigService;

    const settingsEnabled = overrides.settingsEnabled ?? true;
    const membership =
      overrides.membership === undefined
        ? {
            id: MEMBERSHIP,
            tenantId: TENANT,
            workspaceId: WORKSPACE,
            agencyClientId: CLIENT,
            companyContextId: COMPANY,
            userId: TARGET_USER,
            role: 'client_operator',
            status: 'active',
          }
        : overrides.membership;
    const company =
      overrides.company === undefined
        ? {
            id: COMPANY,
            tenantId: TENANT,
            workspaceId: WORKSPACE,
            agencyClientId: CLIENT,
            companyContactId: 'contact-1',
            status: 'active',
          }
        : overrides.company;

    const previewEventsRepo = { save: jest.fn(), create: jest.fn((x) => x) };
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(
        settingsEnabled
          ? {
              tenantId: TENANT,
              workspaceId: WORKSPACE,
              enabled: true,
              brandingMode: 'agency',
            }
          : null,
      ),
    };
    const companySettingsRepo = {
      findOne: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: CLIENT,
        companyContextId: COMPANY,
        enabled: true,
        approvalsEnabled: false,
      }),
    };
    const companyIdentityRepo = {
      findOne: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        tradeName: 'Agência X',
      }),
    };
    const contextsRepo = { findOne: jest.fn().mockResolvedValue(company) };
    const clientsRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: CLIENT,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        managedTenantId: 'managed-tenant-1',
      }),
    };
    const contactsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'contact-1', displayName: 'Empresa Cliente' }),
    };
    const membershipsRepo = {
      findOne: jest.fn().mockResolvedValue(membership),
      manager: {},
    };
    const eligibilityService = {
      isMembershipEligible: jest
        .fn()
        .mockResolvedValue(overrides.eligible ?? true),
    };
    const securityRepo = {
      findOne: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        userId: TARGET_USER,
        currentEmail: 'cliente@example.com',
      }),
    };
    const profilesRepo = {
      findOne: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        userId: TARGET_USER,
        displayName: 'João da Silva',
      }),
    };
    const invitationsRepo = { find: jest.fn().mockResolvedValue([]) };
    const entitlementsRepo = { findOne: jest.fn().mockResolvedValue(null) };

    const service = new ClientAreaManagementService(
      config,
      settingsRepo as never,
      companySettingsRepo as never,
      previewEventsRepo as never,
      companyIdentityRepo as never,
      contextsRepo as never,
      clientsRepo as never,
      contactsRepo as never,
      membershipsRepo as never,
      // PD3 — self access repository; no preview path reads it.
      { find: jest.fn().mockResolvedValue([]) } as never,
      securityRepo as never,
      profilesRepo as never,
      invitationsRepo as never,
      entitlementsRepo as never,
      eligibilityService as never,
    );

    return {
      service,
      previewEventsRepo,
      membershipsRepo,
      contextsRepo,
      eligibilityService,
    };
  }

  it('preview() writes exactly one audit row per call, attributed to the Agency actor, never the target user', async () => {
    const { service, previewEventsRepo } = buildService();

    await service.preview(
      TENANT,
      WORKSPACE,
      CLIENT,
      COMPANY,
      ACTOR,
      MEMBERSHIP,
      'preview_started',
    );

    expect(previewEventsRepo.save).toHaveBeenCalledTimes(1);
    const [saved] = previewEventsRepo.save.mock.calls[0];
    expect(saved.agencyActorUserId).toBe(ACTOR);
    expect(saved.targetMembershipId).toBe(MEMBERSHIP);
    expect(saved.action).toBe('preview_started');
    expect(saved.agencyActorUserId).not.toBe(TARGET_USER);
  });

  it('preview() returns a client-shaped, read-only projection', async () => {
    const { service } = buildService();

    const result = await service.preview(
      TENANT,
      WORKSPACE,
      CLIENT,
      COMPANY,
      ACTOR,
      MEMBERSHIP,
      'preview_started',
    );

    expect(result.preview).toMatchObject({
      surface: 'agency_client_preview',
      companyContextId: COMPANY,
      membershipId: MEMBERSHIP,
      role: 'client_operator',
      readOnly: true,
      modules: { approvals: false },
      company: 'Empresa Cliente',
    });
    expect(result.preview.user.displayName).toBe('João da Silva');
    expect(Array.isArray(result.preview.permissions)).toBe(true);
  });

  it('previewContext() returns the same projection shape without writing an audit row', async () => {
    const { service, previewEventsRepo } = buildService();

    const result = await service.previewContext(
      TENANT,
      WORKSPACE,
      CLIENT,
      COMPANY,
      MEMBERSHIP,
    );

    expect(previewEventsRepo.save).not.toHaveBeenCalled();
    expect(result.preview).toMatchObject({
      surface: 'agency_client_preview',
      companyContextId: COMPANY,
      membershipId: MEMBERSHIP,
      readOnly: true,
    });
  });

  it('previewContext() fails closed when the membership is no longer active (revoked mid-preview)', async () => {
    const { service } = buildService({ membership: null });

    await expect(
      service.previewContext(TENANT, WORKSPACE, CLIENT, COMPANY, MEMBERSHIP),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('previewContext() fails closed when the Company Context is no longer usable (disabled/archived mid-preview)', async () => {
    const { service } = buildService({ company: null });

    await expect(
      service.previewContext(TENANT, WORKSPACE, CLIENT, COMPANY, MEMBERSHIP),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('previewContext() fails closed when the Agency Client Area app is disabled mid-preview', async () => {
    const { service } = buildService({ settingsEnabled: false });

    await expect(
      service.previewContext(TENANT, WORKSPACE, CLIENT, COMPANY, MEMBERSHIP),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('previewContext() fails closed when the CRM identity chain is no longer eligible (revoked identity-link or archived PF)', async () => {
    const { service } = buildService({ eligible: false });

    await expect(
      service.previewContext(TENANT, WORKSPACE, CLIENT, COMPANY, MEMBERSHIP),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('previewContext() checks eligibility for the target membership user, not the Agency actor', async () => {
    const { service, eligibilityService } = buildService();

    await service.previewContext(
      TENANT,
      WORKSPACE,
      CLIENT,
      COMPANY,
      MEMBERSHIP,
    );

    expect(eligibilityService.isMembershipEligible).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT,
        userId: TARGET_USER,
        companyContextId: COMPANY,
      }),
    );
  });

  it('scopes the membership lookup to the given client/company: a membership from another company/client never resolves', async () => {
    const { service, membershipsRepo } = buildService();

    await service.previewContext(
      TENANT,
      WORKSPACE,
      CLIENT,
      COMPANY,
      MEMBERSHIP,
    );

    expect(membershipsRepo.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: MEMBERSHIP,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: CLIENT,
        companyContextId: COMPANY,
        status: 'active',
      }),
    });
  });
});
