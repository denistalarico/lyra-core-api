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
  CompanyContextFieldChange,
  CompanyContextPreviewResponse,
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
  readContextDefaults,
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
import {
  getCompanyContextScalarFieldPaths,
} from './company-context.service';
import { LeadFlowBusinessModeTemplateService } from './leadflow-business-mode-template.service';
import { CompanyContextService } from './company-context.service';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../../leadflow-briefing/entities';
import { LeadFlowBriefingSnapshotKind } from '../../leadflow-briefing/enums/leadflow-briefing-snapshot-kind.enum';

const COMPANY_CONTEXT_LIST_FIELD_PATHS = ['offers', 'faq', 'links'];

const AGENCY_CONNECTION = 'agency';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Companies a tenant may keep active when its LeadFlow entitlement does not pin
 * an explicit `maxManagedClients`. Until subscription plans define their own
 * ceilings, every tenant starts here — an unset entitlement means "the starter
 * allowance", never "unlimited", so a missing/misconfigured row can't hand out
 * unbounded capacity.
 */
const DEFAULT_MAX_MANAGED_CLIENTS = 10;

/**
 * Tenants exempt from the company limit, as a comma-separated list of tenant
 * ids in `LEADFLOW_UNLIMITED_COMPANY_TENANTS`. This is how the operating agency
 * keeps unlimited capacity while every other tenant sits on the default until
 * billing owns the number.
 */
function readUnlimitedCompanyTenants(): Set<string> {
  return new Set(
    (process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

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
    const limit = this.resolveCompanyLimit(entitlement, ctx.tenantId);
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
        companyContextDraft: this.buildInitialCompanyContextDraft(dto, template),
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

  /**
   * Erases a company's LeadFlow configuration so the company can be onboarded
   * from scratch. Archiving already frees the capacity slot and is reversible —
   * this is the irreversible step, so it only accepts an already archived
   * context and is gated on the danger-zone permission at the controller.
   *
   * The briefing provenance of this context (sources, versions, extraction
   * jobs, suggestions, applications and published snapshots) is deleted with
   * it: those tables carry `ON DELETE RESTRICT` and only describe this
   * configuration. Data owned by other modules is untouched — agents and
   * automations keep their rows with `settings_id` nulled out by the schema,
   * and Inbox conversations, CRM leads and appointments belong to the agency
   * client, not to this row.
   */
  async deleteSettings(
    ctx: RequestContext,
    agencyClientId: string,
  ): Promise<void> {
    await this.assertAgencyClient(ctx, agencyClientId);

    const settings = await this.findSettings(ctx, agencyClientId);

    if (!settings) {
      throw new NotFoundException(
        'LeadFlow settings not found for this agency client.',
      );
    }

    if (settings.status !== LeadFlowSettingsStatus.Archived) {
      throw new ConflictException({
        message:
          'Archive the company before deleting its LeadFlow configuration.',
        code: 'leadflow_company_not_archived',
        status: settings.status,
      });
    }

    const settingsId = settings.id;

    await this.dataSource.transaction(async (manager) => {
      // Order matters: every step below is referenced by the one above it with
      // ON DELETE RESTRICT, so deleting out of order aborts the transaction.
      await manager
        .getRepository(LeadFlowBriefingSuggestionApplicationEntity)
        .delete({ settingsId });
      await manager
        .getRepository(LeadFlowBriefingSuggestionEntity)
        .delete({ settingsId });
      await manager
        .getRepository(LeadFlowBriefingExtractionJobEntity)
        .delete({ settingsId });
      await manager
        .getRepository(LeadFlowBriefingContextSnapshotEntity)
        .delete({ settingsId });
      // Source versions cascade with their source.
      await manager
        .getRepository(LeadFlowBriefingSourceEntity)
        .delete({ settingsId });

      await manager
        .getRepository(LeadFlowClientSettingsEntity)
        .delete({ id: settingsId });
    });
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
      companyContextDraft: this.buildInitialCompanyContextDraft(dto, template),
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

  async publishCompanyContext(
    ctx: RequestContext,
    agencyClientId?: string,
    expectedDraftHash?: string,
  ) {
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
      const hash = this.companyContextService.hash(published);
      if (expectedDraftHash && expectedDraftHash !== hash) {
        throw new ConflictException(
          'O rascunho mudou desde a pré-visualização. Atualize a pré-visualização antes de publicar.',
        );
      }
      locked.companyContextPublished = published;
      locked.companyContextPublishedVersion =
        (locked.companyContextPublishedVersion || 0) + 1;
      locked.companyContextPublishedHash = hash;
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
      const snapshotRepo = manager.getRepository(
        LeadFlowBriefingContextSnapshotEntity,
      );
      await snapshotRepo.save(
        snapshotRepo.create({
          tenantId: locked.tenantId,
          workspaceId: locked.workspaceId,
          settingsId: locked.id,
          snapshotKind: LeadFlowBriefingSnapshotKind.Published,
          draftValue: published,
          draftHash: hash,
          schemaVersion: 1,
          publishedVersion: locked.companyContextPublishedVersion,
          createdById: ctx.userId ?? null,
        }),
      );
      return mapLeadFlowClientSettingsResponse(locked);
    });
  }

  async previewCompanyContext(
    ctx: RequestContext,
    agencyClientId?: string,
  ): Promise<CompanyContextPreviewResponse> {
    const settings = agencyClientId
      ? await this.findSettings(ctx, agencyClientId)
      : await this.findAgencySettings(ctx);
    if (!settings) throw new NotFoundException('LeadFlow settings not found.');
    const draft = this.companyContextService.normalizePersisted(
      settings.companyContextDraft ?? {},
    );
    const preview = this.companyContextService.previewPersisted(
      settings.companyContextDraft ?? {},
    );
    const changes = await this.tagChangeOrigins(
      settings.tenantId,
      settings.workspaceId,
      settings.id,
      this.computeCompanyContextDiff(
        settings.companyContextPublished ?? {},
        draft,
      ),
    );
    return {
      ...preview,
      changes,
      hasChanges: changes.length > 0,
      currentPublishedVersion: settings.companyContextPublishedVersion,
      currentPublishedHash: settings.companyContextPublishedHash,
    };
  }

  private getAtDottedPath(value: LeadFlowJsonObject, path: string): unknown {
    return path
      .split('.')
      .reduce<unknown>(
        (cursor, key) =>
          cursor && typeof cursor === 'object'
            ? (cursor as Record<string, unknown>)[key]
            : undefined,
        value,
      );
  }

  private computeCompanyContextDiff(
    previous: LeadFlowJsonObject,
    next: LeadFlowJsonObject,
  ): Array<Omit<CompanyContextFieldChange, 'origin'>> {
    const changes: Array<Omit<CompanyContextFieldChange, 'origin'>> = [];
    for (const fieldPath of [
      ...getCompanyContextScalarFieldPaths(),
      ...COMPANY_CONTEXT_LIST_FIELD_PATHS,
    ]) {
      const previousValue = this.getAtDottedPath(previous, fieldPath);
      const nextValue = this.getAtDottedPath(next, fieldPath);
      if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
        changes.push({ fieldPath, previousValue, nextValue });
      }
    }
    return changes;
  }

  private async tagChangeOrigins(
    tenantId: string,
    workspaceId: string,
    settingsId: string,
    changes: Array<Omit<CompanyContextFieldChange, 'origin'>>,
  ): Promise<CompanyContextFieldChange[]> {
    const scalarFieldPaths = new Set(getCompanyContextScalarFieldPaths());
    const scalarChangedPaths = changes
      .map((change) => change.fieldPath)
      .filter((fieldPath) => scalarFieldPaths.has(fieldPath));

    const applicationByFieldPath = new Map<
      string,
      LeadFlowBriefingSuggestionApplicationEntity
    >();
    if (scalarChangedPaths.length > 0) {
      const applications = await this.dataSource
        .getRepository(LeadFlowBriefingSuggestionApplicationEntity)
        .find({
          where: {
            tenantId,
            workspaceId,
            settingsId,
            fieldPath: In(scalarChangedPaths),
          },
          order: { createdAt: 'DESC' },
        });
      for (const application of applications) {
        if (!applicationByFieldPath.has(application.fieldPath)) {
          applicationByFieldPath.set(application.fieldPath, application);
        }
      }
    }

    return changes.map((change) => {
      const application = applicationByFieldPath.get(change.fieldPath);
      if (
        application &&
        JSON.stringify(application.appliedValue) ===
          JSON.stringify(change.nextValue)
      ) {
        return {
          ...change,
          origin: 'suggestion',
          suggestionId: application.suggestionId,
          appliedById: application.appliedById,
          appliedAt: application.createdAt,
        };
      }
      return { ...change, origin: 'manual' };
    });
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

  /**
   * Resolution order, most specific first:
   *   1. a numeric `maxManagedClients` on the entitlement (what a plan writes);
   *   2. `maxManagedClients: 'unlimited'` — the only in-band way to opt out;
   *   3. the tenant allowlist in `LEADFLOW_UNLIMITED_COMPANY_TENANTS`;
   *   4. {@link DEFAULT_MAX_MANAGED_CLIENTS}.
   *
   * `null` means "no limit". Returning it from the fallback branch would make
   * every unconfigured tenant unlimited, so the default is a number.
   */
  private resolveCompanyLimit(
    entitlement: TenantProductEntitlementEntity | null,
    tenantId?: string | null,
  ): number | null {
    const raw = entitlement?.settings?.maxManagedClients;

    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return raw;
    }

    if (raw === 'unlimited') {
      return null;
    }

    const resolvedTenantId = tenantId ?? entitlement?.tenantId ?? null;

    if (resolvedTenantId && readUnlimitedCompanyTenants().has(resolvedTenantId)) {
      return null;
    }

    return DEFAULT_MAX_MANAGED_CLIENTS;
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

    const limit = this.resolveCompanyLimit(entitlement, tenantId);

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

  /**
   * Owner-only switch that reopens every advanced field of the agent context in
   * the UI. The stored flag already travels to the agent and automation runtime
   * snapshots, so flipping it is a real product decision, not a view preference.
   */
  async setDeveloperMode(
    ctx: RequestContext,
    agencyClientId: string | null,
    enabled: boolean,
  ): Promise<LeadFlowClientSettingsResponse> {
    if (agencyClientId) await this.assertAgencyClient(ctx, agencyClientId);

    const settings = agencyClientId
      ? await this.findSettings(ctx, agencyClientId)
      : await this.findAgencySettings(ctx);

    if (!settings) {
      throw new NotFoundException('LeadFlow settings not found.');
    }

    if (settings.developerModeEnabled !== enabled) {
      settings.developerModeEnabled = enabled;
      settings.updatedById = ctx.userId ?? null;
      await this.settingsRepository.save(settings);
    }

    return mapLeadFlowClientSettingsResponse(settings);
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

  /**
   * The draft a brand-new configuration starts from: whatever the caller sent,
   * topped up with the Business Mode's shipped copy for every field still
   * empty. Without this the operator would meet a blank form and have to author
   * SLA, urgency and qualification wording the catalog already knows.
   */
  private buildInitialCompanyContextDraft(
    dto: CreateLeadFlowClientSettingsDto,
    template: LeadFlowBusinessModeTemplateEntity,
  ): LeadFlowJsonObject {
    const draft = dto.companyContextDraft
      ? this.companyContextService.normalize(dto.companyContextDraft)
      : this.companyContextService.fromLegacy(dto.clientPromptConfig ?? {});

    return this.companyContextService.withDefaults(
      draft,
      readContextDefaults(template.metadata),
    );
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
