/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { LeadFlowAutomationEntity } from '../../leadflow-automations/entities';
import { LeadFlowAutomationStatus } from '../../leadflow-automations/enums/leadflow-automation-status.enum';
import {
  LeadFlowIntelligenceConfigVersionEntity,
  LeadFlowIntelligenceDecisionEntity,
  LeadFlowIntelligenceRecommendationEntity,
} from '../entities';
import { LeadFlowIntelligenceService } from './leadflow-intelligence.service';

const ctx = {
  tenantId: '2bc8a189-a03c-4020-97a1-8f68ce10bdf3',
  workspaceId: '1e278ed5-53ce-49b9-a8aa-c73ca93149a4',
  userId: 'c143ef9e-3c45-4dde-a245-39f09ca41d78',
  role: 'admin',
};

function recommendation() {
  const now = new Date('2026-07-30T12:00:00.000Z');
  return {
    id: '200348d4-a4d4-46be-aa7c-7383cf279484',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    contextType: 'agency',
    agencyClientId: null,
    businessModeKey: 'services',
    generationKey: 'generation',
    kind: 'pause_automation_high_failure_rate',
    status: 'pending',
    targetType: 'automation',
    targetId: '29a2671e-4831-4fea-b442-7003937362bc',
    targetLabel: 'Follow-up comercial',
    title: 'Pausar Follow-up comercial',
    rationale: 'Falhas recorrentes.',
    periodFrom: now,
    periodTo: now,
    segment: {},
    evidence: [],
    confidence: 0.8,
    expectedImpact: {},
    currentConfig: { status: 'active' },
    proposedConfig: { status: 'paused' },
    baseline: {
      terminalLiveRuns: 10,
      succeededRuns: 6,
      failedRuns: 4,
      failureRate: 0.4,
    },
    snoozedUntil: null,
    appliedAt: null,
    measurementDueAt: null,
    rolledBackAt: null,
    appliedVersionId: null,
    rollbackVersionId: null,
    latestResultId: null,
    createdAt: now,
    updatedAt: now,
  } as LeadFlowIntelligenceRecommendationEntity;
}

function buildService(options?: {
  automationRows?: unknown[];
  recommendation?: LeadFlowIntelligenceRecommendationEntity;
}) {
  const savedDecisions: LeadFlowIntelligenceDecisionEntity[] = [];
  const savedVersions: LeadFlowIntelligenceConfigVersionEntity[] = [];
  const recommendationEntity = options?.recommendation;
  const recommendations = {
    find: jest.fn(async () =>
      recommendationEntity ? [recommendationEntity] : [],
    ),
    findOne: jest.fn(async () => recommendationEntity ?? null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const decisions = {
    find: jest.fn(async () => savedDecisions),
  };
  const versions = {
    find: jest.fn(async () => savedVersions),
  };
  const results = {
    find: jest.fn(async () => []),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const automation = {
    id: recommendationEntity?.targetId,
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    contextType: 'agency',
    agencyClientId: null,
    status: LeadFlowAutomationStatus.Active,
    updatedById: null,
  } as LeadFlowAutomationEntity;
  const automations = {
    query: jest.fn(async () => options?.automationRows ?? []),
  };
  const versionRepository = {
    findOne: jest.fn(async () => null),
  };
  const manager = {
    findOne: jest.fn(async (entity) => {
      if (entity === LeadFlowIntelligenceRecommendationEntity)
        return recommendationEntity ?? null;
      if (entity === LeadFlowAutomationEntity) return automation;
      return null;
    }),
    getRepository: jest.fn(() => versionRepository),
    create: jest.fn((entity, value) => {
      if (entity === LeadFlowIntelligenceConfigVersionEntity) {
        const created = {
          ...value,
          id: '9b46b69d-03f3-494a-85db-af03dd1ad575',
          createdAt: new Date(),
        } as LeadFlowIntelligenceConfigVersionEntity;
        savedVersions.push(created);
        return created;
      }
      const created = {
        ...value,
        id: 'a86a5964-cb44-43d1-b7e7-13559d4d048d',
        createdAt: new Date(),
      } as LeadFlowIntelligenceDecisionEntity;
      savedDecisions.push(created);
      return created;
    }),
    save: jest.fn(async (value) => value),
  };
  const dataSource = {
    transaction: jest.fn(async (callback) => callback(manager)),
  };
  const permissions = {
    assertCan: jest.fn(async () => undefined),
  };
  const service = new LeadFlowIntelligenceService(
    recommendations as never,
    decisions as never,
    versions as never,
    results as never,
    automations as never,
    dataSource as never,
    permissions as never,
  );
  return {
    service,
    recommendations,
    automations,
    automation,
    dataSource,
    permissions,
  };
}

describe('LeadFlowIntelligenceService', () => {
  it('generates an evidenced proposal without mutating its automation target', async () => {
    const sample = {
      automationId: '29a2671e-4831-4fea-b442-7003937362bc',
      automationName: 'Follow-up comercial',
      recipeKey: 'followup_idle_lead',
      businessModeKey: 'services',
      succeededRuns: '6',
      failedRuns: '4',
    };
    const { service, recommendations, dataSource } = buildService({
      automationRows: [sample],
    });

    const response = await service.generate(ctx, {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-30T00:00:00.000Z',
    });

    expect(response.generatedCount).toBe(1);
    expect(recommendations.save).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: sample.automationId,
        status: 'pending',
        currentConfig: { status: 'active' },
        proposedConfig: { status: 'paused' },
      }),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('mutates the runtime only after explicit approval and records a version', async () => {
    const item = recommendation();
    const { service, automation, dataSource, permissions } = buildService({
      recommendation: item,
    });

    const response = await service.decide(ctx, item.id, {
      action: 'approve',
    });

    expect(permissions.assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ctx.userId }),
      'leadflow.automations.automation.pause.admin',
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(automation.status).toBe(LeadFlowAutomationStatus.Paused);
    expect(item.status).toBe('applied');
    expect(response.versions).toEqual([
      expect.objectContaining({
        version: 1,
        previousConfig: { status: 'active' },
        config: { status: 'paused' },
      }),
    ]);
    expect(response.decisions).toEqual([
      expect.objectContaining({ action: 'approve' }),
    ]);
  });
});
