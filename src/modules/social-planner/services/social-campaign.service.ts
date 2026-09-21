import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type FindOptionsWhere, Repository } from 'typeorm';
import {
  ConvertSocialContentIdeaDto,
  CreateSocialCampaignDto,
  CreateSocialCampaignTemplateDto,
  CreateSocialContentIdeaDto,
  CreateSocialEditorialPillarDto,
  UpdateSocialCampaignDto,
  UpdateSocialCampaignTemplateDto,
  UpdateSocialContentIdeaDto,
  UpdateSocialEditorialPillarDto,
} from '../dto';
import {
  SocialCampaignInstanceEntity,
  SocialCampaignTemplateEntity,
  SocialContentIdeaEntity,
  SocialContentItemEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
} from '../entities';
import { toSocialContentItemView } from '../views/social-planner.view';
import {
  toSocialCampaignTemplateView,
  toSocialCampaignView,
  toSocialContentIdeaView,
  toSocialEditorialPillarView,
} from '../views/social-campaign.view';
import type { SocialPlannerScope } from './social-planner.service';

/**
 * Campaigns, editorial pillars and the idea backlog (Planner E5).
 *
 * SCOPE IS ALWAYS IN THE WHERE CLAUSE. Every read below builds its filter from
 * `scopeWhere`, which converts a null agencyClientId into `IsNull()`. A raw
 * null is read by TypeORM as "no filter at all" and would match every client
 * in the tenant — the single most repeated defect in this repository.
 *
 * A resource outside the caller's scope is reported as NOT FOUND, never as
 * forbidden: telling a caller that a campaign exists somewhere else is itself
 * a cross-context disclosure.
 */
@Injectable()
export class SocialCampaignService {
  constructor(
    @InjectRepository(SocialCampaignTemplateEntity, 'agency')
    private readonly templatesRepository: Repository<SocialCampaignTemplateEntity>,

    @InjectRepository(SocialCampaignInstanceEntity, 'agency')
    private readonly campaignsRepository: Repository<SocialCampaignInstanceEntity>,

    @InjectRepository(SocialEditorialPillarEntity, 'agency')
    private readonly pillarsRepository: Repository<SocialEditorialPillarEntity>,

    @InjectRepository(SocialContentIdeaEntity, 'agency')
    private readonly ideasRepository: Repository<SocialContentIdeaEntity>,

    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plansRepository: Repository<SocialPlanEntity>,
  ) {}

  // ---------------------------------------------------------------- templates

  async listCampaignTemplates(scope: SocialPlannerScope) {
    const templates = await this.templatesRepository.find({
      where: this.scopeWhere<SocialCampaignTemplateEntity>(scope),
      order: { name: 'ASC' },
    });

    return {
      items: templates.map(toSocialCampaignTemplateView),
      total: templates.length,
    };
  }

  async createCampaignTemplate(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: CreateSocialCampaignTemplateDto,
  ) {
    const name = this.requireText(dto.name, 'Template name');

    await this.assertTemplateNameAvailable(scope, name, null);

    const template = this.templatesRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      name,
      description: this.normalizeNullable(dto.description),
      objective: this.normalizeNullable(dto.objective),
      defaultDurationDays: dto.defaultDurationDays ?? null,
      recommendedPillars: this.normalizeKeys(dto.recommendedPillars ?? []),
      isActive: dto.isActive ?? true,
      createdById: actorUserId,
      updatedById: actorUserId,
    });

    const saved = await this.templatesRepository.save(template);
    return toSocialCampaignTemplateView(saved);
  }

  async updateCampaignTemplate(
    scope: SocialPlannerScope,
    templateId: string,
    actorUserId: string | null,
    dto: UpdateSocialCampaignTemplateDto,
  ) {
    const template = await this.requireTemplate(scope, templateId);

    if (dto.name !== undefined) {
      const name = this.requireText(dto.name, 'Template name');
      await this.assertTemplateNameAvailable(scope, name, template.id);
      template.name = name;
    }

    if (dto.description !== undefined) {
      template.description = this.normalizeNullable(dto.description);
    }

    if (dto.objective !== undefined) {
      template.objective = this.normalizeNullable(dto.objective);
    }

    if (dto.defaultDurationDays !== undefined) {
      template.defaultDurationDays = dto.defaultDurationDays;
    }

    if (dto.recommendedPillars !== undefined) {
      template.recommendedPillars = this.normalizeKeys(dto.recommendedPillars);
    }

    if (dto.isActive !== undefined) {
      template.isActive = dto.isActive;
    }

    template.updatedById = actorUserId;

    const saved = await this.templatesRepository.save(template);
    return toSocialCampaignTemplateView(saved);
  }

  // ---------------------------------------------------------------- campaigns

  async listCampaigns(scope: SocialPlannerScope) {
    const campaigns = await this.campaignsRepository.find({
      where: this.scopeWhere<SocialCampaignInstanceEntity>(scope),
      order: { startsOn: 'DESC', createdAt: 'DESC' },
    });

    return {
      items: campaigns.map(toSocialCampaignView),
      total: campaigns.length,
    };
  }

  async createCampaign(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: CreateSocialCampaignDto,
  ) {
    const name = this.requireText(dto.name, 'Campaign name');

    this.assertValidPeriod(dto.startsOn ?? null, dto.endsOn ?? null);
    await this.assertCampaignNameAvailable(scope, name, null);

    /**
     * A template only seeds defaults. It is resolved inside the caller's own
     * scope, so a template id borrowed from another context is simply not
     * found.
     */
    const template = dto.templateId
      ? await this.requireTemplate(scope, dto.templateId)
      : null;

    const campaign = this.campaignsRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      templateId: template?.id ?? null,
      name,
      description:
        this.normalizeNullable(dto.description) ??
        template?.description ??
        null,
      objective:
        this.normalizeNullable(dto.objective) ?? template?.objective ?? null,
      startsOn: dto.startsOn ?? null,
      endsOn: this.resolveCampaignEnd(dto, template),
      status: dto.status ?? 'planned',
      color: this.normalizeNullable(dto.color),
      createdById: actorUserId,
      updatedById: actorUserId,
    });

    const saved = await this.campaignsRepository.save(campaign);
    return toSocialCampaignView(saved);
  }

  async updateCampaign(
    scope: SocialPlannerScope,
    campaignId: string,
    actorUserId: string | null,
    dto: UpdateSocialCampaignDto,
  ) {
    const campaign = await this.requireCampaign(scope, campaignId);

    /**
     * The period is validated against the MERGED state, not against the patch.
     * Checking only what was sent would let a caller move the start past an
     * untouched end date.
     */
    const startsOn =
      dto.startsOn !== undefined ? dto.startsOn : campaign.startsOn;
    const endsOn = dto.endsOn !== undefined ? dto.endsOn : campaign.endsOn;
    this.assertValidPeriod(startsOn, endsOn);

    if (dto.name !== undefined) {
      const name = this.requireText(dto.name, 'Campaign name');
      await this.assertCampaignNameAvailable(scope, name, campaign.id);
      campaign.name = name;
    }

    if (dto.description !== undefined) {
      campaign.description = this.normalizeNullable(dto.description);
    }

    if (dto.objective !== undefined) {
      campaign.objective = this.normalizeNullable(dto.objective);
    }

    if (dto.startsOn !== undefined) {
      campaign.startsOn = dto.startsOn;
    }

    if (dto.endsOn !== undefined) {
      campaign.endsOn = dto.endsOn;
    }

    if (dto.status !== undefined) {
      campaign.status = dto.status;
    }

    if (dto.color !== undefined) {
      campaign.color = this.normalizeNullable(dto.color);
    }

    campaign.updatedById = actorUserId;

    const saved = await this.campaignsRepository.save(campaign);
    return toSocialCampaignView(saved);
  }

  // ------------------------------------------------------------------ pillars

  async listPillars(scope: SocialPlannerScope) {
    const pillars = await this.pillarsRepository.find({
      where: this.scopeWhere<SocialEditorialPillarEntity>(scope),
      order: { sortOrder: 'ASC', label: 'ASC' },
    });

    return {
      items: pillars.map(toSocialEditorialPillarView),
      total: pillars.length,
    };
  }

  async createPillar(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: CreateSocialEditorialPillarDto,
  ) {
    const key = dto.key.trim();
    const existing = await this.pillarsRepository.findOne({
      where: { ...this.scopeWhere<SocialEditorialPillarEntity>(scope), key },
    });

    if (existing) {
      throw new ConflictException(
        `An editorial pillar with key "${key}" already exists in this context.`,
      );
    }

    const pillar = this.pillarsRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      key,
      label: this.requireText(dto.label, 'Pillar label'),
      description: this.normalizeNullable(dto.description),
      targetPercentage: this.toNumericColumn(dto.targetPercentage ?? null),
      color: this.normalizeNullable(dto.color),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
      createdById: actorUserId,
      updatedById: actorUserId,
    });

    const saved = await this.pillarsRepository.save(pillar);
    return toSocialEditorialPillarView(saved);
  }

  async updatePillar(
    scope: SocialPlannerScope,
    pillarId: string,
    actorUserId: string | null,
    dto: UpdateSocialEditorialPillarDto,
  ) {
    const pillar = await this.requirePillar(scope, pillarId);

    if (dto.label !== undefined) {
      pillar.label = this.requireText(dto.label, 'Pillar label');
    }

    if (dto.description !== undefined) {
      pillar.description = this.normalizeNullable(dto.description);
    }

    if (dto.targetPercentage !== undefined) {
      pillar.targetPercentage = this.toNumericColumn(dto.targetPercentage);
    }

    if (dto.color !== undefined) {
      pillar.color = this.normalizeNullable(dto.color);
    }

    if (dto.sortOrder !== undefined) {
      pillar.sortOrder = dto.sortOrder;
    }

    if (dto.isActive !== undefined) {
      pillar.isActive = dto.isActive;
    }

    pillar.updatedById = actorUserId;

    const saved = await this.pillarsRepository.save(pillar);
    return toSocialEditorialPillarView(saved);
  }

  /**
   * Pillar coverage for one plan.
   *
   * Counts the plan's content per pillar and compares the actual share with
   * the configured target. Content with no pillar is reported separately as
   * `unassigned` rather than being dropped: "12 pieces classified" is a very
   * different answer from "12 pieces, 30 unclassified", and hiding the second
   * number would make the coverage look complete when it is not.
   */
  async getPillarCoverage(scope: SocialPlannerScope, planId: string) {
    const plan = await this.plansRepository.findOne({
      where: { id: planId, ...this.scopeWhere<SocialPlanEntity>(scope) },
    });

    if (!plan) {
      throw new NotFoundException('Social plan not found.');
    }

    const [pillars, items] = await Promise.all([
      this.pillarsRepository.find({
        where: this.scopeWhere<SocialEditorialPillarEntity>(scope),
        order: { sortOrder: 'ASC', label: 'ASC' },
      }),
      this.contentRepository.find({
        where: {
          ...this.scopeWhere<SocialContentItemEntity>(scope),
          planId: plan.id,
          /**
           * Deleted items are not coverage (E6). The generic `scopeWhere` is
           * shared with entities that have no lifecycle columns, so this
           * condition is stated here rather than folded into it.
           *
           * Archived items ARE counted: archiving hides a row from the working
           * list, it does not retract the editorial decision that the pillar
           * was addressed. Excluding them would make coverage drop every time
           * someone tidied up a finished month.
           */
          deletedAt: IsNull(),
        },
        select: { id: true, editorialPillarId: true },
      }),
    ]);

    const counts = new Map<string, number>();
    let unassigned = 0;

    for (const item of items) {
      if (!item.editorialPillarId) {
        unassigned += 1;
        continue;
      }

      counts.set(
        item.editorialPillarId,
        (counts.get(item.editorialPillarId) ?? 0) + 1,
      );
    }

    const total = items.length;

    return {
      planId: plan.id,
      totalContent: total,
      unassignedContent: unassigned,
      items: pillars.map((pillar) => {
        const view = toSocialEditorialPillarView(pillar);
        const count = counts.get(pillar.id) ?? 0;

        /**
         * With no content at all every share is undefined, not zero. Reporting
         * 0% against a 25% target for an empty plan would show four fabricated
         * deviations before any work has started.
         */
        const actualPercentage =
          total === 0 ? null : Math.round((count / total) * 10000) / 100;

        return {
          pillarId: pillar.id,
          key: pillar.key,
          label: pillar.label,
          color: pillar.color,
          isActive: pillar.isActive,
          targetPercentage: view.targetPercentage,
          contentCount: count,
          actualPercentage,
          deviation:
            actualPercentage === null || view.targetPercentage === null
              ? null
              : Math.round((actualPercentage - view.targetPercentage) * 100) /
                100,
        };
      }),
    };
  }

  // ------------------------------------------------------------------ backlog

  async listIdeas(
    scope: SocialPlannerScope,
    status?: 'open' | 'converted' | 'discarded',
  ) {
    const ideas = await this.ideasRepository.find({
      where: {
        ...this.scopeWhere<SocialContentIdeaEntity>(scope),
        ...(status ? { status } : {}),
      },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });

    return {
      items: ideas.map(toSocialContentIdeaView),
      total: ideas.length,
    };
  }

  async createIdea(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: CreateSocialContentIdeaDto,
  ) {
    await this.assertOptionalLinks(scope, {
      pillarId: dto.pillarId ?? null,
      campaignInstanceId: dto.campaignInstanceId ?? null,
    });

    const idea = this.ideasRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      title: this.requireText(dto.title, 'Idea title'),
      notes: this.normalizeNullable(dto.notes),
      pillarId: dto.pillarId ?? null,
      campaignInstanceId: dto.campaignInstanceId ?? null,
      funnelStage: this.normalizeNullable(dto.funnelStage),
      contentType: this.normalizeNullable(dto.contentType),
      status: 'open',
      priority: dto.priority ?? 0,
      source: this.normalizeNullable(dto.source) ?? 'manual',
      convertedContentItemId: null,
      convertedAt: null,
      createdById: actorUserId,
      updatedById: actorUserId,
    });

    const saved = await this.ideasRepository.save(idea);
    return toSocialContentIdeaView(saved);
  }

  async updateIdea(
    scope: SocialPlannerScope,
    ideaId: string,
    actorUserId: string | null,
    dto: UpdateSocialContentIdeaDto,
  ) {
    const idea = await this.requireIdea(scope, ideaId);

    /**
     * A converted idea is history. Editing it would silently change the record
     * of what produced a content item that has since moved on independently.
     */
    if (idea.status === 'converted') {
      throw new BadRequestException(
        'A converted idea can no longer be edited.',
      );
    }

    await this.assertOptionalLinks(scope, {
      pillarId: dto.pillarId ?? null,
      campaignInstanceId: dto.campaignInstanceId ?? null,
    });

    if (dto.title !== undefined) {
      idea.title = this.requireText(dto.title, 'Idea title');
    }

    if (dto.notes !== undefined) {
      idea.notes = this.normalizeNullable(dto.notes);
    }

    if (dto.pillarId !== undefined) {
      idea.pillarId = dto.pillarId;
    }

    if (dto.campaignInstanceId !== undefined) {
      idea.campaignInstanceId = dto.campaignInstanceId;
    }

    if (dto.funnelStage !== undefined) {
      idea.funnelStage = this.normalizeNullable(dto.funnelStage);
    }

    if (dto.contentType !== undefined) {
      idea.contentType = this.normalizeNullable(dto.contentType);
    }

    if (dto.priority !== undefined) {
      idea.priority = dto.priority;
    }

    idea.updatedById = actorUserId;

    const saved = await this.ideasRepository.save(idea);
    return toSocialContentIdeaView(saved);
  }

  async discardIdea(
    scope: SocialPlannerScope,
    ideaId: string,
    actorUserId: string | null,
  ) {
    const idea = await this.requireIdea(scope, ideaId);

    if (idea.status === 'converted') {
      throw new BadRequestException(
        'A converted idea can no longer be discarded.',
      );
    }

    idea.status = 'discarded';
    idea.updatedById = actorUserId;

    const saved = await this.ideasRepository.save(idea);
    return toSocialContentIdeaView(saved);
  }

  /**
   * Turns a backlog idea into planned content.
   *
   * Runs in one transaction because the two writes are a single fact: an idea
   * marked converted whose content item was never created is a pauta that
   * disappeared, and a content item whose idea stayed open would be planned
   * twice on the next pass through the backlog.
   *
   * The idea row is re-read under a pessimistic lock inside the transaction so
   * two operators converting the same idea cannot both succeed.
   */
  async convertIdea(
    scope: SocialPlannerScope,
    ideaId: string,
    actorUserId: string | null,
    dto: ConvertSocialContentIdeaDto,
  ) {
    return this.ideasRepository.manager.transaction(async (manager) => {
      const ideasRepository = manager.getRepository(SocialContentIdeaEntity);
      const contentRepository = manager.getRepository(SocialContentItemEntity);
      const plansRepository = manager.getRepository(SocialPlanEntity);

      const idea = await ideasRepository.findOne({
        where: {
          id: ideaId,
          ...this.scopeWhere<SocialContentIdeaEntity>(scope),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!idea) {
        throw new NotFoundException('Social content idea not found.');
      }

      if (idea.status !== 'open') {
        throw new BadRequestException(
          'Only an open idea can be converted into content.',
        );
      }

      const plan = await plansRepository.findOne({
        where: {
          id: dto.planId,
          ...this.scopeWhere<SocialPlanEntity>(scope),
        },
      });

      if (!plan) {
        throw new NotFoundException('Social plan not found.');
      }

      const item = contentRepository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        planId: plan.id,
        title: dto.title ? this.requireText(dto.title, 'Title') : idea.title,
        theme: null,
        brief: idea.notes,
        keyMessage: null,

        copy: null,
        caption: null,
        script: null,
        cta: null,
        hashtags: [],
        firstComment: null,
        currentRevisionId: null,

        funnelStage: idea.funnelStage,
        contentType: idea.contentType,
        objective: null,
        creativeFormat: null,

        /**
         * A converted idea becomes PLANNED content, not an `idea` content
         * item. The backlog is what holds ideas; keeping the planning status
         * as `idea` here would leave the pauta looking unstarted in the very
         * table it was just promoted into.
         */
        planningStatus: 'planned',
        plannedDate: dto.plannedDate ?? null,
        sortOrder: 0,

        campaignInstanceId: idea.campaignInstanceId,
        editorialPillarId: idea.pillarId,

        createdById: actorUserId,
        updatedById: actorUserId,
      });

      const savedContent = await contentRepository.save(item);

      idea.status = 'converted';
      idea.convertedContentItemId = savedContent.id;
      idea.convertedAt = new Date();
      idea.updatedById = actorUserId;

      const savedIdea = await ideasRepository.save(idea);

      return {
        idea: toSocialContentIdeaView(savedIdea),
        content: toSocialContentItemView(savedContent),
      };
    });
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Validates that a campaign or pillar referenced by a write belongs to the
   * caller's own scope.
   *
   * Without this, a foreign key would happily accept a campaign id from
   * another client in the same database — the database only knows the row
   * exists, not who is allowed to point at it.
   */
  async assertOptionalLinks(
    scope: SocialPlannerScope,
    links: {
      pillarId?: string | null;
      campaignInstanceId?: string | null;
    },
  ): Promise<void> {
    if (links.campaignInstanceId) {
      await this.requireCampaign(scope, links.campaignInstanceId);
    }

    if (links.pillarId) {
      await this.requirePillar(scope, links.pillarId);
    }
  }

  private async requireTemplate(
    scope: SocialPlannerScope,
    templateId: string,
  ): Promise<SocialCampaignTemplateEntity> {
    const template = await this.templatesRepository.findOne({
      where: {
        id: templateId,
        ...this.scopeWhere<SocialCampaignTemplateEntity>(scope),
      },
    });

    if (!template) {
      throw new NotFoundException('Social campaign template not found.');
    }

    return template;
  }

  private async requireCampaign(
    scope: SocialPlannerScope,
    campaignId: string,
  ): Promise<SocialCampaignInstanceEntity> {
    const campaign = await this.campaignsRepository.findOne({
      where: {
        id: campaignId,
        ...this.scopeWhere<SocialCampaignInstanceEntity>(scope),
      },
    });

    if (!campaign) {
      throw new NotFoundException('Social campaign not found.');
    }

    return campaign;
  }

  private async requirePillar(
    scope: SocialPlannerScope,
    pillarId: string,
  ): Promise<SocialEditorialPillarEntity> {
    const pillar = await this.pillarsRepository.findOne({
      where: {
        id: pillarId,
        ...this.scopeWhere<SocialEditorialPillarEntity>(scope),
      },
    });

    if (!pillar) {
      throw new NotFoundException('Social editorial pillar not found.');
    }

    return pillar;
  }

  private async requireIdea(
    scope: SocialPlannerScope,
    ideaId: string,
  ): Promise<SocialContentIdeaEntity> {
    const idea = await this.ideasRepository.findOne({
      where: {
        id: ideaId,
        ...this.scopeWhere<SocialContentIdeaEntity>(scope),
      },
    });

    if (!idea) {
      throw new NotFoundException('Social content idea not found.');
    }

    return idea;
  }

  private async assertTemplateNameAvailable(
    scope: SocialPlannerScope,
    name: string,
    ignoreId: string | null,
  ): Promise<void> {
    const existing = await this.templatesRepository.findOne({
      where: { ...this.scopeWhere<SocialCampaignTemplateEntity>(scope), name },
    });

    if (existing && existing.id !== ignoreId) {
      throw new ConflictException(
        `A campaign template named "${name}" already exists in this context.`,
      );
    }
  }

  private async assertCampaignNameAvailable(
    scope: SocialPlannerScope,
    name: string,
    ignoreId: string | null,
  ): Promise<void> {
    const existing = await this.campaignsRepository.findOne({
      where: { ...this.scopeWhere<SocialCampaignInstanceEntity>(scope), name },
    });

    if (existing && existing.id !== ignoreId) {
      throw new ConflictException(
        `A campaign named "${name}" already exists in this context.`,
      );
    }
  }

  /**
   * The one place the scope triple becomes a query filter.
   *
   * `IsNull()` is not decoration. Passing a bare null here makes TypeORM omit
   * the column from the WHERE clause entirely, so an agency-scope read would
   * return every managed client's rows.
   */
  private scopeWhere<Entity extends { agencyClientId: string | null }>(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<Entity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    } as unknown as FindOptionsWhere<Entity>;
  }

  private resolveCampaignEnd(
    dto: CreateSocialCampaignDto,
    template: SocialCampaignTemplateEntity | null,
  ): string | null {
    if (dto.endsOn !== undefined && dto.endsOn !== null) {
      return dto.endsOn;
    }

    /**
     * A template's duration only produces an end date when the caller gave a
     * start and no end. Inventing a window for a campaign with no start would
     * be fabricating both ends of it.
     */
    if (!dto.startsOn || !template?.defaultDurationDays) {
      return dto.endsOn ?? null;
    }

    const start = new Date(`${dto.startsOn}T00:00:00Z`);

    if (Number.isNaN(start.getTime())) {
      return null;
    }

    start.setUTCDate(start.getUTCDate() + template.defaultDurationDays - 1);
    return start.toISOString().slice(0, 10);
  }

  private assertValidPeriod(
    startsOn: string | null,
    endsOn: string | null,
  ): void {
    if (startsOn && endsOn && endsOn < startsOn) {
      throw new BadRequestException(
        'Campaign endsOn must be on or after startsOn.',
      );
    }
  }

  /**
   * numeric columns round-trip as strings through the driver. Converting here
   * keeps the entity honest about what the database actually returns.
   */
  private toNumericColumn(value: number | null): string | null {
    return value === null ? null : value.toFixed(2);
  }

  private normalizeKeys(values: string[]): string[] {
    const normalized = values
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    return [...new Set(normalized)];
  }

  private requireText(value: string, label: string): string {
    const normalized = value.trim();

    if (normalized.length === 0) {
      throw new BadRequestException(`${label} cannot be empty.`);
    }

    return normalized;
  }

  private normalizeNullable(value: string | null | undefined): string | null {
    if (value == null) return null;

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
