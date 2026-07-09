import {
  BadRequestException,
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
import type { LeadFlowAgentPresetCatalogItem } from '../catalog/agent-presets.catalog';
import {
  LeadFlowAgentDetailResponse,
  LeadFlowAgentListResponse,
  LeadFlowAgentPresetListResponse,
  mapAgentDetail,
  mapAgentPreset,
  PatchAgentDto,
  ProvisionAgentDto,
} from '../dto';
import type {
  LeadFlowAgentRuntimeConfigResponse,
  LeadFlowAgentsRuntimeConfigResponse,
} from '../dto/leadflow-agent-runtime-config-response.dto';
import {
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentEntity,
  LeadFlowAgentVersionEntity,
} from '../entities';
import { LeadFlowAgentChannelStatus } from '../enums/leadflow-agent-channel-status.enum';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import { LeadFlowAgentVersionStatus } from '../enums/leadflow-agent-version-status.enum';
import { LEADFLOW_AGENTS_PERMISSIONS } from '../leadflow-agents.permissions';
import type {
  LeadFlowAgentReadiness,
  LeadFlowJsonObject,
} from '../types/leadflow-agent.types';
import { LeadFlowAgentPresetService } from './leadflow-agent-preset.service';
import { LeadFlowAgentRuntimeConfigService } from './leadflow-agent-runtime-config.service';

const AGENCY_CONNECTION = 'agency';

interface ActiveContext {
  settings: LeadFlowClientSettingsEntity;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
  businessModeKey: string;
  isCustomBusinessMode: boolean;
}

@Injectable()
export class LeadFlowAgentService {
  constructor(
    @InjectRepository(LeadFlowAgentEntity, AGENCY_CONNECTION)
    private readonly agentsRepository: Repository<LeadFlowAgentEntity>,
    @InjectRepository(LeadFlowAgentVersionEntity, AGENCY_CONNECTION)
    private readonly versionsRepository: Repository<LeadFlowAgentVersionEntity>,
    @InjectRepository(LeadFlowAgentChannelBindingEntity, AGENCY_CONNECTION)
    private readonly bindingsRepository: Repository<LeadFlowAgentChannelBindingEntity>,
    @InjectRepository(LeadFlowClientSettingsEntity, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<LeadFlowClientSettingsEntity>,
    private readonly presetService: LeadFlowAgentPresetService,
    private readonly runtimeConfigService: LeadFlowAgentRuntimeConfigService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  async list(ctx: RequestContext): Promise<LeadFlowAgentListResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agents = await this.agentsRepository.find({
      where: this.scopeWhere(ctx, active),
      order: { createdAt: 'ASC' },
    });
    const bindingsByAgent = await this.loadBindingsByAgent(
      agents.map((agent) => agent.id),
    );

    return {
      businessModeKey: active.businessModeKey,
      isCustomBusinessMode: active.isCustomBusinessMode,
      items: agents.map((agent) =>
        mapAgentDetailSummary(agent, bindingsByAgent.get(agent.id) ?? []),
      ),
    };
  }

  async listPresets(ctx: RequestContext): Promise<LeadFlowAgentPresetListResponse> {
    const active = await this.resolveActiveContext(ctx);
    const presets = this.presetService.listPresetsForBusinessMode(
      active.businessModeKey,
    );

    return {
      businessModeKey: active.businessModeKey,
      isCustomBusinessMode: active.isCustomBusinessMode,
      items: presets.map(mapAgentPreset),
    };
  }

  async provision(
    ctx: RequestContext,
    dto: ProvisionAgentDto,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    let agent = this.agentsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      settingsId: active.settings.id,
      contextType: active.contextType,
      agencyClientId: active.agencyClientId,
      businessModeKey: active.businessModeKey,
      status: LeadFlowAgentStatus.Draft,
      createdById: ctx.userId ?? null,
      updatedById: ctx.userId ?? null,
    });

    if (dto.presetKey) {
      if (active.isCustomBusinessMode) {
        throw new BadRequestException(
          'Business Mode customizado não possui presets. Crie um agente customizado.',
        );
      }

      const preset = this.presetService.getPreset(dto.presetKey);
      if (!preset || preset.businessModeKey !== active.businessModeKey) {
        throw new BadRequestException(
          'Preset incompatível com o Business Mode ativo.',
        );
      }

      agent = this.applyPreset(agent, preset, dto);
    } else {
      // Custom agent. Advanced/custom Business Modes are developer territory.
      if (active.isCustomBusinessMode) {
        await this.assertDeveloper(ctx);
      }

      if (!dto.name) {
        throw new BadRequestException('Nome do agente é obrigatório.');
      }

      agent.presetKey = null;
      agent.type = dto.type ?? LeadFlowAgentType.Custom;
      agent.name = dto.name;
      agent.description = dto.description ?? null;
      agent.isSystem = false;
      agent.isCustom = true;
      agent.isProtected = false;
      agent.behaviorConfig = dto.behaviorConfig ?? {};
      agent.promptConfig = {
        platformSystemPromptRef: 'lyra-leadflow-platform-system-v1',
        businessModePromptRef: `leadflow-business-mode-${active.businessModeKey}-v1`,
        clientPromptConfigRef: 'settings',
      };
      agent.handoffPolicy = {};
      agent.crmPolicy = {};
      agent.channelPolicy = { allowedChannels: [], defaultChannel: null };
      agent.avatarConfig = dto.avatarConfig ?? { preset: 'avatar-custom' };
      agent.metadata = {
        allowedActions: ['send_message', 'request_handoff'],
        safetyRules: ['stay_within_business_scope'],
        source: 'custom',
      };
    }

    agent.readiness = this.buildInitialReadiness();
    const saved = await this.agentsRepository.save(agent);

    await this.createDefaultBindings(saved, active.settings);

    if (dto.activate) {
      saved.status = LeadFlowAgentStatus.Active;
      await this.agentsRepository.save(saved);
    }

    return this.detail(ctx, saved.id);
  }

  async getById(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.detail(ctx, id);
  }

  async patch(
    ctx: RequestContext,
    id: string,
    dto: PatchAgentDto,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);

    const touchesRawPrompt =
      dto.developerOverrides !== undefined ||
      (dto.promptConfig !== undefined &&
        dto.promptConfig.developerOverrides !== undefined);

    if (touchesRawPrompt || active.isCustomBusinessMode) {
      await this.assertDeveloper(ctx);
    }

    if (dto.channelPolicy !== undefined) {
      await this.assertChannelManage(ctx);
    }

    if (dto.name !== undefined) agent.name = dto.name;
    if (dto.description !== undefined) agent.description = dto.description;
    if (dto.behaviorConfig !== undefined) {
      agent.behaviorConfig = dto.behaviorConfig;
    }
    if (dto.promptConfig !== undefined) {
      // Non-developer callers cannot introduce raw overrides (guarded above),
      // so the payload is safe to persist as-is here.
      agent.promptConfig = dto.promptConfig;
    }
    if (dto.handoffPolicy !== undefined) agent.handoffPolicy = dto.handoffPolicy;
    if (dto.crmPolicy !== undefined) agent.crmPolicy = dto.crmPolicy;
    if (dto.channelPolicy !== undefined) {
      agent.channelPolicy = dto.channelPolicy;
    }
    if (dto.avatarConfig !== undefined) agent.avatarConfig = dto.avatarConfig;
    if (dto.metadata !== undefined) {
      agent.metadata = { ...agent.metadata, ...dto.metadata };
    }
    if (dto.developerOverrides !== undefined) {
      agent.promptConfig = {
        ...agent.promptConfig,
        developerOverrides: dto.developerOverrides,
      };
    }

    agent.updatedById = ctx.userId ?? null;
    const bindings = await this.loadBindings(agent.id);
    agent.readiness = this.computeReadiness(agent, active.settings, bindings);

    await this.agentsRepository.save(agent);
    return this.detail(ctx, agent.id);
  }

  async activate(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.transition(ctx, id, LeadFlowAgentStatus.Active);
  }

  async pause(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.transition(ctx, id, LeadFlowAgentStatus.Paused);
  }

  async publish(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);
    const bindings = await this.loadBindings(agent.id);

    const snapshot = this.runtimeConfigService.buildAgentContract(
      agent,
      active.settings,
      bindings,
    );

    const nextVersion = await this.nextVersionNumber(agent.id);
    const version = await this.versionsRepository.save(
      this.versionsRepository.create({
        tenantId: agent.tenantId,
        agentId: agent.id,
        version: nextVersion,
        status: LeadFlowAgentVersionStatus.Published,
        snapshot,
        createdById: ctx.userId ?? null,
      }),
    );

    agent.publishedVersionId = version.id;
    agent.updatedById = ctx.userId ?? null;
    await this.agentsRepository.save(agent);

    return this.detail(ctx, agent.id);
  }

  async getAgentRuntimeConfig(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentRuntimeConfigResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);
    const bindings = await this.loadBindings(agent.id);

    return this.runtimeConfigService.buildAgentContract(
      agent,
      active.settings,
      bindings,
    );
  }

  async getContextRuntimeConfig(
    ctx: RequestContext,
  ): Promise<LeadFlowAgentsRuntimeConfigResponse> {
    const active = await this.resolveActiveContext(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const agents = await this.agentsRepository.find({
      where: {
        ...this.scopeWhere(ctx, active),
        status: LeadFlowAgentStatus.Active,
      },
      order: { createdAt: 'ASC' },
    });
    const bindingsByAgent = await this.loadBindingsByAgent(
      agents.map((agent) => agent.id),
    );

    const agentContracts = agents.map((agent) =>
      this.runtimeConfigService.buildAgentContract(
        agent,
        active.settings,
        bindingsByAgent.get(agent.id) ?? [],
      ),
    );

    return this.runtimeConfigService.buildContextContract(
      ctx.tenantId,
      workspaceId,
      active.settings,
      active.businessModeKey,
      agentContracts,
    );
  }

  private async transition(
    ctx: RequestContext,
    id: string,
    status: LeadFlowAgentStatus,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);

    agent.status = status;
    agent.updatedById = ctx.userId ?? null;
    await this.agentsRepository.save(agent);

    return this.detail(ctx, agent.id);
  }

  private applyPreset(
    agent: LeadFlowAgentEntity,
    preset: LeadFlowAgentPresetCatalogItem,
    dto: ProvisionAgentDto,
  ): LeadFlowAgentEntity {
    agent.presetKey = preset.key;
    agent.type = preset.type;
    agent.name = dto.name ?? preset.name;
    agent.description = dto.description ?? preset.description;
    agent.isSystem = preset.isSystem;
    agent.isCustom = false;
    agent.isProtected = preset.isProtected;
    agent.behaviorConfig = { ...preset.behaviorConfig, ...(dto.behaviorConfig ?? {}) };
    agent.promptConfig = { ...preset.promptConfig };
    agent.handoffPolicy = { ...preset.handoffPolicy };
    agent.crmPolicy = { ...preset.crmPolicy };
    agent.channelPolicy = { ...preset.channelPolicy };
    agent.avatarConfig = { ...preset.avatarConfig, ...(dto.avatarConfig ?? {}) };
    agent.metadata = {
      allowedActions: [...preset.allowedActions],
      safetyRules: [...preset.safetyRules],
      source: 'preset',
      presetKey: preset.key,
    };

    return agent;
  }

  private async detail(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);
    const bindings = await this.loadBindings(agent.id);

    return mapAgentDetail(agent, bindings);
  }

  private async findScopedAgent(
    ctx: RequestContext,
    active: ActiveContext,
    id: string,
  ): Promise<LeadFlowAgentEntity> {
    const agent = await this.agentsRepository.findOne({
      where: { ...this.scopeWhere(ctx, active), id },
    });

    if (!agent) {
      throw new NotFoundException('Agente não encontrado neste contexto.');
    }

    return agent;
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
        'Configure o LeadFlow Settings deste contexto antes de usar os Agentes.',
      );
    }

    return {
      settings,
      contextType: settings.contextType,
      agencyClientId: settings.agencyClientId,
      businessModeKey: settings.businessModeKey,
      isCustomBusinessMode: this.presetService.isCustomBusinessMode(
        settings.businessModeKey,
      ),
    };
  }

  private async createDefaultBindings(
    agent: LeadFlowAgentEntity,
    settings: LeadFlowClientSettingsEntity,
  ): Promise<void> {
    const integrations = settings.enabledIntegrations ?? {};
    const allowedChannels: string[] = [];
    const bindings: LeadFlowAgentChannelBindingEntity[] = [];

    for (const [channelKey, rawConfig] of Object.entries(integrations)) {
      if (!this.isRecord(rawConfig) || rawConfig.enabled === false) {
        continue;
      }

      const provider =
        typeof rawConfig.provider === 'string' ? rawConfig.provider : channelKey;
      const connections = Array.isArray(rawConfig.connections)
        ? rawConfig.connections
        : [];
      const firstConnection = connections.find((item) => this.isRecord(item));
      const externalRef =
        firstConnection && typeof firstConnection.id === 'string'
          ? firstConnection.id
          : null;

      allowedChannels.push(channelKey);
      bindings.push(
        this.bindingsRepository.create({
          tenantId: agent.tenantId,
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          channelKey,
          provider,
          externalRef,
          status: externalRef
            ? LeadFlowAgentChannelStatus.Pending
            : LeadFlowAgentChannelStatus.Unbound,
          config: {},
        }),
      );
    }

    if (bindings.length) {
      await this.bindingsRepository.save(bindings);
    }

    agent.channelPolicy = {
      ...agent.channelPolicy,
      allowedChannels,
      defaultChannel: allowedChannels[0] ?? null,
    };
    await this.agentsRepository.save(agent);
  }

  private async loadBindings(
    agentId: string,
  ): Promise<LeadFlowAgentChannelBindingEntity[]> {
    return this.bindingsRepository.find({
      where: { agentId },
      order: { channelKey: 'ASC' },
    });
  }

  private async loadBindingsByAgent(
    agentIds: string[],
  ): Promise<Map<string, LeadFlowAgentChannelBindingEntity[]>> {
    const map = new Map<string, LeadFlowAgentChannelBindingEntity[]>();
    if (!agentIds.length) {
      return map;
    }

    const bindings = await this.bindingsRepository.find({
      where: agentIds.map((agentId) => ({ agentId })),
      order: { channelKey: 'ASC' },
    });

    for (const binding of bindings) {
      const list = map.get(binding.agentId) ?? [];
      list.push(binding);
      map.set(binding.agentId, list);
    }

    return map;
  }

  private async nextVersionNumber(agentId: string): Promise<number> {
    const latest = await this.versionsRepository.findOne({
      where: { agentId },
      order: { version: 'DESC' },
    });

    return (latest?.version ?? 0) + 1;
  }

  private buildInitialReadiness(): LeadFlowAgentReadiness {
    return {
      score: 40,
      level: 'partial',
      missing: ['channels', 'review'],
      checkedAt: new Date().toISOString(),
    };
  }

  private computeReadiness(
    agent: LeadFlowAgentEntity,
    settings: LeadFlowClientSettingsEntity,
    bindings: LeadFlowAgentChannelBindingEntity[],
  ): LeadFlowAgentReadiness {
    const missing: string[] = [];

    if (!agent.name?.trim()) {
      missing.push('name');
    }

    const promptConfigured =
      this.isRecord(settings.clientPromptConfig) &&
      Object.keys(settings.clientPromptConfig).length > 0;
    if (!promptConfigured) {
      missing.push('client_prompt');
    }

    const hasChannel = bindings.some(
      (binding) => binding.status !== LeadFlowAgentChannelStatus.Unbound,
    );
    if (!hasChannel) {
      missing.push('channels');
    }

    const score = Math.max(0, 100 - missing.length * 30);
    const level: LeadFlowAgentReadiness['level'] =
      missing.length === 0 ? 'ready' : missing.length === 1 ? 'partial' : 'not_ready';

    return { score, level, missing, checkedAt: new Date().toISOString() };
  }

  private async assertDeveloper(ctx: RequestContext): Promise<void> {
    const allowed = await this.can(
      ctx,
      LEADFLOW_AGENTS_PERMISSIONS.developerManage,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Requer permissão de developer para configuração avançada ou prompt bruto.',
      );
    }
  }

  private async assertChannelManage(ctx: RequestContext): Promise<void> {
    const allowed = await this.can(
      ctx,
      LEADFLOW_AGENTS_PERMISSIONS.channelManage,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Requer permissão para gerenciar canais dos agentes.',
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

function mapAgentDetailSummary(
  agent: LeadFlowAgentEntity,
  bindings: LeadFlowAgentChannelBindingEntity[],
) {
  // The list endpoint returns the richer detail shape so cards can render
  // config-derived fields without an extra round-trip.
  return mapAgentDetail(agent, bindings);
}
