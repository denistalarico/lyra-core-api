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
import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';
import {
  LeadFlowAutomationDetailResponse,
  LeadFlowAutomationListResponse,
  LeadFlowAutomationRecipeListResponse,
  mapAutomationDetail,
  mapAutomationRecipe,
  mapAutomationSummary,
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
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import { LEADFLOW_AUTOMATIONS_PERMISSIONS } from '../leadflow-automations.permissions';
import type {
  LeadFlowAutomationReadiness,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';
import {
  LeadFlowAutomationConfigSchemaService,
  type LeadFlowAutomationConfigError,
} from './leadflow-automation-config-schema.service';
import {
  LeadFlowAutomationLifecycleService,
  type LeadFlowAutomationLifecycle,
} from './leadflow-automation-lifecycle.service';
import { LeadFlowAutomationRecipeService } from './leadflow-automation-recipe.service';
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
    private readonly permissionService: PlatformPermissionService,
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

  /**
   * Placeholder logs. No automation runs in this sprint, so this always returns
   * a well-typed, empty envelope — never real dispatch data.
   */
  async getLogs(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationLogsResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);

    return {
      automationId: automation.id,
      placeholder: true,
      note: 'Logs de execução ainda não estão disponíveis. Esta automação é um contrato de configuração; nenhuma execução real ocorre neste momento.',
      items: [],
    };
  }

  /**
   * Placeholder dry-run. Produces a static, predictable preview of what *would*
   * happen if the trigger fired — with zero side effects (no message, webhook,
   * or LLM call).
   */
  async dryRun(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAutomationDryRunResponse> {
    const active = await this.resolveActiveContext(ctx);
    const automation = await this.findScopedAutomation(ctx, active, id);

    const trigger =
      (automation.triggerConfig?.type as string) ?? 'conversation.created';
    const primaryAction =
      (automation.actionConfig?.primaryAction as string) ?? 'send_message';
    const ready =
      automation.readiness?.state === LeadFlowAutomationReadinessState.Ready;

    return {
      automationId: automation.id,
      placeholder: true,
      wouldTrigger: ready,
      note: 'Simulação sem efeitos colaterais. Nenhuma mensagem, webhook ou IA é executada.',
      simulatedTrigger: trigger,
      simulatedActions: [primaryAction],
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
    });
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
    const isClientMode =
      managed?.operatingMode === 'client' && Boolean(managed.clientId);

    const settings = isClientMode
      ? await this.settingsRepository.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId,
            contextType: LeadFlowSettingsContextType.Client,
            agencyClientId: managed!.clientId as string,
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
      if (OUTBOUND_ACTIONS.has(primaryAction) && !this.hasChannel(active.settings)) {
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

  private async can(ctx: RequestContext, permissionKey: string): Promise<boolean> {
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
