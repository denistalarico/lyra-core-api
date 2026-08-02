import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { randomUUID } from 'crypto';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { AgencyClient } from '../../clients/entities';
import { PlatformProductKey, TenantProductEntitlementEntity } from '../../platform';
import {
  CreateLeadFlowClientSettingsDto,
  LeadFlowClientSettingsResponse,
  LeadFlowClientSummaryListResponse,
  LeadFlowCompanyCapacityResponse,
  LeadFlowSettingsValidationIssue,
  LeadFlowSettingsValidationResponse,
  ListLeadFlowClientsQueryDto,
  mapLeadFlowClientSettingsResponse,
  mapLeadFlowClientSummaryResponse,
  mapLeadFlowCompanyCapacityResponse,
  UpdateLeadFlowClientSettingsDto,
  ValidateLeadFlowClientSettingsDto,
} from '../dto';
import {
  LeadFlowBusinessModeTemplateEntity,
  LeadFlowClientSettingsEntity,
} from '../entities';
import { LeadFlowSettingsContextType } from '../enums/leadflow-settings-context-type.enum';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import {
  DEFAULT_LEADFLOW_ENABLED_APPS_SCHEMA,
  DEFAULT_LEADFLOW_ENABLED_INTEGRATIONS_SCHEMA,
  LeadFlowEnabledAppsConfig,
  LeadFlowEnabledIntegrationsConfig,
  LeadFlowJsonObject,
} from '../types/leadflow-settings.types';
import { LeadFlowBusinessModeTemplateService } from './leadflow-business-mode-template.service';
import { CompanyContextService } from './company-context.service';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';

const AGENCY_CONNECTION = 'agency';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class LeadFlowClientSettingsService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly agencyClientsRepository: Repository<AgencyClient>,
    @InjectRepository(LeadFlowClientSettingsEntity, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<LeadFlowClientSettingsEntity>,
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepository: Repository<TenantProductEntitlementEntity>,
    private readonly businessModeTemplateService: LeadFlowBusinessModeTemplateService,
    private readonly companyContextService: CompanyContextService,
  ) {}

  async listClients(
    ctx: RequestContext,
    filters: ListLeadFlowClientsQueryDto,
  ): Promise<LeadFlowClientSummaryListResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const limit = this.parseLimit(filters.limit);
    const offset = this.parseOffset(filters.offset);

    const qb = this.agencyClientsRepository
      .createQueryBuilder('client')
      .leftJoin(
        LeadFlowClientSettingsEntity,
        'settings',
        [
          'settings.tenant_id = client.tenant_id',
          'settings.workspace_id = client.workspace_id',
          'settings.agency_client_id = client.id',
          "settings.context_type = 'client'",
        ].join(' AND '),
      )
      .where('client.tenant_id = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('client.workspace_id = :workspaceId', { workspaceId })
      .andWhere('client.archived_at IS NULL');

    if (filters.search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('client.display_name ILIKE :search', {
              search: `%${filters.search}%`,
            })
            .orWhere('client.legal_name ILIKE :search', {
              search: `%${filters.search}%`,
            })
            .orWhere('client.segment ILIKE :search', {
              search: `%${filters.search}%`,
            });
        }),
      );
    }

    if (filters.configured === 'true') {
      qb.andWhere('settings.id IS NOT NULL');
    } else if (filters.configured === 'false') {
      qb.andWhere('settings.id IS NULL');
    }

    if (filters.status) {
      qb.andWhere('settings.status = :leadflowStatus', {
        leadflowStatus: filters.status,
      });
    }

    const [clients, total] = await qb
      .orderBy('client.displayName', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    const settingsByClientId = await this.loadSettingsByClientId(
      ctx.tenantId,
      workspaceId,
      clients.map((client) => client.id),
    );

    return {
      items: clients.map((client) =>
        mapLeadFlowClientSummaryResponse(
          client,
          settingsByClientId.get(client.id) ?? null,
        ),
      ),
      total,
      limit,
      offset,
    };
  }

  /**
   * Structured capacity contract for the tenant's LeadFlow entitlement:
   * active companies, configured limit and remaining slots. This is the
   * single source of truth consumed both by the API and the UI — the
   * `plan` free-text field on settings never authorizes or blocks.
   */
  async getCapacity(
    ctx: RequestContext,
  ): Promise<LeadFlowCompanyCapacityResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const entitlement = await this.findLeadFlowEntitlement(
      this.entitlementsRepository,
      ctx.tenantId,
    );
    const limit = this.resolveCompanyLimit(entitlement);
    const activeCompanies = await this.countActiveCompanies(
      this.settingsRepository,
      ctx.tenantId,
      workspaceId,
    );

    return mapLeadFlowCompanyCapacityResponse(
      activeCompanies,
      limit,
      entitlement,
    );
  }

  async getSettings(
    ctx: RequestContext,
    agencyClientId: string,
  ): Promise<LeadFlowClientSettingsResponse> {
    await this.assertAgencyClient(ctx, agencyClientId);
    const settings = await this.findSettings(ctx, agencyClientId);

    if (!settings) {
      throw new NotFoundException(
        'LeadFlow settings not found for this agency client.',
      );
    }

    return mapLeadFlowClientSettingsResponse(settings);
  }

  async createSettings(
    ctx: RequestContext,
    agencyClientId: string,
    dto: CreateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    const agencyClient = await this.assertAgencyClient(ctx, agencyClientId);
    const existing = await this.findSettings(ctx, agencyClientId);

    if (existing) {
      throw new ConflictException(
        'LeadFlow settings already exist for this agency client.',
      );
    }

    const template = await this.resolveBusinessModeTemplate(
      ctx,
      dto.businessModeKey,
    );
    this.assertValidSettingsPayload(dto, template);

    const workspaceId = this.requireWorkspaceId(ctx);

    return this.dataSource.transaction(async (manager) => {
      await this.assertCapacityAvailable(manager, ctx.tenantId, workspaceId);

      const settingsRepository = manager.getRepository(
        LeadFlowClientSettingsEntity,
      );
      const settings = settingsRepository.create({
        tenantId: ctx.tenantId,
        workspaceId,
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId,
        managedTenantId: agencyClient.managedTenantId,
        businessModeKey: template.key,
        businessModeTemplateId: template.id,
        planKey: dto.planKey ?? null,
        status: dto.status ?? LeadFlowSettingsStatus.Draft,
        developerModeEnabled: false,
        enabledApps: dto.enabledApps ?? this.buildDefaultEnabledApps(template),
        enabledIntegrations:
          dto.enabledIntegrations ??
          this.buildDefaultEnabledIntegrations(template),
        permissionsConfig: dto.permissionsConfig ?? {},
        brandingConfig: dto.brandingConfig ?? {},
        agentConfig: dto.agentConfig ?? {},
        clientPromptConfig: dto.clientPromptConfig ?? {},
        companyContextSchemaVersion: 1,
        companyContextDraft: dto.companyContextDraft
          ? this.companyContextService.normalize(dto.companyContextDraft)
          : this.companyContextService.fromLegacy(
              dto.clientPromptConfig ?? {},
            ),
        companyContextPublished: {},
        companyContextPublishedVersion: 0,
        companyContextPublishedHash: null,
        companyContextPublishedAt: null,
        companyContextPublishedBy: null,
        inboxConfig: dto.inboxConfig ?? {},
        inboxOverrides: dto.inboxOverrides ?? {},
        handoffOverrides: dto.handoffOverrides ?? {},
        leadsConfig: dto.leadsConfig ?? {},
        pipelineRef: dto.pipelineRef ?? {},
        businessModeOverrides: dto.businessModeOverrides ?? {},
        developerOverrides: {},
        metadata: dto.metadata ?? {},
        createdById: ctx.userId ?? null,
        updatedById: ctx.userId ?? null,
      });

      return mapLeadFlowClientSettingsResponse(
        await settingsRepository.save(settings),
      );
    });
  }

  async updateSettings(
    ctx: RequestContext,
    agencyClientId: string,
    dto: UpdateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    await this.assertAgencyClient(ctx, agencyClientId);
    this.assertDeveloperModeNotRequested(dto);

    const settings = await this.findSettings(ctx, agencyClientId);

    if (!settings) {
      throw new NotFoundException(
        'LeadFlow settings not found for this agency client.',
      );
    }

    return this.applySettingsUpdate(ctx, settings, dto);
  }

  async getAgencySettings(
    ctx: RequestContext,
  ): Promise<LeadFlowClientSettingsResponse> {
    const settings = await this.findAgencySettings(ctx);

    if (!settings) {
      throw new NotFoundException(
        'LeadFlow settings not found for this agency.',
      );
    }

    return mapLeadFlowClientSettingsResponse(settings);
  }

  async createAgencySettings(
    ctx: RequestContext,
    dto: CreateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    const existing = await this.findAgencySettings(ctx);

    if (existing) {
      throw new ConflictException(
        'LeadFlow settings already exist for this agency.',
      );
    }

    const template = await this.resolveBusinessModeTemplate(
      ctx,
      dto.businessModeKey,
    );
    this.assertValidSettingsPayload(dto, template);

    const workspaceId = this.requireWorkspaceId(ctx);
    const settings = this.settingsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      managedTenantId: null,
      businessModeKey: template.key,
      businessModeTemplateId: template.id,
      planKey: dto.planKey ?? null,
      status: dto.status ?? LeadFlowSettingsStatus.Draft,
      developerModeEnabled: false,
      enabledApps: dto.enabledApps ?? this.buildDefaultEnabledApps(template),
      enabledIntegrations:
        dto.enabledIntegrations ??
        this.buildDefaultEnabledIntegrations(template),
      permissionsConfig: dto.permissionsConfig ?? {},
      brandingConfig: dto.brandingConfig ?? {},
      agentConfig: dto.agentConfig ?? {},
      clientPromptConfig: dto.clientPromptConfig ?? {},
      companyContextSchemaVersion: 1,
      companyContextDraft: dto.companyContextDraft
        ? this.companyContextService.normalize(dto.companyContextDraft)
        : this.companyContextService.fromLegacy(dto.clientPromptConfig ?? {}),
      companyContextPublished: {},
      companyContextPublishedVersion: 0,
      companyContextPublishedHash: null,
      companyContextPublishedAt: null,
      companyContextPublishedBy: null,
      inboxConfig: dto.inboxConfig ?? {},
      inboxOverrides: dto.inboxOverrides ?? {},
      handoffOverrides: dto.handoffOverrides ?? {},
      leadsConfig: dto.leadsConfig ?? {},
      pipelineRef: dto.pipelineRef ?? {},
      businessModeOverrides: dto.businessModeOverrides ?? {},
      developerOverrides: {},
      metadata: dto.metadata ?? {},
      createdById: ctx.userId ?? null,
      updatedById: ctx.userId ?? null,
    });

    return mapLeadFlowClientSettingsResponse(
      await this.settingsRepository.save(settings),
    );
  }

  async updateAgencySettings(
    ctx: RequestContext,
    dto: UpdateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    this.assertDeveloperModeNotRequested(dto);

    const settings = await this.findAgencySettings(ctx);

    if (!settings) {
      throw new NotFoundException(
        'LeadFlow settings not found for this agency.',
      );
    }

    return this.applySettingsUpdate(ctx, settings, dto);
  }

  async publishCompanyContext(ctx: RequestContext, agencyClientId?: string) {
    const settings = agencyClientId
      ? await this.findSettings(ctx, agencyClientId)
      : await this.findAgencySettings(ctx);
    if (!settings) throw new NotFoundException('LeadFlow settings not found.');
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(LeadFlowClientSettingsEntity)
        .findOne({
          where: {
            id: settings.id,
            tenantId: settings.tenantId,
            workspaceId: settings.workspaceId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!locked) throw new NotFoundException('LeadFlow settings not found.');
      const published = this.companyContextService.normalizePersisted(
        locked.companyContextDraft ?? {},
      );
      locked.companyContextPublished = published;
      locked.companyContextPublishedVersion =
        (locked.companyContextPublishedVersion || 0) + 1;
      locked.companyContextPublishedHash =
        this.companyContextService.hash(published);
      locked.companyContextPublishedAt = new Date();
      locked.companyContextPublishedBy = ctx.userId ?? null;
      locked.updatedById = ctx.userId ?? null;
      await manager.getRepository(LeadFlowClientSettingsEntity).save(locked);
      await manager.getRepository(InboxDomainOutboxEntity).save(
        manager.getRepository(InboxDomainOutboxEntity).create({
          tenantId: locked.tenantId,
          workspaceId: locked.workspaceId,
          aggregateType: 'leadflow_company_context',
          aggregateId: locked.id,
          eventName: 'leadflow.context.published',
          eventVersion: 1,
          idempotencyKey: `company-context:${locked.id}:v${locked.companyContextPublishedVersion}`,
          payload: {
            settingsId: locked.id,
            version: locked.companyContextPublishedVersion,
            hash: locked.companyContextPublishedHash,
          },
          status: 'pending',
          attempts: 0,
          availableAt: new Date(),
        }),
      );
      return mapLeadFlowClientSettingsResponse(locked);
    });
  }

  async previewCompanyContext(ctx: RequestContext, agencyClientId?: string) {
    const settings = agencyClientId
      ? await this.findSettings(ctx, agencyClientId)
      : await this.findAgencySettings(ctx);
    if (!settings) throw new NotFoundException('LeadFlow settings not found.');
    return this.companyContextService.previewPersisted(
      settings.companyContextDraft ?? {},
    );
  }

  async validateAgencySettings(
    ctx: RequestContext,
    dto: ValidateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowSettingsValidationResponse> {
    const errors: LeadFlowSettingsValidationIssue[] = [];
    const workspaceId = this.getWorkspaceId(ctx);

    if (!workspaceId) {
      errors.push({
        field: 'workspaceId',
        message: 'Workspace context is required.',
      });
    }

    let template: LeadFlowBusinessModeTemplateEntity | null = null;
    if (!dto.businessModeKey) {
      errors.push({
        field: 'businessModeKey',
        message: 'Business mode is required.',
      });
    } else {
      template = await this.findBusinessModeTemplate(ctx, dto.businessModeKey);
      if (!template) {
        errors.push({
          field: 'businessModeKey',
          message: 'Business mode not found.',
        });
      }
    }

    if (dto.enabledApps !== undefined) {
      errors.push(...this.validateEnabledApps(dto.enabledApps, 'enabledApps'));
    }
    if (dto.enabledIntegrations !== undefined) {
      errors.push(
        ...this.validateEnabledIntegrations(
          dto.enabledIntegrations,
          'enabledIntegrations',
        ),
      );
    }
    if (template && dto.clientPromptConfig !== undefined) {
      errors.push(
        ...this.validateClientPromptConfig(
          template,
          dto.clientPromptConfig,
          'clientPromptConfig',
        ),
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  async validateSettings(
    ctx: RequestContext,
    agencyClientId: string,
    dto: ValidateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowSettingsValidationResponse> {
    const errors: LeadFlowSettingsValidationIssue[] = [];
    const warnings: LeadFlowSettingsValidationIssue[] = [];
    const workspaceId = this.getWorkspaceId(ctx);

    if (!workspaceId) {
      errors.push({
        field: 'workspaceId',
        message: 'Workspace context is required.',
      });
    } else {
      const agencyClient = await this.findAgencyClient(ctx, agencyClientId);
      if (!agencyClient) {
        errors.push({
          field: 'agencyClientId',
          message: 'Agency client not found.',
        });
      }
    }

    let template: LeadFlowBusinessModeTemplateEntity | null = null;
    if (!dto.businessModeKey) {
      errors.push({
        field: 'businessModeKey',
        message: 'Business mode is required.',
      });
    } else {
      template = await this.findBusinessModeTemplate(ctx, dto.businessModeKey);
      if (!template) {
        errors.push({
          field: 'businessModeKey',
          message: 'Business mode not found.',
        });
      }
    }

    if (dto.enabledApps !== undefined) {
      errors.push(...this.validateEnabledApps(dto.enabledApps, 'enabledApps'));
    }
    if (dto.enabledIntegrations !== undefined) {
      errors.push(
        ...this.validateEnabledIntegrations(
          dto.enabledIntegrations,
          'enabledIntegrations',
        ),
      );
    }
    if (template && dto.clientPromptConfig !== undefined) {
      errors.push(
        ...this.validateClientPromptConfig(
          template,
          dto.clientPromptConfig,
          'clientPromptConfig',
        ),
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private async assertAgencyClient(
    ctx: RequestContext,
    agencyClientId: string,
  ): Promise<AgencyClient> {
    const client = await this.findAgencyClient(ctx, agencyClientId);

    if (!client) {
      throw new NotFoundException('Agency client not found.');
    }

    return client;
  }

  private async findAgencyClient(
    ctx: RequestContext,
    agencyClientId: string,
  ): Promise<AgencyClient | null> {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.agencyClientsRepository.findOne({
      where: {
        id: agencyClientId,
        tenantId: ctx.tenantId,
        workspaceId,
        archivedAt: IsNull(),
      },
    });
  }

  private async resolveBusinessModeTemplate(
    ctx: RequestContext,
    businessModeKey: string,
  ): Promise<LeadFlowBusinessModeTemplateEntity> {
    const template = await this.findBusinessModeTemplate(ctx, businessModeKey);

    if (!template) {
      throw new BadRequestException('Business mode not found.');
    }

    return template;
  }

  private async findBusinessModeTemplate(
    ctx: RequestContext,
    businessModeKey: string,
  ): Promise<LeadFlowBusinessModeTemplateEntity | null> {
    try {
      return await this.businessModeTemplateService.getTemplateByKey(
        ctx,
        businessModeKey,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  private findSettings(
    ctx: RequestContext,
    agencyClientId: string,
  ): Promise<LeadFlowClientSettingsEntity | null> {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.settingsRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId,
      },
    });
  }

  private findAgencySettings(
    ctx: RequestContext,
  ): Promise<LeadFlowClientSettingsEntity | null> {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.settingsRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        contextType: LeadFlowSettingsContextType.Agency,
        agencyClientId: IsNull(),
      },
    });
  }

  private findLeadFlowEntitlement(
    entitlementsRepository: Repository<TenantProductEntitlementEntity>,
    tenantId: string,
  ): Promise<TenantProductEntitlementEntity | null> {
    return entitlementsRepository.findOne({
      where: { tenantId, productKey: PlatformProductKey.LeadFlow },
    });
  }

  private resolveCompanyLimit(
    entitlement: TenantProductEntitlementEntity | null,
  ): number | null {
    const raw = entitlement?.settings?.maxManagedClients;

    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
      ? raw
      : null;
  }

  private countActiveCompanies(
    settingsRepository: Repository<LeadFlowClientSettingsEntity>,
    tenantId: string,
    workspaceId: string,
  ): Promise<number> {
    return settingsRepository.count({
      where: {
        tenantId,
        workspaceId,
        contextType: LeadFlowSettingsContextType.Client,
        status: Not(LeadFlowSettingsStatus.Archived),
      },
    });
  }

  /**
   * Blocks creating or reactivating a company once the tenant's LeadFlow
   * entitlement limit is reached. Locks the entitlement row for the
   * duration of the transaction so two concurrent creations cannot both
   * observe a free slot and both succeed (Fase 2 risk: "corrida de duas
   * criações").
   */
  private async assertCapacityAvailable(
    manager: EntityManager,
    tenantId: string,
    workspaceId: string,
  ): Promise<void> {
    const entitlement = await manager
      .getRepository(TenantProductEntitlementEntity)
      .findOne({
        where: { tenantId, productKey: PlatformProductKey.LeadFlow },
        lock: { mode: 'pessimistic_write' },
      });

    const limit = this.resolveCompanyLimit(entitlement);

    if (limit === null) {
      return;
    }

    const activeCompanies = await this.countActiveCompanies(
      manager.getRepository(LeadFlowClientSettingsEntity),
      tenantId,
      workspaceId,
    );

    if (activeCompanies >= limit) {
      throw new ForbiddenException({
        message: 'LeadFlow company capacity limit reached for this tenant.',
        code: 'leadflow_company_capacity_exceeded',
        activeCompanies,
        limit,
        availableSlots: 0,
      });
    }
  }

  private async loadSettingsByClientId(
    tenantId: string,
    workspaceId: string,
    agencyClientIds: string[],
  ): Promise<Map<string, LeadFlowClientSettingsEntity>> {
    if (!agencyClientIds.length) {
      return new Map();
    }

    const settings = await this.settingsRepository.find({
      where: {
        tenantId,
        workspaceId,
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: In(agencyClientIds),
      },
    });

    return new Map(
      settings
        .filter((item) => item.agencyClientId)
        .map((item) => [item.agencyClientId as string, item]),
    );
  }

  private async applySettingsUpdate(
    ctx: RequestContext,
    settings: LeadFlowClientSettingsEntity,
    dto: UpdateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    const contextDraftChanged =
      dto.clientPromptConfig !== undefined ||
      dto.companyContextDraft !== undefined;
    const isReactivatingCompany =
      settings.contextType === LeadFlowSettingsContextType.Client &&
      settings.status === LeadFlowSettingsStatus.Archived &&
      dto.status !== undefined &&
      dto.status !== LeadFlowSettingsStatus.Archived;
    let template: LeadFlowBusinessModeTemplateEntity | null = null;
    if (dto.businessModeKey !== undefined) {
      template = await this.resolveBusinessModeTemplate(
        ctx,
        dto.businessModeKey,
      );
      settings.businessModeKey = template.key;
      settings.businessModeTemplateId = template.id;
    } else if (
      dto.enabledApps !== undefined ||
      dto.enabledIntegrations !== undefined ||
      dto.clientPromptConfig !== undefined
    ) {
      template = await this.resolveBusinessModeTemplate(
        ctx,
        settings.businessModeKey,
      );
    }

    if (template) {
      this.assertValidSettingsPayload(dto, template);
    }

    if (dto.planKey !== undefined) settings.planKey = dto.planKey;
    if (dto.status !== undefined) settings.status = dto.status;
    if (dto.enabledApps !== undefined) settings.enabledApps = dto.enabledApps;
    if (dto.enabledIntegrations !== undefined) {
      settings.enabledIntegrations = dto.enabledIntegrations;
    }
    if (dto.permissionsConfig !== undefined) {
      settings.permissionsConfig = dto.permissionsConfig;
    }
    if (dto.brandingConfig !== undefined)
      settings.brandingConfig = dto.brandingConfig;
    if (dto.agentConfig !== undefined) settings.agentConfig = dto.agentConfig;
    if (dto.clientPromptConfig !== undefined) {
      settings.clientPromptConfig = dto.clientPromptConfig;
      if (dto.companyContextDraft === undefined) {
        settings.companyContextDraft = this.companyContextService.fromLegacy(
          dto.clientPromptConfig,
        );
      }
    }
    if (dto.companyContextDraft !== undefined) {
      settings.companyContextDraft = this.companyContextService.normalize(
        dto.companyContextDraft,
      );
      settings.companyContextSchemaVersion = 1;
    }
    if (dto.inboxConfig !== undefined) settings.inboxConfig = dto.inboxConfig;
    if (dto.inboxOverrides !== undefined)
      settings.inboxOverrides = dto.inboxOverrides;
    if (dto.handoffOverrides !== undefined) {
      settings.handoffOverrides = dto.handoffOverrides;
    }
    if (dto.leadsConfig !== undefined) settings.leadsConfig = dto.leadsConfig;
    if (dto.pipelineRef !== undefined) settings.pipelineRef = dto.pipelineRef;
    if (dto.businessModeOverrides !== undefined) {
      settings.businessModeOverrides = dto.businessModeOverrides;
    }
    if (dto.metadata !== undefined) settings.metadata = dto.metadata;

    settings.updatedById = ctx.userId ?? null;

    if (contextDraftChanged || isReactivatingCompany) {
      return this.dataSource.transaction(async (manager) => {
        if (isReactivatingCompany) {
          await this.assertCapacityAvailable(
            manager,
            settings.tenantId,
            settings.workspaceId,
          );
        }

        const saved = await manager
          .getRepository(LeadFlowClientSettingsEntity)
          .save(settings);

        if (contextDraftChanged) {
          const hash = this.companyContextService.hash(
            saved.companyContextDraft,
          );
          const outbox = manager.getRepository(InboxDomainOutboxEntity);
          await outbox.save(
            outbox.create({
              tenantId: saved.tenantId,
              workspaceId: saved.workspaceId,
              aggregateType: 'leadflow_company_context',
              aggregateId: saved.id,
              eventName: 'leadflow.context.draft_updated',
              eventVersion: 1,
              idempotencyKey: `company-context-draft:${saved.id}:${randomUUID()}`,
              payload: {
                settingsId: saved.id,
                schemaVersion: saved.companyContextSchemaVersion,
                draftHash: hash,
              },
              status: 'pending',
              attempts: 0,
              availableAt: new Date(),
            }),
          );
        }

        return mapLeadFlowClientSettingsResponse(saved);
      });
    }

    return mapLeadFlowClientSettingsResponse(
      await this.settingsRepository.save(settings),
    );
  }

  private buildDefaultEnabledApps(
    template: LeadFlowBusinessModeTemplateEntity,
  ): LeadFlowEnabledAppsConfig {
    const recommendedKeys = new Set(
      template.recommendedApps
        .map((item) => (this.isRecord(item) ? item.key : null))
        .filter((key): key is string => typeof key === 'string'),
    );
    const defaults = this.clone(DEFAULT_LEADFLOW_ENABLED_APPS_SCHEMA);

    for (const [key, config] of Object.entries(defaults)) {
      if (!recommendedKeys.has(key)) {
        defaults[key] = {
          ...config,
          enabled: false,
          limit: 0,
          instances: [],
        };
      }
    }

    for (const key of recommendedKeys) {
      if (!defaults[key]) {
        defaults[key] = {
          enabled: true,
          limit: this.supportsMultipleInstances(key) ? 3 : 1,
          instances: [
            {
              id: 'default',
              label: this.labelForKey(key),
              purpose: 'lead_capture',
              status: 'active',
            },
          ],
        };
      }
    }

    return defaults;
  }

  private buildDefaultEnabledIntegrations(
    template: LeadFlowBusinessModeTemplateEntity,
  ): LeadFlowEnabledIntegrationsConfig {
    const supportedKeys = Object.entries(template.supportedIntegrations)
      .filter(([, value]) => !this.isRecord(value) || value.enabled !== false)
      .map(([key]) => key);
    const defaults: LeadFlowEnabledIntegrationsConfig = {};

    for (const key of supportedKeys) {
      defaults[key] = this.clone(DEFAULT_LEADFLOW_ENABLED_INTEGRATIONS_SCHEMA)[
        key
      ] ?? {
        enabled: true,
        provider: key,
        limit: this.supportsMultipleInstances(key) ? 3 : 1,
        connections: [
          {
            id: 'default',
            label: this.labelForKey(key),
            purpose: 'lead_capture',
            status: 'pending',
          },
        ],
      };
    }

    return defaults;
  }

  private assertDeveloperModeNotRequested(
    dto: UpdateLeadFlowClientSettingsDto,
  ): void {
    if (dto.developerModeEnabled !== undefined) {
      throw new BadRequestException(
        'Developer Mode cannot be changed in this endpoint.',
      );
    }

    if (dto.developerOverrides !== undefined) {
      throw new BadRequestException(
        'Developer overrides cannot be changed in this endpoint.',
      );
    }
  }

  private assertValidSettingsPayload(
    dto:
      | CreateLeadFlowClientSettingsDto
      | UpdateLeadFlowClientSettingsDto
      | ValidateLeadFlowClientSettingsDto,
    template: LeadFlowBusinessModeTemplateEntity,
  ): void {
    const errors: LeadFlowSettingsValidationIssue[] = [];

    if (dto.enabledApps !== undefined) {
      errors.push(...this.validateEnabledApps(dto.enabledApps, 'enabledApps'));
    }
    if (dto.enabledIntegrations !== undefined) {
      errors.push(
        ...this.validateEnabledIntegrations(
          dto.enabledIntegrations,
          'enabledIntegrations',
        ),
      );
    }
    if (dto.clientPromptConfig !== undefined) {
      errors.push(
        ...this.validateClientPromptConfig(
          template,
          dto.clientPromptConfig,
          'clientPromptConfig',
        ),
      );
    }

    if (errors.length) {
      throw new BadRequestException({
        message: 'LeadFlow settings validation failed.',
        errors,
      });
    }
  }

  private validateEnabledApps(
    enabledApps: unknown,
    fieldPrefix: string,
  ): LeadFlowSettingsValidationIssue[] {
    const errors: LeadFlowSettingsValidationIssue[] = [];

    if (!this.isRecord(enabledApps)) {
      return [
        { field: fieldPrefix, message: 'Enabled apps must be an object.' },
      ];
    }

    for (const [key, config] of Object.entries(enabledApps)) {
      const field = `${fieldPrefix}.${key}`;

      if (!this.isRecord(config)) {
        errors.push({ field, message: 'App config must be an object.' });
        continue;
      }

      if (typeof config.enabled !== 'boolean') {
        errors.push({ field: `${field}.enabled`, message: 'Must be boolean.' });
      }
      if (typeof config.limit !== 'number') {
        errors.push({ field: `${field}.limit`, message: 'Must be number.' });
      }
      if (!Array.isArray(config.instances)) {
        errors.push({ field: `${field}.instances`, message: 'Must be array.' });
      }
    }

    return errors;
  }

  private validateEnabledIntegrations(
    enabledIntegrations: unknown,
    fieldPrefix: string,
  ): LeadFlowSettingsValidationIssue[] {
    const errors: LeadFlowSettingsValidationIssue[] = [];

    if (!this.isRecord(enabledIntegrations)) {
      return [
        {
          field: fieldPrefix,
          message: 'Enabled integrations must be an object.',
        },
      ];
    }

    for (const [key, config] of Object.entries(enabledIntegrations)) {
      const field = `${fieldPrefix}.${key}`;

      if (!this.isRecord(config)) {
        errors.push({
          field,
          message: 'Integration config must be an object.',
        });
        continue;
      }

      if (typeof config.enabled !== 'boolean') {
        errors.push({ field: `${field}.enabled`, message: 'Must be boolean.' });
      }
      if (typeof config.provider !== 'string') {
        errors.push({ field: `${field}.provider`, message: 'Must be string.' });
      }
      if (typeof config.limit !== 'number') {
        errors.push({ field: `${field}.limit`, message: 'Must be number.' });
      }
      if (!Array.isArray(config.connections)) {
        errors.push({
          field: `${field}.connections`,
          message: 'Must be array.',
        });
      }
    }

    return errors;
  }

  private validateClientPromptConfig(
    template: LeadFlowBusinessModeTemplateEntity,
    clientPromptConfig: unknown,
    fieldPrefix: string,
  ): LeadFlowSettingsValidationIssue[] {
    if (!this.isRecord(clientPromptConfig)) {
      return [
        {
          field: fieldPrefix,
          message: 'Client prompt config must be an object.',
        },
      ];
    }

    const fields = this.isRecord(template.clientPromptSchema)
      ? template.clientPromptSchema.fields
      : null;

    if (!Array.isArray(fields)) {
      return [];
    }

    return fields.flatMap((field) => {
      if (!this.isRecord(field) || field.required !== true) {
        return [];
      }
      const key = field.key;
      if (typeof key !== 'string') {
        return [];
      }

      const value = clientPromptConfig[key];
      if (value === undefined || value === null || value === '') {
        return [
          {
            field: `${fieldPrefix}.${key}`,
            message: 'Required client prompt field is missing.',
          },
        ];
      }

      return [];
    });
  }

  private parseLimit(raw?: string): number {
    const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;

    if (Number.isNaN(parsed) || parsed < 1) {
      return DEFAULT_LIMIT;
    }

    return Math.min(parsed, MAX_LIMIT);
  }

  private parseOffset(raw?: string): number {
    const parsed = raw ? Number.parseInt(raw, 10) : 0;

    if (Number.isNaN(parsed) || parsed < 0) {
      return 0;
    }

    return parsed;
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    const workspaceId = this.getWorkspaceId(ctx);

    if (!workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return workspaceId;
  }

  private getWorkspaceId(ctx: RequestContext): string | null {
    return ctx.workspaceId ?? null;
  }

  private supportsMultipleInstances(key: string): boolean {
    return ['whatsapp', 'email'].includes(key);
  }

  private labelForKey(key: string): string {
    return key
      .split(/[_-]+/)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  private isRecord(value: unknown): value is LeadFlowJsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
