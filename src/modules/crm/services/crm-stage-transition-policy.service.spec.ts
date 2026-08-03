import { BadRequestException, ConflictException } from '@nestjs/common';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmStageEntity } from '../entities/crm-stage.entity';
import { CrmStageTransitionPolicyEntity } from '../entities/crm-stage-transition-policy.entity';
import { CrmLeadScoreStateEntity } from '../lead-score/entities/crm-lead-score-state.entity';
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

function harness(
  resolvedPolicy: CrmStageTransitionPolicyEntity | null,
  leadScoreState: { score: number; band: string } | null = null,
) {
  const findOne = jest.fn().mockResolvedValue(resolvedPolicy);
  const leadScoreFindOne = jest.fn().mockResolvedValue(leadScoreState);
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === CrmStageTransitionPolicyEntity) return { findOne };
      if (entity === CrmLeadScoreStateEntity) {
        return { findOne: leadScoreFindOne };
      }
      throw new Error('Unexpected repository');
    }),
  };
  return {
    service: new CrmStageTransitionPolicyService({} as never),
    manager,
    findOne,
    leadScoreFindOne,
  };
}

describe('CrmStageTransitionPolicyService', () => {
  it('rejects terminal sources and entry destinations while defining a policy', () => {
    const service = new CrmStageTransitionPolicyService({} as never);
    const assertEdge = (
      service as unknown as {
        assertConfigurableEdge(
          fromStage: CrmStageEntity,
          toStage: CrmStageEntity,
        ): void;
      }
    ).assertConfigurableEdge.bind(service);

    expect(() =>
      assertEdge(
        stage({ isWonStage: true, type: 'won' }),
        stage({ id: '00000000-0000-4000-8000-000000000032' }),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'CRM_STAGE_TRANSITION_TERMINAL_SOURCE',
        }),
      }),
    );

    expect(() =>
      assertEdge(
        stage(),
        stage({
          id: '00000000-0000-4000-8000-000000000032',
          isInitialStage: true,
          role: 'entry',
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'CRM_STAGE_TRANSITION_INITIAL_DESTINATION',
        }),
      }),
    );
  });

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

  describe('lead score qualification (Fase 1C)', () => {
    const bandCondition = {
      all: [
        { field: 'leadScore.band', operator: 'in', value: ['warm', 'hot'] },
      ],
    };
    const scoreCondition = {
      all: [{ field: 'leadScore.score', operator: 'gte', value: 30 }],
    };

    it('blocks a human transition when the score band is below the minimum', async () => {
      const { service, manager } = harness(
        policy({ requiredFields: [], conditionContract: bandCondition }),
        { score: 8, band: 'cold' },
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
          code: 'CRM_STAGE_TRANSITION_BLOCKED',
          reasonCode: 'conditions_not_met',
          failedFields: ['leadScore.band'],
        },
      });
    });

    it('allows a human transition when the score band meets the minimum', async () => {
      const expected = policy({
        requiredFields: [],
        conditionContract: bandCondition,
      });
      const { service, manager } = harness(expected, {
        score: 30,
        band: 'warm',
      });

      await expect(
        service.assertTransitionAllowedWithinTransaction(
          manager as never,
          ctx,
          opportunity(),
          stage(),
          { type: 'user' },
          'manual_stage_move',
        ),
      ).resolves.toBe(expected);
    });

    it('blocks when the numeric score is below the gte threshold', async () => {
      const { service, manager } = harness(
        policy({ requiredFields: [], conditionContract: scoreCondition }),
        { score: 10, band: 'cold' },
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
          reasonCode: 'conditions_not_met',
          failedFields: ['leadScore.score'],
        },
      });
    });

    it('fails closed on a score gate when the lead was never scored', async () => {
      const { service, manager, leadScoreFindOne } = harness(
        policy({ requiredFields: [], conditionContract: scoreCondition }),
        null,
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
        response: { reasonCode: 'conditions_not_met' },
      });
      expect(leadScoreFindOne).toHaveBeenCalledTimes(1);
    });

    it('never queries the score when no policy field references it', async () => {
      const { service, manager, leadScoreFindOne } = harness(policy());

      await service.assertTransitionAllowedWithinTransaction(
        manager as never,
        ctx,
        opportunity(),
        stage(),
        { type: 'user' },
        'manual_stage_move',
      );

      expect(leadScoreFindOne).not.toHaveBeenCalled();
    });

    it('reflects the loaded band in the AI transition catalog, reading it once', async () => {
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
            requiredFields: [],
            reasonCodes: ['ai_qualified'],
            conditionContract: bandCondition,
          }),
        ]),
      };
      const leadScoreRepository = {
        findOne: jest.fn().mockResolvedValue({ score: 30, band: 'warm' }),
      };
      const service = new CrmStageTransitionPolicyService({
        getRepository: jest.fn((entity) => {
          if (entity === CrmStageEntity) return stageRepository;
          if (entity === CrmLeadScoreStateEntity) return leadScoreRepository;
          return policyRepository;
        }),
      } as never);

      await expect(
        service.getAiTransitionCatalog(ctx, opportunity()),
      ).resolves.toMatchObject({
        destinations: [
          {
            toStageId: target.id,
            conditionsMet: true,
            currentlyEligible: true,
            criteria: ['leadScore.band:in:["warm","hot"]'],
          },
        ],
      });
      expect(leadScoreRepository.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAutomationDestinations', () => {
    const from = () =>
      stage({ id: '00000000-0000-4000-8000-000000000030', name: 'Novo' });
    const to = () => stage({ name: 'Qualificado' });

    function service(
      policies: CrmStageTransitionPolicyEntity[],
      stages: CrmStageEntity[],
    ) {
      const policyRepository = { find: jest.fn().mockResolvedValue(policies) };
      const stageRepository = { find: jest.fn().mockResolvedValue(stages) };
      return new CrmStageTransitionPolicyService({
        getRepository: jest.fn((entity) =>
          entity === CrmStageEntity ? stageRepository : policyRepository,
        ),
      } as never);
    }

    it('offers only edges a published automation policy admits, to non-terminal stages', async () => {
      const target = to();
      const won = stage({
        id: '00000000-0000-4000-8000-000000000033',
        name: 'Ganho',
        type: 'won',
        isWonStage: true,
      });
      const svc = service(
        [
          policy({
            allowedActors: ['automation'],
            toStageId: target.id,
            reasonCodes: ['auto_qualified'],
          }),
          policy({
            id: 'policy-won',
            allowedActors: ['automation'],
            toStageId: won.id,
          }),
          policy({ id: 'policy-human-only', allowedActors: ['human'] }),
        ],
        [from(), target, won],
      );

      const destinations = await svc.getAutomationDestinations(
        ctx,
        '00000000-0000-4000-8000-000000000020',
      );

      expect(destinations).toEqual([
        expect.objectContaining({
          toStageId: target.id,
          toStageName: 'Qualificado',
          fromStageName: 'Novo',
          reasonCodes: ['auto_qualified'],
        }),
      ]);
    });

    it('returns nothing when no policy admits automations', async () => {
      const svc = service(
        [policy({ allowedActors: ['human'] })],
        [from(), to()],
      );

      await expect(
        svc.getAutomationDestinations(
          ctx,
          '00000000-0000-4000-8000-000000000020',
        ),
      ).resolves.toEqual([]);
    });
  });

  describe('assertAutomationDestination', () => {
    function service(
      policies: CrmStageTransitionPolicyEntity[],
      toStage: CrmStageEntity | null,
    ) {
      const policyRepository = { find: jest.fn().mockResolvedValue(policies) };
      const stageRepository = {
        findOne: jest.fn().mockResolvedValue(toStage),
      };
      return new CrmStageTransitionPolicyService({
        getRepository: jest.fn((entity) =>
          entity === CrmStageEntity ? stageRepository : policyRepository,
        ),
      } as never);
    }

    it('accepts a destination and reason a published automation policy admits', async () => {
      const svc = service(
        [
          policy({
            allowedActors: ['automation'],
            reasonCodes: ['auto_qualified'],
          }),
        ],
        stage({ name: 'Qualificado' }),
      );

      await expect(
        svc.assertAutomationDestination(ctx, {
          toStageId: '00000000-0000-4000-8000-000000000031',
          reasonCode: 'auto_qualified',
        }),
      ).resolves.toBeUndefined();
    });

    it('refuses a reason no admitting policy declares', async () => {
      const svc = service(
        [
          policy({
            allowedActors: ['automation'],
            reasonCodes: ['auto_qualified'],
          }),
        ],
        stage(),
      );

      await expect(
        svc.assertAutomationDestination(ctx, {
          toStageId: '00000000-0000-4000-8000-000000000031',
          reasonCode: 'made_up',
        }),
      ).rejects.toMatchObject({
        response: { code: 'AUTOMATION_TRANSITION_NOT_ALLOWED' },
      });
    });

    it('refuses a destination only human policies admit', async () => {
      const svc = service(
        [
          policy({
            allowedActors: ['human'],
            reasonCodes: ['manual_stage_move'],
          }),
        ],
        stage(),
      );

      await expect(
        svc.assertAutomationDestination(ctx, {
          toStageId: '00000000-0000-4000-8000-000000000031',
          reasonCode: 'manual_stage_move',
        }),
      ).rejects.toMatchObject({
        response: { code: 'AUTOMATION_TRANSITION_NOT_ALLOWED' },
      });
    });

    it('refuses a terminal destination even when a policy admits it', async () => {
      const svc = service(
        [
          policy({
            allowedActors: ['automation'],
            reasonCodes: ['auto_qualified'],
          }),
        ],
        stage({ type: 'won', isWonStage: true }),
      );

      await expect(
        svc.assertAutomationDestination(ctx, {
          toStageId: '00000000-0000-4000-8000-000000000031',
          reasonCode: 'auto_qualified',
        }),
      ).rejects.toMatchObject({
        response: { code: 'AUTOMATION_TRANSITION_TERMINAL' },
      });
    });
  });
});
