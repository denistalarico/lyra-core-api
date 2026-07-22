import { BadRequestException, ConflictException } from '@nestjs/common';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmStageEntity } from '../entities/crm-stage.entity';
import { CrmStageTransitionPolicyEntity } from '../entities/crm-stage-transition-policy.entity';
import { CrmStageTransitionPolicyService } from './crm-stage-transition-policy.service';

const ctx = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
};

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    pipelineId: '00000000-0000-4000-8000-000000000020',
    stageId: '00000000-0000-4000-8000-000000000030',
    status: 'open',
    title: 'Lead governado',
    contactName: 'Ada',
    contactPhone: null,
    businessContext: { score: 'qualified' },
    rowVersion: 7,
    ...overrides,
  } as unknown as CrmOpportunityEntity;
}

function stage(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000031',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    pipelineId: '00000000-0000-4000-8000-000000000020',
    type: 'open',
    isWonStage: false,
    isLostStage: false,
    operationMode: 'hybrid',
    ...overrides,
  } as CrmStageEntity;
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000090',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    pipelineId: '00000000-0000-4000-8000-000000000020',
    fromStageId: '00000000-0000-4000-8000-000000000030',
    toStageId: '00000000-0000-4000-8000-000000000031',
    allowedActors: ['human'],
    requiredFields: ['contactName'],
    conditionContract: {
      all: [
        {
          field: 'businessContext.score',
          operator: 'equals',
          value: 'qualified',
        },
      ],
    },
    reasonCodes: ['manual_stage_move'],
    status: 'published',
    version: 2,
    ...overrides,
  } as CrmStageTransitionPolicyEntity;
}

function harness(resolvedPolicy: CrmStageTransitionPolicyEntity | null) {
  const findOne = jest.fn().mockResolvedValue(resolvedPolicy);
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === CrmStageTransitionPolicyEntity) return { findOne };
      throw new Error('Unexpected repository');
    }),
  };
  return {
    service: new CrmStageTransitionPolicyService({} as never),
    manager,
    findOne,
  };
}

describe('CrmStageTransitionPolicyService', () => {
  it('catalogues only published, non-terminal AI destinations in the current scope', async () => {
    const current = stage({
      id: '00000000-0000-4000-8000-000000000030',
      name: 'Novo',
    });
    const eligible = stage({ name: 'Qualificado' });
    const humanOnly = stage({
      id: '00000000-0000-4000-8000-000000000032',
      name: 'Negociação humana',
      operationMode: 'human_managed',
    });
    const terminal = stage({
      id: '00000000-0000-4000-8000-000000000033',
      name: 'Ganho',
      type: 'won',
      isWonStage: true,
    });
    const published = policy({
      allowedActors: ['ai'],
      reasonCodes: ['ai_qualified'],
      aiGuidance: 'Somente quando qualificado.',
    });
    const policies = [
      published,
      policy({
        id: 'policy-human',
        toStageId: humanOnly.id,
        allowedActors: ['ai'],
      }),
      policy({
        id: 'policy-terminal',
        toStageId: terminal.id,
        allowedActors: ['ai'],
      }),
      policy({
        id: 'policy-user-only',
        allowedActors: ['human'],
      }),
    ];
    const stageRepository = {
      findOne: jest.fn().mockResolvedValue(current),
      find: jest.fn().mockResolvedValue([eligible, humanOnly, terminal]),
    };
    const policyRepository = { find: jest.fn().mockResolvedValue(policies) };
    const service = new CrmStageTransitionPolicyService({
      getRepository: jest.fn((entity) =>
        entity === CrmStageEntity ? stageRepository : policyRepository,
      ),
    } as never);

    await expect(
      service.getAiTransitionCatalog(ctx, opportunity()),
    ).resolves.toMatchObject({
      opportunityId: '00000000-0000-4000-8000-000000000010',
      opportunityRowVersion: 7,
      currentStageId: current.id,
      capabilities: {
        canProposeStageTransition: true,
        canApplyTerminalTransition: false,
      },
      destinations: [
        {
          toStageId: eligible.id,
          transitionPolicyId: published.id,
          transitionPolicyVersion: 2,
          currentlyEligible: true,
          missingFields: [],
          conditionsMet: true,
        },
      ],
    });
    expect(policyRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        // Jest asymmetric matchers are intentionally dynamic at this boundary.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        where: expect.objectContaining({ status: 'published' }),
      }),
    );
  });

  it('marks a destination ineligible while canonical requirements are missing', async () => {
    const current = stage({
      id: '00000000-0000-4000-8000-000000000030',
      name: 'Novo',
    });
    const target = stage({ name: 'Qualificado' });
    const stageRepository = {
      findOne: jest.fn().mockResolvedValue(current),
      find: jest.fn().mockResolvedValue([target]),
    };
    const policyRepository = {
      find: jest.fn().mockResolvedValue([
        policy({
          allowedActors: ['ai'],
          requiredFields: ['contactName', 'contactPhone'],
          reasonCodes: ['ai_qualified'],
        }),
      ]),
    };
    const service = new CrmStageTransitionPolicyService({
      getRepository: jest.fn((entity) =>
        entity === CrmStageEntity ? stageRepository : policyRepository,
      ),
    } as never);

    await expect(
      service.getAiTransitionCatalog(ctx, opportunity()),
    ).resolves.toMatchObject({
      capabilities: { canProposeStageTransition: false },
      destinations: [
        {
          toStageId: target.id,
          currentlyEligible: false,
          presentFields: ['contactName'],
          missingFields: ['contactPhone'],
        },
      ],
    });
  });

  it('rejects a catalog request outside the opportunity workspace', async () => {
    const service = new CrmStageTransitionPolicyService({} as never);

    await expect(
      service.getAiTransitionCatalog(
        { ...ctx, workspaceId: '00000000-0000-4000-8000-000000000099' },
        opportunity(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a human transition only when the published contract matches', async () => {
    const expected = policy();
    const { service, manager } = harness(expected);

    await expect(
      service.assertTransitionAllowedWithinTransaction(
        manager as never,
        ctx,
        opportunity(),
        stage(),
        { type: 'user', userId: ctx.userId },
        'manual_stage_move',
      ),
    ).resolves.toBe(expected);
  });

  it('fails closed when no published edge exists', async () => {
    const { service, manager } = harness(null);

    await expect(
      service.assertTransitionAllowedWithinTransaction(
        manager as never,
        ctx,
        opportunity(),
        stage(),
        { type: 'user' },
        'manual_stage_move',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'CRM_STAGE_TRANSITION_BLOCKED',
        reasonCode: 'transition_policy_missing',
      },
    });
  });

  it('blocks automatic terminal transitions before policy lookup', async () => {
    const { service, manager, findOne } = harness(policy());

    await expect(
      service.assertTransitionAllowedWithinTransaction(
        manager as never,
        ctx,
        opportunity(),
        stage({ type: 'won', isWonStage: true }),
        { type: 'automation' },
        'automation_qualified',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns the missing canonical fields without mutating the opportunity', async () => {
    const { service, manager } = harness(
      policy({ requiredFields: ['contactName', 'contactPhone'] }),
    );

    await expect(
      service.assertTransitionAllowedWithinTransaction(
        manager as never,
        ctx,
        opportunity(),
        stage(),
        { type: 'user' },
        'manual_stage_move',
      ),
    ).rejects.toMatchObject({
      response: {
        reasonCode: 'required_fields_missing',
        missingFields: ['contactPhone'],
      },
    });
  });
});
