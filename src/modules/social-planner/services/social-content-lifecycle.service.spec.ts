import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsNull, Not, type Repository } from 'typeorm';
import { SocialContentDestinationEntity } from '../entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../entities/social-content-item.entity';
import { SocialDestinationCreativeEntity } from '../entities/social-destination-creative.entity';
import { SocialPlanEntity } from '../entities/social-plan.entity';
import {
  SocialContentPublicationGuard,
  type SocialContentPublicationSource,
} from './content-publication-guard.port';
import { SocialContentLifecycleService } from './social-content-lifecycle.service';
import type { SocialPlannerScope } from './social-planner.service';

type RepositoryMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  manager: { transaction: jest.Mock };
};

function createRepositoryMock(): RepositoryMock {
  return {
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    delete: jest.fn(() => Promise.resolve({ affected: 0 })),
    manager: { transaction: jest.fn() },
  };
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const CONTENT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_CONTENT_ID = '66666666-6666-4666-8666-666666666666';
const DESTINATION_ID = '77777777-7777-4777-8777-777777777777';
const MEDIA_ASSET_ID = '88888888-8888-4888-8888-888888888888';
const ORGANIC_ASSET_ID = '99999999-9999-4999-8999-999999999999';

const agencyScope: SocialPlannerScope = {
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  agencyClientId: null,
  companyContextId: null,
};

const clientScope: SocialPlannerScope = {
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  agencyClientId: CLIENT_ID,
  companyContextId: '44444444-4444-4444-8444-444444444444',
};

function buildContentItem(
  overrides: Partial<SocialContentItemEntity> = {},
): SocialContentItemEntity {
  return {
    id: CONTENT_ID,
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    agencyClientId: CLIENT_ID,
    planId: PLAN_ID,
    title: 'Lançamento de outubro',
    theme: 'lançamento',
    brief: 'brief original',
    keyMessage: 'mensagem',
    copy: 'copy atual',
    caption: 'legenda',
    script: null,
    cta: 'Saiba mais',
    hashtags: ['#lyra', '#social'],
    firstComment: 'primeiro comentário',
    currentRevisionId: 'revision-1',
    funnelStage: 'topo',
    contentType: 'reel',
    objective: 'alcance',
    creativeFormat: 'video',
    planningStatus: 'ready',
    plannedDate: '2026-10-01',
    sortOrder: 3,
    campaignInstanceId: null,
    editorialPillarId: null,
    archivedAt: null,
    archivedById: null,
    deletedAt: null,
    deletedById: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-02T10:00:00.000Z'),
    ...overrides,
  } as SocialContentItemEntity;
}

/**
 * The first argument of a mock's first call, typed.
 *
 * `jest.Mock` types its calls as `any[]`, so indexing them directly trips
 * `no-unsafe-member-access` at every assertion site. Narrowing once here keeps
 * the tests readable and the rule enforced everywhere else.
 */
function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls[0] as unknown[])[0] as T;
}

describe('SocialContentLifecycleService', () => {
  let contentRepository: RepositoryMock;
  let plansRepository: RepositoryMock;
  let destinationsRepository: RepositoryMock;
  let creativesRepository: RepositoryMock;
  let guard: SocialContentPublicationGuard;
  let service: SocialContentLifecycleService;

  /** A guard with a source registered that reports nothing blocking. */
  function registerPermissiveSource(): jest.Mock {
    const findBlockingPublications = jest.fn(() => Promise.resolve([]));

    guard.register({
      publicationSourceKey: 'test.source',
      findBlockingPublications,
    } as unknown as SocialContentPublicationSource);

    return findBlockingPublications;
  }

  function registerBlockingSource(statuses: string[]): jest.Mock {
    const findBlockingPublications = jest.fn(() =>
      Promise.resolve([{ contentItemId: CONTENT_ID, statuses }]),
    );

    guard.register({
      publicationSourceKey: 'test.source',
      findBlockingPublications,
    } as unknown as SocialContentPublicationSource);

    return findBlockingPublications;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    contentRepository = createRepositoryMock();
    plansRepository = createRepositoryMock();
    plansRepository.findOne.mockResolvedValue({
      id: PLAN_ID,
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      agencyClientId: CLIENT_ID,
      companyContextId: clientScope.companyContextId,
      deletedAt: null,
    });
    destinationsRepository = createRepositoryMock();
    creativesRepository = createRepositoryMock();
    guard = new SocialContentPublicationGuard();

    service = new SocialContentLifecycleService(
      contentRepository as unknown as Repository<SocialContentItemEntity>,
      plansRepository as unknown as Repository<SocialPlanEntity>,
      destinationsRepository as unknown as Repository<SocialContentDestinationEntity>,
      creativesRepository as unknown as Repository<SocialDestinationCreativeEntity>,
      guard,
    );
  });

  // ------------------------------------------------------------- duplicate

  describe('duplicate', () => {
    /** Runs the transaction callback against the same repository mocks. */
    function runTransaction(): void {
      contentRepository.manager.transaction.mockImplementation(
        async (callback: (manager: unknown) => Promise<unknown>) =>
          callback({
            getRepository: (entity: unknown) => {
              if (entity === SocialContentItemEntity) return contentRepository;
              if (entity === SocialContentDestinationEntity) {
                return destinationsRepository;
              }
              return creativesRepository;
            },
          }),
      );
    }

    it('copies editorial substance and marks the title as a copy', async () => {
      const source = buildContentItem();
      contentRepository.findOne.mockResolvedValue(source);
      contentRepository.save.mockImplementation((value: unknown) =>
        Promise.resolve({ ...(value as object), id: OTHER_CONTENT_ID }),
      );
      runTransaction();

      await service.duplicate(clientScope, CONTENT_ID, 'actor-1');

      const created = firstCallArg<SocialContentItemEntity>(
        contentRepository.create,
      );

      expect(created.title).toBe('Lançamento de outubro (cópia)');
      expect(created.copy).toBe('copy atual');
      expect(created.caption).toBe('legenda');
      expect(created.hashtags).toEqual(['#lyra', '#social']);
      expect(created.planningStatus).toBe('ready');
      expect(created.plannedDate).toBe('2026-10-01');
      expect(created.planId).toBe(PLAN_ID);
    });

    /**
     * A clone that carried the original's revision pointer would make two
     * content items share one mutable revision row, so editing either would
     * silently rewrite the other's history.
     */
    it('gives the clone no revision history and no lifecycle stamps', async () => {
      contentRepository.findOne.mockResolvedValue(
        buildContentItem({ currentRevisionId: 'revision-9' }),
      );
      runTransaction();

      await service.duplicate(clientScope, CONTENT_ID, 'actor-1');

      const created = firstCallArg<SocialContentItemEntity>(
        contentRepository.create,
      );

      expect(created.currentRevisionId).toBeNull();
      expect(created.archivedAt).toBeNull();
      expect(created.deletedAt).toBeNull();
    });

    /** Scope is taken from the request context, never from the source row. */
    it('writes the caller scope, not the scope stored on the source row', async () => {
      contentRepository.findOne.mockResolvedValue(
        buildContentItem({
          tenantId: 'other-tenant',
          workspaceId: 'other-workspace',
          agencyClientId: 'other-client',
        }),
      );
      runTransaction();

      await service.duplicate(agencyScope, CONTENT_ID, 'actor-1');

      const created = firstCallArg<SocialContentItemEntity>(
        contentRepository.create,
      );

      expect(created.tenantId).toBe(TENANT_ID);
      expect(created.workspaceId).toBe(WORKSPACE_ID);
      expect(created.agencyClientId).toBeNull();
    });

    it('clones destinations and re-points each creative at the new destination', async () => {
      contentRepository.findOne.mockResolvedValue(buildContentItem());
      contentRepository.save.mockImplementation((value: unknown) =>
        Promise.resolve({ ...(value as object), id: OTHER_CONTENT_ID }),
      );

      destinationsRepository.find.mockResolvedValue([
        {
          id: DESTINATION_ID,
          contentItemId: CONTENT_ID,
          channel: 'instagram',
          placement: 'feed',
          plannedAt: new Date('2026-10-01T12:00:00.000Z'),
        },
      ]);
      destinationsRepository.save.mockImplementation((value: unknown) =>
        Promise.resolve({ ...(value as object), id: 'new-destination' }),
      );

      creativesRepository.find.mockResolvedValue([
        {
          id: 'creative-1',
          destinationId: DESTINATION_ID,
          contentItemId: CONTENT_ID,
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
          role: 'primary',
          sortOrder: 0,
          source: 'creative_studio',
        },
      ]);

      runTransaction();

      await service.duplicate(clientScope, CONTENT_ID, 'actor-1');

      const clonedCreative = firstCallArg<{
        destinationId: string;
        contentItemId: string;
        mediaAssetId: string;
        organicAssetId: string;
        source: string;
      }>(creativesRepository.create);

      expect(clonedCreative.destinationId).toBe('new-destination');
      expect(clonedCreative.contentItemId).toBe(OTHER_CONTENT_ID);
      /** The same file, not a copy of it. */
      expect(clonedCreative.mediaAssetId).toBe(MEDIA_ASSET_ID);
      expect(clonedCreative.organicAssetId).toBe(ORGANIC_ASSET_ID);
      /** Provenance survives: the file really did come from Creative Studio. */
      expect(clonedCreative.source).toBe('creative_studio');
    });

    it('does everything in one transaction', async () => {
      contentRepository.findOne.mockResolvedValue(buildContentItem());
      runTransaction();

      await service.duplicate(clientScope, CONTENT_ID, 'actor-1');

      expect(contentRepository.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it('refuses a content item outside the caller scope', async () => {
      contentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.duplicate(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contentRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('keeps the copy marker when the title would overflow the column', async () => {
      contentRepository.findOne.mockResolvedValue(
        buildContentItem({ title: 'x'.repeat(240) }),
      );
      runTransaction();

      await service.duplicate(clientScope, CONTENT_ID, 'actor-1');

      const created = firstCallArg<SocialContentItemEntity>(
        contentRepository.create,
      );

      expect(created.title.length).toBeLessThanOrEqual(240);
      expect(created.title.endsWith(' (cópia)')).toBe(true);
    });
  });

  // --------------------------------------------------------------- archive

  describe('archive and restore', () => {
    it('stamps archivedAt and the actor', async () => {
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await service.archive(clientScope, CONTENT_ID, 'actor-1');

      const [, values] = contentRepository.update.mock.calls[0] as [
        unknown,
        { archivedAt: Date; archivedById: string },
      ];

      expect(values.archivedAt).toBeInstanceOf(Date);
      expect(values.archivedById).toBe('actor-1');
    });

    /**
     * Archiving must not touch `planningStatus`: it says how far the editorial
     * work got, and losing it would make restore unable to put the item back
     * where it was.
     */
    it('never writes planningStatus', async () => {
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await service.archive(clientScope, CONTENT_ID, 'actor-1');

      const [, values] = contentRepository.update.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];

      expect(values).not.toHaveProperty('planningStatus');
    });

    it('filters the update by scope and by the state it expects to find', async () => {
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await service.archive(clientScope, CONTENT_ID, 'actor-1');

      const [where] = contentRepository.update.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];

      expect(where.tenantId).toBe(TENANT_ID);
      expect(where.workspaceId).toBe(WORKSPACE_ID);
      expect(where.agencyClientId).toBe(CLIENT_ID);
      expect(where.deletedAt).toEqual(IsNull());
      expect(where.archivedAt).toEqual(IsNull());
    });

    it('uses IsNull for the agency context instead of a raw null', async () => {
      contentRepository.findOne.mockResolvedValue(
        buildContentItem({ agencyClientId: null }),
      );

      await service.archive(agencyScope, CONTENT_ID, 'actor-1');

      const [where] = contentRepository.update.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];

      expect(where.agencyClientId).toEqual(IsNull());
    });

    it('refuses to archive an already archived item', async () => {
      contentRepository.findOne.mockResolvedValue(
        buildContentItem({ archivedAt: new Date() }),
      );

      await expect(
        service.archive(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(contentRepository.update).not.toHaveBeenCalled();
    });

    it('clears archivedAt and its actor on restore', async () => {
      contentRepository.findOne.mockResolvedValue(
        buildContentItem({ archivedAt: new Date(), archivedById: 'actor-9' }),
      );

      await service.restore(clientScope, CONTENT_ID, 'actor-1');

      const [where, values] = contentRepository.update.mock.calls[0] as [
        Record<string, unknown>,
        { archivedAt: Date | null; archivedById: string | null },
      ];

      expect(values.archivedAt).toBeNull();
      expect(values.archivedById).toBeNull();
      expect(where.archivedAt).toEqual(Not(IsNull()));
    });

    it('refuses to restore an item that is not archived', async () => {
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await expect(
        service.restore(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers not found for an item in another scope', async () => {
      contentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.archive(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- delete

  describe('remove', () => {
    it('hard deletes an unscheduled Calendar draft after the publication guard approves', async () => {
      registerPermissiveSource();
      contentRepository.findOne.mockResolvedValue(buildContentItem());
      contentRepository.delete.mockResolvedValue({ affected: 1 });

      await service.discard(clientScope, CONTENT_ID);

      expect(contentRepository.update).not.toHaveBeenCalled();
      expect(contentRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: CONTENT_ID,
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          agencyClientId: CLIENT_ID,
          deletedAt: IsNull(),
        }),
      );
    });

    it('never hard deletes a Calendar draft once publication evidence exists', async () => {
      registerBlockingSource(['scheduled']);
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await expect(
        service.discard(clientScope, CONTENT_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(contentRepository.delete).not.toHaveBeenCalled();
    });

    it('soft deletes rather than deleting the row', async () => {
      registerPermissiveSource();
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await service.remove(clientScope, CONTENT_ID, 'actor-1');

      expect(contentRepository.delete).not.toHaveBeenCalled();

      const [, values] = contentRepository.update.mock.calls[0] as [
        unknown,
        { deletedAt: Date; deletedById: string },
      ];

      expect(values.deletedAt).toBeInstanceOf(Date);
      expect(values.deletedById).toBe('actor-1');
    });

    /**
     * Destinations and creatives survive so a future restore does not find an
     * item stripped of its editorial work. They are already invisible, because
     * every read reaches them through the content item.
     */
    it('leaves destinations and creatives intact', async () => {
      registerPermissiveSource();
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await service.remove(clientScope, CONTENT_ID, 'actor-1');

      expect(destinationsRepository.delete).not.toHaveBeenCalled();
      expect(creativesRepository.delete).not.toHaveBeenCalled();
    });

    it('refuses when a publication is scheduled, and says which statuses block it', async () => {
      registerBlockingSource(['scheduled']);
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await expect(
        service.remove(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(contentRepository.update).not.toHaveBeenCalled();
    });

    it('refuses when the content was already published', async () => {
      registerBlockingSource(['published']);
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await expect(
        service.remove(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    /**
     * The single most important test in this file: with no source registered
     * the guard cannot answer, and an unanswerable question must not read as
     * permission. Fail closed.
     */
    it('refuses to delete when no publication source is registered', async () => {
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await expect(
        service.remove(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(contentRepository.update).not.toHaveBeenCalled();
    });

    it('asks the guard with the caller scope, never with a body-supplied one', async () => {
      const findBlocking = registerPermissiveSource();
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      await service.remove(clientScope, CONTENT_ID, 'actor-1');

      expect(findBlocking).toHaveBeenCalledWith({
        scope: clientScope,
        contentItemIds: [CONTENT_ID],
      });
    });

    it('answers not found for an item in another scope, without deleting', async () => {
      registerPermissiveSource();
      contentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.remove(clientScope, CONTENT_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contentRepository.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- delete plan

  describe('removePlan', () => {
    /** Runs the transaction callback against the same repository mocks. */
    function runPlanTransaction(): void {
      contentRepository.manager.transaction.mockImplementation(
        async (callback: (manager: unknown) => Promise<unknown>) =>
          callback({
            getRepository: (entity: unknown) =>
              entity === SocialPlanEntity ? plansRepository : contentRepository,
          }),
      );
    }

    function livePlan() {
      return { id: PLAN_ID, deletedAt: null } as SocialPlanEntity;
    }

    it('stamps the plan and its content instead of deleting rows', async () => {
      registerPermissiveSource();
      plansRepository.findOne.mockResolvedValue(livePlan());
      contentRepository.find.mockResolvedValue([{ id: CONTENT_ID }]);
      runPlanTransaction();

      await service.removePlan(clientScope, PLAN_ID, 'actor-1');

      expect(plansRepository.delete).not.toHaveBeenCalled();
      expect(contentRepository.delete).not.toHaveBeenCalled();

      const [, contentValues] = contentRepository.update.mock.calls[0] as [
        unknown,
        { deletedAt: Date; deletedById: string },
      ];
      const [, planValues] = plansRepository.update.mock.calls[0] as [
        unknown,
        { deletedAt: Date; deletedById: string },
      ];

      expect(contentValues.deletedById).toBe('actor-1');
      expect(planValues.deletedById).toBe('actor-1');
      /** One stamp for the whole operation, so the two can never disagree. */
      expect(planValues.deletedAt).toEqual(contentValues.deletedAt);
    });

    /**
     * The plan-level counterpart of the single most important test above: a
     * guard that cannot answer is not a guard that said yes.
     */
    it('refuses when no publication source is registered', async () => {
      plansRepository.findOne.mockResolvedValue(livePlan());
      contentRepository.find.mockResolvedValue([{ id: CONTENT_ID }]);

      await expect(
        service.removePlan(clientScope, PLAN_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(plansRepository.update).not.toHaveBeenCalled();
      expect(contentRepository.update).not.toHaveBeenCalled();
    });

    /**
     * One blocked item stops the whole plan. A partial delete would leave a
     * removed plan owning live content that the calendar still shows.
     */
    it('refuses the whole plan when any item has a live publication', async () => {
      registerBlockingSource(['published']);
      plansRepository.findOne.mockResolvedValue(livePlan());
      contentRepository.find.mockResolvedValue([
        { id: CONTENT_ID },
        { id: OTHER_CONTENT_ID },
      ]);

      await expect(
        service.removePlan(clientScope, PLAN_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(plansRepository.update).not.toHaveBeenCalled();
      expect(contentRepository.update).not.toHaveBeenCalled();
    });

    it('deletes an empty plan without asking about any content', async () => {
      const findBlocking = registerPermissiveSource();
      plansRepository.findOne.mockResolvedValue(livePlan());
      contentRepository.find.mockResolvedValue([]);
      runPlanTransaction();

      await service.removePlan(clientScope, PLAN_ID, 'actor-1');

      expect(findBlocking).not.toHaveBeenCalled();
      expect(contentRepository.update).not.toHaveBeenCalled();
      expect(plansRepository.update).toHaveBeenCalled();
    });

    it('answers not found for a plan in another scope, without deleting', async () => {
      registerPermissiveSource();
      plansRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removePlan(clientScope, PLAN_ID, 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(plansRepository.update).not.toHaveBeenCalled();
    });

    it('reads only live content, so an already deleted item is not restamped', async () => {
      registerPermissiveSource();
      plansRepository.findOne.mockResolvedValue(livePlan());
      contentRepository.find.mockResolvedValue([{ id: CONTENT_ID }]);
      runPlanTransaction();

      await service.removePlan(clientScope, PLAN_ID, 'actor-1');

      const [{ where }] = contentRepository.find.mock.calls[0] as [
        { where: { deletedAt: unknown; planId: string } },
      ];

      expect(where.planId).toBe(PLAN_ID);
      expect(where.deletedAt).toEqual(IsNull());
    });
  });

  // ----------------------------------------------------------------- batch

  describe('batch actions', () => {
    it('reports success and failure per item instead of failing the batch', async () => {
      registerBlockingSource(['queued']);

      contentRepository.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            buildContentItem({
              id: where.id,
            }),
          ),
      );

      const result = await service.removeMany(
        clientScope,
        [CONTENT_ID, OTHER_CONTENT_ID],
        'actor-1',
      );

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);

      const blocked = result.items.find(
        (item) => item.contentId === CONTENT_ID,
      );

      expect(blocked).toEqual({
        contentId: CONTENT_ID,
        status: 'failed',
        reason: 'has_publications',
        blockingStatuses: ['queued'],
      });

      expect(
        result.items.find((item) => item.contentId === OTHER_CONTENT_ID),
      ).toEqual({ contentId: OTHER_CONTENT_ID, status: 'ok' });
    });

    /** One cross-domain call for the whole batch, not one per id. */
    it('asks the publication guard once for the whole batch', async () => {
      const findBlocking = registerPermissiveSource();
      contentRepository.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(buildContentItem({ id: where.id })),
      );

      await service.removeMany(
        clientScope,
        [CONTENT_ID, OTHER_CONTENT_ID],
        'actor-1',
      );

      expect(findBlocking).toHaveBeenCalledTimes(1);
      expect(findBlocking).toHaveBeenCalledWith({
        scope: clientScope,
        contentItemIds: [CONTENT_ID, OTHER_CONTENT_ID],
      });
    });

    it('fails every item when the guard is unavailable', async () => {
      contentRepository.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(buildContentItem({ id: where.id })),
      );

      const result = await service.removeMany(
        clientScope,
        [CONTENT_ID, OTHER_CONTENT_ID],
        'actor-1',
      );

      expect(result.succeeded).toBe(0);
      expect(
        result.items.every(
          (item) =>
            item.status === 'failed' && item.reason === 'guard_unavailable',
        ),
      ).toBe(true);
    });

    it('reports an out-of-scope id as not found without touching the others', async () => {
      registerPermissiveSource();
      contentRepository.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === CONTENT_ID ? buildContentItem() : null),
      );

      const result = await service.removeMany(
        clientScope,
        [CONTENT_ID, OTHER_CONTENT_ID],
        'actor-1',
      );

      expect(result.succeeded).toBe(1);
      expect(
        result.items.find((item) => item.contentId === OTHER_CONTENT_ID),
      ).toEqual({
        contentId: OTHER_CONTENT_ID,
        status: 'failed',
        reason: 'not_found',
      });
    });

    it('acts once on a repeated id and echoes the same verdict', async () => {
      registerPermissiveSource();
      contentRepository.findOne.mockResolvedValue(buildContentItem());

      const result = await service.removeMany(
        clientScope,
        [CONTENT_ID, CONTENT_ID],
        'actor-1',
      );

      expect(result.items).toHaveLength(2);
      expect(contentRepository.update).toHaveBeenCalledTimes(1);
    });

    it('reports an already archived item instead of counting it as success', async () => {
      contentRepository.findOne.mockResolvedValue(
        buildContentItem({ archivedAt: new Date() }),
      );

      const result = await service.archiveMany(
        clientScope,
        [CONTENT_ID],
        'actor-1',
      );

      expect(result.succeeded).toBe(0);
      expect(result.items[0]).toEqual({
        contentId: CONTENT_ID,
        status: 'failed',
        reason: 'already_archived',
      });
    });
  });

  // ------------------------------------------------------------------ CSV

  describe('exportPlanContentCsv', () => {
    it('excludes soft-deleted rows and, by default, archived ones', async () => {
      contentRepository.find.mockResolvedValue([]);

      await service.exportPlanContentCsv(clientScope, PLAN_ID);

      const [{ where }] = contentRepository.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];

      expect(where.deletedAt).toEqual(IsNull());
      expect(where.archivedAt).toEqual(IsNull());
    });

    it('reads only archived rows when asked for the archive view', async () => {
      contentRepository.find.mockResolvedValue([]);

      await service.exportPlanContentCsv(clientScope, PLAN_ID, 'only');

      const [{ where }] = contentRepository.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];

      expect(where.archivedAt).toEqual(Not(IsNull()));
      expect(where.deletedAt).toEqual(IsNull());
    });

    it('never exports media storage details', async () => {
      contentRepository.find.mockResolvedValue([buildContentItem()]);
      destinationsRepository.find.mockResolvedValue([
        {
          id: DESTINATION_ID,
          contentItemId: CONTENT_ID,
          channel: 'instagram',
          placement: 'feed',
          plannedAt: null,
        },
      ]);

      const csv = await service.exportPlanContentCsv(clientScope, PLAN_ID);

      expect(csv).not.toContain('storagePath');
      expect(csv).not.toContain('media');
      expect(csv).toContain('instagram:feed');
    });

    it('neutralizes a formula hidden in operator text', async () => {
      contentRepository.find.mockResolvedValue([
        buildContentItem({ title: '=1+1', cta: '@SUM(A1)' }),
      ]);

      const csv = await service.exportPlanContentCsv(clientScope, PLAN_ID);

      expect(csv).toContain("'=1+1");
      expect(csv).toContain("'@SUM(A1)");
    });
  });
});
