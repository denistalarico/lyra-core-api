import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import { resolveUserWhatsAppPhone } from '../../agency/user-whatsapp-phone';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { getOperationsChatCatalog } from '../../leadflow-settings/catalog/business-mode-operations-chat.catalog';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { PlatformPermissionService } from '../../permissions';
import type { PermissionContext } from '../../permissions';
import type { LeadFlowAgentPresetCatalogItem } from '../catalog/agent-presets.catalog';
import {
  getAllowedActionsForType,
  getHandoffDefaultsByType,
  getHandoffPolicyDefaultsForType,
  resolveHandoffPolicyForType,
} from '../catalog/agent-presets.catalog';
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
import { computeAgentReadiness } from './agent-readiness';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import { LeadFlowAgentVersionStatus } from '../enums/leadflow-agent-version-status.enum';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../enums/room-operational.enums';
import { LEADFLOW_AGENTS_PERMISSIONS } from '../leadflow-agents.permissions';
import type {
  LeadFlowAgentActivationPolicy,
  LeadFlowAgentBehaviorConfig,
  LeadFlowAgentChannelPolicy,
  LeadFlowAgentReadiness,
  LeadFlowJsonObject,
} from '../types/leadflow-agent.types';
import { LeadFlowAgentPresetService } from './leadflow-agent-preset.service';
import { LeadFlowAgentRuntimeConfigService } from './leadflow-agent-runtime-config.service';
import { LeadFlowAgentBindingReconcilerService } from './leadflow-agent-binding-reconciler.service';
import { OperationsRoomStateService } from './operations-room-state.service';

const AGENCY_CONNECTION = 'agency';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LeadFlowHandoffTargetResponse {
  userId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  /** Se este usuário tem um WhatsApp resolvível no perfil. */
  hasWhatsApp: boolean;
}

interface ActiveContext {
  settings: LeadFlowClientSettingsEntity;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
  businessModeKey: string;
  isCustomBusinessMode: boolean;
}

@Injectable()
export class LeadFlowAgentService {
  private readonly logger = new Logger(LeadFlowAgentService.name);

  constructor(
    @InjectRepository(LeadFlowAgentEntity, AGENCY_CONNECTION)
    private readonly agentsRepository: Repository<LeadFlowAgentEntity>,
    @InjectRepository(LeadFlowAgentVersionEntity, AGENCY_CONNECTION)
    private readonly versionsRepository: Repository<LeadFlowAgentVersionEntity>,
    @InjectRepository(LeadFlowAgentChannelBindingEntity, AGENCY_CONNECTION)
    private readonly bindingsRepository: Repository<LeadFlowAgentChannelBindingEntity>,
    @InjectRepository(LeadFlowClientSettingsEntity, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<LeadFlowClientSettingsEntity>,
    @InjectRepository(InboxConversationEntity, AGENCY_CONNECTION)
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepository: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly userProfilesRepository: Repository<AgencyUserProfileEntity>,
    private readonly presetService: LeadFlowAgentPresetService,
    private readonly runtimeConfigService: LeadFlowAgentRuntimeConfigService,
    private readonly permissionService: PlatformPermissionService,
    private readonly bindingReconciler: LeadFlowAgentBindingReconcilerService,
    private readonly operationsRoomState: OperationsRoomStateService,
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
      operationsChat: getOperationsChatCatalog(active.businessModeKey),
      items: agents.map((agent) =>
        mapAgentDetailSummary(agent, bindingsByAgent.get(agent.id) ?? []),
      ),
    };
  }

  async listPresets(
    ctx: RequestContext,
  ): Promise<LeadFlowAgentPresetListResponse> {
    const active = await this.resolveActiveContext(ctx);
    const presets = this.presetService.listPresetsForBusinessMode(
      active.businessModeKey,
    );

    return {
      businessModeKey: active.businessModeKey,
      isCustomBusinessMode: active.isCustomBusinessMode,
      items: presets.map(mapAgentPreset),
      handoffDefaultsByType: getHandoffDefaultsByType(),
    };
  }

  /**
   * Quem pode ser escolhido como responsável pelo handoff de um agente.
   *
   * Todos os membros ativos do workspace, inclusive quem está pedindo — o
   * dono da conta é um destino legítimo, ao contrário de um encaminhamento de
   * conversa, onde encaminhar para si mesmo não faz sentido. `hasWhatsApp`
   * diz se aquela pessoa também receberia o aviso no WhatsApp, para a tela
   * poder sinalizar quem só receberia notificação no app.
   */
  async listHandoffTargets(
    ctx: RequestContext,
  ): Promise<LeadFlowHandoffTargetResponse[]> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const members = await this.workspaceUsersRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId, status: 'active' },
      order: { name: 'ASC' },
    });

    const userIds = members
      .map((member) => member.userId)
      .filter((userId): userId is string => Boolean(userId));
    const profiles = userIds.length
      ? await this.userProfilesRepository.find({
          where: { tenantId: ctx.tenantId, userId: In(userIds) },
        })
      : [];

    return members
      .filter((member): member is typeof member & { userId: string } =>
        Boolean(member.userId),
      )
      .map((member) => {
        const profile = profiles.find((item) => item.userId === member.userId);
        return {
          userId: member.userId,
          name: profile?.displayName?.trim() || member.name || member.email,
          email: member.email,
          jobTitle: profile?.jobTitle ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          hasWhatsApp: Boolean(resolveUserWhatsAppPhone(profile ?? null)),
        };
      });
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
      if (
        !preset ||
        String(preset.businessModeKey) !== String(active.businessModeKey)
      ) {
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
      agent.handoffPolicy = getHandoffPolicyDefaultsForType(agent.type);
      agent.crmPolicy = {};
      agent.channelPolicy = {
        allowedChannels: [],
        defaultChannel: null,
        activationPolicy: this.safeActivationPolicy(),
      };
      agent.avatarConfig = dto.avatarConfig ?? { preset: 'avatar-custom' };
      agent.metadata = {
        allowedActions: ['send_message', 'request_handoff'],
        safetyRules: ['stay_within_business_scope'],
        source: 'custom',
      };
    }

    // No bindings exist yet at creation; readiness honestly reports them
    // missing rather than a hard-coded placeholder.
    agent.readiness = this.computeReadiness(agent, active.settings, []);
    const saved = await this.agentsRepository.save(agent);

    await this.createDefaultBindings(saved, active.settings);

    if (dto.activate) {
      saved.status = LeadFlowAgentStatus.Active;
      await this.agentsRepository.save(saved);
      await this.recordOperationalStatus(
        saved,
        RoomAgentOperationalStatus.Available,
        'agent_provisioned_active',
      );
    }

    return this.detail(ctx, saved.id);
  }

  async getById(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.detail(ctx, id, { withDeleted: true });
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
    if (dto.type !== undefined) this.applyTypeChange(agent, dto.type);
    if (dto.description !== undefined) agent.description = dto.description;
    if (dto.behaviorConfig !== undefined) {
      agent.behaviorConfig = this.validateBehaviorConfig(dto.behaviorConfig);
    }
    if (dto.promptConfig !== undefined) {
      // Non-developer callers cannot introduce raw overrides (guarded above),
      // so the payload is safe to persist as-is here.
      agent.promptConfig = dto.promptConfig;
    }
    if (dto.handoffPolicy !== undefined) {
      agent.handoffPolicy = {
        ...agent.handoffPolicy,
        ...dto.handoffPolicy,
        ...(dto.handoffPolicy.targetUserIds !== undefined
          ? {
              targetUserIds: this.validateHandoffTargetUserIds(
                dto.handoffPolicy.targetUserIds,
              ),
            }
          : {}),
      };
    }
    if (dto.crmPolicy !== undefined) agent.crmPolicy = dto.crmPolicy;
    if (dto.channelPolicy !== undefined) {
      agent.channelPolicy = {
        ...dto.channelPolicy,
        activationPolicy: this.validateActivationPolicy(
          dto.channelPolicy.activationPolicy,
        ),
        channelActivationPolicies: this.validateChannelActivationPolicies(
          dto.channelPolicy.channelActivationPolicies,
        ),
      };
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
    // Um agente ativo não deve exigir um passo manual de publicação: se ele já
    // está operando, a configuração salva é a configuração vigente.
    await this.republishIfLive(ctx, agent, active);
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

  async archive(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);

    if (agent.isProtected) {
      throw new BadRequestException(
        'Este agente é protegido pela plataforma e não pode ser arquivado.',
      );
    }

    if (agent.status !== LeadFlowAgentStatus.Archived) {
      agent.status = LeadFlowAgentStatus.Archived;
      agent.archivedAt = new Date();
      agent.updatedById = ctx.userId ?? null;
      await this.agentsRepository.save(agent);

      await this.bindingReconciler.reconcile(ctx, {
        trigger: 'agent_archived',
      });

      await this.recordOperationalStatus(
        agent,
        RoomAgentOperationalStatus.Offline,
        'agent_archived',
      );
    }

    return this.detail(ctx, agent.id);
  }

  async unarchive(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);

    if (agent.status !== LeadFlowAgentStatus.Archived) {
      throw new BadRequestException('Este agente não está arquivado.');
    }

    agent.status = LeadFlowAgentStatus.Draft;
    agent.archivedAt = null;
    agent.updatedById = ctx.userId ?? null;
    await this.agentsRepository.save(agent);

    return this.detail(ctx, agent.id);
  }

  async softDelete(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);

    if (agent.isProtected) {
      throw new BadRequestException(
        'Este agente é protegido pela plataforma e não pode ser excluído.',
      );
    }

    const activeConversations = await this.conversationsRepository.count({
      where: {
        tenantId: agent.tenantId,
        workspaceId: agent.workspaceId,
        assignedAgentId: agent.id,
        status: Not(In(['resolved', 'closed', 'archived'])),
      },
    });

    if (activeConversations > 0) {
      throw new ConflictException(
        `Este agente ainda possui ${activeConversations} conversa(s) em andamento. Encerre-as antes de excluir.`,
      );
    }

    const archivedByDeletion = agent.status !== LeadFlowAgentStatus.Archived;
    const deletedAt = new Date();
    if (archivedByDeletion) {
      agent.status = LeadFlowAgentStatus.Archived;
      agent.archivedAt = deletedAt;
      agent.updatedById = ctx.userId ?? null;
    }
    agent.deletedAt = deletedAt;
    agent.deletedById = ctx.userId ?? null;
    await this.agentsRepository.save(agent);

    if (archivedByDeletion) {
      await this.bindingReconciler.reconcile(ctx, {
        trigger: 'agent_archived',
      });
      await this.recordOperationalStatus(
        agent,
        RoomAgentOperationalStatus.Offline,
        'agent_archived',
      );
    }

    return this.detail(ctx, agent.id, { withDeleted: true });
  }

  async publish(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id);

    if (agent.status === LeadFlowAgentStatus.Archived) {
      throw new BadRequestException(
        'Desarquive o agente antes de ativar, pausar ou publicar.',
      );
    }

    await this.publishVersion(ctx, agent, active, { force: true });

    return this.detail(ctx, agent.id);
  }

  /**
   * Publica a configuração atual do agente como uma nova versão.
   *
   * Sem `force`, uma publicação cuja fotografia é idêntica à versão vigente é
   * ignorada — é o que permite publicar automaticamente a cada alteração de um
   * agente ativo sem encher o histórico de versões iguais.
   */
  private async publishVersion(
    ctx: RequestContext,
    agent: LeadFlowAgentEntity,
    active: ActiveContext,
    opts?: { force?: boolean },
  ): Promise<boolean> {
    const bindings = await this.loadBindings(agent.id);

    const snapshot = this.runtimeConfigService.buildAgentContract(
      agent,
      active.settings,
      bindings,
    );

    if (
      !opts?.force &&
      (await this.matchesPublishedSnapshot(agent, snapshot))
    ) {
      return false;
    }

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
    // A versão publicada é uma das dependências de readiness: sem recalcular
    // aqui, o agente continuaria reportando "published_version" em falta.
    agent.readiness = this.computeReadiness(agent, active.settings, bindings);
    await this.agentsRepository.save(agent);

    await this.bindingReconciler.reconcile(ctx, {
      trigger: 'agent_published',
    });

    return true;
  }

  /**
   * Publicação automática de um agente em operação. Um agente pausado ou em
   * rascunho não publica sozinho: sua configuração ainda está sendo montada, e
   * publicar seria colocá-la em vigor antes da decisão de ativar.
   */
  private async republishIfLive(
    ctx: RequestContext,
    agent: LeadFlowAgentEntity,
    active: ActiveContext,
  ): Promise<void> {
    if (agent.status !== LeadFlowAgentStatus.Active) return;
    await this.publishVersion(ctx, agent, active);
  }

  private async matchesPublishedSnapshot(
    agent: LeadFlowAgentEntity,
    snapshot: LeadFlowAgentRuntimeConfigResponse,
  ): Promise<boolean> {
    if (!agent.publishedVersionId) return false;

    const published = await this.versionsRepository.findOne({
      where: { id: agent.publishedVersionId, agentId: agent.id },
    });
    if (!published?.snapshot) return false;

    return (
      comparableSnapshot(published.snapshot) === comparableSnapshot(snapshot)
    );
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

    if (agent.status === LeadFlowAgentStatus.Archived) {
      throw new BadRequestException(
        'Desarquive o agente antes de ativar, pausar ou publicar.',
      );
    }

    agent.status = status;
    agent.updatedById = ctx.userId ?? null;
    await this.agentsRepository.save(agent);

    if (status === LeadFlowAgentStatus.Active) {
      // Ativar já publica: a operação não deve depender de o usuário lembrar
      // de um segundo botão para o agente sair do papel.
      await this.publishVersion(ctx, agent, active);
      await this.bindingReconciler.reconcile(ctx, {
        trigger: 'agent_activated',
      });
    }

    await this.recordOperationalStatus(
      agent,
      status === LeadFlowAgentStatus.Active
        ? RoomAgentOperationalStatus.Available
        : RoomAgentOperationalStatus.Paused,
      status === LeadFlowAgentStatus.Active
        ? 'agent_activated'
        : 'agent_paused',
    );

    return this.detail(ctx, agent.id);
  }

  private async recordOperationalStatus(
    agent: LeadFlowAgentEntity,
    nextStatus: RoomAgentOperationalStatus,
    reasonCode: string,
  ) {
    try {
      await this.operationsRoomState.recordTransition({
        tenantId: agent.tenantId,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        nextStatus,
        occurredAt: new Date(),
        source: RoomOperationalSource.AgentRuntime,
        sourceEventId: `${reasonCode}:${agent.id}:${randomUUID()}`,
        reasonCode,
      });
    } catch (error) {
      this.logger.warn(
        `Não foi possível publicar telemetria ${reasonCode} do agente ${agent.id}: ${telemetryErrorCode(error)}`,
      );
    }
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
    agent.behaviorConfig = {
      ...preset.behaviorConfig,
      ...(dto.behaviorConfig ?? {}),
    };
    agent.promptConfig = { ...preset.promptConfig };
    agent.handoffPolicy = { ...preset.handoffPolicy };
    agent.crmPolicy = { ...preset.crmPolicy };
    agent.channelPolicy = {
      ...preset.channelPolicy,
      activationPolicy: this.safeActivationPolicy(),
    };
    agent.avatarConfig = {
      ...preset.avatarConfig,
      ...(dto.avatarConfig ?? {}),
    };
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
    opts?: { withDeleted?: boolean },
  ): Promise<LeadFlowAgentDetailResponse> {
    const active = await this.resolveActiveContext(ctx);
    const agent = await this.findScopedAgent(ctx, active, id, opts);
    const bindings = await this.loadBindings(agent.id);

    return {
      ...mapAgentDetail(agent, bindings),
      handoffPolicy: resolveHandoffPolicyForType(
        agent.type,
        agent.handoffPolicy,
      ),
    };
  }

  private async findScopedAgent(
    ctx: RequestContext,
    active: ActiveContext,
    id: string,
    opts?: { withDeleted?: boolean },
  ): Promise<LeadFlowAgentEntity> {
    const agent = await this.agentsRepository.findOne({
      where: { ...this.scopeWhere(ctx, active), id },
      withDeleted: opts?.withDeleted ?? false,
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
    const managedClientId =
      managed?.operatingMode === 'client' &&
      typeof managed.clientId === 'string' &&
      managed.clientId
        ? managed.clientId
        : null;

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
        typeof rawConfig.provider === 'string'
          ? rawConfig.provider
          : channelKey;
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

  private computeReadiness(
    agent: LeadFlowAgentEntity,
    settings: LeadFlowClientSettingsEntity | null,
    bindings: LeadFlowAgentChannelBindingEntity[],
  ): LeadFlowAgentReadiness {
    // Single source of truth, shared with the runtime contract, so the
    // readiness we persist and the readiness a runtime reads never disagree.
    return computeAgentReadiness(agent, settings, bindings);
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

  private safeActivationPolicy(): NonNullable<
    LeadFlowAgentChannelPolicy['activationPolicy']
  > {
    return {
      version: 1,
      trigger: 'manual',
      keywords: [],
      keywordMode: 'word',
      adFilters: {},
      expiresAfterMinutes: 1440,
      afterHandoff: 'require_explicit_return',
      automaticEffects: { reply: false, crm: false, followUp: false },
    };
  }

  /**
   * Troca o papel de um agente já provisionado.
   *
   * Mantém tudo que é escolha do operador (nome, descrição, avatar, tom,
   * canais e responsáveis nominais) e ajusta só o que o papel governa: ações
   * permitidas e defaults de handoff. Um agente que veio de um preset deixa de
   * ser aquele preset — continuar apontando para ele diria que este é o modelo
   * "Recepção" da Lyra quando ele passou a ser um agente de vendas.
   */
  private applyTypeChange(
    agent: LeadFlowAgentEntity,
    type: LeadFlowAgentType,
  ): void {
    if (agent.type === type) return;

    agent.type = type;
    agent.handoffPolicy = {
      ...agent.handoffPolicy,
      ...getHandoffPolicyDefaultsForType(type),
    };
    agent.metadata = {
      ...agent.metadata,
      allowedActions: getAllowedActionsForType(type),
    };

    if (agent.presetKey || agent.isProtected || agent.isSystem) {
      const originPresetKey =
        agent.presetKey ??
        (typeof agent.metadata?.presetKey === 'string'
          ? agent.metadata.presetKey
          : null);
      agent.presetKey = null;
      agent.isSystem = false;
      agent.isCustom = true;
      agent.isProtected = false;
      agent.metadata = {
        ...agent.metadata,
        source: 'custom',
        derivedFromPresetKey: originPresetKey,
        presetKey: null,
      };
    }
  }

  /**
   * Ids de usuário do handoff: UUIDs, em número sensato. Repetição não é erro
   * — a lista vem de uma seleção na tela — mas é guardada uma vez só, para o
   * destinatário não receber a mesma notificação duas vezes.
   */
  private validateHandoffTargetUserIds(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 20) {
      throw new BadRequestException('Handoff target users are invalid.');
    }
    if (value.some((item) => typeof item !== 'string')) {
      throw new BadRequestException('Handoff target users are invalid.');
    }

    const ids = [...new Set(value as string[])];
    if (ids.some((id) => !UUID_PATTERN.test(id))) {
      throw new BadRequestException('Handoff target users are invalid.');
    }

    return ids;
  }

  /**
   * Regras de ativação por canal. As chaves são ids de canal do Inbox; o valor
   * passa pela mesma validação da regra padrão, então nenhuma delas pode
   * introduzir keyword com regex ou efeito automático.
   */
  private validateChannelActivationPolicies(
    value: LeadFlowAgentChannelPolicy['channelActivationPolicies'],
  ): Record<string, LeadFlowAgentActivationPolicy> {
    if (!value) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Channel activation policies are invalid.');
    }

    const entries = Object.entries(value);
    if (entries.length > 50) {
      throw new BadRequestException('Channel activation policies are invalid.');
    }

    const result: Record<string, LeadFlowAgentActivationPolicy> = {};
    for (const [channelId, policy] of entries) {
      if (!UUID_PATTERN.test(channelId)) {
        throw new BadRequestException(
          'Channel activation policies are invalid.',
        );
      }
      result[channelId] = this.validateActivationPolicy(policy);
    }

    return result;
  }

  private validateActivationPolicy(
    value: LeadFlowAgentChannelPolicy['activationPolicy'],
  ) {
    if (!value) return this.safeActivationPolicy();
    if (
      !['manual', 'every_eligible', 'keywords', 'ad_referral'].includes(
        value.trigger,
      )
    ) {
      throw new BadRequestException('Activation trigger is invalid.');
    }
    const keywords = value.keywords ?? [];
    if (
      keywords.length > 50 ||
      keywords.some(
        (item) => typeof item !== 'string' || !item.trim() || item.length > 80,
      )
    ) {
      throw new BadRequestException('Activation keywords are invalid.');
    }
    if (keywords.some((item) => /[.*+?^${}()|[\]\\]/.test(item))) {
      throw new BadRequestException(
        'Regular expressions are not allowed in activation keywords.',
      );
    }
    return {
      ...this.safeActivationPolicy(),
      ...value,
      version: 1 as const,
      keywords: keywords.map((item) => item.trim()),
      automaticEffects: {
        reply: false as const,
        crm: false as const,
        followUp: false as const,
      },
      afterHandoff: 'require_explicit_return' as const,
    };
  }

  private validateBehaviorConfig(value: LeadFlowAgentBehaviorConfig) {
    const introduction = value.introductionPolicy ?? 'when_asked';
    if (!['never', 'first_reply', 'when_asked'].includes(introduction)) {
      throw new BadRequestException('Agent introduction policy is invalid.');
    }
    const disclosure =
      typeof value.aiDisclosure === 'string'
        ? value.aiDisclosure.trim()
        : 'Sou um assistente virtual.';
    if (!disclosure || disclosure.length > 240)
      throw new BadRequestException('AI disclosure is invalid.');
    const forbiddenHumanClaim =
      /\b(sou|como)\s+(uma?\s+)?(pessoa|humano|humana|funcion[aá]ri[oa])\b/i;
    if (forbiddenHumanClaim.test(disclosure))
      throw new BadRequestException(
        'Agent cannot claim to be human or an employee.',
      );
    return {
      ...value,
      introductionPolicy: introduction,
      aiDisclosure: disclosure,
    };
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

function mapAgentDetailSummary(
  agent: LeadFlowAgentEntity,
  bindings: LeadFlowAgentChannelBindingEntity[],
) {
  // The list endpoint returns the richer detail shape so cards can render
  // config-derived fields without an extra round-trip.
  return mapAgentDetail(agent, bindings);
}

/**
 * Campos voláteis ou derivados: comparar qualquer um deles diria que toda
 * configuração mudou. `generatedAt` é o carimbo da chamada, `readiness` é
 * consequência calculada do resto do contrato e `publishedVersionId` é a
 * autorreferência da publicação anterior — nenhum deles é configuração.
 */
const SNAPSHOT_VOLATILE_KEYS = new Set([
  'generatedAt',
  'readiness',
  'publishedVersionId',
]);

/**
 * Serialização estável da fotografia do agente, para responder "a configuração
 * mudou?".
 *
 * As chaves são ordenadas porque o snapshot vindo do Postgres é `jsonb`, que
 * não preserva a ordem de inserção: sem isso, a versão lida do banco nunca
 * casaria com a recém-construída em memória.
 */
function comparableSnapshot(snapshot: unknown): string {
  return JSON.stringify(stableValue(snapshot, true));
}

function stableValue(value: unknown, isRoot = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (isRoot && SNAPSHOT_VOLATILE_KEYS.has(key)) continue;
      result[key] = stableValue(source[key]);
    }
    return result;
  }
  return value;
}

function telemetryErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : 'unknown_error';
  return /^[a-z0-9_.: -]{1,120}$/i.test(message)
    ? message
    : 'telemetry_publish_failed';
}
