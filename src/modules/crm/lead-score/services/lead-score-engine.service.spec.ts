import type { DataSource } from 'typeorm';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { InboxDomainOutboxEntity } from '../../../inbox/entities/inbox-domain-outbox.entity';
import { CrmOpportunityEntity } from '../../entities/crm-opportunity.entity';
import { CrmLeadScoreSnapshotEntity } from '../entities/crm-lead-score-snapshot.entity';
import { CrmLeadScoreStateEntity } from '../entities/crm-lead-score-state.entity';
import { LEAD_SCORE_POLICY_V1 } from '../policy/lead-score-rules-v1.policy';
import {
  LeadScoreFeatureKey,
  type LeadScoreFeatureSet,
} from '../lead-score.types';
import type { LeadScoreFeatureLoaderService } from './lead-score-feature-loader.service';
import {
  LEAD_SCORE_CHANGED_EVENT,
  LEAD_SCORE_HOT_LEAD_EVENT,
  LeadScoreEngineService,
} from './lead-score-engine.service';

const ctx = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
} as RequestContext;

const OTHER_SCOPE = {
  tenantId: 'tenant-2',
  workspaceId: 'workspace-2',
} as RequestContext;

function opportunity(): CrmOpportunityEntity {
  return {
    id: 'opportunity-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    stageId: 'stage-1',
    status: 'open',
    businessMode: 'real_estate',
    inboxConversationId: 'conversation-1',
    businessContext: {},
    rowVersion: 4,
  } as CrmOpportunityEntity;
}

/**
 * Minimal in-memory store standing in for the agency datasource.
 *
 * Everything the engine writes lands in one place, so a test can assert that a
 * snapshot, a projection and an outbox row were produced by the same call.
 */
function buildHarness(
  features: LeadScoreFeatureSet,
  policy = LEAD_SCORE_POLICY_V1,
) {
  const tables = {
    opportunities: [opportunity()],
    snapshots: [] as CrmLeadScoreSnapshotEntity[],
    states: [] as CrmLeadScoreStateEntity[],
    outbox: [] as InboxDomainOutboxEntity[],
  };
  let nextId = 1;

  const repoFor = (entity: unknown) => {
    const rows =
      entity === CrmLeadScoreSnapshotEntity
        ? tables.snapshots
        : entity === CrmLeadScoreStateEntity
          ? tables.states
          : entity === InboxDomainOutboxEntity
            ? tables.outbox
            : tables.opportunities;

    const matches = (row: Record<string, unknown>, where: unknown) =>
      Object.entries((where ?? {}) as Record<string, unknown>).every(
        ([key, expected]) => row[key] === expected,
      );

    return {
      findOne: ({ where }: { where?: unknown }) =>
        Promise.resolve(
          (rows as unknown as Record<string, unknown>[]).find((row) =>
            matches(row, where),
          ) ?? null,
        ),
      create: (input: Record<string, unknown>) => ({ ...input }),
      save: (input: Record<string, unknown>) => {
        const saved = { id: `id-${nextId++}`, ...input };
        (rows as unknown as Record<string, unknown>[]).push(saved);
        return Promise.resolve(saved);
      },
      update: (
        where: Record<string, unknown>,
        patch: Record<string, unknown>,
      ) => {
        const row = (rows as unknown as Record<string, unknown>[]).find(
          (item) => matches(item, where),
        );
        if (row) Object.assign(row, patch);
        return Promise.resolve({ affected: row ? 1 : 0 });
      },
    };
  };

  const manager = {
    getRepository: repoFor,
    query: jest.fn().mockResolvedValue([]),
  };

  const dataSource = {
    transaction: (runner: (m: typeof manager) => Promise<unknown>) =>
      runner(manager),
  } as unknown as DataSource;

  const load = jest
    .fn()
    .mockResolvedValue({ features, queryCount: 2, durationMs: 3 });
  const loader = { load } as unknown as LeadScoreFeatureLoaderService;

  const service = new LeadScoreEngineService(
    dataSource,
    { getActivePolicy: () => Promise.resolve(policy) },
    loader,
  );

  return { service, tables, manager, load };
}

function features(overrides: LeadScoreFeatureSet = {}): LeadScoreFeatureSet {
  const at = new Date('2026-07-23T12:00:00Z').toISOString();
  const v = (value: number | boolean | string) =>
    ({ available: true, value, observedAt: at }) as const;
  return {
    [LeadScoreFeatureKey.OriginatedFromChannel]: v(true),
    [LeadScoreFeatureKey.ConversationLinked]: v(true),
    [LeadScoreFeatureKey.InboundMessageCount]: v(3),
    [LeadScoreFeatureKey.EssentialFieldsTotal]: v(2),
    [LeadScoreFeatureKey.EssentialFieldsPresent]: v(2),
    [LeadScoreFeatureKey.LifecycleStatus]: v('open'),
    [LeadScoreFeatureKey.StageIsLost]: v(false),
    ...overrides,
  };
}

describe('LeadScoreEngineService', () => {
  it('writes the snapshot, the projection and the event in one transaction', () => {
    const { service, tables, manager } = buildHarness(features());

    return service
      .recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_created',
        sourceEventId: 'event-1',
      })
      .then(() => {
        expect(tables.snapshots).toHaveLength(1);
        expect(tables.states).toHaveLength(1);
        expect(tables.outbox).toHaveLength(1);
        // One runner call means one transaction covered all three writes.
        expect(manager.query).toHaveBeenCalledTimes(1);
      });
  });

  it('takes an advisory lock scoped to the opportunity', async () => {
    const { service, manager } = buildHarness(features());

    await service.recalculate(ctx, {
      opportunityId: 'opportunity-1',
      reason: 'stage_changed',
      sourceEventId: 'event-1',
    });

    const call = manager.query.mock.calls[0] as [string, string[]];
    expect(call[0]).toContain('pg_advisory_xact_lock');
    expect(call[1][0]).toBe('tenant-1:workspace-1:opportunity-1:lead_score');
  });

  it('does not find an opportunity from another scope', async () => {
    const { service } = buildHarness(features());

    await expect(
      service.recalculate(OTHER_SCOPE, {
        opportunityId: 'opportunity-1',
        reason: 'manual_recalculation',
      }),
    ).rejects.toThrow('Opportunity not found in this scope.');
  });

  describe('replay', () => {
    it('does not write a second snapshot for the same source event', async () => {
      const { service, tables } = buildHarness(features());
      const input = {
        opportunityId: 'opportunity-1',
        reason: 'inbound_message' as const,
        sourceEventId: 'event-1',
      };

      await service.recalculate(ctx, input);
      const replayed = await service.recalculate(ctx, input);

      expect(tables.snapshots).toHaveLength(1);
      expect(replayed.replayed).toBe(true);
      expect(replayed.changed).toBe(false);
    });

    it('does not announce the same event twice on replay', async () => {
      const { service, tables } = buildHarness(features());
      const input = {
        opportunityId: 'opportunity-1',
        reason: 'inbound_message' as const,
        sourceEventId: 'event-1',
      };

      await service.recalculate(ctx, input);
      await service.recalculate(ctx, input);

      expect(tables.outbox).toHaveLength(1);
    });

    it('lets an operator ask twice and get two answers', async () => {
      // A manual recalculation carries no source event: asking again is a new
      // question, not a redelivery.
      const { service, tables } = buildHarness(features());

      await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'manual_recalculation',
      });
      await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'manual_recalculation',
      });

      expect(tables.snapshots).toHaveLength(2);
    });
  });

  describe('score.changed', () => {
    it('is emitted when the score moves', async () => {
      const { service, tables } = buildHarness(features());

      await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_created',
        sourceEventId: 'event-1',
      });

      expect(tables.outbox[0].eventName).toBe(LEAD_SCORE_CHANGED_EVENT);
      expect(tables.outbox[0].aggregateType).toBe('crm_opportunity');
      expect(tables.outbox[0].aggregateId).toBe('opportunity-1');
    });

    it('is not emitted when a recalculation changes nothing', async () => {
      const { service, tables } = buildHarness(features());

      await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_created',
        sourceEventId: 'event-1',
      });
      await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_updated',
        sourceEventId: 'event-2',
      });

      expect(tables.snapshots).toHaveLength(2);
      expect(tables.outbox).toHaveLength(1);
    });

    it('carries both sides of the change', async () => {
      const { service, tables } = buildHarness(features());

      await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_created',
        sourceEventId: 'event-1',
      });

      const payload = tables.outbox[0].payload;
      expect(payload.previousScore).toBeNull();
      expect(payload.currentScore).toBe(45);
      expect(payload.currentBand).toBe('warm');
      expect(payload.maxAchievable).toBe(45);
    });
  });

  describe('hot lead', () => {
    /** A policy whose single active rule can carry a lead over the threshold. */
    const hotHarness = (score: number) =>
      buildHarness(features(), {
        ...LEAD_SCORE_POLICY_V1,
        rules: [
          { ...LEAD_SCORE_POLICY_V1.rules[0], points: score },
          LEAD_SCORE_POLICY_V1.rules[LEAD_SCORE_POLICY_V1.rules.length - 1],
        ],
      });

    it('is announced only when the threshold is crossed', async () => {
      const { service, tables } = hotHarness(80);

      const result = await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_created',
        sourceEventId: 'event-1',
      });

      expect(result.hotLeadDetected).toBe(true);
      expect(
        tables.outbox.some(
          (row) => row.eventName === LEAD_SCORE_HOT_LEAD_EVENT,
        ),
      ).toBe(true);
    });

    it('is not repeated while the lead stays hot', async () => {
      const { service, tables } = hotHarness(80);

      await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_created',
        sourceEventId: 'event-1',
      });
      const second = await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_updated',
        sourceEventId: 'event-2',
      });

      expect(second.hotLeadDetected).toBe(false);
      expect(
        tables.outbox.filter(
          (row) => row.eventName === LEAD_SCORE_HOT_LEAD_EVENT,
        ),
      ).toHaveLength(1);
    });

    it('is not announced below the threshold', async () => {
      const { service, tables } = hotHarness(69);

      const result = await service.recalculate(ctx, {
        opportunityId: 'opportunity-1',
        reason: 'opportunity_created',
        sourceEventId: 'event-1',
      });

      expect(result.hotLeadDetected).toBe(false);
      expect(
        tables.outbox.some(
          (row) => row.eventName === LEAD_SCORE_HOT_LEAD_EVENT,
        ),
      ).toBe(false);
    });
  });

  it('swallows a failure when scoring follows a command that already succeeded', async () => {
    const { service } = buildHarness(features());

    await expect(
      service.recalculateQuietly(ctx, {
        opportunityId: 'missing-opportunity',
        reason: 'stage_changed',
      }),
    ).resolves.toBeUndefined();
  });
});
