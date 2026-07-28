import type { DataSource, EntityManager, Repository } from 'typeorm';
import type {
  AdminIdentityGateway,
  AdminIdentityRecord,
} from '../contracts/admin-identity.gateway';
import {
  PlatformAdminAuditEventEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import type { PlatformAdminRoleKey } from '../types/admin-access.types';
import {
  AdminBootstrapService,
  PlatformAdminBootstrapError,
} from './admin-bootstrap.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

function identity(
  overrides: Partial<AdminIdentityRecord> = {},
): AdminIdentityRecord {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    email: 'owner@example.com',
    displayName: 'Agency Owner',
    status: 'active',
    passwordConfigured: true,
    twoFactorEnabled: true,
    twoFactorMethod: 'authenticator',
    ...overrides,
  };
}

function admin(
  overrides: Partial<PlatformInternalAdminEntity> = {},
): PlatformInternalAdminEntity {
  return {
    id: ADMIN_ID,
    identityTenantId: TENANT_ID,
    userId: USER_ID,
    status: 'active',
    roleKey: 'super_admin',
    twoFactorRequired: true,
    locale: 'en-US',
    theme: 'dark',
    timezone: 'Europe/Lisbon',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
    lastAdminLoginAt: new Date('2026-07-01T12:00:00.000Z'),
    createdBy: null,
    updatedBy: null,
    metadata: { team: 'platform', source: 'manual' },
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    updatedAt: new Date('2026-06-01T12:00:00.000Z'),
    ...overrides,
  };
}

type HarnessOptions = {
  candidates?: AdminIdentityRecord[];
  existingAdmin?: PlatformInternalAdminEntity | null;
  failAuditSave?: boolean;
};

function cloneAdmin(
  value: PlatformInternalAdminEntity | null,
): PlatformInternalAdminEntity | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    metadata: { ...value.metadata },
    lastAdminLoginAt: value.lastAdminLoginAt
      ? new Date(value.lastAdminLoginAt)
      : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

function createHarness(options: HarnessOptions = {}) {
  const state: {
    admin: PlatformInternalAdminEntity | null;
    audits: PlatformAdminAuditEventEntity[];
  } = {
    admin: cloneAdmin(options.existingAdmin ?? null),
    audits: [],
  };

  const adminRepository = {
    findOne: jest.fn(() => Promise.resolve(state.admin)),
    create: jest.fn(
      (
        value: Partial<PlatformInternalAdminEntity>,
      ): PlatformInternalAdminEntity =>
        ({
          id: ADMIN_ID,
          createdAt: new Date('2026-07-28T12:00:00.000Z'),
          updatedAt: new Date('2026-07-28T12:00:00.000Z'),
          ...value,
        }) as PlatformInternalAdminEntity,
    ),
    save: jest.fn(
      (
        value: PlatformInternalAdminEntity,
      ): Promise<PlatformInternalAdminEntity> => {
        state.admin = value;
        return Promise.resolve(value);
      },
    ),
  };
  const auditRepository = {
    create: jest.fn(
      (
        value: Partial<PlatformAdminAuditEventEntity>,
      ): PlatformAdminAuditEventEntity =>
        value as PlatformAdminAuditEventEntity,
    ),
    save: jest.fn(
      (
        value: PlatformAdminAuditEventEntity,
      ): Promise<PlatformAdminAuditEventEntity> => {
        if (options.failAuditSave) {
          return Promise.reject(
            new Error('audit_write_failed_with_private_context'),
          );
        }
        state.audits.push(value);
        return Promise.resolve(value);
      },
    ),
  };
  const manager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === PlatformInternalAdminEntity) {
        return adminRepository;
      }
      if (entity === PlatformAdminAuditEventEntity) {
        return auditRepository;
      }
      throw new Error('unexpected_repository');
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(
      async <T>(
        operation: (transactionManager: EntityManager) => Promise<T>,
      ): Promise<T> => {
        const adminSnapshot = cloneAdmin(state.admin);
        const auditCount = state.audits.length;
        try {
          return await operation(manager);
        } catch (error) {
          state.admin = adminSnapshot;
          state.audits.splice(auditCount);
          throw error;
        }
      },
    ),
  } as unknown as DataSource;
  const gateway = {
    findCandidatesByEmail: jest
      .fn()
      .mockResolvedValue(options.candidates ?? [identity()]),
  } as unknown as AdminIdentityGateway;
  const service = new AdminBootstrapService(dataSource, gateway);

  return {
    service,
    state,
    gateway,
    adminRepository:
      adminRepository as unknown as Repository<PlatformInternalAdminEntity>,
    auditRepository,
    manager,
  };
}

function bootstrap(
  service: AdminBootstrapService,
  overrides: {
    requestedRole?: PlatformAdminRoleKey;
    allowRoleChange?: boolean;
  } = {},
) {
  return service.bootstrap({
    email: ' OWNER@Example.com ',
    requestedRole: overrides.requestedRole ?? 'super_admin',
    allowRoleChange: overrides.allowRoleChange ?? false,
  });
}

describe('AdminBootstrapService', () => {
  it('fails safely when no active Agency identity exists', async () => {
    const harness = createHarness({ candidates: [] });

    await expect(bootstrap(harness.service)).rejects.toMatchObject({
      code: 'platform_admin_identity_not_found',
    } satisfies Partial<PlatformAdminBootstrapError>);
    expect(harness.state.admin).toBeNull();
    expect(harness.state.audits).toEqual([
      expect.objectContaining({
        action: 'admin.bootstrap.denied',
        actorUserId: null,
        outcome: 'denied',
      }),
    ]);
  });

  it('fails safely when the e-mail resolves to ambiguous identities', async () => {
    const harness = createHarness({
      candidates: [identity(), identity({ userId: 'another-user-id' })],
    });

    await expect(bootstrap(harness.service)).rejects.toMatchObject({
      code: 'platform_admin_identity_ambiguous',
    } satisfies Partial<PlatformAdminBootstrapError>);
    expect(harness.state.admin).toBeNull();
  });

  it('creates the administrative link with secure defaults when absent', async () => {
    const harness = createHarness();

    await expect(bootstrap(harness.service)).resolves.toMatchObject({
      result: 'created',
      roleKey: 'super_admin',
      status: 'active',
      twoFactorRequired: true,
    });
    expect(harness.state.admin).toMatchObject({
      identityTenantId: TENANT_ID,
      userId: USER_ID,
      status: 'active',
      roleKey: 'super_admin',
      twoFactorRequired: true,
      locale: 'pt-BR',
      theme: 'system',
      timezone: 'America/Sao_Paulo',
      metadata: { source: 'bootstrap_cli' },
    });
  });

  it('returns unchanged on the second equivalent execution', async () => {
    const harness = createHarness();

    await bootstrap(harness.service);
    await expect(bootstrap(harness.service)).resolves.toMatchObject({
      result: 'unchanged',
    });
    expect(harness.auditRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'admin.bootstrap.unchanged' }),
    );
  });

  it('reactivates a suspended administrative link', async () => {
    const harness = createHarness({
      existingAdmin: admin({ status: 'suspended' }),
    });

    await expect(bootstrap(harness.service)).resolves.toMatchObject({
      result: 'updated',
      status: 'active',
    });
    expect(harness.state.admin?.status).toBe('active');
  });

  it('forces twoFactorRequired without activating identity 2FA', async () => {
    const harness = createHarness({
      candidates: [identity({ twoFactorEnabled: false })],
      existingAdmin: admin({ twoFactorRequired: false }),
    });

    await expect(bootstrap(harness.service)).resolves.toMatchObject({
      result: 'updated',
      twoFactorRequired: true,
      identityTwoFactorEnabled: false,
    });
    expect(harness.state.admin?.twoFactorRequired).toBe(true);
  });

  it('preserves existing locale, theme, timezone and last login', async () => {
    const existing = admin({ status: 'suspended' });
    const harness = createHarness({ existingAdmin: existing });

    await bootstrap(harness.service);

    expect(harness.state.admin).toMatchObject({
      locale: 'en-US',
      theme: 'dark',
      timezone: 'Europe/Lisbon',
      lastAdminLoginAt: existing.lastAdminLoginAt,
      createdAt: existing.createdAt,
    });
  });

  it('preserves existing functional metadata', async () => {
    const harness = createHarness({
      existingAdmin: admin({
        status: 'suspended',
        metadata: { team: 'platform', approvals: ['security'] },
      }),
    });

    await bootstrap(harness.service);

    expect(harness.state.admin?.metadata).toEqual({
      team: 'platform',
      approvals: ['security'],
    });
  });

  it('does not downgrade a super admin without the explicit flag', async () => {
    const harness = createHarness({ existingAdmin: admin() });

    await expect(
      bootstrap(harness.service, { requestedRole: 'admin' }),
    ).resolves.toMatchObject({
      result: 'unchanged',
      roleKey: 'super_admin',
      roleChangeDenied: true,
    });
    expect(harness.state.admin?.roleKey).toBe('super_admin');
    expect(harness.state.audits).toEqual([
      expect.objectContaining({
        action: 'admin.bootstrap.denied',
        outcome: 'denied',
      }),
    ]);
  });

  it('allows a role downgrade with the explicit flag', async () => {
    const harness = createHarness({ existingAdmin: admin() });

    await expect(
      bootstrap(harness.service, {
        requestedRole: 'admin',
        allowRoleChange: true,
      }),
    ).resolves.toMatchObject({
      result: 'updated',
      roleKey: 'admin',
      roleChangeDenied: false,
    });
    expect(harness.state.admin?.roleKey).toBe('admin');
  });

  it('creates a successful bootstrap audit in the same transaction', async () => {
    const harness = createHarness();

    await bootstrap(harness.service);

    expect(harness.state.audits).toEqual([
      expect.objectContaining({
        actorAdminId: null,
        actorUserId: USER_ID,
        action: 'admin.bootstrap.created',
        outcome: 'success',
        metadata: {
          source: 'bootstrap_cli',
          requestedRole: 'super_admin',
          effectiveRole: 'super_admin',
          result: 'created',
          twoFactorEnabled: true,
        },
      }),
    ]);
  });

  it('rolls back a newly created link when its audit cannot be persisted', async () => {
    const harness = createHarness({ failAuditSave: true });

    await expect(bootstrap(harness.service)).rejects.toMatchObject({
      code: 'platform_admin_bootstrap_failed',
    } satisfies Partial<PlatformAdminBootstrapError>);
    expect(harness.state.admin).toBeNull();
    expect(harness.state.audits).toHaveLength(0);
  });

  it('keeps full e-mail and unexpected credential material out of result and audit', async () => {
    const credentialBearingIdentity = {
      ...identity(),
      passwordHash: '$argon2id$private',
      twoFactorSecretEncrypted: 'private-secret',
      token: 'Bearer private-token',
    } as AdminIdentityRecord;
    const harness = createHarness({
      candidates: [credentialBearingIdentity],
    });

    const result = await bootstrap(harness.service);
    const externallyVisible = JSON.stringify({
      result,
      audits: harness.state.audits,
    });

    expect(result.maskedEmail).toBe('o***@example.com');
    expect(externallyVisible).not.toContain('owner@example.com');
    expect(externallyVisible).not.toContain('$argon2id$private');
    expect(externallyVisible).not.toContain('private-secret');
    expect(externallyVisible).not.toContain('private-token');
  });
});
