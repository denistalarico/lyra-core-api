import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, type FindOptionsWhere, Repository } from 'typeorm';
import {
  CreateSocialContentItemDto,
  CreateSocialPlanDto,
  UpdateSocialContentItemDto,
  UpdateSocialPlanDto,
  UpsertSocialContentDestinationsDto,
  CreateSocialContentRevisionDto,
} from '../dto';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialPlanEntity,
  SocialContentRevisionEntity,
} from '../entities';
import {
  toSocialContentItemView,
  toSocialPlanView,
  toSocialContentRevisionView,
} from '../views/social-planner.view';
import { SocialCampaignService } from './social-campaign.service';

export interface SocialPlannerScope {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
}

@Injectable()
export class SocialPlannerService {
  constructor(
    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plansRepository: Repository<SocialPlanEntity>,

    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    @InjectRepository(SocialContentDestinationEntity, 'agency')
    private readonly destinationsRepository: Repository<SocialContentDestinationEntity>,

    @InjectRepository(SocialContentRevisionEntity, 'agency')
    private readonly revisionsRepository: Repository<SocialContentRevisionEntity>,

    /**
     * Used only to prove that a campaign or pillar named by a write belongs to
     * the caller's own scope. The dependency points one way — the campaign
     * service knows nothing about plans, content or revisions.
     */
    private readonly campaignService: SocialCampaignService,
  ) {}

  async listPlans(scope: SocialPlannerScope) {
    const plans = await this.plansRepository.find({
      where: this.planScopeWhere(scope),
      order: {
        periodStart: 'DESC',
        createdAt: 'DESC',
      },
    });

    return {
      items: plans.map(toSocialPlanView),
      total: plans.length,
    };
  }

  async createPlan(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: CreateSocialPlanDto,
  ) {
    this.assertValidPeriod(dto.periodStart, dto.periodEnd);

    const plan = this.plansRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      title: dto.title.trim(),
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      status: dto.status ?? 'draft',
      primaryObjective: this.normalizeNullable(dto.primaryObjective),
      strategyMode: this.normalizeNullable(dto.strategyMode),
      summary: this.normalizeNullable(dto.summary),
      createdById: actorUserId,
      updatedById: actorUserId,
    });

    const saved = await this.plansRepository.save(plan);
    return toSocialPlanView(saved);
  }

  async getPlan(scope: SocialPlannerScope, planId: string) {
    const plan = await this.requirePlan(scope, planId);
    return toSocialPlanView(plan);
  }

  async updatePlan(
    scope: SocialPlannerScope,
    planId: string,
    actorUserId: string | null,
    dto: UpdateSocialPlanDto,
  ) {
    const plan = await this.requirePlan(scope, planId);

    const periodStart = dto.periodStart ?? plan.periodStart;
    const periodEnd = dto.periodEnd ?? plan.periodEnd;
    this.assertValidPeriod(periodStart, periodEnd);

    if (dto.title !== undefined) {
      plan.title = dto.title.trim();
    }

    if (dto.periodStart !== undefined) {
      plan.periodStart = dto.periodStart;
    }

    if (dto.periodEnd !== undefined) {
      plan.periodEnd = dto.periodEnd;
    }

    if (dto.status !== undefined) {
      plan.status = dto.status;
    }

    if (dto.primaryObjective !== undefined) {
      plan.primaryObjective = this.normalizeNullable(dto.primaryObjective);
    }

    if (dto.strategyMode !== undefined) {
      plan.strategyMode = this.normalizeNullable(dto.strategyMode);
    }

    if (dto.summary !== undefined) {
      plan.summary = this.normalizeNullable(dto.summary);
    }

    plan.updatedById = actorUserId;

    const saved = await this.plansRepository.save(plan);
    return toSocialPlanView(saved);
  }

  async archivePlan(
    scope: SocialPlannerScope,
    planId: string,
    actorUserId: string | null,
  ) {
    const plan = await this.requirePlan(scope, planId);

    plan.status = 'archived';
    plan.updatedById = actorUserId;

    const saved = await this.plansRepository.save(plan);
    return toSocialPlanView(saved);
  }

  /**
   * The plan's content.
   *
   * `archived` selects which rows are visible (E6): `exclude` is the default
   * listing, `only` is the restore view, `include` is everything still alive.
   * Soft-deleted rows appear in none of them — that filter lives in
   * `contentScopeWhere` and has no opt-out, because a deleted item has no view
   * that should show it.
   */
  async listContent(
    scope: SocialPlannerScope,
    planId: string,
    archived: 'exclude' | 'include' | 'only' = 'exclude',
  ) {
    await this.requirePlan(scope, planId);

    const items = await this.contentRepository.find({
      where: {
        ...this.contentScopeWhere(scope),
        planId,
        ...(archived === 'exclude' ? { archivedAt: IsNull() } : {}),
        ...(archived === 'only' ? { archivedAt: Not(IsNull()) } : {}),
      },
      order: {
        plannedDate: 'ASC',
        sortOrder: 'ASC',
        createdAt: 'ASC',
      },
    });

    const destinationsByContentId = await this.loadDestinationsForItems(
      scope,
      items.map((item) => item.id),
    );

    return {
      items: items.map((item) =>
        toSocialContentItemView(
          item,
          destinationsByContentId.get(item.id) ?? [],
        ),
      ),
      total: items.length,
    };
  }

  async createContent(
    scope: SocialPlannerScope,
    planId: string,
    actorUserId: string | null,
    dto: CreateSocialContentItemDto,
  ) {
    await this.requirePlan(scope, planId);

    await this.campaignService.assertOptionalLinks(scope, {
      campaignInstanceId: dto.campaignInstanceId ?? null,
      pillarId: dto.editorialPillarId ?? null,
    });

    const item = this.contentRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      planId,
      title: dto.title.trim(),
      theme: this.normalizeNullable(dto.theme),
      brief: this.normalizeNullable(dto.brief),
      keyMessage: this.normalizeNullable(dto.keyMessage),

      copy: null,
      caption: null,
      script: null,
      cta: null,
      hashtags: [],
      firstComment: null,
      currentRevisionId: null,

      funnelStage: this.normalizeNullable(dto.funnelStage),
      contentType: this.normalizeNullable(dto.contentType),
      objective: this.normalizeNullable(dto.objective),
      creativeFormat: this.normalizeNullable(dto.creativeFormat),

      planningStatus: dto.planningStatus ?? 'planned',
      calendarOnly: dto.calendarOnly === true,
      plannedDate: dto.plannedDate ?? null,
      sortOrder: dto.sortOrder ?? 0,

      campaignInstanceId: dto.campaignInstanceId ?? null,
      editorialPillarId: dto.editorialPillarId ?? null,

      createdById: actorUserId,
      updatedById: actorUserId,
    });

    const saved = await this.contentRepository.save(item);
    return toSocialContentItemView(saved);
  }

  async getContent(scope: SocialPlannerScope, contentId: string) {
    const item = await this.requireContent(scope, contentId);

    const destinations = await this.destinationsRepository.find({
      where: {
        ...this.destinationScopeWhere(scope),
        contentItemId: item.id,
      },
      order: {
        channel: 'ASC',
        placement: 'ASC',
      },
    });

    return toSocialContentItemView(item, destinations);
  }

  async updateContent(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
    dto: UpdateSocialContentItemDto,
  ) {
    const item = await this.requireContent(scope, contentId);

    await this.campaignService.assertOptionalLinks(scope, {
      campaignInstanceId: dto.campaignInstanceId ?? null,
      pillarId: dto.editorialPillarId ?? null,
    });

    if (dto.title !== undefined) {
      item.title = dto.title.trim();
    }

    if (dto.theme !== undefined) {
      item.theme = this.normalizeNullable(dto.theme);
    }

    if (dto.brief !== undefined) {
      item.brief = this.normalizeNullable(dto.brief);
    }

    if (dto.keyMessage !== undefined) {
      item.keyMessage = this.normalizeNullable(dto.keyMessage);
    }

    if (dto.funnelStage !== undefined) {
      item.funnelStage = this.normalizeNullable(dto.funnelStage);
    }

    if (dto.contentType !== undefined) {
      item.contentType = this.normalizeNullable(dto.contentType);
    }

    if (dto.objective !== undefined) {
      item.objective = this.normalizeNullable(dto.objective);
    }

    if (dto.creativeFormat !== undefined) {
      item.creativeFormat = this.normalizeNullable(dto.creativeFormat);
    }

    if (dto.planningStatus !== undefined) {
      item.planningStatus = dto.planningStatus;
    }

    if (dto.plannedDate !== undefined) {
      item.plannedDate = dto.plannedDate;
    }

    if (dto.sortOrder !== undefined) {
      item.sortOrder = dto.sortOrder;
    }

    /**
     * `undefined` means the field was not sent and must not be touched;
     * an explicit `null` means unlink. Collapsing the two would clear a
     * campaign every time an operator saved an unrelated field.
     */
    if (dto.campaignInstanceId !== undefined) {
      item.campaignInstanceId = dto.campaignInstanceId;
    }

    if (dto.editorialPillarId !== undefined) {
      item.editorialPillarId = dto.editorialPillarId;
    }

    item.updatedById = actorUserId;

    const saved = await this.contentRepository.save(item);

    const destinations = await this.destinationsRepository.find({
      where: {
        ...this.destinationScopeWhere(scope),
        contentItemId: saved.id,
      },
      order: {
        channel: 'ASC',
        placement: 'ASC',
      },
    });

    return toSocialContentItemView(saved, destinations);
  }

  async replaceDestinations(
    scope: SocialPlannerScope,
    contentId: string,
    dto: UpsertSocialContentDestinationsDto,
  ) {
    const item = await this.requireContent(scope, contentId);

    this.assertUniqueDestinations(dto);

    await this.destinationsRepository.manager.transaction(
      async (transactionManager) => {
        const repository = transactionManager.getRepository(
          SocialContentDestinationEntity,
        );

        await repository.delete({
          ...this.destinationScopeWhere(scope),
          contentItemId: item.id,
        });

        if (dto.items.length === 0) {
          return;
        }

        const destinations = dto.items.map((input) =>
          repository.create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,
            contentItemId: item.id,
            channel: input.channel,
            placement: input.placement,
            plannedAt: input.plannedAt ? new Date(input.plannedAt) : null,
          }),
        );

        await repository.save(destinations);
      },
    );

    return this.getContent(scope, item.id);
  }

  async listRevisions(scope: SocialPlannerScope, contentId: string) {
    const item = await this.requireContent(scope, contentId);

    const revisions = await this.revisionsRepository.find({
      where: {
        ...this.revisionScopeWhere(scope),
        contentItemId: item.id,
      },
      order: {
        revisionNumber: 'DESC',
      },
    });

    return {
      items: revisions.map(toSocialContentRevisionView),
      total: revisions.length,
      currentRevisionId: item.currentRevisionId,
    };
  }

  async createRevision(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
    dto: CreateSocialContentRevisionDto,
  ) {
    return this.contentRepository.manager.transaction(async (manager) => {
      const contentRepository = manager.getRepository(SocialContentItemEntity);
      const revisionsRepository = manager.getRepository(
        SocialContentRevisionEntity,
      );

      const item = await contentRepository.findOne({
        where: {
          id: contentId,
          ...this.contentScopeWhere(scope),
        },
        lock: {
          mode: 'pessimistic_write',
        },
      });

      if (!item) {
        throw new NotFoundException('Social content item not found.');
      }
      await this.requirePlan(scope, item.planId);

      const latestRevision = await revisionsRepository.findOne({
        where: {
          ...this.revisionScopeWhere(scope),
          contentItemId: item.id,
        },
        order: {
          revisionNumber: 'DESC',
        },
      });

      const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;

      const copy =
        dto.copy !== undefined ? this.normalizeNullable(dto.copy) : item.copy;

      const caption =
        dto.caption !== undefined
          ? this.normalizeNullable(dto.caption)
          : item.caption;

      const script =
        dto.script !== undefined
          ? this.normalizeNullable(dto.script)
          : item.script;

      const cta =
        dto.cta !== undefined ? this.normalizeNullable(dto.cta) : item.cta;

      const firstComment =
        dto.firstComment !== undefined
          ? this.normalizeNullable(dto.firstComment)
          : item.firstComment;

      const hashtags =
        dto.hashtags !== undefined
          ? this.normalizeHashtags(dto.hashtags)
          : item.hashtags;

      const revision = revisionsRepository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,

        contentItemId: item.id,
        revisionNumber,

        copy,
        caption,
        script,
        cta,
        hashtags,
        firstComment,

        briefSnapshot: item.brief,

        source: dto.source ?? 'human',

        parentRevisionId: item.currentRevisionId,
        generationRunId: dto.generationRunId ?? null,

        createdById: actorUserId,
      });

      const savedRevision = await revisionsRepository.save(revision);

      item.copy = savedRevision.copy;
      item.caption = savedRevision.caption;
      item.script = savedRevision.script;
      item.cta = savedRevision.cta;
      item.hashtags = savedRevision.hashtags;
      item.firstComment = savedRevision.firstComment;

      item.currentRevisionId = savedRevision.id;
      item.updatedById = actorUserId;

      const savedContent = await contentRepository.save(item);

      return {
        content: toSocialContentItemView(savedContent),
        revision: toSocialContentRevisionView(savedRevision),
      };
    });
  }

  async restoreRevision(
    scope: SocialPlannerScope,
    contentId: string,
    revisionId: string,
    actorUserId: string | null,
  ) {
    return this.contentRepository.manager.transaction(async (manager) => {
      const contentRepository = manager.getRepository(SocialContentItemEntity);
      const revisionsRepository = manager.getRepository(
        SocialContentRevisionEntity,
      );

      const item = await contentRepository.findOne({
        where: {
          id: contentId,
          ...this.contentScopeWhere(scope),
        },
        lock: {
          mode: 'pessimistic_write',
        },
      });

      if (!item) {
        throw new NotFoundException('Social content item not found.');
      }
      await this.requirePlan(scope, item.planId);

      const sourceRevision = await revisionsRepository.findOne({
        where: {
          id: revisionId,
          contentItemId: item.id,
          ...this.revisionScopeWhere(scope),
        },
      });

      if (!sourceRevision) {
        throw new NotFoundException('Social content revision not found.');
      }

      const latestRevision = await revisionsRepository.findOne({
        where: {
          contentItemId: item.id,
          ...this.revisionScopeWhere(scope),
        },
        order: {
          revisionNumber: 'DESC',
        },
      });

      const restored = revisionsRepository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,

        contentItemId: item.id,
        revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,

        copy: sourceRevision.copy,
        caption: sourceRevision.caption,
        script: sourceRevision.script,
        cta: sourceRevision.cta,
        hashtags: [...sourceRevision.hashtags],
        firstComment: sourceRevision.firstComment,

        /**
         * Restore brings back the editorial snapshot, including the brief
         * context that belonged to that revision.
         *
         * The current ContentItem.brief itself is not overwritten.
         */
        briefSnapshot: sourceRevision.briefSnapshot,

        source: 'restored',

        parentRevisionId: sourceRevision.id,
        generationRunId: null,

        createdById: actorUserId,
      });

      const savedRevision = await revisionsRepository.save(restored);

      item.copy = savedRevision.copy;
      item.caption = savedRevision.caption;
      item.script = savedRevision.script;
      item.cta = savedRevision.cta;
      item.hashtags = savedRevision.hashtags;
      item.firstComment = savedRevision.firstComment;

      item.currentRevisionId = savedRevision.id;
      item.updatedById = actorUserId;

      const savedContent = await contentRepository.save(item);

      return {
        content: toSocialContentItemView(savedContent),
        revision: toSocialContentRevisionView(savedRevision),
      };
    });
  }

  private async requirePlan(
    scope: SocialPlannerScope,
    planId: string,
  ): Promise<SocialPlanEntity> {
    const plan = await this.plansRepository.findOne({
      where: {
        id: planId,
        ...this.planScopeWhere(scope),
      },
    });

    if (!plan) {
      throw new NotFoundException('Social plan not found.');
    }

    return plan;
  }

  private async requireContent(
    scope: SocialPlannerScope,
    contentId: string,
  ): Promise<SocialContentItemEntity> {
    const item = await this.contentRepository.findOne({
      where: {
        id: contentId,
        ...this.contentScopeWhere(scope),
      },
    });

    if (!item) {
      throw new NotFoundException('Social content item not found.');
    }

    await this.requirePlan(scope, item.planId);

    return item;
  }

  private async loadDestinationsForItems(
    scope: SocialPlannerScope,
    contentIds: string[],
  ): Promise<Map<string, SocialContentDestinationEntity[]>> {
    if (contentIds.length === 0) {
      return new Map();
    }

    const destinations = await this.destinationsRepository.find({
      where: {
        ...this.destinationScopeWhere(scope),
        contentItemId: In(contentIds),
      },
      order: {
        channel: 'ASC',
        placement: 'ASC',
      },
    });

    const byContentId = new Map<string, SocialContentDestinationEntity[]>();

    for (const destination of destinations) {
      const items = byContentId.get(destination.contentItemId) ?? [];
      items.push(destination);
      byContentId.set(destination.contentItemId, items);
    }

    return byContentId;
  }

  /**
   * Scope AND visibility, for the same reason `contentScopeWhere` below carries
   * both: every plan read in this service goes through this helper, so a
   * soft-deleted plan is invisible to all of them at once. Leaving the filter
   * to each call site would make omitting it the silent default, and the
   * symptom — a deleted plan reappearing in the picker — reads as data
   * corruption rather than a missing condition.
   */
  private planScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialPlanEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
      deletedAt: IsNull(),
    };
  }

  /**
   * Scope AND visibility, in one place on purpose (E6).
   *
   * `deletedAt IS NULL` belongs here rather than at each call site because
   * every method in this service reaches content through this helper, and a
   * soft-deleted item must be invisible to all of them — read, update, revise
   * and restore alike. Adding the condition per query would make forgetting it
   * in the next method the default failure, and that failure is silent: a
   * deleted item would simply reappear.
   *
   * Archived items are NOT filtered here. They are hidden from the default
   * listing only, by `listContent`, because archiving hides a row from a list
   * while leaving it fully editable by anything holding its id.
   */
  private contentScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialContentItemEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      deletedAt: IsNull(),
    };
  }

  private destinationScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialContentDestinationEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private revisionScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialContentRevisionEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private normalizeHashtags(values: string[]): string[] {
    const normalized = values.map((value) => value.trim()).filter(Boolean);

    return [...new Set(normalized)];
  }

  private assertValidPeriod(periodStart: string, periodEnd: string): void {
    if (periodEnd < periodStart) {
      throw new BadRequestException(
        'Plan periodEnd must be on or after periodStart.',
      );
    }
  }

  private assertUniqueDestinations(
    dto: UpsertSocialContentDestinationsDto,
  ): void {
    const seen = new Set<string>();

    for (const item of dto.items) {
      const key = `${item.channel}:${item.placement}`;

      if (seen.has(key)) {
        throw new BadRequestException(
          `Duplicate destination "${item.channel}:${item.placement}".`,
        );
      }

      seen.add(key);
    }
  }

  private normalizeNullable(value: string | null | undefined): string | null {
    if (value == null) return null;

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
