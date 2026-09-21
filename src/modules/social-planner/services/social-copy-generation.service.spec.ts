/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment --
 * The transaction mocks hand a fake EntityManager to the code under test, so the
 * callback's parameter and return are untyped by construction. Typing them fully
 * would mean reimplementing EntityManager to assert behaviour that does not
 * depend on it.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsNull, type Repository } from 'typeorm';
import type {
  SocialCampaignInstanceEntity,
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialCopyGenerationProposalEntity,
  SocialCopyGenerationRunEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
} from '../entities';
import type { SocialCopyGenerationConfigService } from './social-copy-generation-config.service';
import { SocialCopyGenerationStateMachine } from './social-copy-generation-state-machine';
import { SocialCopyGenerationService } from './social-copy-generation.service';
import type { SocialPlannerSettingsService } from './social-planner-settings.service';
import type { SocialPlannerScope } from './social-planner.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const CONTENT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_CONTENT_ID = '66666666-6666-4666-8666-666666666666';
const RUN_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_RUN_ID = '88888888-8888-4888-8888-888888888888';
const PROPOSAL_ID = '99999999-9999-4999-8999-999999999999';
const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type RepositoryMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
  manager: { transaction: jest.Mock; getRepository: jest.Mock };
};

function createRepositoryMock(): RepositoryMock {
  return {
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(null)),
    findOneBy: jest.fn(() => Promise.resolve(null)),
    count: jest.fn(() => Promise.resolve(0)),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(),
    manager: { transaction: jest.fn(), getRepository: jest.fn() },
  };
}

/** A query builder that answers a single SUM, for the budget query. */
function sumQueryBuilder(total: string) {
  const builder = {
    innerJoin: jest.fn(() => builder),
    select: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    getRawOne: jest.fn(() => Promise.resolve({ total })),
  };
  return builder;
}

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

function buildItem(
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
    caption: 'legenda atual',
    script: null,
    cta: 'Saiba mais',
    hashtags: ['#lyra'],
    firstComment: null,
    currentRevisionId: 'revision-1',
    funnelStage: 'consideration',
    contentType: 'testimonial',
    objective: 'engagement',
    creativeFormat: 'feed_image',
    planningStatus: 'planned',
    plannedDate: '2026-09-12',
    sortOrder: 0,
    campaignInstanceId: null,
    editorialPillarId: null,
    archivedAt: null,
    archivedById: null,
    deletedAt: null,
    deletedById: null,
    createdById: ACTOR_ID,
    updatedById: ACTOR_ID,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as SocialContentItemEntity;
}

function buildRun(
  overrides: Partial<SocialCopyGenerationRunEntity> = {},
): SocialCopyGenerationRunEntity {
  return {
    id: RUN_ID,
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    agencyClientId: CLIENT_ID,
    planId: PLAN_ID,
    contentItemId: CONTENT_ID,
    runKind: 'content_copy',
    idempotencyKey: 'planner-copy:content:1',
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    availableAt: new Date('2026-09-10T00:00:00.000Z'),
    lockedAt: null,
    lockedBy: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    deadLetteredAt: null,
    lastError: null,
    provider: null,
    model: null,
    promptVersion: null,
    contextVersion: 'planner-context-v1',
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    costCents: null,
    costIsEstimated: true,
    latencyMs: null,
    requestedFields: null,
    instruction: null,
    requestedById: ACTOR_ID,
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    ...overrides,
  } as SocialCopyGenerationRunEntity;
}

function buildProposal(
  overrides: Partial<SocialCopyGenerationProposalEntity> = {},
): SocialCopyGenerationProposalEntity {
  return {
    id: PROPOSAL_ID,
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    agencyClientId: CLIENT_ID,
    runId: RUN_ID,
    contentItemId: CONTENT_ID,
    field: 'caption',
    value: 'legenda gerada',
    baseValue: 'legenda atual',
    rationale: 'Tom mais direto.',
    status: 'pending',
    appliedRevisionId: null,
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-09-10T00:10:00.000Z'),
    ...overrides,
  } as SocialCopyGenerationProposalEntity;
}

describe('SocialCopyGenerationService', () => {
  let runs: RepositoryMock;
  let proposals: RepositoryMock;
  let content: RepositoryMock;
  let destinations: RepositoryMock;
  let plans: RepositoryMock;
  let campaigns: RepositoryMock;
  let pillars: RepositoryMock;
  let settingsService: { getSettings: jest.Mock };
  let config: SocialCopyGenerationConfigService;
  let service: SocialCopyGenerationService;

  function build(mode: 'disabled' | 'mock' | 'live' = 'live') {
    config = {
      mode,
      maxAttempts: 3,
      maxItemsPerRequest: 3,
      maxContextChars: 12_000,
      dailyBudgetCents: 500,
      reserveCents: 5,
    } as unknown as SocialCopyGenerationConfigService;

    service = new SocialCopyGenerationService(
      runs as unknown as Repository<SocialCopyGenerationRunEntity>,
      proposals as unknown as Repository<SocialCopyGenerationProposalEntity>,
      content as unknown as Repository<SocialContentItemEntity>,
      destinations as unknown as Repository<SocialContentDestinationEntity>,
      plans as unknown as Repository<SocialPlanEntity>,
      campaigns as unknown as Repository<SocialCampaignInstanceEntity>,
      pillars as unknown as Repository<SocialEditorialPillarEntity>,
      settingsService as unknown as SocialPlannerSettingsService,
      config,
      new SocialCopyGenerationStateMachine(),
    );
  }

  it('reports provider availability without loading a content item', () => {
    build('disabled');
    expect(service.availability()).toEqual({ providerEnabled: false });

    build('live');
    expect(service.availability()).toEqual({ providerEnabled: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    runs = createRepositoryMock();
    proposals = createRepositoryMock();
    content = createRepositoryMock();
    destinations = createRepositoryMock();
    plans = createRepositoryMock();
    plans.findOne.mockResolvedValue({
      id: PLAN_ID,
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      agencyClientId: CLIENT_ID,
      companyContextId: clientScope.companyContextId,
    });
    campaigns = createRepositoryMock();
    pillars = createRepositoryMock();
    settingsService = { getSettings: jest.fn() };

    runs.createQueryBuilder.mockReturnValue(sumQueryBuilder('0'));

    /**
     * A real `save` returns the persisted row, so the generated id and the
     * `@CreateDateColumn` timestamps exist by the time the view projects it.
     * Without that here, every assertion would fail on the view rather than on
     * the behaviour under test.
     */
    runs.save.mockImplementation((value: Record<string, unknown>) =>
      Promise.resolve({
        id: RUN_ID,
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
        updatedAt: new Date('2026-09-10T00:00:00.000Z'),
        ...value,
      }),
    );

    build();
  });

  describe('requestForContent', () => {
    it('refuses while the provider is disabled, without touching the queue', async () => {
      build('disabled');

      await expect(
        service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {}),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(runs.save).not.toHaveBeenCalled();
    });

    it('filters the content by resource and scope together', async () => {
      content.findOne.mockResolvedValue(buildItem());

      await service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {});

      expect(content.findOne).toHaveBeenCalledWith({
        where: {
          id: CONTENT_ID,
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          agencyClientId: CLIENT_ID,
          deletedAt: IsNull(),
        },
      });
    });

    /**
     * §3 of the handoff: a raw `null` is not a safe TypeORM filter, so an agency
     * context must ask for `IsNull()` or it would match every client's rows.
     */
    it('uses IsNull for the agency context rather than a raw null', async () => {
      content.findOne.mockResolvedValue(buildItem({ agencyClientId: null }));

      await service.requestForContent(agencyScope, CONTENT_ID, ACTOR_ID, {});

      expect(content.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agencyClientId: IsNull() }),
        }),
      );
    });

    it('reports content outside the caller scope as not found', async () => {
      content.findOne.mockResolvedValue(null);

      await expect(
        service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to generate for archived content', async () => {
      content.findOne.mockResolvedValue(
        buildItem({ archivedAt: new Date('2026-09-09T00:00:00.000Z') }),
      );

      await expect(
        service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    /**
     * A second click while the first run is still going must not buy a second
     * provider call.
     */
    it('returns the in-flight run instead of enqueueing a duplicate', async () => {
      content.findOne.mockResolvedValue(buildItem());
      runs.findOne.mockResolvedValue(buildRun({ status: 'processing' }));

      const result = await service.requestForContent(
        clientScope,
        CONTENT_ID,
        ACTOR_ID,
        {},
      );

      expect(result.id).toBe(RUN_ID);
      expect(runs.save).not.toHaveBeenCalled();
    });

    it('persists an explicit field list and the operator instruction', async () => {
      content.findOne.mockResolvedValue(buildItem());
      runs.count.mockResolvedValue(0);

      await service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {
        fields: ['caption', 'hashtags'],
        instruction: '  mais curto  ',
      });

      expect(runs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          contentItemId: CONTENT_ID,
          planId: PLAN_ID,
          status: 'queued',
          runKind: 'content_copy',
          requestedFields: ['caption', 'hashtags'],
          instruction: 'mais curto',
          requestedById: ACTOR_ID,
        }),
      );
    });

    /**
     * An omitted list must stay NULL, so the worker derives the fields from the
     * item as it is when the prompt is built.
     */
    it('leaves the field list null when the caller did not choose', async () => {
      content.findOne.mockResolvedValue(buildItem());

      await service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {});

      expect(runs.save).toHaveBeenCalledWith(
        expect.objectContaining({ requestedFields: null, instruction: null }),
      );
    });

    it('never copies scope out of the content row instead of the request scope', async () => {
      content.findOne.mockResolvedValue(
        buildItem({
          agencyClientId: 'a-different-client' as unknown as string,
        }),
      );

      await service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {});

      expect(runs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          agencyClientId: CLIENT_ID,
        }),
      );
    });

    it('refuses when the daily budget is spent', async () => {
      content.findOne.mockResolvedValue(buildItem());
      runs.createQueryBuilder.mockReturnValue(sumQueryBuilder('500'));

      await expect(
        service.requestForContent(clientScope, CONTENT_ID, ACTOR_ID, {}),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(runs.save).not.toHaveBeenCalled();
    });
  });

  describe('requestForSelection', () => {
    it('reports each item separately and never collapses to one flag', async () => {
      content.find.mockResolvedValue([
        buildItem(),
        buildItem({
          id: OTHER_CONTENT_ID,
          archivedAt: new Date('2026-09-09T00:00:00.000Z'),
        }),
      ]);

      const result = await service.requestForSelection(clientScope, ACTOR_ID, {
        contentIds: [CONTENT_ID, OTHER_CONTENT_ID],
      });

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.items).toEqual([
        { contentId: CONTENT_ID, status: 'ok', runId: expect.any(String) },
        { contentId: OTHER_CONTENT_ID, status: 'failed', reason: 'archived' },
      ]);
    });

    /**
     * A selection that crossed a context boundary is something the operator must
     * be told about, not something to skip quietly.
     */
    it('reports ids the caller cannot see as not_found', async () => {
      content.find.mockResolvedValue([]);

      const result = await service.requestForSelection(clientScope, ACTOR_ID, {
        contentIds: [CONTENT_ID],
      });

      expect(result.items).toEqual([
        { contentId: CONTENT_ID, status: 'failed', reason: 'not_found' },
      ]);
    });

    it('reports an item already generating as already_running', async () => {
      content.find.mockResolvedValue([buildItem()]);
      runs.findOne.mockResolvedValue(buildRun({ status: 'queued' }));

      const result = await service.requestForSelection(clientScope, ACTOR_ID, {
        contentIds: [CONTENT_ID],
      });

      expect(result.items).toEqual([
        { contentId: CONTENT_ID, status: 'failed', reason: 'already_running' },
      ]);
      expect(runs.save).not.toHaveBeenCalled();
    });

    /**
     * The partial unique index is the real authority on "one live run per item",
     * so losing that race must report the same reason as the checked case.
     */
    it('treats a unique-index collision as already_running', async () => {
      content.find.mockResolvedValue([buildItem()]);
      runs.save.mockRejectedValue(new Error('duplicate key value'));

      const result = await service.requestForSelection(clientScope, ACTOR_ID, {
        contentIds: [CONTENT_ID],
      });

      expect(result.items).toEqual([
        { contentId: CONTENT_ID, status: 'failed', reason: 'already_running' },
      ]);
    });

    it('trims past the configured ceiling and says so per item', async () => {
      const ids = [
        CONTENT_ID,
        OTHER_CONTENT_ID,
        '12121212-1212-4212-8212-121212121212',
        '13131313-1313-4313-8313-131313131313',
      ];
      content.find.mockResolvedValue(
        ids.slice(0, 3).map((id) => buildItem({ id })),
      );

      const result = await service.requestForSelection(clientScope, ACTOR_ID, {
        contentIds: ids,
      });

      expect(result.items).toHaveLength(4);
      expect(result.items.at(-1)).toEqual({
        contentId: ids[3],
        status: 'failed',
        reason: 'limit_exceeded',
      });
    });

    it('stops enqueueing once the budget runs out mid-batch', async () => {
      content.find.mockResolvedValue([
        buildItem(),
        buildItem({ id: OTHER_CONTENT_ID }),
      ]);
      // Room for exactly one reservation of 5 cents.
      runs.createQueryBuilder.mockReturnValue(sumQueryBuilder('492'));

      const result = await service.requestForSelection(clientScope, ACTOR_ID, {
        contentIds: [CONTENT_ID, OTHER_CONTENT_ID],
      });

      expect(result.succeeded).toBe(1);
      expect(result.items.at(-1)).toEqual({
        contentId: OTHER_CONTENT_ID,
        status: 'failed',
        reason: 'budget_exhausted',
      });
    });

    it('deduplicates repeated ids in one request', async () => {
      content.find.mockResolvedValue([buildItem()]);

      const result = await service.requestForSelection(clientScope, ACTOR_ID, {
        contentIds: [CONTENT_ID, CONTENT_ID],
      });

      expect(result.items).toHaveLength(1);
    });
  });

  describe('requestForPlan', () => {
    it('reports an unknown plan as not found', async () => {
      plans.findOne.mockResolvedValue(null);

      await expect(
        service.requestForPlan(clientScope, PLAN_ID, ACTOR_ID, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /** Archived items are excluded at the query, not filtered afterwards. */
    it('asks only for live, non-archived content of the plan', async () => {
      plans.findOne.mockResolvedValue({ id: PLAN_ID });
      content.find.mockResolvedValue([]);

      await service.requestForPlan(clientScope, PLAN_ID, ACTOR_ID, {});

      expect(content.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            planId: PLAN_ID,
            archivedAt: IsNull(),
            deletedAt: IsNull(),
          }),
        }),
      );
    });
  });

  describe('cancelRun', () => {
    function transactionOver(run: SocialCopyGenerationRunEntity | null) {
      const repository = createRepositoryMock();
      repository.findOne.mockResolvedValue(run);
      runs.manager.transaction.mockImplementation(
        async (callback: (manager: unknown) => unknown) =>
          callback({ getRepository: () => repository }),
      );
      return repository;
    }

    it('cancels a queued run', async () => {
      const repository = transactionOver(buildRun({ status: 'queued' }));

      const result = await service.cancelRun(clientScope, RUN_ID);

      expect(result.status).toBe('cancelled');
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled', lockedBy: null }),
      );
    });

    /**
     * A processing run cannot recall its HTTP request, but the operator's intent
     * still has to be recorded — the worker re-reads the row before staging.
     */
    it('cancels a run that is already processing', async () => {
      transactionOver(buildRun({ status: 'processing', attempts: 1 }));

      const result = await service.cancelRun(clientScope, RUN_ID);

      expect(result.status).toBe('cancelled');
    });

    it('refuses to cancel a finished run', async () => {
      transactionOver(buildRun({ status: 'succeeded' }));

      await expect(
        service.cancelRun(clientScope, RUN_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports a run outside the caller scope as not found', async () => {
      transactionOver(null);

      await expect(
        service.cancelRun(clientScope, RUN_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acceptProposals', () => {
    function transactionOver(options: {
      item: SocialContentItemEntity | null;
      found: SocialCopyGenerationProposalEntity[];
      latestRevisionNumber?: number;
    }) {
      const contentRepository = createRepositoryMock();
      const proposalsRepository = createRepositoryMock();
      const revisionsRepository = createRepositoryMock();

      contentRepository.findOne.mockResolvedValue(options.item);
      proposalsRepository.find.mockResolvedValue(options.found);
      revisionsRepository.findOne.mockResolvedValue(
        options.latestRevisionNumber
          ? { revisionNumber: options.latestRevisionNumber }
          : null,
      );
      revisionsRepository.create.mockImplementation((value: unknown) => ({
        ...(value as Record<string, unknown>),
        id: 'new-revision',
      }));
      revisionsRepository.save.mockImplementation((value: unknown) =>
        Promise.resolve(value),
      );

      runs.manager.transaction.mockImplementation(
        async (callback: (manager: unknown) => unknown) =>
          callback({
            getRepository: (entity: { name?: string }) => {
              const name = entity?.name ?? '';
              if (name.includes('Proposal')) return proposalsRepository;
              if (name.includes('Revision')) return revisionsRepository;
              return contentRepository;
            },
          }),
      );

      return { contentRepository, proposalsRepository, revisionsRepository };
    }

    it('writes one revision carrying ai provenance and the run id', async () => {
      const { revisionsRepository, contentRepository } = transactionOver({
        item: buildItem(),
        found: [buildProposal()],
        latestRevisionNumber: 4,
      });

      const result = await service.acceptProposals(
        clientScope,
        CONTENT_ID,
        ACTOR_ID,
        { proposalIds: [PROPOSAL_ID] },
      );

      expect(revisionsRepository.save).toHaveBeenCalledTimes(1);
      expect(revisionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contentItemId: CONTENT_ID,
          revisionNumber: 5,
          caption: 'legenda gerada',
          source: 'ai',
          generationRunId: RUN_ID,
          parentRevisionId: 'revision-1',
          createdById: ACTOR_ID,
        }),
      );
      expect(contentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          caption: 'legenda gerada',
          currentRevisionId: 'new-revision',
        }),
      );
      expect(result.revisionId).toBe('new-revision');
    });

    /**
     * Fields nobody accepted must carry through unchanged. A revision is a
     * snapshot of all six, so an accept of one field must not blank the others.
     */
    it('preserves the fields that were not part of the accepted set', async () => {
      const { revisionsRepository } = transactionOver({
        item: buildItem(),
        found: [buildProposal()],
      });

      await service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
        proposalIds: [PROPOSAL_ID],
      });

      expect(revisionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          copy: 'copy atual',
          cta: 'Saiba mais',
          hashtags: ['#lyra'],
        }),
      );
    });

    it('marks the accepted proposals with the revision that applied them', async () => {
      const { proposalsRepository } = transactionOver({
        item: buildItem(),
        found: [buildProposal()],
      });

      await service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
        proposalIds: [PROPOSAL_ID],
      });

      expect(proposalsRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'accepted',
          appliedRevisionId: 'new-revision',
          decidedById: ACTOR_ID,
        }),
      );
    });

    /**
     * The rule that protects a manual edit made while the run was in flight.
     */
    it('refuses when the field changed after the generation ran', async () => {
      transactionOver({
        item: buildItem({ caption: 'editada à mão depois' }),
        found: [buildProposal()],
      });

      await expect(
        service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
          proposalIds: [PROPOSAL_ID],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts the changed base only when the operator says so explicitly', async () => {
      const { revisionsRepository } = transactionOver({
        item: buildItem({ caption: 'editada à mão depois' }),
        found: [buildProposal()],
      });

      await service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
        proposalIds: [PROPOSAL_ID],
        overrideChangedBase: true,
      });

      expect(revisionsRepository.save).toHaveBeenCalledTimes(1);
    });

    /**
     * An empty string and a NULL are the same editorial state, so reporting a
     * conflict there would block an accept for a reason nobody could see.
     */
    it('does not call an empty string a change from null', async () => {
      const { revisionsRepository } = transactionOver({
        item: buildItem({ caption: '' }),
        found: [buildProposal({ baseValue: null })],
      });

      await service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
        proposalIds: [PROPOSAL_ID],
      });

      expect(revisionsRepository.save).toHaveBeenCalledTimes(1);
    });

    it('compares hashtag arrays element by element', async () => {
      transactionOver({
        item: buildItem({ hashtags: ['#lyra', '#novo'] }),
        found: [
          buildProposal({
            field: 'hashtags',
            value: ['#gerado'],
            baseValue: ['#lyra'],
          }),
        ],
      });

      await expect(
        service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
          proposalIds: [PROPOSAL_ID],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps the stored first_comment column onto the contract field', async () => {
      const { revisionsRepository } = transactionOver({
        item: buildItem(),
        found: [
          buildProposal({
            field: 'first_comment',
            value: 'comentário gerado',
            baseValue: null,
          }),
        ],
      });

      await service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
        proposalIds: [PROPOSAL_ID],
      });

      expect(revisionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ firstComment: 'comentário gerado' }),
      );
    });

    it('refuses a proposal id that is not in the caller scope', async () => {
      transactionOver({ item: buildItem(), found: [] });

      await expect(
        service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
          proposalIds: [PROPOSAL_ID],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to accept a proposal that was already decided', async () => {
      transactionOver({
        item: buildItem(),
        found: [buildProposal({ status: 'accepted' })],
      });

      await expect(
        service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
          proposalIds: [PROPOSAL_ID],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    /**
     * One revision names one run, so mixing runs would make provenance a guess.
     */
    it('refuses to mix proposals from two different runs', async () => {
      transactionOver({
        item: buildItem(),
        found: [
          buildProposal(),
          buildProposal({
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            runId: OTHER_RUN_ID,
            field: 'cta',
            value: 'Clique aqui',
            baseValue: 'Saiba mais',
          }),
        ],
      });

      await expect(
        service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
          proposalIds: [PROPOSAL_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reports content outside the caller scope as not found', async () => {
      transactionOver({ item: null, found: [] });

      await expect(
        service.acceptProposals(clientScope, CONTENT_ID, ACTOR_ID, {
          proposalIds: [PROPOSAL_ID],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rejectProposals', () => {
    it('keeps the rejected row instead of deleting the decision', async () => {
      content.findOne.mockResolvedValue(buildItem());
      proposals.find.mockResolvedValue([buildProposal()]);

      const result = await service.rejectProposals(
        clientScope,
        CONTENT_ID,
        ACTOR_ID,
        [PROPOSAL_ID],
      );

      expect(result.rejectedProposalIds).toEqual([PROPOSAL_ID]);
      expect(proposals.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'rejected', decidedById: ACTOR_ID }),
      );
    });

    it('never touches the content item', async () => {
      content.findOne.mockResolvedValue(buildItem());
      proposals.find.mockResolvedValue([buildProposal()]);

      await service.rejectProposals(clientScope, CONTENT_ID, ACTOR_ID, [
        PROPOSAL_ID,
      ]);

      expect(content.save).not.toHaveBeenCalled();
      expect(content.update).not.toHaveBeenCalled();
    });

    it('only considers pending proposals in the caller scope', async () => {
      content.findOne.mockResolvedValue(buildItem());
      proposals.find.mockResolvedValue([]);

      await expect(
        service.rejectProposals(clientScope, CONTENT_ID, ACTOR_ID, [
          PROPOSAL_ID,
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(proposals.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'pending',
            agencyClientId: CLIENT_ID,
          }),
        }),
      );
    });
  });

  describe('listForContent', () => {
    it('tells the caller whether generation is available at all', async () => {
      content.findOne.mockResolvedValue(buildItem());

      expect(
        (await service.listForContent(clientScope, CONTENT_ID)).providerEnabled,
      ).toBe(true);

      build('disabled');
      content.findOne.mockResolvedValue(buildItem());

      expect(
        (await service.listForContent(clientScope, CONTENT_ID)).providerEnabled,
      ).toBe(false);
    });

    it('scopes both the runs and the proposals it returns', async () => {
      content.findOne.mockResolvedValue(buildItem());

      await service.listForContent(clientScope, CONTENT_ID);

      for (const repository of [runs, proposals])
        expect(repository.find).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              tenantId: TENANT_ID,
              workspaceId: WORKSPACE_ID,
              agencyClientId: CLIENT_ID,
            }),
          }),
        );
    });
  });

  describe('dailyBudgetRemaining', () => {
    it('subtracts what today already cost', async () => {
      runs.createQueryBuilder.mockReturnValue(sumQueryBuilder('120'));

      await expect(service.dailyBudgetRemaining(clientScope)).resolves.toBe(
        380,
      );
    });

    it('never reports a negative budget', async () => {
      runs.createQueryBuilder.mockReturnValue(sumQueryBuilder('900'));

      await expect(service.dailyBudgetRemaining(clientScope)).resolves.toBe(0);
    });

    it('treats a zero configured budget as no ceiling', async () => {
      config = {
        ...config,
        dailyBudgetCents: 0,
      } as unknown as SocialCopyGenerationConfigService;

      service = new SocialCopyGenerationService(
        runs as unknown as Repository<SocialCopyGenerationRunEntity>,
        proposals as unknown as Repository<SocialCopyGenerationProposalEntity>,
        content as unknown as Repository<SocialContentItemEntity>,
        destinations as unknown as Repository<SocialContentDestinationEntity>,
        plans as unknown as Repository<SocialPlanEntity>,
        campaigns as unknown as Repository<SocialCampaignInstanceEntity>,
        pillars as unknown as Repository<SocialEditorialPillarEntity>,
        settingsService as unknown as SocialPlannerSettingsService,
        config,
        new SocialCopyGenerationStateMachine(),
      );

      await expect(service.dailyBudgetRemaining(clientScope)).resolves.toBe(
        Number.MAX_SAFE_INTEGER,
      );
    });
  });

  describe('resolveWork', () => {
    it('filters a persisted field list against the closed vocabulary', async () => {
      content.findOne.mockResolvedValue(buildItem());
      plans.findOne.mockResolvedValue({
        id: PLAN_ID,
        title: 'Plano',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        primaryObjective: null,
        summary: null,
      });
      destinations.find.mockResolvedValue([]);
      settingsService.getSettings.mockResolvedValue({
        settings: {
          monthlyContentVolume: 12,
          funnelDistribution: {
            discovery: 25,
            recognition: 25,
            consideration: 25,
            decision: 25,
          },
          contentTypes: [],
          objectives: [],
          creativeFormats: [],
          ctaDefaults: {},
          hashtagDefaults: {
            mandatory: [],
            suggestedCount: 5,
            complementWithAi: false,
          },
          firstCommentDefaults: { enabled: false, template: null },
          hookLibrary: [],
          milestones: [],
        },
      });

      const work = await service.resolveWork(
        buildRun({
          requestedFields: ['caption', 'not_a_field'] as unknown as string[],
        }),
      );

      expect(work.fields.map((field) => field.field)).toEqual(['caption']);
      expect(work.contextVersion).toBe('planner-context-v1');
    });

    it('passes the live value of each field as the base for the prompt', async () => {
      content.findOne.mockResolvedValue(buildItem());
      plans.findOne.mockResolvedValue({
        id: PLAN_ID,
        title: 'Plano',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        primaryObjective: null,
        summary: null,
      });
      destinations.find.mockResolvedValue([]);
      settingsService.getSettings.mockResolvedValue({
        settings: {
          monthlyContentVolume: 12,
          funnelDistribution: {
            discovery: 25,
            recognition: 25,
            consideration: 25,
            decision: 25,
          },
          contentTypes: [],
          objectives: [],
          creativeFormats: [],
          ctaDefaults: {},
          hashtagDefaults: {
            mandatory: [],
            suggestedCount: 5,
            complementWithAi: false,
          },
          firstCommentDefaults: { enabled: false, template: null },
          hookLibrary: [],
          milestones: [],
        },
      });

      const work = await service.resolveWork(
        buildRun({ requestedFields: ['caption'] }),
      );

      expect(work.fields[0].currentValue).toBe('legenda atual');
    });

    it('fails closed when the content is no longer readable in its own scope', async () => {
      content.findOne.mockResolvedValue(null);

      await expect(service.resolveWork(buildRun())).rejects.toMatchObject({
        code: 'content_not_available',
      });
    });
  });
});
