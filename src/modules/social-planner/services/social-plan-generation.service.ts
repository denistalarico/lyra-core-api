import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import type { SocialBusinessModeKey } from '../catalog/commemorative-dates.catalog';
import type { RequestSocialPlanGenerationDto } from '../dto';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialCopyGenerationRunEntity,
  SocialPlanEntity,
} from '../entities';
import { toSocialContentItemView } from '../views/social-planner.view';
import {
  resolveCommemorativeDates,
  resolveCommemorativeDatesByKey,
  type ResolvedCommemorativeDate,
} from './commemorative-dates.resolver';
import { SocialBrandContextPort } from './social-brand-context.port';
import { SocialCopyGenerationConfigService } from './social-copy-generation-config.service';
import {
  copyGenerationErrorCode,
  SocialCopyGenerationError,
} from './social-copy-generation.errors';
import { SocialCopyGenerationService } from './social-copy-generation.service';
import {
  buildPlanGenerationContext,
  planGenerationVocabulary,
  SOCIAL_PLAN_CONTEXT_VERSION,
} from './social-plan-generation-context';
import {
  SocialPlanGenerationProvider,
  SOCIAL_PLAN_PROMPT_VERSION,
  type PlanGenerationItem,
  type PlanGenerationResult,
} from './social-plan-generation-provider';
import { SocialPlannerSettingsService } from './social-planner-settings.service';
import { SocialPublishingCadenceService } from './social-publishing-cadence.service';
import type { SocialPlannerScope } from './social-planner.service';

export interface SocialPlanGenerationResultView {
  runId: string;
  planId: string;
  created: number;
  items: ReturnType<typeof toSocialContentItemView>[];
}

/**
 * Builds a plan's editorial grid with the model (Planner AI).
 *
 * WHY THIS RUNS SYNCHRONOUSLY WHILE COPY GENERATION IS QUEUED
 * ----------------------------------------------------------
 * Copy generation fans out into one provider call per content item, so a
 * plan-wide request is tens of calls and has to be a queue with per-item
 * cancellation and review. Plan generation is one call producing one grid that
 * the operator is sitting and waiting for. Queuing it would mean building a
 * polling UI for a single request that finishes in seconds, and it would make
 * "the plan is empty" ambiguous between "still working" and "it failed".
 *
 * It still records a `social_copy_generation_runs` row with full provenance, so
 * AI cost per client (§8.6) is one SUM over one column regardless of which kind
 * of generation spent it.
 *
 * WHY THE GRID IS WRITTEN DIRECTLY AND NOT STAGED AS PROPOSALS
 * ------------------------------------------------------------
 * The proposal/accept flow exists because copy generation overwrites text a
 * human already wrote. Plan generation adds content to an empty plan; there is
 * nothing to destroy, and an operator who dislikes the result deletes the items
 * with the batch actions E6 already built.
 */
@Injectable()
export class SocialPlanGenerationService {
  private readonly logger = new Logger(SocialPlanGenerationService.name);

  constructor(
    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plansRepository: Repository<SocialPlanEntity>,

    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    @InjectRepository(SocialContentDestinationEntity, 'agency')
    private readonly destinationsRepository: Repository<SocialContentDestinationEntity>,

    @InjectRepository(SocialCopyGenerationRunEntity, 'agency')
    private readonly runsRepository: Repository<SocialCopyGenerationRunEntity>,

    private readonly provider: SocialPlanGenerationProvider,
    private readonly config: SocialCopyGenerationConfigService,
    private readonly settingsService: SocialPlannerSettingsService,
    private readonly cadenceService: SocialPublishingCadenceService,
    private readonly brandContext: SocialBrandContextPort,
    private readonly copyGenerationService: SocialCopyGenerationService,
  ) {}

  /**
   * The commemorative dates offered to the operator for a period.
   *
   * Country and business mode fall back to what the Brand Kit and the client's
   * LeadFlow settings already declare, so the common case needs no parameters
   * and the picker agrees with the configuration by default.
   */
  async listCommemorativeDates(
    scope: SocialPlannerScope,
    input: {
      periodStart: string;
      periodEnd: string;
      country?: string;
      businessMode?: string;
    },
  ): Promise<{
    dates: ResolvedCommemorativeDate[];
    country: string | null;
    businessMode: string | null;
  }> {
    const brand = await this.brandContext.load(scope);

    const country = normalizeCountry(input.country) ?? brand.country ?? null;

    /**
     * An unrecognized mode resolves to NULL rather than filtering on a key the
     * catalog has never heard of, which would return only the untagged dates
     * and look like a broken picker.
     */
    const businessMode =
      normalizeBusinessMode(input.businessMode) ?? brand.businessMode;

    return {
      dates: resolveCommemorativeDates({
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        country,
        businessMode,
      }),
      country,
      businessMode,
    };
  }

  async generatePlan(
    scope: SocialPlannerScope,
    planId: string,
    actorUserId: string | null,
    dto: RequestSocialPlanGenerationDto,
  ): Promise<SocialPlanGenerationResultView> {
    this.assertEnabled();

    const plan = await this.requirePlan(scope, planId);
    await this.assertWithinDailyBudget(scope);

    const [settingsResult, cadenceResult, brand] = await Promise.all([
      this.settingsService.getSettings(scope),
      this.cadenceService.getCadence(scope),
      this.brandContext.load(scope),
    ]);

    const settings = settingsResult.settings;
    const cadence = cadenceResult.cadence;

    const commemorativeDates = resolveCommemorativeDatesByKey(
      dto.commemorativeDateKeys ?? [],
      { periodStart: plan.periodStart, periodEnd: plan.periodEnd },
    );

    const itemCount = this.resolveItemCount(
      dto,
      plan,
      settings.monthlyContentVolume,
    );

    const vocabulary = planGenerationVocabulary(
      settings,
      cadence,
      commemorativeDates,
    );

    const context = buildPlanGenerationContext(
      {
        plan,
        settings,
        cadence,
        brand,
        commemorativeDates,
        commemorativeStoryOnly: dto.commemorativeStoryOnly ?? false,
        itemCount,
      },
      this.config.maxContextChars,
    );

    const run = await this.createRun(scope, plan, actorUserId, dto, itemCount);

    let result: PlanGenerationResult;
    try {
      result = await this.provider.generate({
        idempotencyKey: run.idempotencyKey,
        context,
        instruction: dto.instruction?.trim() || null,
        itemCount,
        allowed: vocabulary,
      });
    } catch (error) {
      await this.failRun(run, copyGenerationErrorCode(error));
      throw new ServiceUnavailableException(
        'AI plan generation could not be completed.',
      );
    }

    const items = await this.persistItems(
      scope,
      plan,
      actorUserId,
      result.items,
      {
        commemorativeDates,
        commemorativeStoryOnly: dto.commemorativeStoryOnly ?? false,
        cadence,
      },
    );

    await this.completeRun(run, result, items.length);

    return {
      runId: run.id,
      planId: plan.id,
      created: items.length,
      items: items.map((item) => toSocialContentItemView(item)),
    };
  }

  /**
   * How many items to generate when the operator did not say.
   *
   * The configured volume is monthly, so it is scaled by the plan's actual
   * length — a two-week plan asking for a month of content would blow past the
   * cadence, and a quarterly plan would come back a third full.
   */
  private resolveItemCount(
    dto: RequestSocialPlanGenerationDto,
    plan: SocialPlanEntity,
    monthlyVolume: number,
  ): number {
    if (dto.itemCount) return dto.itemCount;

    const days = daysBetween(plan.periodStart, plan.periodEnd) + 1;
    const scaled = Math.round((monthlyVolume * days) / 30);

    return Math.min(120, Math.max(1, scaled));
  }

  /**
   * Turns the model's grid into content items and their destinations.
   *
   * Every value the model produced is re-checked here even though the schema
   * already constrained it: a date is clamped into the plan period, and a
   * commemorative item is forced to Story when the operator asked for that.
   * The schema constrains what the model *may* say; this decides what the
   * Planner *stores*.
   */
  private async persistItems(
    scope: SocialPlannerScope,
    plan: SocialPlanEntity,
    actorUserId: string | null,
    generated: PlanGenerationItem[],
    options: {
      commemorativeDates: ResolvedCommemorativeDate[];
      commemorativeStoryOnly: boolean;
      cadence: { timezone: string };
    },
  ): Promise<SocialContentItemEntity[]> {
    const commemorativeByKey = new Map(
      options.commemorativeDates.map((date) => [date.key, date]),
    );

    const existingCount = await this.contentRepository.count({
      where: { ...this.contentScopeWhere(scope), planId: plan.id },
    });

    const rows: SocialContentItemEntity[] = [];
    const destinationDrafts: Array<{
      index: number;
      channel: string;
      placement: string;
      plannedAt: Date | null;
    }> = [];

    generated.forEach((item, index) => {
      const commemorative = item.commemorativeDateKey
        ? (commemorativeByKey.get(item.commemorativeDateKey) ?? null)
        : null;

      /**
       * A commemorative slot is pinned to its real date, not to whatever the
       * model wrote: the whole point of ticking the date was that the post
       * lands on it.
       */
      const plannedDate = commemorative
        ? commemorative.date
        : clampToPeriod(item.plannedDate, plan.periodStart, plan.periodEnd);

      const storyOnly =
        Boolean(commemorative) && options.commemorativeStoryOnly;

      const creativeFormat = storyOnly
        ? 'story'
        : (item.creativeFormat ?? null);

      rows.push(
        this.contentRepository.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          planId: plan.id,
          title: item.title.slice(0, 240),
          theme: item.theme,

          // Plan generation never writes copy. These stay empty for the copy
          // generation step the operator runs afterwards.
          brief: null,
          keyMessage: null,
          copy: null,
          caption: null,
          script: null,
          cta: null,
          hashtags: [],
          firstComment: null,
          currentRevisionId: null,

          funnelStage: item.funnelStage,
          contentType: commemorative
            ? (item.contentType ?? 'commemorative')
            : item.contentType,
          objective: item.objective,
          creativeFormat,

          planningStatus: 'planned',
          plannedDate,
          sortOrder: existingCount + index,

          campaignInstanceId: null,
          editorialPillarId: null,

          createdById: actorUserId,
          updatedById: actorUserId,
        }),
      );

      const placement = storyOnly ? 'story' : (item.placement ?? 'feed');
      const plannedAt = toPlannedAt(plannedDate, item.plannedTime);

      for (const channel of item.channels)
        destinationDrafts.push({ index, channel, placement, plannedAt });
    });

    const saved = await this.contentRepository.save(rows);

    const destinations = destinationDrafts
      .map((draft) => {
        const item = saved[draft.index];
        if (!item) return null;
        return this.destinationsRepository.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          contentItemId: item.id,
          channel: draft.channel,
          placement: draft.placement,
          plannedAt: draft.plannedAt,
        });
      })
      .filter((row): row is SocialContentDestinationEntity => row !== null);

    if (destinations.length > 0)
      await this.destinationsRepository.save(destinations);

    return saved;
  }

  private async createRun(
    scope: SocialPlannerScope,
    plan: SocialPlanEntity,
    actorUserId: string | null,
    dto: RequestSocialPlanGenerationDto,
    itemCount: number,
  ): Promise<SocialCopyGenerationRunEntity> {
    const run = this.runsRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      planId: plan.id,
      contentItemId: null,
      runKind: 'plan_grid',
      idempotencyKey: `plan:${plan.id}:${randomUUID()}`,
      status: 'processing',
      attempts: 1,
      maxAttempts: 1,
      startedAt: new Date(),
      /**
       * The reserve is charged before the call so a burst of concurrent
       * requests cannot each see a full budget. It is replaced by the token
       * estimate when the call returns.
       */
      costCents: this.config.reserveCents,
      costIsEstimated: true,
      contextVersion: SOCIAL_PLAN_CONTEXT_VERSION,
      promptVersion: SOCIAL_PLAN_PROMPT_VERSION,
      requestedItems: itemCount,
      commemorativeDateKeys: dto.commemorativeDateKeys ?? null,
      instruction: dto.instruction?.trim().slice(0, 2_000) || null,
      requestedById: actorUserId,
    });

    return this.runsRepository.save(run);
  }

  private async completeRun(
    run: SocialCopyGenerationRunEntity,
    result: PlanGenerationResult,
    created: number,
  ): Promise<void> {
    await this.runsRepository.update(
      { id: run.id },
      {
        status: 'succeeded',
        completedAt: new Date(),
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        inputTokens: result.usage.inputTokens ?? null,
        cachedInputTokens: result.usage.cachedInputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        costCents: this.estimateCostCents(result.usage),
        costIsEstimated: true,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        requestedItems: created > 0 ? created : run.requestedItems,
      },
    );
  }

  private async failRun(
    run: SocialCopyGenerationRunEntity,
    code: string,
  ): Promise<void> {
    this.logger.warn(`Plan generation run ${run.id} failed: ${code}`);

    await this.runsRepository.update(
      { id: run.id },
      {
        status: 'failed',
        failedAt: new Date(),
        lastError: code.slice(0, 120),
        // The reserve stays charged: a call that reached the provider and
        // failed still cost something, and zeroing it would hide that spend
        // from the daily budget.
      },
    );
  }

  /**
   * Token counts turned into cents at the configured rates. Always flagged
   * estimated — a token-derived number is not a provider invoice.
   */
  private estimateCostCents(usage: {
    inputTokens?: number;
    outputTokens?: number;
  }): number {
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;

    const cents =
      (input * this.config.inputCentsPerMillionTokens) / 1_000_000 +
      (output * this.config.outputCentsPerMillionTokens) / 1_000_000;

    return Math.max(this.config.reserveCents, Math.ceil(cents));
  }

  private async requirePlan(
    scope: SocialPlannerScope,
    planId: string,
  ): Promise<SocialPlanEntity> {
    const plan = await this.plansRepository.findOne({
      where: {
        id: planId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        companyContextId:
          scope.companyContextId === null ? IsNull() : scope.companyContextId,
      },
    });

    if (!plan) throw new NotFoundException('Plan not found.');
    return plan;
  }

  private contentScopeWhere(scope: SocialPlannerScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private async assertWithinDailyBudget(
    scope: SocialPlannerScope,
  ): Promise<void> {
    const remaining =
      await this.copyGenerationService.dailyBudgetRemaining(scope);

    if (remaining < this.config.reserveCents)
      throw new ServiceUnavailableException(
        'The daily AI generation budget for this context has been reached.',
      );
  }

  private assertEnabled(): void {
    if (this.config.mode === 'disabled')
      throw new ServiceUnavailableException(
        'AI generation is not enabled for this deployment.',
      );
  }
}

function normalizeCountry(country: string | undefined): string | null {
  const trimmed = country?.trim().toUpperCase();
  return trimmed && /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Checks a caller-supplied mode against the real enum instead of trusting the
 * query string, which is what keeps `SocialBusinessModeKey` meaningful rather
 * than "any string that arrived over HTTP".
 */
function normalizeBusinessMode(
  value: string | undefined,
): SocialBusinessModeKey | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  return BUSINESS_MODE_KEYS.has(trimmed as SocialBusinessModeKey)
    ? (trimmed as SocialBusinessModeKey)
    : null;
}

const BUSINESS_MODE_KEYS = new Set<SocialBusinessModeKey>(
  Object.values(LeadFlowBusinessMode),
);

/**
 * A date the model placed outside the plan is pulled to the nearest edge rather
 * than dropped: the operator asked for N items, and silently returning fewer
 * because the model drifted a day past the period is a worse answer than an
 * item on the last day.
 */
function clampToPeriod(
  date: string,
  periodStart: string,
  periodEnd: string,
): string {
  if (date < periodStart) return periodStart;
  if (date > periodEnd) return periodEnd;
  return date;
}

/**
 * Builds the destination timestamp from an editorial day plus a clock time.
 *
 * Deliberately assembled as a UTC instant from the parts. The cadence timezone
 * is recorded on the cadence itself and applied when publication is actually
 * scheduled; inventing an offset here would bake the server's timezone into
 * planning data.
 */
function toPlannedAt(date: string, time: string | null): Date | null {
  if (!time) return null;
  const parsed = new Date(`${date}T${time}:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00.000Z`);
  const to = Date.parse(`${end}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 30;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Re-exported so the module's error vocabulary stays in one place. */
export { SocialCopyGenerationError };
