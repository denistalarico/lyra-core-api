import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivityEntityType } from '../activities/enums';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

type RepositoryMock = {
  create: jest.Mock;
  delete: jest.Mock;
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
};

const ctx = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  userId: 'user-a',
};

function createRepositoryMock(): RepositoryMock {
  return {
    create: jest.fn((value) => value),
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
  const salesNotificationPublisher = {
    publishOpportunityAssigned: jest.fn(),
    publishOpportunityStageChanged: jest.fn(),
  };

  const service = new CrmService(
    pipelinesRepository as never,
    stagesRepository as never,
    opportunitiesRepository as never,
    tagsRepository as never,
    opportunityTagsRepository as never,
    opportunityEventsRepository as never,
    contactsRepository as never,
    salesNotificationPublisher as never,
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
});
