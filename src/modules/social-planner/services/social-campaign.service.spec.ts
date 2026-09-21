import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IsNull, type Repository } from 'typeorm';
import type { CreateSocialCampaignDto } from '../dto';
import {
  SocialCampaignInstanceEntity,
  SocialCampaignTemplateEntity,
  SocialContentIdeaEntity,
  SocialContentItemEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
} from '../entities';
import { SocialCampaignService } from './social-campaign.service';
import type { SocialPlannerScope } from './social-planner.service';

type RepositoryMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  manager: { transaction: jest.Mock };
};

function createRepositoryMock(): RepositoryMock {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({
      id: value.id ?? 'generated-id',
      ...value,
      createdAt: value.createdAt ?? new Date('2026-09-09T12:00:00Z'),
      updatedAt: value.updatedAt ?? new Date('2026-09-09T12:00:00Z'),
    })),
    manager: { transaction: jest.fn() },
  };
}

describe('SocialCampaignService', () => {
  let service: SocialCampaignService;

  let templates: RepositoryMock;
  let campaigns: RepositoryMock;
  let pillars: RepositoryMock;
  let ideas: RepositoryMock;
  let content: RepositoryMock;
  let plans: RepositoryMock;

  const agencyScope: SocialPlannerScope = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
    companyContextId: null,
  };

  const clientScope: SocialPlannerScope = {
    ...agencyScope,
    agencyClientId: '33333333-3333-4333-8333-333333333333',
    companyContextId: '44444444-4444-4444-8444-444444444444',
  };

  beforeEach(() => {
    templates = createRepositoryMock();
    campaigns = createRepositoryMock();
    pillars = createRepositoryMock();
    ideas = createRepositoryMock();
    content = createRepositoryMock();
    plans = createRepositoryMock();

    service = new SocialCampaignService(
      templates as unknown as Repository<SocialCampaignTemplateEntity>,
      campaigns as unknown as Repository<SocialCampaignInstanceEntity>,
      pillars as unknown as Repository<SocialEditorialPillarEntity>,
      ideas as unknown as Repository<SocialContentIdeaEntity>,
      content as unknown as Repository<SocialContentItemEntity>,
      plans as unknown as Repository<SocialPlanEntity>,
    );
  });

  describe('scope isolation', () => {
    it('filters agency-scope reads with IsNull, never with a bare null', async () => {
      await service.listCampaigns(agencyScope);

      const where = campaigns.find.mock.calls[0][0].where;

      expect(where.tenantId).toBe(agencyScope.tenantId);
      expect(where.workspaceId).toBe(agencyScope.workspaceId);
      // A bare null is read by TypeORM as "no filter" and matches every
      // managed client in the tenant.
      expect(where.agencyClientId).not.toBeNull();
      expect(where.agencyClientId).toEqual(IsNull());
    });

    it('filters client-scope reads with the client id itself', async () => {
      await service.listIdeas(clientScope);

      expect(ideas.find.mock.calls[0][0].where.agencyClientId).toBe(
        clientScope.agencyClientId,
      );
    });

    it('applies the scope filter to every new table', async () => {
      await service.listCampaignTemplates(agencyScope);
      await service.listPillars(agencyScope);
      await service.listIdeas(agencyScope);

      for (const repository of [templates, pillars, ideas]) {
        expect(repository.find.mock.calls[0][0].where.agencyClientId).toEqual(
          IsNull(),
        );
      }
    });

    it('never writes a scope value that came from the caller', async () => {
      // A malicious body would try to smuggle scope fields. The DTO declares
      // none of them and the service reads scope only from its own argument,
      // so even a body that carries them cannot change what is written.
      const smuggled = {
        name: 'Natal 2026',
        tenantId: 'other-tenant',
        agencyClientId: 'other-client',
      } as unknown as CreateSocialCampaignDto;

      await service.createCampaign(clientScope, 'user-1', smuggled);

      const created = campaigns.create.mock.calls[0][0];

      expect(created.tenantId).toBe(clientScope.tenantId);
      expect(created.workspaceId).toBe(clientScope.workspaceId);
      expect(created.agencyClientId).toBe(clientScope.agencyClientId);
    });
  });

  describe('campaigns', () => {
    it('creates a campaign with no plan reference at all', async () => {
      const result = await service.createCampaign(agencyScope, 'user-1', {
        name: '  Natal 2026  ',
        startsOn: '2026-11-01',
        endsOn: '2026-12-25',
      });

      const created = campaigns.create.mock.calls[0][0];

      expect(created.name).toBe('Natal 2026');
      // A campaign spans plans; pinning it to one would make the other plan's
      // content unattachable.
      expect(created).not.toHaveProperty('planId');
      expect(result.name).toBe('Natal 2026');
    });

    it('refuses a campaign whose end precedes its start', async () => {
      await expect(
        service.createCampaign(agencyScope, null, {
          name: 'Invertida',
          startsOn: '2026-12-25',
          endsOn: '2026-11-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('validates the period against the merged state, not just the patch', async () => {
      campaigns.findOne.mockResolvedValue({
        id: 'campaign-1',
        name: 'Natal 2026',
        startsOn: '2026-11-01',
        endsOn: '2026-12-25',
      });

      // Moving only the start past the untouched end must fail.
      await expect(
        service.updateCampaign(agencyScope, 'campaign-1', null, {
          startsOn: '2027-01-10',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a duplicate campaign name inside one context', async () => {
      campaigns.findOne.mockResolvedValue({ id: 'other', name: 'Natal 2026' });

      await expect(
        service.createCampaign(agencyScope, null, { name: 'Natal 2026' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows renaming a campaign to the name it already has', async () => {
      campaigns.findOne
        .mockResolvedValueOnce({ id: 'campaign-1', name: 'Natal 2026' })
        .mockResolvedValueOnce({ id: 'campaign-1', name: 'Natal 2026' });

      await expect(
        service.updateCampaign(agencyScope, 'campaign-1', null, {
          name: 'Natal 2026',
        }),
      ).resolves.toBeDefined();
    });

    it('reports a campaign from another context as not found', async () => {
      campaigns.findOne.mockResolvedValue(null);

      await expect(
        service.updateCampaign(clientScope, 'campaign-from-elsewhere', null, {
          name: 'Roubada',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves a template inside the caller scope before seeding from it', async () => {
      templates.findOne.mockResolvedValue({
        id: 'template-1',
        description: 'Sazonal',
        objective: 'reach',
        defaultDurationDays: 10,
      });

      await service.createCampaign(agencyScope, null, {
        name: 'Black Friday',
        templateId: 'template-1',
        startsOn: '2026-11-20',
      });

      expect(templates.findOne.mock.calls[0][0].where.agencyClientId).toEqual(
        IsNull(),
      );

      const created = campaigns.create.mock.calls[0][0];

      // 10 days inclusive of the start day.
      expect(created.endsOn).toBe('2026-11-29');
      expect(created.objective).toBe('reach');
    });

    it('does not invent an end date when the campaign has no start', async () => {
      templates.findOne.mockResolvedValue({
        id: 'template-1',
        defaultDurationDays: 30,
      });

      await service.createCampaign(agencyScope, null, {
        name: 'Sempre ativa',
        templateId: 'template-1',
      });

      expect(campaigns.create.mock.calls[0][0].endsOn).toBeNull();
    });
  });

  describe('pillars', () => {
    it('stores the target percentage as the numeric column expects', async () => {
      await service.createPillar(agencyScope, null, {
        key: 'bastidores',
        label: 'Bastidores',
        targetPercentage: 25,
      });

      expect(pillars.create.mock.calls[0][0].targetPercentage).toBe('25.00');
    });

    it('keeps a null target distinct from a zero target', async () => {
      await service.createPillar(agencyScope, null, {
        key: 'educativo',
        label: 'Educativo',
      });

      // Null means "tracked without a target"; zero would mean "should never
      // appear", and a coverage report must not confuse the two.
      expect(pillars.create.mock.calls[0][0].targetPercentage).toBeNull();
    });

    it('refuses a duplicate pillar key in the same context', async () => {
      pillars.findOne.mockResolvedValue({ id: 'existing', key: 'bastidores' });

      await expect(
        service.createPillar(agencyScope, null, {
          key: 'bastidores',
          label: 'Outro',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('pillar coverage', () => {
    beforeEach(() => {
      plans.findOne.mockResolvedValue({ id: 'plan-1' });
    });

    it('counts content per pillar and reports the unclassified remainder', async () => {
      pillars.find.mockResolvedValue([
        {
          id: 'pillar-a',
          key: 'bastidores',
          label: 'Bastidores',
          color: null,
          isActive: true,
          targetPercentage: '50.00',
          sortOrder: 0,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'pillar-b',
          key: 'educativo',
          label: 'Educativo',
          color: null,
          isActive: true,
          targetPercentage: '50.00',
          sortOrder: 1,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      content.find.mockResolvedValue([
        { id: 'c1', editorialPillarId: 'pillar-a' },
        { id: 'c2', editorialPillarId: 'pillar-a' },
        { id: 'c3', editorialPillarId: 'pillar-b' },
        { id: 'c4', editorialPillarId: null },
      ]);

      const coverage = await service.getPillarCoverage(agencyScope, 'plan-1');

      expect(coverage.totalContent).toBe(4);
      // Unclassified content is reported, not dropped: hiding it would make
      // the coverage look complete when a quarter of the plan is unassigned.
      expect(coverage.unassignedContent).toBe(1);

      const [first, second] = coverage.items;

      expect(first.contentCount).toBe(2);
      expect(first.actualPercentage).toBe(50);
      expect(first.deviation).toBe(0);

      expect(second.contentCount).toBe(1);
      expect(second.actualPercentage).toBe(25);
      expect(second.deviation).toBe(-25);
    });

    it('reports an undefined share for an empty plan instead of zero', async () => {
      pillars.find.mockResolvedValue([
        {
          id: 'pillar-a',
          key: 'bastidores',
          label: 'Bastidores',
          color: null,
          isActive: true,
          targetPercentage: '25.00',
          sortOrder: 0,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      content.find.mockResolvedValue([]);

      const coverage = await service.getPillarCoverage(agencyScope, 'plan-1');

      // 0% against a 25% target would show a deviation before any work
      // started.
      expect(coverage.items[0].actualPercentage).toBeNull();
      expect(coverage.items[0].deviation).toBeNull();
    });

    it('reports no deviation for a pillar with no target', async () => {
      pillars.find.mockResolvedValue([
        {
          id: 'pillar-a',
          key: 'bastidores',
          label: 'Bastidores',
          color: null,
          isActive: true,
          targetPercentage: null,
          sortOrder: 0,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      content.find.mockResolvedValue([
        { id: 'c1', editorialPillarId: 'pillar-a' },
      ]);

      const coverage = await service.getPillarCoverage(agencyScope, 'plan-1');

      expect(coverage.items[0].actualPercentage).toBe(100);
      expect(coverage.items[0].deviation).toBeNull();
    });

    it('refuses coverage for a plan outside the caller scope', async () => {
      plans.findOne.mockResolvedValue(null);

      await expect(
        service.getPillarCoverage(clientScope, 'plan-from-elsewhere'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('idea backlog', () => {
    it('creates an idea with neither a plan nor a date', async () => {
      await service.createIdea(agencyScope, 'user-1', {
        title: 'Série de bastidores',
      });

      const created = ideas.create.mock.calls[0][0];

      // The whole point of the backlog: a pauta before it has a home.
      expect(created).not.toHaveProperty('planId');
      expect(created).not.toHaveProperty('plannedDate');
      expect(created.status).toBe('open');
      expect(created.convertedContentItemId).toBeNull();
    });

    it('validates a campaign link against the caller scope', async () => {
      campaigns.findOne.mockResolvedValue(null);

      // The foreign key alone would accept another client's campaign id: the
      // database only knows the row exists, not who may point at it.
      await expect(
        service.createIdea(clientScope, null, {
          title: 'Ideia',
          campaignInstanceId: '44444444-4444-4444-8444-444444444444',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('orders the backlog by priority and then by recency', async () => {
      await service.listIdeas(agencyScope);

      expect(ideas.find.mock.calls[0][0].order).toEqual({
        priority: 'DESC',
        createdAt: 'DESC',
      });
    });

    it('filters the backlog by status when one is requested', async () => {
      await service.listIdeas(agencyScope, 'open');

      expect(ideas.find.mock.calls[0][0].where.status).toBe('open');
    });

    it('refuses to edit an idea that was already converted', async () => {
      ideas.findOne.mockResolvedValue({
        id: 'idea-1',
        status: 'converted',
        convertedContentItemId: 'content-1',
      });

      await expect(
        service.updateIdea(agencyScope, 'idea-1', null, { title: 'Reescrita' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('discards an open idea without inventing a conversion target', async () => {
      ideas.findOne.mockResolvedValue({
        id: 'idea-1',
        status: 'open',
        convertedContentItemId: null,
      });

      const result = await service.discardIdea(agencyScope, 'idea-1', 'user-1');

      expect(result.status).toBe('discarded');
      expect(result.convertedContentItemId).toBeNull();
    });
  });

  describe('idea conversion', () => {
    function runInTransaction(state: {
      idea: Record<string, unknown> | null;
      plan: Record<string, unknown> | null;
    }) {
      const contentRepository = {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => ({ id: 'content-1', ...value })),
      };

      const ideasRepository = {
        findOne: jest.fn().mockResolvedValue(state.idea),
        save: jest.fn(async (value) => value),
      };

      const plansRepository = {
        findOne: jest.fn().mockResolvedValue(state.plan),
      };

      ideas.manager.transaction.mockImplementation(
        async (callback: (manager: unknown) => Promise<unknown>) =>
          callback({
            getRepository: (entity: unknown) => {
              if (entity === SocialContentIdeaEntity) return ideasRepository;
              if (entity === SocialContentItemEntity) return contentRepository;
              return plansRepository;
            },
          }),
      );

      return { contentRepository, ideasRepository, plansRepository };
    }

    it('creates the content and closes the idea in one transaction', async () => {
      const repositories = runInTransaction({
        idea: {
          id: 'idea-1',
          status: 'open',
          title: 'Série de bastidores',
          notes: 'Mostrar o time',
          funnelStage: 'discovery',
          contentType: 'reel',
          pillarId: 'pillar-a',
          campaignInstanceId: 'campaign-a',
        },
        plan: { id: 'plan-1' },
      });

      const result = await service.convertIdea(
        agencyScope,
        'idea-1',
        'user-1',
        { planId: 'plan-1', plannedDate: '2026-11-10' },
      );

      const created = repositories.contentRepository.create.mock.calls[0][0];

      expect(created.planId).toBe('plan-1');
      expect(created.plannedDate).toBe('2026-11-10');
      // The idea's editorial hints carry over.
      expect(created.editorialPillarId).toBe('pillar-a');
      expect(created.campaignInstanceId).toBe('campaign-a');
      expect(created.brief).toBe('Mostrar o time');
      // A promoted pauta is planned content, not an item still sitting at
      // "idea" in the very table it was just promoted into.
      expect(created.planningStatus).toBe('planned');

      expect(result.idea.status).toBe('converted');
      expect(result.idea.convertedContentItemId).toBe('content-1');
      expect(result.idea.convertedAt).toBeInstanceOf(Date);
      expect(result.content.id).toBe('content-1');
    });

    it('locks the idea row so two operators cannot both convert it', async () => {
      const repositories = runInTransaction({
        idea: { id: 'idea-1', status: 'open', title: 'Ideia' },
        plan: { id: 'plan-1' },
      });

      await service.convertIdea(agencyScope, 'idea-1', null, {
        planId: 'plan-1',
      });

      expect(
        repositories.ideasRepository.findOne.mock.calls[0][0].lock,
      ).toEqual({ mode: 'pessimistic_write' });
    });

    it('refuses to convert an idea twice', async () => {
      runInTransaction({
        idea: { id: 'idea-1', status: 'converted' },
        plan: { id: 'plan-1' },
      });

      await expect(
        service.convertIdea(agencyScope, 'idea-1', null, { planId: 'plan-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to convert into a plan outside the caller scope', async () => {
      runInTransaction({
        idea: { id: 'idea-1', status: 'open', title: 'Ideia' },
        plan: null,
      });

      await expect(
        service.convertIdea(clientScope, 'idea-1', null, {
          planId: 'plan-from-elsewhere',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves the idea itself inside the caller scope', async () => {
      const repositories = runInTransaction({ idea: null, plan: null });

      await expect(
        service.convertIdea(clientScope, 'idea-from-elsewhere', null, {
          planId: 'plan-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(
        repositories.ideasRepository.findOne.mock.calls[0][0].where
          .agencyClientId,
      ).toBe(clientScope.agencyClientId);
    });
  });

  describe('assertOptionalLinks', () => {
    it('accepts a write that names neither a campaign nor a pillar', async () => {
      await expect(
        service.assertOptionalLinks(agencyScope, {}),
      ).resolves.toBeUndefined();

      expect(campaigns.findOne).not.toHaveBeenCalled();
      expect(pillars.findOne).not.toHaveBeenCalled();
    });

    it('rejects a pillar that belongs to another context', async () => {
      pillars.findOne.mockResolvedValue(null);

      await expect(
        service.assertOptionalLinks(clientScope, { pillarId: 'pillar-x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
