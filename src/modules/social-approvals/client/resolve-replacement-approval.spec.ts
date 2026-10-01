import { resolveReplacementApproval } from './resolve-replacement-approval';
import type { SocialApprovalRequestEntity } from '../entities';

/**
 * AP4 §32 — replacement resolution security matrix (unit level; the
 * end-to-end cross-company cases live in
 * `client-approvals.security-matrix.postgres.spec.ts`).
 */

const scopeA = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};

function approval(
  overrides: Partial<SocialApprovalRequestEntity> = {},
): SocialApprovalRequestEntity {
  return {
    id: 'approval-1',
    tenantId: scopeA.tenantId,
    workspaceId: scopeA.workspaceId,
    agencyClientId: scopeA.agencyClientId,
    companyContextId: scopeA.companyContextId,
    subjectType: 'planner_content_revision',
    subjectId: 'item-1',
    subjectRevisionId: 'revision-1',
    status: 'superseded',
    sentToClientAt: new Date('2026-01-01T10:00:00.000Z'),
    createdAt: new Date('2026-01-01T09:00:00.000Z'),
    ...overrides,
  } as SocialApprovalRequestEntity;
}

describe('resolveReplacementApproval', () => {
  it('returns the later client-visible revision of the same root/scope', async () => {
    const rev2 = approval({
      id: 'approval-2',
      subjectRevisionId: 'revision-2',
      createdAt: new Date('2026-01-02T09:00:00.000Z'),
      sentToClientAt: new Date('2026-01-02T10:00:00.000Z'),
    });
    const findOne = jest.fn().mockResolvedValue(rev2);
    const result = await resolveReplacementApproval(
      { findOne },
      scopeA,
      approval(),
    );
    expect(result).toBe(rev2);
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: scopeA.tenantId,
          workspaceId: scopeA.workspaceId,
          agencyClientId: scopeA.agencyClientId,
          companyContextId: scopeA.companyContextId,
          subjectType: 'planner_content_revision',
          subjectId: 'item-1',
        }),
      }),
    );
  });

  it('returns null when no row for the root exists', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const result = await resolveReplacementApproval(
      { findOne },
      scopeA,
      approval(),
    );
    expect(result).toBeNull();
  });

  it('never returns the same revision as the superseded approval (unrelated row from same root with same revision)', async () => {
    const same = approval({ id: 'approval-1' });
    const findOne = jest.fn().mockResolvedValue(same);
    const result = await resolveReplacementApproval(
      { findOne },
      scopeA,
      approval(),
    );
    expect(result).toBeNull();
  });

  it('never returns a row created before or at the same time as the superseded approval (prevents pointing backwards)', async () => {
    const earlier = approval({
      id: 'approval-0',
      subjectRevisionId: 'revision-0',
      createdAt: new Date('2025-12-31T09:00:00.000Z'),
    });
    const findOne = jest.fn().mockResolvedValue(earlier);
    const result = await resolveReplacementApproval(
      { findOne },
      scopeA,
      approval(),
    );
    expect(result).toBeNull();
  });

  it('only queries sent_to_client_at IS NOT NULL rows, so an internal-only or never-sent replacement is not offered (§20)', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    await resolveReplacementApproval({ findOne }, scopeA, approval());
    const call = findOne.mock.calls[0][0];
    expect(call.where.sentToClientAt).toBeDefined();
  });

  it('collapses a rev1->rev2->rev3 chain to the latest eligible row in one query (§21)', async () => {
    const rev3 = approval({
      id: 'approval-3',
      subjectRevisionId: 'revision-3',
      createdAt: new Date('2026-01-03T09:00:00.000Z'),
      sentToClientAt: new Date('2026-01-03T10:00:00.000Z'),
    });
    // ORDER BY createdAt DESC means the query itself returns the tail of the
    // chain; the helper does not need to recurse to get there, so no loop is
    // reachable regardless of chain length.
    const findOne = jest.fn().mockResolvedValue(rev3);
    const result = await resolveReplacementApproval(
      { findOne },
      scopeA,
      approval({ id: 'approval-1', subjectRevisionId: 'revision-1' }),
    );
    expect(result).toBe(rev3);
    expect(findOne.mock.calls).toHaveLength(1);
  });

  it('scopes strictly: a different companyContextId in the same tenant/agencyClient is a different scope tuple entirely (cross-company safety is enforced by the caller always passing the approval\'s own scope)', async () => {
    // This test documents the contract rather than exercising cross-tenant
    // DB rows (covered by the postgres security matrix): the where clause
    // always binds to the exact scope passed in, never a wider one.
    const findOne = jest.fn().mockResolvedValue(null);
    await resolveReplacementApproval(
      { findOne },
      { ...scopeA, companyContextId: 'company-b' },
      approval(),
    );
    const call = findOne.mock.calls[0][0];
    expect(call.where.companyContextId).toBe('company-b');
  });
});
