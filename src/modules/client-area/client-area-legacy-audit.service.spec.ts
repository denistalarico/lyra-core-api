import { ClientAreaLegacyAuditService } from './services/client-area-legacy-audit.service';

/**
 * CA4.1 — the audit is read-only and recomputes live; no persisted
 * classification exists anywhere. This spec locks the three-way outcome
 * (valid / no_identity_contact / no_company_link) against the single query.
 */
describe('CA4.1 ClientAreaLegacyAuditService.classifyMemberships', () => {
  const TENANT = 'tenant-1';
  const WORKSPACE = 'workspace-1';

  function buildService(
    rows: Array<{
      membership_id: string;
      user_id: string;
      company_context_id: string;
      has_identity_contact: boolean;
      has_company_link: boolean;
    }>,
  ) {
    const query = jest.fn().mockResolvedValue(rows);
    const db = { query };
    const service = new ClientAreaLegacyAuditService(db as never);
    return { service, query };
  }

  it('counts a membership with an active identity-contact and an active company link as valid', async () => {
    const { service } = buildService([
      {
        membership_id: 'm1',
        user_id: 'u1',
        company_context_id: 'c1',
        has_identity_contact: true,
        has_company_link: true,
      },
    ]);

    const report = await service.classifyMemberships(TENANT, WORKSPACE);

    expect(report).toEqual({
      total: 1,
      valid: 1,
      legacyUnlinked: 0,
      sample: [],
    });
  });

  it('classifies a membership with no identity-contact at all as no_identity_contact', async () => {
    const { service } = buildService([
      {
        membership_id: 'm2',
        user_id: 'u2',
        company_context_id: 'c1',
        has_identity_contact: false,
        has_company_link: false,
      },
    ]);

    const report = await service.classifyMemberships(TENANT, WORKSPACE);

    expect(report).toEqual({
      total: 1,
      valid: 0,
      legacyUnlinked: 1,
      sample: [
        {
          membershipId: 'm2',
          userId: 'u2',
          companyContextId: 'c1',
          reason: 'no_identity_contact',
        },
      ],
    });
  });

  it('classifies a membership with an identity-contact but no matching active company link as no_company_link', async () => {
    const { service } = buildService([
      {
        membership_id: 'm3',
        user_id: 'u3',
        company_context_id: 'c1',
        has_identity_contact: true,
        has_company_link: false,
      },
    ]);

    const report = await service.classifyMemberships(TENANT, WORKSPACE);

    expect(report).toEqual({
      total: 1,
      valid: 0,
      legacyUnlinked: 1,
      sample: [
        {
          membershipId: 'm3',
          userId: 'u3',
          companyContextId: 'c1',
          reason: 'no_company_link',
        },
      ],
    });
  });

  it('scopes the query to the given tenant/workspace and active memberships only (asserted via SQL params)', async () => {
    const { service, query } = buildService([]);

    await service.classifyMemberships(TENANT, WORKSPACE);

    expect(query).toHaveBeenCalledWith(expect.any(String), [TENANT, WORKSPACE]);
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("m.status = 'active'");
  });
});
