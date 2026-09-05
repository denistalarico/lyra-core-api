import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialPlanEntity,
  SocialContentRevisionEntity,
} from '../entities';
import {
  SocialPlannerService,
  type SocialPlannerScope,
} from './social-planner.service';

type RepositoryMock<T> = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  manager: {
    transaction: jest.Mock;
  };
};

function createRepositoryMock<T>(): RepositoryMock<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    delete: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };
}

describe('SocialPlannerService', () => {
  let service: SocialPlannerService;

  let plansRepository: RepositoryMock<SocialPlanEntity>;
  let contentRepository: RepositoryMock<SocialContentItemEntity>;
  let destinationsRepository: RepositoryMock<SocialContentDestinationEntity>;
  let revisionsRepository: RepositoryMock<SocialContentRevisionEntity>;

  const agencyScope: SocialPlannerScope = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
  };

  const clientScope: SocialPlannerScope = {
    ...agencyScope,
    agencyClientId: '33333333-3333-4333-8333-333333333333',
  };

  beforeEach(() => {
    plansRepository = createRepositoryMock();
    contentRepository = createRepositoryMock();
    destinationsRepository = createRepositoryMock();
    revisionsRepository = createRepositoryMock();

    service = new SocialPlannerService(
      plansRepository as unknown as Repository<SocialPlanEntity>,
      contentRepository as unknown as Repository<SocialContentItemEntity>,
      destinationsRepository as unknown as Repository<SocialContentDestinationEntity>,
      revisionsRepository as unknown as Repository<SocialContentRevisionEntity>,
    );
  });

  describe('createPlan', () => {
    it('creates a plan in agency scope without allowing caller-owned scope fields', async () => {
      plansRepository.save.mockImplementation(async (value) => ({
        id: '44444444-4444-4444-8444-444444444444',
        ...value,
        createdAt: new Date('2026-09-05T12:00:00Z'),
        updatedAt: new Date('2026-09-05T12:00:00Z'),
      }));

      const result = await service.createPlan(
        agencyScope,
        '55555555-5555-4555-8555-555555555555',
        {
          title: ' Setembro ',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
        },
      );

      expect(plansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: agencyScope.tenantId,
          workspaceId: agencyScope.workspaceId,
          agencyClientId: null,
          title: 'Setembro',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          status: 'draft',
          createdById: '55555555-5555-4555-8555-555555555555',
          updatedById: '55555555-5555-4555-8555-555555555555',
        }),
      );

      expect(result).not.toHaveProperty('tenantId');
      expect(result).not.toHaveProperty('workspaceId');
      expect(result).not.toHaveProperty('agencyClientId');
      expect(result.title).toBe('Setembro');
    });

    it('persists managed client scope when the server resolved one', async () => {
      plansRepository.save.mockImplementation(async (value) => ({
        id: '44444444-4444-4444-8444-444444444444',
        ...value,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.createPlan(clientScope, null, {
        title: 'Cliente Setembro',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      });

      expect(plansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: clientScope.tenantId,
          workspaceId: clientScope.workspaceId,
          agencyClientId: clientScope.agencyClientId,
        }),
      );
    });

    it('rejects an inverted period', async () => {
      await expect(
        service.createPlan(agencyScope, null, {
          title: 'Inválido',
          periodStart: '2026-10-01',
          periodEnd: '2026-09-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(plansRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getPlan', () => {
    it('queries by id and complete operational scope', async () => {
      plansRepository.findOne.mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444444',
        tenantId: clientScope.tenantId,
        workspaceId: clientScope.workspaceId,
        agencyClientId: clientScope.agencyClientId,
        title: 'Cliente Setembro',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        status: 'draft',
        primaryObjective: null,
        strategyMode: null,
        summary: null,
        createdById: null,
        updatedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.getPlan(
        clientScope,
        '44444444-4444-4444-8444-444444444444',
      );

      expect(plansRepository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: '44444444-4444-4444-8444-444444444444',
          tenantId: clientScope.tenantId,
          workspaceId: clientScope.workspaceId,
          agencyClientId: clientScope.agencyClientId,
        }),
      });
    });

    it('returns not found for a plan outside the current scope', async () => {
      plansRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getPlan(clientScope, '99999999-9999-4999-8999-999999999999'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createContent', () => {
    it('refuses content creation when the parent plan is outside scope', async () => {
      plansRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createContent(
          clientScope,
          '44444444-4444-4444-8444-444444444444',
          null,
          {
            title: 'Post 1',
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getContent', () => {
    it('does not expose a content item outside the selected client scope', async () => {
      contentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getContent(clientScope, '66666666-6666-4666-8666-666666666666'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(destinationsRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('replaceDestinations', () => {
    const contentItem = {
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: clientScope.tenantId,
      workspaceId: clientScope.workspaceId,
      agencyClientId: clientScope.agencyClientId,
      planId: '44444444-4444-4444-8444-444444444444',
      title: 'Post',
      theme: null,
      brief: null,
      keyMessage: null,

      copy: null,
      caption: null,
      script: null,
      cta: null,
      hashtags: [],
      firstComment: null,
      currentRevisionId: null,

      funnelStage: null,
      contentType: null,
      objective: null,
      creativeFormat: null,
      planningStatus: 'planned',
      plannedDate: null,
      sortOrder: 0,
      createdById: null,
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies SocialContentItemEntity;

    it('rejects duplicate channel + placement pairs before opening a transaction', async () => {
      contentRepository.findOne.mockResolvedValue(contentItem);

      await expect(
        service.replaceDestinations(clientScope, contentItem.id, {
          items: [
            {
              channel: 'instagram',
              placement: 'feed',
            },
            {
              channel: 'instagram',
              placement: 'feed',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(destinationsRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('replaces all destinations inside one transaction', async () => {
      contentRepository.findOne.mockResolvedValue(contentItem);

      const transactionalRepository = {
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
      };

      destinationsRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn(() => transactionalRepository),
          }),
      );

      destinationsRepository.find.mockResolvedValue([
        {
          id: '77777777-7777-4777-8777-777777777777',
          tenantId: clientScope.tenantId,
          workspaceId: clientScope.workspaceId,
          agencyClientId: clientScope.agencyClientId,
          contentItemId: contentItem.id,
          channel: 'instagram',
          placement: 'feed',
          plannedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await service.replaceDestinations(clientScope, contentItem.id, {
        items: [
          {
            channel: 'instagram',
            placement: 'feed',
          },
        ],
      });

      expect(destinationsRepository.manager.transaction).toHaveBeenCalledTimes(
        1,
      );

      expect(transactionalRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          contentItemId: contentItem.id,
          tenantId: clientScope.tenantId,
          workspaceId: clientScope.workspaceId,
          agencyClientId: clientScope.agencyClientId,
        }),
      );

      expect(transactionalRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('revisions', () => {
    const contentItem = {
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: clientScope.tenantId,
      workspaceId: clientScope.workspaceId,
      agencyClientId: clientScope.agencyClientId,
      planId: '44444444-4444-4444-8444-444444444444',
      title: 'Post',
      theme: null,
      brief: 'Brief original',
      keyMessage: null,

      copy: null,
      caption: null,
      script: null,
      cta: null,
      hashtags: [],
      firstComment: null,
      currentRevisionId: null,

      funnelStage: null,
      contentType: null,
      objective: null,
      creativeFormat: null,
      planningStatus: 'planned',
      plannedDate: null,
      sortOrder: 0,
      createdById: null,
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies SocialContentItemEntity;

    it('creates revision 1 and promotes it to current state', async () => {
      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue({ ...contentItem }),
        save: jest.fn(async (value) => value),
      };

      const transactionalRevisionRepository = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value) => ({
          id: '77777777-7777-4777-8777-777777777777',
          ...value,
          createdAt: new Date(),
        })),
        save: jest.fn(async (value) => value),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn((entity) => {
              if (entity === SocialContentItemEntity) {
                return transactionalContentRepository;
              }

              if (entity === SocialContentRevisionEntity) {
                return transactionalRevisionRepository;
              }

              throw new Error('Unexpected repository');
            }),
          }),
      );

      const result = await service.createRevision(
        clientScope,
        contentItem.id,
        '55555555-5555-4555-8555-555555555555',
        {
          copy: 'Copy 1',
          caption: 'Legenda 1',
          hashtags: ['#lyra', '#social'],
          source: 'human',
        },
      );

      expect(transactionalRevisionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contentItemId: contentItem.id,
          revisionNumber: 1,
          copy: 'Copy 1',
          caption: 'Legenda 1',
          hashtags: ['#lyra', '#social'],
          briefSnapshot: 'Brief original',
          source: 'human',
          parentRevisionId: null,
        }),
      );

      expect(transactionalContentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          copy: 'Copy 1',
          caption: 'Legenda 1',
          currentRevisionId: '77777777-7777-4777-8777-777777777777',
        }),
      );

      expect(result.revision.revisionNumber).toBe(1);
    });

    it('increments revision number and links to current revision', async () => {
      const current = {
        ...contentItem,
        copy: 'Copy atual',
        currentRevisionId: '77777777-7777-4777-8777-777777777777',
      };

      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue(current),
        save: jest.fn(async (value) => value),
      };

      const transactionalRevisionRepository = {
        findOne: jest.fn().mockResolvedValue({
          id: current.currentRevisionId,
          revisionNumber: 4,
        }),
        create: jest.fn((value) => ({
          id: '88888888-8888-4888-8888-888888888888',
          ...value,
          createdAt: new Date(),
        })),
        save: jest.fn(async (value) => value),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn((entity) => {
              if (entity === SocialContentItemEntity) {
                return transactionalContentRepository;
              }

              return transactionalRevisionRepository;
            }),
          }),
      );

      await service.createRevision(clientScope, contentItem.id, null, {
        copy: 'Copy nova',
      });

      expect(transactionalRevisionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionNumber: 5,
          parentRevisionId: '77777777-7777-4777-8777-777777777777',
        }),
      );
    });

    it('preserves current fields omitted from a partial editorial save', async () => {
      const current = {
        ...contentItem,
        copy: 'Copy atual',
        caption: 'Legenda atual',
        cta: 'Saiba mais',
        hashtags: ['#atual'],
      };

      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue(current),
        save: jest.fn(async (value) => value),
      };

      const transactionalRevisionRepository = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value) => ({
          id: '77777777-7777-4777-8777-777777777777',
          ...value,
          createdAt: new Date(),
        })),
        save: jest.fn(async (value) => value),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn((entity) =>
              entity === SocialContentItemEntity
                ? transactionalContentRepository
                : transactionalRevisionRepository,
            ),
          }),
      );

      await service.createRevision(clientScope, contentItem.id, null, {
        caption: 'Legenda nova',
      });

      expect(transactionalRevisionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          copy: 'Copy atual',
          caption: 'Legenda nova',
          cta: 'Saiba mais',
          hashtags: ['#atual'],
        }),
      );
    });

    it('normalizes and deduplicates hashtags', async () => {
      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue({ ...contentItem }),
        save: jest.fn(async (value) => value),
      };

      const transactionalRevisionRepository = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value) => ({
          id: '77777777-7777-4777-8777-777777777777',
          ...value,
          createdAt: new Date(),
        })),
        save: jest.fn(async (value) => value),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn((entity) =>
              entity === SocialContentItemEntity
                ? transactionalContentRepository
                : transactionalRevisionRepository,
            ),
          }),
      );

      await service.createRevision(clientScope, contentItem.id, null, {
        hashtags: [' #lyra ', '#social', '#lyra', ''],
      });

      expect(transactionalRevisionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hashtags: ['#lyra', '#social'],
        }),
      );
    });

    it('returns not found instead of exposing cross-context content', async () => {
      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue(null),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn(() => transactionalContentRepository),
          }),
      );

      await expect(
        service.createRevision(clientScope, contentItem.id, null, {
          copy: 'Não deve salvar',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores an old revision by creating a new immutable revision', async () => {
      const current = {
        ...contentItem,
        currentRevisionId: '99999999-9999-4999-8999-999999999999',
      };

      const sourceRevision = {
        id: '77777777-7777-4777-8777-777777777777',
        tenantId: clientScope.tenantId,
        workspaceId: clientScope.workspaceId,
        agencyClientId: clientScope.agencyClientId,
        contentItemId: contentItem.id,
        revisionNumber: 2,

        copy: 'Copy antiga',
        caption: 'Legenda antiga',
        script: null,
        cta: 'CTA antigo',
        hashtags: ['#antiga'],
        firstComment: 'Comentário antigo',

        briefSnapshot: 'Brief antigo',
        source: 'human',
        parentRevisionId: null,
        generationRunId: null,
        createdById: null,
        createdAt: new Date(),
      } satisfies SocialContentRevisionEntity;

      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue(current),
        save: jest.fn(async (value) => value),
      };

      const transactionalRevisionRepository = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(sourceRevision)
          .mockResolvedValueOnce({
            revisionNumber: 4,
          }),
        create: jest.fn((value) => ({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          ...value,
          createdAt: new Date(),
        })),
        save: jest.fn(async (value) => value),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn((entity) =>
              entity === SocialContentItemEntity
                ? transactionalContentRepository
                : transactionalRevisionRepository,
            ),
          }),
      );

      const result = await service.restoreRevision(
        clientScope,
        contentItem.id,
        sourceRevision.id,
        '55555555-5555-4555-8555-555555555555',
      );

      expect(transactionalRevisionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionNumber: 5,
          copy: 'Copy antiga',
          caption: 'Legenda antiga',
          cta: 'CTA antigo',
          hashtags: ['#antiga'],
          source: 'restored',
          parentRevisionId: sourceRevision.id,
          generationRunId: null,
        }),
      );

      expect(transactionalContentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          copy: 'Copy antiga',
          caption: 'Legenda antiga',
          currentRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      );

      expect(result.revision.source).toBe('restored');
    });

    it('does not restore a revision belonging to another content item or scope', async () => {
      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue({ ...contentItem }),
      };

      const transactionalRevisionRepository = {
        findOne: jest.fn().mockResolvedValue(null),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn((entity) =>
              entity === SocialContentItemEntity
                ? transactionalContentRepository
                : transactionalRevisionRepository,
            ),
          }),
      );

      await expect(
        service.restoreRevision(
          clientScope,
          contentItem.id,
          '77777777-7777-4777-8777-777777777777',
          null,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stores generationRunId as provenance without provider details', async () => {
      const transactionalContentRepository = {
        findOne: jest.fn().mockResolvedValue({ ...contentItem }),
        save: jest.fn(async (value) => value),
      };

      const transactionalRevisionRepository = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value) => ({
          id: '77777777-7777-4777-8777-777777777777',
          ...value,
          createdAt: new Date(),
        })),
        save: jest.fn(async (value) => value),
      };

      contentRepository.manager.transaction.mockImplementation(
        async (callback) =>
          callback({
            getRepository: jest.fn((entity) =>
              entity === SocialContentItemEntity
                ? transactionalContentRepository
                : transactionalRevisionRepository,
            ),
          }),
      );

      await service.createRevision(clientScope, contentItem.id, null, {
        caption: 'Gerada pela Intelligence Layer',
        source: 'ai',
        generationRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      });

      expect(transactionalRevisionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'ai',
          generationRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      );
    });
  });
});
