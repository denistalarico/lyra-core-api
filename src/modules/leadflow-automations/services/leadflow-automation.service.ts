import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { PlatformPermissionService } from '../../permissions';
import type { PermissionContext } from '../../permissions';
import {
  GOVERNED_STAGE_ADVANCE_RECIPE_KEY,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import { CrmStageTransitionPolicyService } from '../../crm/services/crm-stage-transition-policy.service';
import {
  DryRunAutomationDto,
  LeadFlowAutomationDetailResponse,
  LeadFlowAutomationListResponse,
  LeadFlowAutomationRecipeListResponse,
  LeadFlowAutomationRunDetailResponse,
  LeadFlowAutomationRunListResponse,
  mapAutomationDetail,
  mapAutomationRecipe,
  mapAutomationSummary,
  mapRun,
  mapRunDetail,
  PatchAutomationDto,
  ProvisionAutomationDto,
} from '../dto';
import type {
  LeadFlowAutomationDryRunResponse,
  LeadFlowAutomationLogsResponse,
  LeadFlowAutomationRuntimeConfigResponse,
  LeadFlowAutomationsRuntimeConfigResponse,
} from '../dto/leadflow-automation-runtime-config-response.dto';
import { type LeadFlowAutomationConfigSection } from '../catalog/automation-config-schemas.catalog';
import { isRuntimeAvailable } from '../catalog/automation-dependencies.registry';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationVersionEntity,
} from '../entities';
import { LeadFlowAutomationReadinessState } from '../enums/leadflow-automation-readiness-state.enum';
import {
  LeadFlowAutomationRunMode,
  LeadFlowAutomationRunStatus,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import { unavailableExecutors } from '../executors';
import { LEADFLOW_AUTOMATIONS_PERMISSIONS } from '../leadflow-automations.permissions';
import type {
  LeadFlowAutomationReadiness,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';
import {
  LeadFlowAutomationConfigSchemaService,
  type LeadFlowAutomationConfigError,
} from './leadflow-automation-config-schema.service';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import { LeadFlowAutomationEvaluationService } from './leadflow-automation-evaluation.service';
import {
  LeadFlowAutomationLifecycleService,
  type LeadFlowAutomationLifecycle,
} from './leadflow-automation-lifecycle.service';
import { LeadFlowAutomationRecipeService } from './leadflow-automation-recipe.service';
import { LeadFlowAutomationRunService } from './leadflow-automation-run.service';
import { LeadFlowAutomationRuntimeConfigService } from './leadflow-automation-runtime-config.service';

const AGENCY_CONNECTION = 'agency';

/** Actions that reach out to the lead and therefore need a channel to be ready. */
const OUTBOUND_ACTIONS = new Set(['send_message', 'schedule_followup']);

interface ActiveContext {
  settings: LeadFlowClientSettingsEntity;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
  businessModeKey: string;
  isCustomBusinessMode: boolean;
}

@Injectable()
export class LeadFlowAutomationService {
  constructor(
    @InjectRepository(LeadFlowAutomationEntity, AGENCY_CONNECTION)
    private readonly automationsRepository: Repository<LeadFlowAutomationEntity>,
    @InjectRepository(LeadFlowAutomationVersionEntity, AGENCY_CONNECTION)
    private readonly versionsRepository: Repository<LeadFlowAutomationVersionEntity>,
    @InjectRepository(LeadFlowClientSettingsEntity, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<LeadFlowClientSettingsEntity>,
    private readonly recipeService: LeadFlowAutomationRecipeService,
    private readonly runtimeConfigService: LeadFlowAutomationRuntimeConfigService,
    private readonly configSchemaService: LeadFlowAutomationConfigSchemaService,
    private readonly lifecycleService: LeadFlowAutomationLifecycleService,
    private readonly evaluationService: LeadFlowAutomationEvaluationService,
    private readonly contextService: LeadFlowAutomationContextService,
    private readonly runService: LeadFlowAutomationRunService,
    private readonly permissionService: PlatformPermissionService,
    private readonly transitionPolicies: CrmStageTransitionPolicyService,
  ) {}

  async list(ctx: RequestContext): Promise<LeadFlowAutomationListResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automations = await this.automationsRepository.find({
      where: this.scopeWhere(ctx, active),
      order: { createdAt: 'ASC' },
    });

    return {
      businessModeKey: active.businessModeKey,
      isCustomBusinessMode: active.isCustomBusinessMode,
      runtimeAvailable: isRuntimeAvailable(),
      items: automations.map((automation) => ({
        ...mapAutomationSummary(automation),
        lifecycle: this.lifecycleFor(automation, active),
      })),
    };
  }

  async listRecipes(
    ctx: RequestContext,
  ): Promise<LeadFlowAutomationRecipeListResponse> {
    const active = await this.resolveActiveContext(ctx);
    const canDeveloper = await this.can(
      ctx,
      LEADFLOW_AUTOMATIONS_PERMISSIONS.developerManage,
    );

    const recipes = this.recipeService
      .listRecipes()
      // Developer-only recipes are hidden from users without the developer
      // permission — governance parity with the detail Developer Mode.
      .filter((recipe) => !recipe.isDeveloperOnly || canDeveloper);

    return {
      businessModeKey: active.businessModeKey,
      isCustomBusinessMode: active.isCustomBusinessMode,
      runtimeAvailable: isRuntimeAvailable(),
      items: recipes.map((recipe) =>
        mapAutomationRecipe(recipe, active.businessModeKey),
      ),
    };
  }

  async provision(
    ctx: RequestContext,
    dto: ProvisionAutomationDto,
  ): Promise<LeadFlowAutomationDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const recipe = this.recipeService.getRecipe(dto.recipeKey);
    if (!recipe) {
      throw new BadRequestException('Receita de automação desconhecida.');
    }

    if (recipe.deprecated) {
      throw new BadRequestException(
        'Esta receita foi descontinuada e não pode mais ser provisionada.',
      );
    }

    if (recipe.isDeveloperOnly) {
      await this.assertDeveloper(ctx);
    }

    const automation = this.automationsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      settingsId: active.settings.id,
      contextType: active.contextType,
      agencyClientId: active.agencyClientId,
      businessModeKey: active.businessModeKey,
      status: LeadFlowAutomationStatus.Draft,
      createdById: ctx.userId ?? null,
      updatedById: ctx.userId ?? null,
    });

    this.applyRecipe(automation, recipe, dto);
    automation.readiness = this.computeReadiness(automation, active, recipe);

    const saved = await this.automationsRepository.save(automation);

    if (dto.activate) {
      // Same gate as the explicit activate endpoint — provisioning must not be
      // a side door around dependency checks.
      this.assertActivatable(this.lifecycleFor(saved, active));
      saved.status = LeadFlowAutomationStatus.Active;
      await this.automationsRepository.save(saved);
    }

    return this.detail(ctx, saved.id);
  }

  async getById(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    return this.detail(ctx, id);
  }

  async patch(
    ctx: RequestContext,
    id: string,
    dto: PatchAutomationDto,
  ): Promise<LeadFlowAutomationDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);

    const touchesDeveloper =
      dto.developerConfig !== undefined || dto.webhookConfig !== undefined;
    if (touchesDeveloper) {
      await this.assertDeveloper(ctx);
    }

    const recipeForValidation = this.recipeService.getRecipe(
      automation.recipeKey,
    );
    if (recipeForValidation) {
      this.assertConfigMatchesSchema(recipeForValidation, dto);
    }

    // A governed stage-advance may only be saved with a destination the CRM
    // actually admits for automations. Validated here so an impossible
    // configuration is refused at save, not silently ignored at run time.
    await this.assertGovernedStageAdvanceConfig(ctx, automation, dto);

    if (dto.name !== undefined) automation.name = dto.name;
    if (dto.description !== undefined) automation.description = dto.description;
    if (dto.triggerConfig !== undefined) {
      automation.triggerConfig = dto.triggerConfig;
    }
    if (dto.conditionConfig !== undefined) {
      automation.conditionConfig = dto.conditionConfig;
    }
    if (dto.actionConfig !== undefined) {
      automation.actionConfig = dto.actionConfig;
    }
    if (dto.messageConfig !== undefined) {
      automation.messageConfig = dto.messageConfig;
    }
    if (dto.crmPolicy !== undefined) automation.crmPolicy = dto.crmPolicy;
    if (dto.schedulePolicy !== undefined) {
      automation.schedulePolicy = dto.schedulePolicy;
    }
    if (dto.developerConfig !== undefined) {
      automation.developerConfig = dto.developerConfig;
    }
    if (dto.webhookConfig !== undefined) {
      // Merge so an update that omits `secret` keeps the stored one instead of
      // wiping it (the secret is never echoed back to the client).
      automation.webhookConfig = {
        ...automation.webhookConfig,
        ...dto.webhookConfig,
      };
    }

    automation.updatedById = ctx.userId ?? null;
    const recipe = this.recipeService.getRecipe(automation.recipeKey);
    automation.readiness = this.computeReadiness(automation, active, recipe);

    await this.automationsRepository.save(automation);
    return this.detail(ctx, automation.id);
  }

  async activate(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);

    this.assertActivatable(this.lifecycleFor(automation, active));

    return this.transition(ctx, automation, LeadFlowAutomationStatus.Active);
  }

  async pause(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);
    return this.transition(ctx, automation, LeadFlowAutomationStatus.Paused);
  }

  async publish(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);

    const snapshot = this.runtimeConfigService.buildAutomationContract(
      automation,
      active.settings,
    );

    const nextVersion = await this.nextVersionNumber(automation.id);
    const version = await this.versionsRepository.save(
      this.versionsRepository.create({
        tenantId: automation.tenantId,
        automationId: automation.id,
        version: nextVersion,
        status: LeadFlowAutomationVersionStatus.Published,
        snapshot,
        createdById: ctx.userId ?? null,
      }),
    );

    automation.publishedVersionId = version.id;
    automation.updatedById = ctx.userId ?? null;
    await this.automationsRepository.save(automation);

    return this.detail(ctx, automation.id);
  }

  async getAutomationRuntimeConfig(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationRuntimeConfigResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);

    return this.runtimeConfigService.buildAutomationContract(
      automation,
      active.settings,
    );
  }

  async getContextRuntimeConfig(
    ctx: RequestContext,
  ): Promise<LeadFlowAutomationsRuntimeConfigResponse> {
    const active = await this.resolveActiveContext(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const automations = await this.automationsRepository.find({
      where: {
        ...this.scopeWhere(ctx, active),
        status: LeadFlowAutomationStatus.Active,
      },
      order: { createdAt: 'ASC' },
    });

    const contracts = automations.map((automation) =>
      this.runtimeConfigService.buildAutomationContract(
        automation,
        active.settings,
      ),
    );

    return this.runtimeConfigService.buildContextContract(
      ctx.tenantId,
      workspaceId,
      active.settings,
      active.businessModeKey,
      contracts,
    );
  }

  /** Log view derived from persisted runs. */
  async getLogs(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationLogsResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);
    const runs = await this.runService.listRuns(ctx, automation.id);

    return {
      automationId: automation.id,
      placeholder: false,
      note:
        runs.length === 0
          ? 'Nenhum registro ainda. Execute uma simulação para ver como esta automação decidiria.'
          : 'Registros derivados das execuções e simulações desta automação.',
      items: runs.map((run) => ({
        id: run.id,
        automationId: run.automationId,
        level:
          run.status === LeadFlowAutomationRunStatus.Failed
            ? ('error' as const)
            : run.status === LeadFlowAutomationRunStatus.Skipped
              ? ('warn' as const)
              : ('info' as const),
        event: `${run.mode}.${run.status}`,
        message:
          run.errorMessage ??
          run.skipReason ??
          (run.mode === LeadFlowAutomationRunMode.DryRun
            ? 'Simulação concluída.'
            : run.mode === LeadFlowAutomationRunMode.Shadow
              ? 'Gatilho real avaliado sem executar efeitos.'
              : 'Execução concluída.'),
        createdAt: run.createdAt.toISOString(),
      })),
    };
  }

  async listRuns(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationRunListResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);
    const runs = await this.runService.listRuns(ctx, automation.id);

    return {
      automationId: automation.id,
      liveRunCount: runs.filter(
        (run) => run.mode === LeadFlowAutomationRunMode.Live,
      ).length,
      dryRunCount: runs.filter(
        (run) => run.mode === LeadFlowAutomationRunMode.DryRun,
      ).length,
      shadowRunCount: runs.filter(
        (run) => run.mode === LeadFlowAutomationRunMode.Shadow,
      ).length,
      items: runs.map(mapRun),
    };
  }

  async getRun(
    ctx: RequestContext,
    id: string,
    runId: string,
  ): Promise<LeadFlowAutomationRunDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);
    const { run, attempts } = await this.runService.getRun(
      ctx,
      automation.id,
      runId,
    );

    return mapRunDetail(run, attempts);
  }

  /**
   * Evaluates the stored configuration against a simulated situation and
   * persists the result as a run with `mode = dry_run`.
   *
   * This is a real evaluation, not a preview: the same condition logic a future
   * engine will use decides the outcome. It requests no effects — no message,
   * webhook, LLM call or cross-domain write — so it is safe to run against a
   * live configuration at any time.
   */
  async dryRun(
    ctx: RequestContext,
    id: string,
    dto: DryRunAutomationDto = {},
  ): Promise<LeadFlowAutomationDryRunResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);
    const recipe = this.recipeService.getRecipe(automation.recipeKey);

    const lifecycle = this.lifecycleFor(automation, active);
    const blockedByDependency = lifecycle.unmetDependencies.length > 0;

    // A simulation is explicitly hypothetical, so an operator may assert
    // signals the platform cannot observe — but only by stating them. Anything
    // left blank stays unresolved instead of acquiring a plausible value.
    const resolution = this.contextService.resolveForSimulation(
      automation,
      dto,
    );
    const evaluation = this.evaluationService.evaluate(
      automation,
      recipe,
      resolution.context,
      resolution.gaps,
    );

    const { run } = await this.runService.recordDryRun(
      ctx,
      automation,
      recipe,
      evaluation,
      { blockedByDependency, contextSnapshot: resolution.snapshot },
    );

    return {
      automationId: automation.id,
      runId: run.id,
      wouldAct: evaluation.wouldAct,
      status: evaluation.status,
      skipReason: evaluation.skipReason,
      blockedByDependency,
      note: blockedByDependency
        ? 'Simulação sem efeitos colaterais. Mesmo que as condições passem, esta automação ainda não pode ser executada pela plataforma.'
        : 'Simulação sem efeitos colaterais. Nenhuma mensagem, webhook ou IA é executada.',
      simulatedTrigger:
        (automation.triggerConfig?.type as string) ??
        recipe?.trigger ??
        'unknown',
      plannedActions: evaluation.plannedActions,
      checks: evaluation.checks,
      context: evaluation.context as unknown as Record<string, unknown>,
      readiness: automation.readiness ?? {},
      generatedAt: new Date().toISOString(),
    };
  }

  private async transition(
    ctx: RequestContext,
    automation: LeadFlowAutomationEntity,
    status: LeadFlowAutomationStatus,
  ): Promise<LeadFlowAutomationDetailResponse> {
    automation.status = status;
    automation.updatedById = ctx.userId ?? null;
    await this.automationsRepository.save(automation);

    return this.detail(ctx, automation.id);
  }

  private applyRecipe(
    automation: LeadFlowAutomationEntity,
    recipe: LeadFlowAutomationRecipeCatalogItem,
    dto: ProvisionAutomationDto,
  ): void {
    automation.recipeKey = recipe.key;
    automation.name = dto.name ?? recipe.name;
    automation.description = dto.description ?? recipe.description;
    automation.category = recipe.category;
    automation.triggerConfig = { ...recipe.defaultTriggerConfig };
    automation.conditionConfig = { ...recipe.defaultConditionConfig };
    automation.actionConfig = { ...recipe.defaultActionConfig };
    automation.messageConfig = { ...recipe.defaultMessageConfig };
    automation.crmPolicy = { ...recipe.defaultCrmPolicy };
    automation.schedulePolicy = { ...recipe.defaultSchedulePolicy };
    automation.developerConfig = { enabled: false, dryRunEnabled: false };
    automation.webhookConfig = recipe.isDeveloperOnly
      ? { enabled: false, direction: 'outgoing', method: 'POST' }
      : {};
    automation.templateVersion = recipe.templateVersion;
    automation.metadata = {
      tier: recipe.tier,
      source: 'recipe',
      recipeKey: recipe.key,
      templateVersion: recipe.templateVersion,
      safetyRules: [...recipe.safetyRules],
    };
  }

  /**
   * Rejects a configuration patch that does not match the recipe schema.
   * Closed by default: unknown keys and edits to structural fields are refused
   * rather than silently persisted into jsonb.
   */
  private assertConfigMatchesSchema(
    recipe: LeadFlowAutomationRecipeCatalogItem,
    dto: PatchAutomationDto,
  ): void {
    const sections: Array<
      [LeadFlowAutomationConfigSection, unknown, Record<string, unknown>]
    > = [
      ['trigger', dto.triggerConfig, recipe.defaultTriggerConfig],
      ['conditions', dto.conditionConfig, recipe.defaultConditionConfig],
      ['actions', dto.actionConfig, recipe.defaultActionConfig],
      ['message', dto.messageConfig, recipe.defaultMessageConfig],
      ['crmPolicy', dto.crmPolicy, recipe.defaultCrmPolicy],
      ['schedulePolicy', dto.schedulePolicy, recipe.defaultSchedulePolicy],
    ];

    const errors: LeadFlowAutomationConfigError[] = [];
    for (const [section, value, defaults] of sections) {
      if (value === undefined) continue;
      errors.push(
        ...this.configSchemaService.validateSection(
          recipe,
          section,
          value,
          defaults,
        ).errors,
      );
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'AUTOMATION_CONFIG_INVALID',
        message: 'A configuração enviada não é válida para esta automação.',
        errors,
      });
    }
  }

  /**
   * Fail-closed validation for the governed stage-advance recipe.
   *
   * When the patch sets both a destination stage and a reason on this recipe,
   * the pair must correspond to a published transition policy that admits the
   * automation actor. A partial configuration (one of the two) is left to the
   * ordinary "requires configuration" lifecycle rather than blocked here.
   */
  private async assertGovernedStageAdvanceConfig(
    ctx: RequestContext,
    automation: LeadFlowAutomationEntity,
    dto: PatchAutomationDto,
  ): Promise<void> {
    if (
      automation.recipeKey !== GOVERNED_STAGE_ADVANCE_RECIPE_KEY ||
      dto.crmPolicy === undefined
    ) {
      return;
    }
    const policy = dto.crmPolicy;
    const toStageId =
      typeof policy.moveStageOnComplete === 'string'
        ? policy.moveStageOnComplete
        : null;
    const reasonCode =
      typeof policy.moveStageReasonCode === 'string'
        ? policy.moveStageReasonCode
        : null;
    // Both empty is a legitimate "not configured yet"; both present is what we
    // validate. One present is caught by the required-field lifecycle.
    if (!toStageId || !reasonCode) return;

    await this.transitionPolicies.assertAutomationDestination(ctx, {
      toStageId,
      reasonCode,
    });
  }

  /** Derives the effective lifecycle state of an automation instance. */
  private lifecycleFor(
    automation: LeadFlowAutomationEntity,
    active: ActiveContext,
  ): LeadFlowAutomationLifecycle {
    const recipe = this.recipeService.getRecipe(automation.recipeKey);

    return this.lifecycleService.evaluate({
      status: automation.status,
      recipe,
      compatibleWithBusinessMode: recipe
        ? this.recipeService.isCompatible(recipe, active.businessModeKey)
        : false,
      missingConfiguration: recipe
        ? this.configSchemaService.findMissingRequiredFields(recipe, {
            trigger: automation.triggerConfig ?? {},
            conditions: automation.conditionConfig ?? {},
            actions: automation.actionConfig ?? {},
            message: automation.messageConfig ?? {},
            crmPolicy: automation.crmPolicy ?? {},
            schedulePolicy: automation.schedulePolicy ?? {},
          })
        : [],
      unavailableActions: recipe
        ? unavailableExecutors(this.configuredActionKeys(automation, recipe))
        : [],
    });
  }

  private configuredActionKeys(
    automation: LeadFlowAutomationEntity,
    recipe: LeadFlowAutomationRecipeCatalogItem,
  ): string[] {
    const actions = automation.actionConfig ?? {};
    const crmPolicy = automation.crmPolicy ?? {};
    const keys = [
      typeof actions.primaryAction === 'string'
        ? actions.primaryAction
        : recipe.primaryAction,
    ];
    if (Array.isArray(crmPolicy.addTags) && crmPolicy.addTags.length > 0) {
      keys.push('add_tag');
    }
    if (crmPolicy.appendNote === true) keys.push('append_note');
    if (crmPolicy.updateScore === true) keys.push('update_opportunity_score');
    if (
      typeof crmPolicy.moveStageOnComplete === 'string' &&
      typeof crmPolicy.moveStageReasonCode === 'string'
    ) {
      keys.push('move_opportunity_stage');
    }
    if (
      typeof crmPolicy.transferToPipelineRef === 'string' &&
      typeof crmPolicy.transferToStageRef === 'string' &&
      typeof crmPolicy.transferReasonCode === 'string'
    ) {
      keys.push('transfer_opportunity_pipeline');
    }
    if (
      typeof crmPolicy.copyToPipelineRef === 'string' &&
      typeof crmPolicy.copyToStageRef === 'string' &&
      typeof crmPolicy.copyReasonCode === 'string'
    ) {
      keys.push('copy_opportunity');
    }
    return keys;
  }

  /**
   * The single gate that keeps the on/off switch honest. An automation may only
   * be switched on when the platform can genuinely execute it.
   */
  private assertActivatable(lifecycle: LeadFlowAutomationLifecycle): void {
    if (lifecycle.canActivate) {
      return;
    }

    if (lifecycle.unmetDependencies.length > 0) {
      throw new ConflictException({
        code: 'AUTOMATION_BLOCKED_BY_DEPENDENCY',
        message: lifecycle.blockedReason,
        state: lifecycle.state,
        unmetDependencies: lifecycle.unmetDependencies,
      });
    }

    if (lifecycle.unavailableActions.length > 0) {
      throw new ConflictException({
        code: 'AUTOMATION_EXECUTOR_UNAVAILABLE',
        message: lifecycle.blockedReason,
        state: lifecycle.state,
        unavailableActions: lifecycle.unavailableActions,
      });
    }

    throw new BadRequestException({
      code: 'AUTOMATION_NOT_ACTIVATABLE',
      message:
        lifecycle.blockedReason ??
        'A automação não está pronta para ativar. Ajuste a configuração pendente.',
      state: lifecycle.state,
      missingConfiguration: lifecycle.missingConfiguration,
    });
  }

  private async detail(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);

    const recipe = this.recipeService.getRecipe(automation.recipeKey);
    const detail = mapAutomationDetail(automation);
    detail.capabilities = {
      developer: await this.can(
        ctx,
        LEADFLOW_AUTOMATIONS_PERMISSIONS.developerManage,
      ),
    };
    detail.lifecycle = this.lifecycleFor(automation, active);
    detail.configSchema = recipe
      ? this.configSchemaService.buildSchema(recipe)
      : null;
    return detail;
  }

  private async findScopedAutomation(
    ctx: RequestContext,
    active: ActiveContext,
    id: string,
  ): Promise<LeadFlowAutomationEntity> {
    const automation = await this.automationsRepository.findOne({
      where: { ...this.scopeWhere(ctx, active), id },
    });

    if (!automation) {
      throw new NotFoundException('Automação não encontrada neste contexto.');
    }

    return automation;
  }

  private scopeWhere(ctx: RequestContext, active: ActiveContext) {
    return {
      tenantId: ctx.tenantId,
      workspaceId: this.requireWorkspaceId(ctx),
      contextType: active.contextType,
      agencyClientId: active.agencyClientId ?? IsNull(),
    };
  }

  private async resolveActiveContext(
    ctx: RequestContext,
  ): Promise<ActiveContext> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const managed = ctx.managedContext;
    const managedClientId =
      managed?.operatingMode === 'client' ? managed.clientId : null;

    // Branch on the value itself, not on a derived boolean, so the client id
    // narrows to `string` here instead of needing an assertion.
    const settings = managedClientId
      ? await this.settingsRepository.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId,
            contextType: LeadFlowSettingsContextType.Client,
            agencyClientId: managedClientId,
          },
        })
      : await this.settingsRepository.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId,
            contextType: LeadFlowSettingsContextType.Agency,
            agencyClientId: IsNull(),
          },
        });

    if (!settings) {
      throw new NotFoundException(
        'Configure o LeadFlow Settings deste contexto antes de usar as Automações.',
      );
    }

    return {
      settings,
      contextType: settings.contextType,
      agencyClientId: settings.agencyClientId,
      businessModeKey: settings.businessModeKey,
      isCustomBusinessMode: this.recipeService.isCustomBusinessMode(
        settings.businessModeKey,
      ),
    };
  }

  private computeReadiness(
    automation: LeadFlowAutomationEntity,
    active: ActiveContext,
    recipe: LeadFlowAutomationRecipeCatalogItem | undefined,
  ): LeadFlowAutomationReadiness {
    const checkedAt = new Date().toISOString();

    if (!recipe) {
      return {
        score: 40,
        level: 'partial',
        state: LeadFlowAutomationReadinessState.MissingSettings,
        missing: ['recipe'],
        checkedAt,
      };
    }

    if (!this.recipeService.isCompatible(recipe, active.businessModeKey)) {
      return {
        score: 0,
        level: 'not_ready',
        state: LeadFlowAutomationReadinessState.UnsupportedBusinessMode,
        missing: ['business_mode'],
        checkedAt,
      };
    }

    const missing: string[] = [];
    let state = LeadFlowAutomationReadinessState.Ready;

    if (recipe.isDeveloperOnly) {
      const webhookReady =
        Boolean(automation.webhookConfig?.url) &&
        automation.webhookConfig?.enabled === true;
      if (!webhookReady) {
        missing.push('webhook');
        state = LeadFlowAutomationReadinessState.DeveloperRequired;
      }
    }

    const primaryAction =
      (automation.actionConfig?.primaryAction as string) ??
      recipe.primaryAction;
    if (state === LeadFlowAutomationReadinessState.Ready) {
      if (
        OUTBOUND_ACTIONS.has(primaryAction) &&
        !this.hasChannel(active.settings)
      ) {
        missing.push('channel');
        state = LeadFlowAutomationReadinessState.MissingChannel;
      }
    }

    // Readiness used to check only channel/webhook, so an automation with empty
    // required fields still reported "ready". Required fields now come from the
    // recipe schema, which is the same source the validator enforces.
    const missingFields = this.configSchemaService.findMissingRequiredFields(
      recipe,
      {
        trigger: automation.triggerConfig ?? {},
        conditions: automation.conditionConfig ?? {},
        actions: automation.actionConfig ?? {},
        message: automation.messageConfig ?? {},
        crmPolicy: automation.crmPolicy ?? {},
        schedulePolicy: automation.schedulePolicy ?? {},
      },
    );
    if (missingFields.length > 0) {
      missing.push(...missingFields);
      if (state === LeadFlowAutomationReadinessState.Ready) {
        state = LeadFlowAutomationReadinessState.MissingSettings;
      }
    }

    const score = Math.max(0, 100 - missing.length * 40);
    const level: LeadFlowAutomationReadiness['level'] =
      missing.length === 0 ? 'ready' : 'partial';

    return { score, level, state, missing, checkedAt };
  }

  private hasChannel(settings: LeadFlowClientSettingsEntity): boolean {
    const integrations = settings.enabledIntegrations ?? {};
    return Object.values(integrations).some(
      (value) =>
        this.isRecord(value) && (value as LeadFlowJsonObject).enabled !== false,
    );
  }

  private async nextVersionNumber(automationId: string): Promise<number> {
    const latest = await this.versionsRepository.findOne({
      where: { automationId },
      order: { version: 'DESC' },
    });

    return (latest?.version ?? 0) + 1;
  }

  private async assertDeveloper(ctx: RequestContext): Promise<void> {
    const allowed = await this.can(
      ctx,
      LEADFLOW_AUTOMATIONS_PERMISSIONS.developerManage,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Requer permissão de developer para configurar webhooks e opções avançadas.',
      );
    }
  }

  private async can(
    ctx: RequestContext,
    permissionKey: string,
  ): Promise<boolean> {
    if (!ctx.userId || !ctx.role) {
      return false;
    }

    const context: PermissionContext = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: ctx.role,
    };

    return this.permissionService.can(context, permissionKey);
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return ctx.workspaceId;
  }

  private isRecord(value: unknown): value is LeadFlowJsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
