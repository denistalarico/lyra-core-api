import { FindOperator } from 'typeorm';
import type { SocialContentPlanningStatus } from '../entities';
import {
  SocialContentProductionStatusService,
  type SocialContentCreativeStatus,
} from './social-content-production-status.service';
import type { SocialPlannerScope } from './social-planner.service';

const companyA: SocialPlannerScope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};
const companyB: SocialPlannerScope = {
  ...companyA,
  companyContextId: 'company-b',
};
const agency: SocialPlannerScope = {
  ...companyA,
  agencyClientId: null,
  companyContextId: null,
};

type Row = Record<string, unknown>;

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull') return row[key] === null;
      if (expected.type === 'in')
        return (expected.value as unknown[]).includes(row[key]);
      throw new Error(`unsupported operator ${expected.type}`);
    }
    return row[key] === expected;
  });
}

function harness(
  planningStatus: SocialContentPlanningStatus,
  overrides: { item?: Row; plan?: Row } = {},
) {
  const plan: Row = {
    id: 'plan-a',
    tenantId: companyA.tenantId,
    workspaceId: companyA.workspaceId,
    agencyClientId: companyA.agencyClientId,
    companyContextId: companyA.companyContextId,
    deletedAt: null,
    ...overrides.plan,
  };
  const item: Row = {
    id: 'content-a',
    tenantId: companyA.tenantId,
    workspaceId: companyA.workspaceId,
    agencyClientId: companyA.agencyClientId,
    planId: 'plan-a',
    planningStatus,
    updatedById: 'planner-user',
    deletedAt: null,
    ...overrides.item,
  };
  const contents = {
    findOne: jest.fn(async ({ where }: { where: Row }) =>
      matches(item, where) ? { ...item } : null,
    ),
    update: jest.fn(async (where: Row, patch: Row) => {
      if (!matches(item, where)) return { affected: 0 };
      Object.assign(item, patch);
      return { affected: 1 };
    }),
  };
  const plans = {
    exists: jest.fn(async ({ where }: { where: Row }) => matches(plan, where)),
  };
  const service = new SocialContentProductionStatusService(
    contents as unknown as never,
    plans as unknown as never,
  );
  const reflect = (
    status: SocialContentCreativeStatus,
    scope: SocialPlannerScope = companyA,
  ) =>
    service.reflectCreativeStatus(scope, {
      contentItemId: 'content-a',
      status,
      actorUserId: 'studio-user',
    });
  return { item, contents, plans, service, reflect };
}

const ALL: SocialContentPlanningStatus[] = [
  'idea',
  'planned',
  'copy_in_progress',
  'copy_ready',
  'creative_in_progress',
  'creative_ready',
  'ready',
];

/** Expected state after the reflection; equal to the input means no-op. */
const EXPECTED: Record<
  SocialContentCreativeStatus,
  Record<SocialContentPlanningStatus, SocialContentPlanningStatus>
> = {
  creative_in_progress: {
    idea: 'idea',
    planned: 'planned',
    copy_in_progress: 'copy_in_progress',
    copy_ready: 'creative_in_progress',
    creative_in_progress: 'creative_in_progress',
    creative_ready: 'creative_ready',
    ready: 'ready',
  },
  creative_ready: {
    idea: 'idea',
    planned: 'planned',
    copy_in_progress: 'copy_in_progress',
    copy_ready: 'creative_ready',
    creative_in_progress: 'creative_ready',
    creative_ready: 'creative_ready',
    ready: 'ready',
  },
};

describe('CS2B.4 SocialContentProductionStatusService', () => {
  describe.each(['creative_in_progress', 'creative_ready'] as const)(
    'reflecting %s',
    (target) => {
      it.each(ALL)('from %s follows the transition table', async (from) => {
        const h = harness(from);
        const changed = await h.reflect(target);
        const expected = EXPECTED[target][from];

        expect(h.item.planningStatus).toBe(expected);
        expect(changed).toBe(expected !== from);
        if (changed) {
          expect(h.item.updatedById).toBe('studio-user');
        } else {
          // A no-op never writes, so updated_at/updated_by stay untouched.
          expect(h.contents.update).not.toHaveBeenCalled();
          expect(h.item.updatedById).toBe('planner-user');
        }
      });
    },
  );

  it('is idempotent: a repeated reflection does not write again', async () => {
    const h = harness('copy_ready');
    await expect(h.reflect('creative_in_progress')).resolves.toBe(true);
    await expect(h.reflect('creative_in_progress')).resolves.toBe(false);
    await expect(h.reflect('creative_ready')).resolves.toBe(true);
    await expect(h.reflect('creative_ready')).resolves.toBe(false);
    expect(h.contents.update).toHaveBeenCalledTimes(2);
    expect(h.item.planningStatus).toBe('creative_ready');
  });

  it('never walks creative_ready back when a new version starts production', async () => {
    const h = harness('copy_ready');
    await h.reflect('creative_in_progress');
    await h.reflect('creative_ready');
    await h.reflect('creative_in_progress');
    expect(h.item.planningStatus).toBe('creative_ready');
  });

  it('does not touch a content item whose plan belongs to another company', async () => {
    const h = harness('copy_ready');
    await expect(h.reflect('creative_in_progress', companyB)).resolves.toBe(
      false,
    );
    expect(h.plans.exists).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'plan-a',
        companyContextId: 'company-b',
      }),
    });
    expect(h.contents.update).not.toHaveBeenCalled();
    expect(h.item.planningStatus).toBe('copy_ready');
  });

  it('does not touch a content item of another agency client or the agency scope', async () => {
    const h = harness('copy_ready');
    await expect(
      h.reflect('creative_in_progress', {
        ...companyA,
        agencyClientId: 'client-b',
      }),
    ).resolves.toBe(false);
    await expect(h.reflect('creative_in_progress', agency)).resolves.toBe(
      false,
    );
    expect(h.plans.exists).not.toHaveBeenCalled();
    expect(h.item.planningStatus).toBe('copy_ready');
  });

  it('works in agency scope with IsNull ownership', async () => {
    const h = harness('copy_ready', {
      item: { agencyClientId: null },
      plan: { agencyClientId: null, companyContextId: null },
    });
    await expect(h.reflect('creative_in_progress', agency)).resolves.toBe(true);
    const where = h.contents.findOne.mock.calls[0][0].where;
    expect((where.agencyClientId as FindOperator<unknown>).type).toBe('isNull');
  });

  it.each([
    ['soft-deleted content item', { item: { deletedAt: new Date() } }],
    ['soft-deleted plan', { plan: { deletedAt: new Date() } }],
  ])('ignores a %s', async (_label, overrides) => {
    const h = harness('copy_ready', overrides);
    await expect(h.reflect('creative_in_progress')).resolves.toBe(false);
    expect(h.item.planningStatus).toBe('copy_ready');
  });

  it('compare-and-sets on the state it read, so a concurrent operator edit wins', async () => {
    const h = harness('copy_ready');
    // The operator moves the item between the read and the write.
    h.contents.findOne.mockImplementationOnce(async () => {
      const snapshot = { ...h.item };
      h.item.planningStatus = 'ready';
      return snapshot;
    });
    await expect(h.reflect('creative_in_progress')).resolves.toBe(false);
    expect(h.item.planningStatus).toBe('ready');
    expect(h.contents.update).toHaveBeenCalledWith(
      {
        id: 'content-a',
        planningStatus: expect.any(FindOperator),
      },
      { planningStatus: 'creative_in_progress', updatedById: 'studio-user' },
    );
  });

  it("uses the caller's transaction manager when one is given", async () => {
    const h = harness('copy_ready');
    const contents = h.contents;
    const plans = h.plans;
    const fresh = new SocialContentProductionStatusService(
      { findOne: jest.fn(), update: jest.fn() } as never,
      { exists: jest.fn() } as never,
    );
    const manager = {
      getRepository: jest.fn((entity: { name: string }) =>
        entity.name === 'SocialPlanEntity' ? plans : contents,
      ),
    };

    await expect(
      fresh.reflectCreativeStatus(
        companyA,
        {
          contentItemId: 'content-a',
          status: 'creative_in_progress',
          actorUserId: 'studio-user',
        },
        manager as never,
      ),
    ).resolves.toBe(true);
    expect(manager.getRepository).toHaveBeenCalledTimes(2);
    expect(h.item.planningStatus).toBe('creative_in_progress');
  });

  describe('CS2B.6 reflectCreativeRevisionStarted', () => {
    /** Expected state after a revision starts; equal to the input = no-op. */
    const REVISION: Record<
      SocialContentPlanningStatus,
      SocialContentPlanningStatus
    > = {
      idea: 'idea',
      planned: 'planned',
      copy_in_progress: 'copy_in_progress',
      copy_ready: 'creative_in_progress',
      creative_in_progress: 'creative_in_progress',
      creative_ready: 'creative_in_progress',
      // The operator's sign-off on the whole item is never withdrawn here.
      ready: 'ready',
    };
    const revise = (
      h: ReturnType<typeof harness>,
      scope: SocialPlannerScope = companyA,
    ) =>
      h.service.reflectCreativeRevisionStarted(scope, {
        contentItemId: 'content-a',
        actorUserId: 'studio-user',
      });

    it.each(ALL)('from %s follows the revision table', async (from) => {
      const h = harness(from);
      const changed = await revise(h);
      expect(h.item.planningStatus).toBe(REVISION[from]);
      expect(changed).toBe(REVISION[from] !== from);
      if (!changed) expect(h.contents.update).not.toHaveBeenCalled();
      else expect(h.item.updatedById).toBe('studio-user');
    });

    it('closes the loop: creative_ready → revision → creative_in_progress → hand-off → creative_ready', async () => {
      const h = harness('creative_ready');
      await expect(revise(h)).resolves.toBe(true);
      await expect(revise(h)).resolves.toBe(false);
      expect(h.item.planningStatus).toBe('creative_in_progress');
      await expect(h.reflect('creative_ready')).resolves.toBe(true);
      expect(h.item.planningStatus).toBe('creative_ready');
    });

    it('the generic reflection still never regresses creative_ready', async () => {
      const h = harness('creative_ready');
      await expect(h.reflect('creative_in_progress')).resolves.toBe(false);
      expect(h.item.planningStatus).toBe('creative_ready');
    });

    it('never moves another company content', async () => {
      const h = harness('creative_ready');
      await expect(revise(h, companyB)).resolves.toBe(false);
      expect(h.contents.update).not.toHaveBeenCalled();
      expect(h.item.planningStatus).toBe('creative_ready');
    });

    it('compare-and-sets on the states the revision may leave', async () => {
      const h = harness('creative_ready');
      h.contents.findOne.mockImplementationOnce(async () => {
        const snapshot = { ...h.item };
        h.item.planningStatus = 'ready';
        return snapshot;
      });
      await expect(revise(h)).resolves.toBe(false);
      expect(h.item.planningStatus).toBe('ready');
    });
  });
});
