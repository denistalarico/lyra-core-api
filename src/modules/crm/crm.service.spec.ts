import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivityEntityType } from '../activities/enums';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmPipelineEntity } from './entities/crm-pipeline.entity';

type RepositoryMock = {
  create: jest.Mock;
  count: jest.Mock;
  createQueryBuilder: jest.Mock;
  delete: jest.Mock;
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  manager?: unknown;
};

const ctx = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  userId: 'user-a',
};

function createRepositoryMock(): RepositoryMock {
  return {
    create: jest.fn((value) => value),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
    delete: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((value) =>
      Promise.resolve({ id: value.id ?? 'saved-id', ...value }),
    ),
  };
}

function createService() {
  const pipelinesRepository = createRepositoryMock();
  const stagesRepository = createRepositoryMock();
  const opportunitiesRepository = createRepositoryMock();
  const tagsRepository = createRepositoryMock();
  const opportunityTagsRepository = createRepositoryMock();
  const opportunityEventsRepository = createRepositoryMock();
  const contactsRepository = createRepositoryMock();
  const updateQueryBuilder = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  Object.values(updateQueryBuilder).forEach((method) => {
    if (method !== updateQueryBuilder.execute)
      method.mockReturnValue(updateQueryBuilder);
  });
  stagesRepository.createQueryBuilder.mockReturnValue(updateQueryBuilder);
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === CrmPipelineEntity ? pipelinesRepository : stagesRepository,
    ),
    transaction: jest.fn((callback) => callback(manager)),
  };
  stagesRepository.manager = manager;
  const salesNotificationPublisher = {
    publishOpportunityAssigned: jest.fn(),
    publishOpportunityStageChanged: jest.fn(),
  };
  const opportunityCommands = {
    createOpportunity: jest.fn(async (_ctx, opportunity) =>
      opportunitiesRepository.save(opportunity),
    ),
    updateOpportunity: jest.fn(async (_ctx, opportunity) =>
      opportunitiesRepository.save(opportunity),
    ),
    moveStage: jest.fn(),
    changeStatus: jest.fn(),
    reorder: jest.fn(),
    recordEvent: jest.fn(),
  };

  const transitionPolicies = {
    ensureDefaultPolicies: jest.fn(async () => ({ created: 0 })),
  };

  const service = new CrmService(
    pipelinesRepository as never,
    stagesRepository as never,
    opportunitiesRepository as never,
    tagsRepository as never,
    opportunityTagsRepository as never,
    opportunityEventsRepository as never,
    contactsRepository as never,
    opportunityCommands as never,
    salesNotificationPublisher as never,
    transitionPolicies as never,
  );

  return {
    service,
    pipelinesRepository,
    stagesRepository,
    opportunitiesRepository,
    tagsRepository,
    opportunityTagsRepository,
    opportunityEventsRepository,
    contactsRepository,
    salesNotificationPublisher,
    opportunityCommands,
    updateQueryBuilder,
  };
}

function mockPipeline(id = 'pipeline-a') {
  return {
    id,
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    businessMode: 'general',
    deletedAt: null,
  };
}

function mockStage(id = 'stage-a', pipelineId = 'pipeline-a') {
  return {
    id,
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    pipelineId,
    type: 'open',
    isWonStage: false,
    isLostStage: false,
    deletedAt: null,
  };
}

function mockOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'opportunity-a',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    pipelineId: 'pipeline-a',
    stageId: 'stage-a',
    status: 'open',
    wonAt: null,
    lostAt: null,
    lostReason: null,
    priority: 'normal',
    source: 'manual',
    businessContext: {},
    metadata: {},
    deletedAt: null,
    ...overrides,
  };
}

describe('CrmService agency validation', () => {
  it('keeps a stage that is still used by an opportunity', async () => {
    const { service, stagesRepository, opportunitiesRepository } =
      createService();
    stagesRepository.findOne.mockResolvedValue(mockStage('stage-a'));
    opportunitiesRepository.count.mockResolvedValue(1);

    await expect(service.deleteStage(ctx, 'stage-a')).rejects.toMatchObject({
      response: { code: 'CRM_STAGE_IN_USE' },
    });
  });

  it('normalizes tag names and refuses case or accent duplicates', async () => {
    const { service, tagsRepository } = createService();
    tagsRepository.findOne.mockResolvedValue({ id: 'existing-tag' });

    await expect(
      service.createTag(ctx, {
        name: 'Prioridade',
        slug: 'prioridade',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CRM_TAG_NAME_CONFLICT' },
    });
  });

  it('keeps a tag that is still applied to an opportunity', async () => {
    const { service, tagsRepository, opportunityTagsRepository } =
      createService();
    tagsRepository.findOne.mockResolvedValue({
      id: 'tag-a',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      kind: 'user',
      isEditable: true,
      deletedAt: null,
    });
    opportunityTagsRepository.count.mockResolvedValue(1);

    await expect(service.deleteTag(ctx, 'tag-a')).rejects.toMatchObject({
      response: { code: 'CRM_TAG_IN_USE' },
    });
  });

  it('makes the first eligible stage explicitly initial', async () => {
    const { service, pipelinesRepository, stagesRepository } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.count.mockResolvedValue(0);

    await expect(
      service.createStage(ctx, {
        pipelineId: 'pipeline-a',
        name: 'Novo lead',
        type: 'open',
      }),
    ).resolves.toMatchObject({
      name: 'Novo lead',
      isInitialStage: true,
    });
  });

  it('rejects a terminal stage as the pipeline initial stage', async () => {
    const { service, pipelinesRepository, stagesRepository } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.count.mockResolvedValue(1);

    await expect(
      service.createStage(ctx, {
        pipelineId: 'pipeline-a',
        name: 'Ganho',
        type: 'won',
        isWonStage: true,
        isInitialStage: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a terminal stage to be created first without making it initial', async () => {
    const { service, pipelinesRepository, stagesRepository } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.count.mockResolvedValue(0);

    await expect(
      service.createStage(ctx, {
        pipelineId: 'pipeline-a',
        name: 'Ganho',
        type: 'won',
        isWonStage: true,
      }),
    ).resolves.toMatchObject({ isInitialStage: false });
  });

  it('requires selecting a replacement instead of clearing the current initial stage', async () => {
    const { service, pipelinesRepository, stagesRepository } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.findOne.mockResolvedValue({
      ...mockStage(),
      isInitialStage: true,
      metadata: {},
    });

    await expect(
      service.patchStage(ctx, 'stage-a', { isInitialStage: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('switches the initial stage inside the same transaction', async () => {
    const {
      service,
      pipelinesRepository,
      stagesRepository,
      updateQueryBuilder,
    } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.findOne.mockResolvedValue({
      ...mockStage('stage-b'),
      isInitialStage: false,
      metadata: {},
    });

    await expect(
      service.patchStage(ctx, 'stage-b', { isInitialStage: true }),
    ).resolves.toMatchObject({
      id: 'stage-b',
      isInitialStage: true,
    });
    expect(updateQueryBuilder.set).toHaveBeenCalledWith({
      isInitialStage: false,
    });
    expect(updateQueryBuilder.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects create opportunity when contactId is not found for the tenant', async () => {
    const {
      service,
      pipelinesRepository,
      stagesRepository,
      contactsRepository,
    } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.findOne.mockResolvedValue(mockStage());
    contactsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createOpportunity(ctx, {
        pipelineId: 'pipeline-a',
        stageId: 'stage-a',
        contactId: 'contact-from-other-tenant',
        title: 'Lead técnico',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contactsRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'contact-from-other-tenant',
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
  });

  it('rejects create opportunity when contactId is not found for the workspace', async () => {
    const {
      service,
      pipelinesRepository,
      stagesRepository,
      contactsRepository,
    } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.findOne.mockResolvedValue(mockStage());
    contactsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createOpportunity(ctx, {
        pipelineId: 'pipeline-a',
        stageId: 'stage-a',
        contactId: 'contact-from-other-workspace',
        title: 'Lead técnico',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contactsRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'contact-from-other-workspace',
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
  });

  it('rejects create opportunity when stage does not belong to the pipeline', async () => {
    const {
      service,
      pipelinesRepository,
      stagesRepository,
      contactsRepository,
    } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline('pipeline-a'));
    stagesRepository.findOne.mockResolvedValue(
      mockStage('stage-b', 'pipeline-b'),
    );

    await expect(
      service.createOpportunity(ctx, {
        pipelineId: 'pipeline-a',
        stageId: 'stage-b',
        title: 'Lead técnico',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(contactsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects patch opportunity when pipeline and stage are incompatible', async () => {
    const {
      service,
      pipelinesRepository,
      stagesRepository,
      opportunitiesRepository,
    } = createService();
    opportunitiesRepository.findOne.mockResolvedValue(mockOpportunity());
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline('pipeline-a'));
    stagesRepository.findOne.mockResolvedValue(
      mockStage('stage-b', 'pipeline-b'),
    );

    await expect(
      service.patchOpportunity(ctx, 'opportunity-a', {
        pipelineId: 'pipeline-a',
        stageId: 'stage-b',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects moving opportunity to a stage from another pipeline', async () => {
    const { service, stagesRepository, opportunitiesRepository } =
      createService();
    opportunitiesRepository.findOne.mockResolvedValue(
      mockOpportunity({ pipelineId: 'pipeline-a', stageId: 'stage-a' }),
    );
    stagesRepository.findOne.mockResolvedValue(
      mockStage('stage-b', 'pipeline-b'),
    );

    await expect(
      service.patchOpportunityStage(ctx, 'opportunity-a', {
        stageId: 'stage-b',
        reasonCode: 'manual_stage_move',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes opportunity assignment after creating an assigned opportunity', async () => {
    const {
      service,
      pipelinesRepository,
      stagesRepository,
      contactsRepository,
      salesNotificationPublisher,
    } = createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.findOne.mockResolvedValue(mockStage());
    contactsRepository.findOne.mockResolvedValue(null);

    const saved = await service.createOpportunity(ctx, {
      pipelineId: 'pipeline-a',
      stageId: 'stage-a',
      title: 'Lead técnico',
      assignedUserId: 'user-b',
    });

    expect(saved.assignedUserId).toBe('user-b');
    expect(
      salesNotificationPublisher.publishOpportunityAssigned,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          assignedUserId: 'user-b',
        }),
        actorUserId: ctx.userId,
        assignedUserId: 'user-b',
      }),
    );
  });

  it('does not publish opportunity assignment when assignee is unchanged', async () => {
    const {
      service,
      pipelinesRepository,
      stagesRepository,
      opportunitiesRepository,
      salesNotificationPublisher,
    } = createService();
    opportunitiesRepository.findOne.mockResolvedValue(
      mockOpportunity({ assignedUserId: 'user-b' }),
    );
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline('pipeline-a'));
    stagesRepository.findOne.mockResolvedValue(mockStage('stage-a'));

    await service.patchOpportunity(ctx, 'opportunity-a', {
      assignedUserId: 'user-b',
    });

    expect(
      salesNotificationPublisher.publishOpportunityAssigned,
    ).not.toHaveBeenCalled();
  });

  it('marks fields changed by a human so governed enrichment cannot silently overwrite them', async () => {
    const { service, opportunitiesRepository } = createService();
    opportunitiesRepository.findOne.mockResolvedValue(
      mockOpportunity({
        businessContext: { niche: 'old value' },
      }),
    );

    const saved = await service.patchOpportunity(ctx, 'opportunity-a', {
      priority: 'high',
      source: 'referral',
      businessContext: { niche: 'human value' },
    });

    expect(saved.businessContext).toMatchObject({
      niche: 'human value',
      fieldProvenance: {
        niche: { source: 'human', userId: ctx.userId },
        urgency: { source: 'human', userId: ctx.userId },
      },
    });
    expect(saved.metadata).toMatchObject({
      sourceProvenance: 'human',
      sourceUpdatedBy: ctx.userId,
    });
  });
});

describe('CRM activities cutover', () => {
  it('supports crm_opportunity as a shared activity entity type', () => {
    expect(ActivityEntityType.CrmOpportunity).toBe('crm_opportunity');
  });

  it('does not expose /crm/activities controller endpoints', () => {
    const routes = Object.getOwnPropertyNames(CrmController.prototype)
      .filter((property) => property !== 'constructor')
      .map((property) => {
        const handler =
          CrmController.prototype[property as keyof CrmController];

        return {
          method: Reflect.getMetadata(METHOD_METADATA, handler),
          path: Reflect.getMetadata(PATH_METADATA, handler),
        };
      })
      .filter((route) => route.method !== undefined);

    expect(routes).not.toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('activities') }),
    );
  });

  it('does not expose a public endpoint for arbitrary opportunity events', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        CrmController.prototype,
        'createOpportunityEvent',
      ),
    ).toBe(false);
  });
});

describe('CrmService stage roles (D4)', () => {
  it('creates a stage with a unique role when none exists', async () => {
    const { service, pipelinesRepository, stagesRepository, updateQueryBuilder } =
      createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.count.mockResolvedValue(1);
    (updateQueryBuilder as { getCount?: jest.Mock }).getCount = jest
      .fn()
      .mockResolvedValue(0);

    await expect(
      service.createStage(ctx, {
        pipelineId: 'pipeline-a',
        name: 'Ganho',
        type: 'won',
        isWonStage: true,
        role: 'won',
      }),
    ).resolves.toMatchObject({ role: 'won' });
  });

  it('rejects creating a second stage with a unique role', async () => {
    const { service, pipelinesRepository, stagesRepository, updateQueryBuilder } =
      createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.count.mockResolvedValue(1);
    (updateQueryBuilder as { getCount?: jest.Mock }).getCount = jest
      .fn()
      .mockResolvedValue(1);

    await expect(
      service.createStage(ctx, {
        pipelineId: 'pipeline-a',
        name: 'Ganho 2',
        type: 'won',
        isWonStage: true,
        role: 'won',
      }),
    ).rejects.toMatchObject({
      response: { reasonCode: 'stage_role_not_unique' },
    });
  });

  it('allows repeated non-unique roles without querying uniqueness', async () => {
    const { service, pipelinesRepository, stagesRepository, updateQueryBuilder } =
      createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.count.mockResolvedValue(1);
    const getCount = jest.fn().mockResolvedValue(3);
    (updateQueryBuilder as { getCount?: jest.Mock }).getCount = getCount;

    await expect(
      service.createStage(ctx, {
        pipelineId: 'pipeline-a',
        name: 'Qualificação 2',
        type: 'open',
        role: 'qualification',
      }),
    ).resolves.toMatchObject({ role: 'qualification' });
    expect(getCount).not.toHaveBeenCalled();
  });

  it('rejects patching a stage to a duplicate unique role', async () => {
    const { service, pipelinesRepository, stagesRepository, updateQueryBuilder } =
      createService();
    pipelinesRepository.findOne.mockResolvedValue(mockPipeline());
    stagesRepository.findOne.mockResolvedValue({
      ...mockStage('stage-b'),
      role: 'custom',
      metadata: {},
    });
    (updateQueryBuilder as { getCount?: jest.Mock }).getCount = jest
      .fn()
      .mockResolvedValue(1);

    await expect(
      service.patchStage(ctx, 'stage-b', { role: 'won' }),
    ).rejects.toMatchObject({
      response: { reasonCode: 'stage_role_not_unique' },
    });
  });
});
