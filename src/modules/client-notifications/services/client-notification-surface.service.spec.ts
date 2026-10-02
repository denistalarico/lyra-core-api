import { ClientNotificationSurfaceService } from './client-notification-surface.service';

/**
 * NTF-C1 §8/§9/§21 — client recipient resolution.
 *
 * These are AP3's recipient rules, asserted in their new home. The cases are
 * carried over deliberately — active membership only, the role preset's
 * permission, CRM eligibility re-checked at call time, never a Contact — so
 * the migration is provably behaviour-preserving rather than merely
 * type-correct.
 */

const query = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  companyContextId: 'company-a',
  requiredPermission: 'client_area.approvals.view',
  requiredModule: 'approvals',
};

function membership(
  userId: string,
  role: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `membership-${userId}`,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    companyContextId: 'company-a',
    userId,
    role,
    status: 'active',
    ...overrides,
  };
}

function build({
  memberships = [] as unknown[],
  eligible = new Set<string>(),
  emails = [] as unknown[],
  modules = { approvals: true, conversations: true } as Record<string, boolean>,
}: {
  memberships?: unknown[];
  eligible?: Set<string>;
  emails?: unknown[];
  modules?: Record<string, boolean>;
} = {}) {
  const membershipsRepo = {
    find: jest.fn().mockResolvedValue(memberships),
    manager: {},
  };
  const identitiesRepo = { find: jest.fn().mockResolvedValue(emails) };
  const eligibility = {
    isMembershipEligible: jest
      .fn()
      .mockImplementation((_m: unknown, input: { userId: string }) =>
        Promise.resolve(eligible.has(input.userId)),
      ),
  };
  const management = {
    resolveCompanyModules: jest.fn().mockResolvedValue(modules),
  };

  const service = new ClientNotificationSurfaceService(
    membershipsRepo as never,
    identitiesRepo as never,
    eligibility as never,
    management as never,
  );

  return { service, membershipsRepo, identitiesRepo, eligibility, management };
}

describe('NTF-C1 client notification audience', () => {
  it('resolves active memberships whose preset grants the permission', async () => {
    const { service, membershipsRepo } = build({
      memberships: [
        membership('viewer', 'client_viewer'),
        membership('operator', 'client_operator'),
        membership('admin', 'client_admin'),
      ],
      eligible: new Set(['viewer', 'operator', 'admin']),
      emails: [
        { userId: 'viewer', currentEmail: 'v@example.com' },
        { userId: 'operator', currentEmail: 'o@example.com' },
        { userId: 'admin', currentEmail: 'a@example.com' },
      ],
    });

    const audience = await service.resolveAudience(query);

    // All three presets include approvals.view.
    expect(audience.map((item) => item.userId).sort()).toEqual([
      'admin',
      'operator',
      'viewer',
    ]);
    expect(membershipsRepo.find).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        companyContextId: 'company-a',
        status: 'active',
      },
    });
  });

  it('excludes a role whose preset lacks the required permission', async () => {
    const { service } = build({
      memberships: [membership('viewer', 'client_viewer')],
      eligible: new Set(['viewer']),
      emails: [{ userId: 'viewer', currentEmail: 'v@example.com' }],
    });

    // A viewer may comment but never decide.
    const audience = await service.resolveAudience({
      ...query,
      requiredPermission: 'client_area.approvals.decide',
    });

    expect(audience).toEqual([]);
  });

  it('excludes a membership whose CRM eligibility no longer holds', async () => {
    const { service } = build({
      memberships: [
        membership('valid', 'client_admin'),
        membership('archived-pf', 'client_admin'),
      ],
      eligible: new Set(['valid']),
      emails: [{ userId: 'valid', currentEmail: 'v@example.com' }],
    });

    const audience = await service.resolveAudience(query);

    expect(audience.map((item) => item.userId)).toEqual(['valid']);
  });

  it('excludes a revoked membership: the query only asks for active rows', async () => {
    const { service, membershipsRepo } = build({
      memberships: [],
      eligible: new Set(['revoked-user']),
    });

    expect(await service.resolveAudience(query)).toEqual([]);
    expect(membershipsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active' }),
      }),
    );
  });

  it('resolves nobody when the company module is off', async () => {
    const { service } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'm@example.com' }],
      modules: { approvals: false, conversations: true },
    });

    expect(await service.resolveAudience(query)).toEqual([]);
  });

  /** §9 — the authenticated credential, never CRM data. */
  it('takes the email from the identity, never from a Contact', async () => {
    const { service, identitiesRepo } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
    });

    const audience = await service.resolveAudience(query);

    expect(audience[0].email).toBe('member@example.com');
    expect(identitiesRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', userId: expect.anything() },
    });
  });

  /**
   * A recipient with no address is still a recipient: in-app and realtime do
   * not depend on email, so the surface reports them with a null address and
   * the core simply creates no email delivery.
   */
  it('keeps a recipient who has no email on file, with a null address', async () => {
    const { service } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [],
    });

    const audience = await service.resolveAudience(query);

    expect(audience).toHaveLength(1);
    expect(audience[0].email).toBeNull();
  });

  it('reports the membership as evidence, never as the actor', async () => {
    const { service } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'm@example.com' }],
    });

    const audience = await service.resolveAudience(query);

    expect(audience[0]).toMatchObject({
      userId: 'member',
      membershipId: 'membership-member',
      companyContextId: 'company-a',
    });
  });

  describe('revalidate (§21)', () => {
    it('returns the recipient while access holds', async () => {
      const { service } = build({
        memberships: [membership('member', 'client_admin')],
        eligible: new Set(['member']),
        emails: [{ userId: 'member', currentEmail: 'm@example.com' }],
      });

      const recipient = await service.revalidate({
        ...query,
        userId: 'member',
      });

      expect(recipient?.userId).toBe('member');
    });

    it('fails closed when the membership was revoked', async () => {
      const { service } = build({ memberships: [], eligible: new Set() });

      expect(
        await service.revalidate({ ...query, userId: 'member' }),
      ).toBeNull();
    });

    it('fails closed when CRM eligibility broke', async () => {
      const { service } = build({
        memberships: [membership('member', 'client_admin')],
        eligible: new Set(),
      });

      expect(
        await service.revalidate({ ...query, userId: 'member' }),
      ).toBeNull();
    });

    it('never answers for a different user', async () => {
      const { service } = build({
        memberships: [membership('other', 'client_admin')],
        eligible: new Set(['other']),
        emails: [{ userId: 'other', currentEmail: 'o@example.com' }],
      });

      expect(
        await service.revalidate({ ...query, userId: 'member' }),
      ).toBeNull();
    });
  });
});
