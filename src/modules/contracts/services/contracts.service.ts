import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Raw, Repository } from 'typeorm';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { chromium } from 'playwright';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { CONTRACT_TEMPLATE_PRESETS } from '../contracts-presets';
import { sanitizeContractHtml } from '../contracts-sanitize';
import { getContractTemplateContentByPresetKey } from '../contracts-template-content';
import {
  AutentiqueApiError,
  AutentiqueClient,
  assertAutentiqueApiBaseUrl,
  type AutentiqueDocument,
} from '../autentique/autentique.client';
import {
  contractStatusesBelow,
  isContractInSignatureFlow,
  parseAutentiqueWebhookEvent,
  partyStatusesBelow,
  planSignatureTransitions,
  snapshotFromDocument,
  verifyAutentiqueWebhookSignature,
  type AutentiqueDocumentSnapshot,
  type PartyTransition,
} from '../autentique/autentique-signature-state';
import {
  deriveSignatureParties,
  validateSigners,
  type SignatureReadinessIssue,
} from '../autentique/contract-signature-parties';
import {
  ContractDocument,
  ContractEvent,
  ContractParty,
  ContractRecord,
  ContractTemplate,
  ContractTemplateVersion,
  ContractSignatureProviderSetting,
} from '../entities';
import {
  ContractDocumentType,
  ContractEventType,
  ContractFooterPreset,
  ContractHeaderPreset,
  ContractPartyRole,
  ContractPartySignatureStatus,
  ContractSignatureMode,
  ContractSignatureProvider,
  ContractStatus,
  ContractTemplateEditorMode,
  ContractTemplateSource,
  ContractTemplateStatus,
} from '../enums';
import {
  CreateContractPartyDto,
  CreateContractFromTemplateDto,
  CreateContractRecordDto,
  CreateContractTemplateDto,
  CreateContractTemplateFromPresetDto,
  CreateContractTemplateVersionDto,
  CreateCustomContractTemplateDto,
  GenerateContractHtmlDto,
  GenerateContractPdfDto,
  ListContractsQueryDto,
  ListContractTemplatesQueryDto,
  MarkContractManuallySignedDto,
  PrepareContractSignatureDto,
  SendContractToSignatureProviderDto,
  PreviewContractTemplateDto,
  UpdateContractPartyDto,
  UpdateSignatureProviderSettingsDto,
  UploadManuallySignedContractDto,
  UpdateContractRecordDto,
  UpdateContractTemplateDto,
} from '../dto';
import {
  NotificationActorType,
  NotificationInterestReason,
} from '../../notifications/enums';
import { ContractNotificationPublisher } from './contract-notification.publisher';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

/** Autentique webhook categories this module listens to (one endpoint each). */
export type AutentiqueWebhookCategory = 'signature' | 'document';

// Tenant scope without an acting user (Autentique webhook).
type ContractScope = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

type SignaturePlan = {
  source: 'parties' | 'derived';
  signers: Array<{
    partyId: string | null;
    role: ContractPartyRole;
    name: string | null;
    email: string | null;
    signatureOrder: number;
    userId: string | null;
    signatureStatus: ContractPartySignatureStatus | null;
  }>;
  issues: SignatureReadinessIssue[];
  warnings: SignatureReadinessIssue[];
};

// Contract statuses from which a digital signature can be sent.
const SIGNATURE_SENDABLE_STATUSES = [
  ContractStatus.Draft,
  ContractStatus.Generated,
  ContractStatus.PendingSignature,
];

// A send claim older than this no longer blocks a new attempt. Long enough for
// someone to check the Autentique panel after an uncertain (timed out) send.
const AUTENTIQUE_SEND_LOCK_STALE_MS = 30 * 60 * 1000;

type LetterheadSettings = {
  headerPreset?: ContractHeaderPreset | null;
  footerPreset?: ContractFooterPreset | null;
  showLogo?: boolean;
  showCompanyData?: boolean;
  showContractNumber?: boolean;
  showPoweredByLyra?: boolean;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(ContractTemplate, AGENCY_CONNECTION)
    private readonly templatesRepository: Repository<ContractTemplate>,
    @InjectRepository(ContractTemplateVersion, AGENCY_CONNECTION)
    private readonly templateVersionsRepository: Repository<ContractTemplateVersion>,

    @InjectRepository(ContractSignatureProviderSetting, AGENCY_CONNECTION)
    private readonly signatureProviderSettingsRepository: Repository<ContractSignatureProviderSetting>,
    @InjectRepository(ContractRecord, AGENCY_CONNECTION)
    private readonly contractsRepository: Repository<ContractRecord>,
    @InjectRepository(ContractParty, AGENCY_CONNECTION)
    private readonly partiesRepository: Repository<ContractParty>,
    @InjectRepository(ContractDocument, AGENCY_CONNECTION)
    private readonly documentsRepository: Repository<ContractDocument>,
    @InjectRepository(ContractEvent, AGENCY_CONNECTION)
    private readonly eventsRepository: Repository<ContractEvent>,
    private readonly contractNotificationPublisher: ContractNotificationPublisher,
  ) {}

  private readonly logger = new Logger(ContractsService.name);

  getTemplatePresets() {
    return CONTRACT_TEMPLATE_PRESETS;
  }

  async createTemplateFromPreset(
    context: RequestContext,
    dto: CreateContractTemplateFromPresetDto,
  ) {
    const preset = CONTRACT_TEMPLATE_PRESETS.find(
      (p) => p.key === dto.presetKey,
    );
    if (!preset) {
      throw new NotFoundException(`Preset '${dto.presetKey}' not found`);
    }

    const content = getContractTemplateContentByPresetKey(dto.presetKey);

    const template = this.templatesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      name: dto.name ?? preset.label,
      description: dto.description ?? preset.description,
      category: preset.category,
      targetType: preset.targetType,
      status: ContractTemplateStatus.Draft,
      defaultSignatureMode:
        dto.defaultSignatureMode ?? preset.defaultSignatureMode,
      headerHtml: content?.headerHtml ?? null,
      bodyHtml: content?.bodyHtml ?? '<p>Texto do contrato aqui.</p>',
      footerHtml: content?.footerHtml ?? null,
      headerPreset: ContractHeaderPreset.Classic,
      footerPreset: ContractFooterPreset.Lyra,
      showLogo: true,
      showCompanyData: true,
      showContractNumber: true,
      showPoweredByLyra: true,
      variablesSchema: {
        groups: preset.variableGroups,
        required: preset.requiredVariables,
        recommended: preset.recommendedVariables,
      },
      locale: 'pt-BR',
      countryCode: 'BR',
      jurisdictionRegion: null,
      templateSource: ContractTemplateSource.Preset,
      editorMode: ContractTemplateEditorMode.Html,
      legalDisclaimer: null,
      metadata: { ...(dto.metadata ?? {}), presetKey: preset.key },
      createdById: context.userId,
      updatedById: context.userId,
    });

    const saved = await this.templatesRepository.save(template);
    await this.createTemplateVersionFromTemplate(
      context,
      saved,
      ContractTemplateStatus.Draft,
    );
    return saved;
  }

  async createCustomTemplate(
    context: RequestContext,
    dto: CreateCustomContractTemplateDto,
  ) {
    const template = this.templatesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      name: dto.name,
      description: dto.description ?? null,
      category: dto.category,
      targetType: dto.targetType,
      status: ContractTemplateStatus.Draft,
      defaultSignatureMode:
        dto.defaultSignatureMode ?? ContractSignatureMode.Manual,
      headerHtml: dto.headerHtml ?? null,
      bodyHtml: dto.bodyHtml,
      footerHtml: dto.footerHtml ?? null,
      headerPreset: dto.headerPreset ?? ContractHeaderPreset.Classic,
      footerPreset: dto.footerPreset ?? ContractFooterPreset.Lyra,
      showLogo: dto.showLogo ?? true,
      showCompanyData: dto.showCompanyData ?? true,
      showContractNumber: dto.showContractNumber ?? true,
      showPoweredByLyra: dto.showPoweredByLyra ?? true,
      variablesSchema: dto.variablesSchema ?? {},
      locale: dto.locale ?? 'pt-BR',
      countryCode: dto.countryCode ?? 'BR',
      jurisdictionRegion: dto.jurisdictionRegion ?? null,
      templateSource: ContractTemplateSource.Custom,
      editorMode: dto.editorMode ?? ContractTemplateEditorMode.Html,
      legalDisclaimer: dto.legalDisclaimer ?? null,
      metadata: dto.metadata ?? {},
      createdById: context.userId,
      updatedById: context.userId,
    });

    const saved = await this.templatesRepository.save(template);
    await this.createTemplateVersionFromTemplate(
      context,
      saved,
      ContractTemplateStatus.Draft,
    );
    return saved;
  }

  previewTemplate(_context: RequestContext, dto: PreviewContractTemplateDto) {
    const variablesData = dto.variablesData ?? {};
    const headerHtml = this.renderTemplateString(
      this.resolveHeaderHtml({
        fallbackHtml: dto.headerHtml ?? '',
        variablesData,
        settings: dto,
      }),
      variablesData,
    );
    const bodyHtml = this.renderTemplateString(
      sanitizeContractHtml(dto.bodyHtml),
      variablesData,
    );
    const footerHtml = this.renderTemplateString(
      this.resolveFooterHtml({
        fallbackHtml: dto.footerHtml ?? '',
        variablesData,
        settings: dto,
      }),
      variablesData,
    );

    return {
      html: this.wrapContractHtml({
        title: dto.title ?? 'Preview do modelo',
        locale: dto.locale ?? 'pt-BR',
        headerHtml,
        bodyHtml,
        footerHtml,
      }),
    };
  }

  async getSignatureProviderSettings(
    context: RequestContext,
    provider: ContractSignatureProvider,
  ) {
    const settings = await this.getOrCreateSignatureProviderSettings(
      context,
      provider,
    );
    return this.serializeSignatureProviderSettings(settings);
  }

  async updateSignatureProviderSettings(
    context: RequestContext,
    provider: ContractSignatureProvider,
    dto: UpdateSignatureProviderSettingsDto,
  ) {
    const settings = await this.getOrCreateSignatureProviderSettings(
      context,
      provider,
    );

    // The account verified by "Testar conexão" belongs to the token: keep it
    // across metadata replacements, drop it when the token changes.
    const verifiedAccount = settings.metadata?.autentiqueAccount;

    if (dto.status !== undefined)
      settings.status = dto.status as 'active' | 'inactive';
    if (dto.apiBaseUrl !== undefined) {
      settings.apiBaseUrl = dto.apiBaseUrl
        ? this.toAutentiqueHttpError(() =>
            assertAutentiqueApiBaseUrl(dto.apiBaseUrl as string),
          )
        : null;
    }
    if (dto.metadata !== undefined) settings.metadata = dto.metadata;
    if (dto.apiToken !== undefined) {
      settings.apiTokenEncrypted = dto.apiToken
        ? this.encryptSecret(dto.apiToken)
        : null;
    }
    settings.metadata = { ...(settings.metadata ?? {}) };
    if (dto.apiToken !== undefined || !verifiedAccount) {
      delete settings.metadata.autentiqueAccount;
    } else {
      settings.metadata.autentiqueAccount = verifiedAccount;
    }
    if (dto.webhookSecret !== undefined) {
      settings.webhookSecretEncrypted = dto.webhookSecret
        ? this.encryptSecret(dto.webhookSecret)
        : null;
    }
    if (dto.documentWebhookSecret !== undefined) {
      settings.documentWebhookSecretEncrypted = dto.documentWebhookSecret
        ? this.encryptSecret(dto.documentWebhookSecret)
        : null;
    }
    if (dto.defaultSignatureMode !== undefined) {
      settings.defaultSignatureMode = dto.defaultSignatureMode;
    }
    if (dto.sandboxEnabled !== undefined)
      settings.sandboxEnabled = dto.sandboxEnabled;
    settings.updatedById = context.userId;

    const saved = await this.signatureProviderSettingsRepository.save(settings);
    return this.serializeSignatureProviderSettings(saved);
  }

  async testSignatureProviderSettings(
    context: RequestContext,
    provider: ContractSignatureProvider,
  ) {
    const settings = await this.getOrCreateSignatureProviderSettings(
      context,
      provider,
    );

    const hasApiBaseUrl = Boolean(settings.apiBaseUrl);
    const hasApiToken = Boolean(settings.apiTokenEncrypted);
    const base = {
      provider,
      status: settings.status,
      checks: {
        hasApiBaseUrl,
        hasApiToken,
        hasWebhookSecret: Boolean(settings.webhookSecretEncrypted),
        hasDocumentWebhookSecret: Boolean(
          settings.documentWebhookSecretEncrypted,
        ),
        sandboxEnabled: settings.sandboxEnabled,
      },
    };

    if (!hasApiToken) {
      return {
        ...base,
        ok: false,
        account: null,
        message: 'Token de API não configurado.',
      };
    }

    // Real round-trip: `me` proves the token. Only the account identity is
    // returned, never the token.
    let account: {
      id: string | null;
      name: string | null;
      email: string | null;
    };
    try {
      account = await this.createAutentiqueClient(settings).me();
    } catch (error) {
      if (!(error instanceof AutentiqueApiError)) throw error;
      return { ...base, ok: false, account: null, message: error.message };
    }

    settings.metadata = {
      ...(settings.metadata ?? {}),
      autentiqueAccount: {
        name: account.name,
        email: account.email,
        verifiedAt: new Date().toISOString(),
      },
    };
    await this.signatureProviderSettingsRepository.save(settings);

    const who = [account.name, account.email ? `(${account.email})` : null]
      .filter(Boolean)
      .join(' ');
    const isActive = settings.status === 'active';

    return {
      ...base,
      ok: isActive,
      account: { name: account.name, email: account.email },
      message: isActive
        ? `Conectado como ${who}.`
        : `Token válido para ${who}, mas o provedor está inativo. Ative para enviar contratos.`,
    };
  }

  listTemplates(context: RequestContext, query: ListContractTemplatesQueryDto) {
    const qb = this.templatesRepository
      .createQueryBuilder('template')
      .where('template.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('template.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      });

    if (query.status) {
      qb.andWhere('template.status = :status', { status: query.status });
    }

    if (query.targetType) {
      qb.andWhere('template.target_type = :targetType', {
        targetType: query.targetType,
      });
    }

    if (query.category) {
      qb.andWhere('template.category = :category', {
        category: query.category,
      });
    }

    if (query.search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('template.name ILIKE :search', {
              search: `%${query.search}%`,
            })
            .orWhere('template.description ILIKE :search', {
              search: `%${query.search}%`,
            });
        }),
      );
    }

    return qb.orderBy('template.updated_at', 'DESC').getMany();
  }

  async createTemplate(
    context: RequestContext,
    dto: CreateContractTemplateDto,
  ) {
    const template = this.templatesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      name: dto.name,
      description: dto.description ?? null,
      category: dto.category,
      targetType: dto.targetType,
      status: ContractTemplateStatus.Draft,
      defaultSignatureMode:
        dto.defaultSignatureMode ?? ContractSignatureMode.Manual,
      headerHtml: dto.headerHtml ?? null,
      bodyHtml: dto.bodyHtml,
      footerHtml: dto.footerHtml ?? null,
      headerPreset: dto.headerPreset ?? ContractHeaderPreset.Classic,
      footerPreset: dto.footerPreset ?? ContractFooterPreset.Lyra,
      showLogo: dto.showLogo ?? true,
      showCompanyData: dto.showCompanyData ?? true,
      showContractNumber: dto.showContractNumber ?? true,
      showPoweredByLyra: dto.showPoweredByLyra ?? true,
      variablesSchema: dto.variablesSchema ?? {},
      locale: dto.locale ?? 'pt-BR',
      countryCode: dto.countryCode ?? 'BR',
      jurisdictionRegion: dto.jurisdictionRegion ?? null,
      templateSource: dto.templateSource ?? ContractTemplateSource.Custom,
      editorMode: dto.editorMode ?? ContractTemplateEditorMode.Html,
      legalDisclaimer: dto.legalDisclaimer ?? null,
      metadata: dto.metadata ?? {},
      createdById: context.userId,
      updatedById: context.userId,
    });

    const saved = await this.templatesRepository.save(template);
    await this.createTemplateVersionFromTemplate(
      context,
      saved,
      ContractTemplateStatus.Draft,
    );

    return saved;
  }

  async findTemplate(context: RequestContext, id: string) {
    const template = await this.templatesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!template) {
      throw new NotFoundException('Contract template not found');
    }

    const versions = await this.templateVersionsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        templateId: template.id,
      },
      order: { version: 'DESC' },
    });

    return { ...template, versions };
  }

  async updateTemplate(
    context: RequestContext,
    id: string,
    dto: UpdateContractTemplateDto,
  ) {
    const template = await this.getTemplateOrFail(context, id);

    Object.assign(template, {
      ...dto,
      updatedById: context.userId,
    });

    return this.templatesRepository.save(template);
  }

  async activateTemplate(context: RequestContext, id: string) {
    const template = await this.getTemplateOrFail(context, id);
    template.status = ContractTemplateStatus.Active;
    template.updatedById = context.userId;

    const saved = await this.templatesRepository.save(template);
    await this.createTemplateVersionFromTemplate(
      context,
      saved,
      ContractTemplateStatus.Active,
    );

    return saved;
  }

  async archiveTemplate(context: RequestContext, id: string) {
    const template = await this.getTemplateOrFail(context, id);
    template.status = ContractTemplateStatus.Archived;
    template.updatedById = context.userId;

    return this.templatesRepository.save(template);
  }

  async deleteTemplate(context: RequestContext, id: string) {
    const template = await this.getTemplateOrFail(context, id);

    await this.templateVersionsRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      templateId: template.id,
    });
    await this.templatesRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      id: template.id,
    });

    return { deleted: true, id: template.id };
  }

  async listTemplateVersions(context: RequestContext, templateId: string) {
    await this.getTemplateOrFail(context, templateId);

    return this.templateVersionsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        templateId,
      },
      order: { version: 'DESC' },
    });
  }

  async createTemplateVersion(
    context: RequestContext,
    templateId: string,
    dto: CreateContractTemplateVersionDto,
  ) {
    const template = await this.getTemplateOrFail(context, templateId);

    const nextVersion = await this.getNextTemplateVersion(context, templateId);

    const version = this.templateVersionsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      templateId,
      version: nextVersion,
      status: ContractTemplateStatus.Draft,
      signatureMode: dto.signatureMode ?? template.defaultSignatureMode,
      headerHtml: dto.headerHtml ?? template.headerHtml,
      bodyHtml: dto.bodyHtml ?? template.bodyHtml,
      footerHtml: dto.footerHtml ?? template.footerHtml,
      headerPreset: dto.headerPreset ?? template.headerPreset,
      footerPreset: dto.footerPreset ?? template.footerPreset,
      showLogo: dto.showLogo ?? template.showLogo,
      showCompanyData: dto.showCompanyData ?? template.showCompanyData,
      showContractNumber: dto.showContractNumber ?? template.showContractNumber,
      showPoweredByLyra: dto.showPoweredByLyra ?? template.showPoweredByLyra,
      variablesSchema: dto.variablesSchema ?? template.variablesSchema ?? {},
      metadata: dto.metadata ?? {},
      createdById: context.userId,
    });

    return this.templateVersionsRepository.save(version);
  }

  listContracts(context: RequestContext, query: ListContractsQueryDto) {
    const qb = this.contractsRepository
      .createQueryBuilder('contract')
      .where('contract.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('contract.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      });

    if (query.includeArchived !== 'true') {
      qb.andWhere('contract.archived_at IS NULL');
    }

    if (query.status) {
      qb.andWhere('contract.status = :status', { status: query.status });
    }

    if (query.targetType) {
      qb.andWhere('contract.target_type = :targetType', {
        targetType: query.targetType,
      });
    }

    if (query.targetId) {
      qb.andWhere('contract.target_id = :targetId', {
        targetId: query.targetId,
      });
    }

    if (query.templateId) {
      qb.andWhere('contract.template_id = :templateId', {
        templateId: query.templateId,
      });
    }

    if (query.signatureMode) {
      qb.andWhere('contract.signature_mode = :signatureMode', {
        signatureMode: query.signatureMode,
      });
    }

    if (query.signatureProvider) {
      qb.andWhere('contract.signature_provider = :signatureProvider', {
        signatureProvider: query.signatureProvider,
      });
    }

    if (query.search) {
      qb.andWhere('contract.title ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    return qb.orderBy('contract.updated_at', 'DESC').getMany();
  }

  async getTemplateSchema(context: RequestContext, templateId: string) {
    const template = await this.getTemplateOrFail(context, templateId);

    const latestVersion = await this.templateVersionsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        templateId,
      },
      order: { version: 'DESC' },
    });

    return {
      templateId: template.id,
      templateVersionId: latestVersion?.id ?? null,
      name: template.name,
      description: template.description,
      category: template.category,
      targetType: template.targetType,
      locale: template.locale,
      countryCode: template.countryCode,
      jurisdictionRegion: template.jurisdictionRegion,
      templateSource: template.templateSource,
      editorMode: template.editorMode,
      legalDisclaimer: template.legalDisclaimer,
      headerPreset: template.headerPreset,
      footerPreset: template.footerPreset,
      showLogo: template.showLogo,
      showCompanyData: template.showCompanyData,
      showContractNumber: template.showContractNumber,
      showPoweredByLyra: template.showPoweredByLyra,
      variablesSchema:
        latestVersion?.variablesSchema ?? template.variablesSchema ?? {},
    };
  }

  async validateTemplateVariables(
    context: RequestContext,
    templateId: string,
    variablesData: Record<string, unknown>,
    templateVersionId?: string | null,
  ) {
    const templateParts = await this.resolveTemplatePartsForTemplate(
      context,
      templateId,
      templateVersionId ?? null,
    );

    const missingVariables = this.getMissingRequiredVariables(
      templateParts.variablesSchema,
      variablesData,
    );

    return {
      valid: missingVariables.length === 0,
      missingVariables,
      variablesSchema: templateParts.variablesSchema,
    };
  }

  async createContractFromTemplate(
    context: RequestContext,
    dto: CreateContractFromTemplateDto,
  ) {
    const template = await this.getTemplateOrFail(context, dto.templateId);

    const templateParts = await this.resolveTemplatePartsForTemplate(
      context,
      dto.templateId,
      dto.templateVersionId ?? null,
    );

    const missingVariables = this.getMissingRequiredVariables(
      templateParts.variablesSchema,
      dto.variablesData,
    );

    if (missingVariables.length > 0) {
      throw new BadRequestException({
        message: 'Missing required contract variables',
        missingVariables,
      });
    }

    const contract = this.contractsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      title: dto.title,
      targetType: template.targetType,
      targetId: dto.targetId ?? null,
      templateId: template.id,
      templateVersionId: templateParts.templateVersionId,
      status: ContractStatus.Draft,
      signatureMode: template.defaultSignatureMode,
      signatureProvider: ContractSignatureProvider.None,
      externalDocumentId: null,
      variablesData: dto.variablesData,
      generatedHtml: null,
      validFrom: dto.validFrom ?? null,
      validUntil: dto.validUntil ?? null,
      signedAt: null,
      completedAt: null,
      cancelledAt: null,
      archivedAt: null,
      createdById: context.userId,
      updatedById: context.userId,
      cancelledById: null,
      metadata: {
        ...(dto.metadata ?? {}),
        createdFromTemplate: true,
        templateName: template.name,
      },
    });

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.Created,
      'Contrato criado a partir de template.',
      {
        templateId: template.id,
        templateVersionId: templateParts.templateVersionId,
      },
    );

    if (dto.generateHtml) {
      return this.generateContractHtml(context, saved.id, {
        note: 'HTML gerado automaticamente na criação do contrato.',
      });
    }

    return this.findContract(context, saved.id);
  }

  async createContract(context: RequestContext, dto: CreateContractRecordDto) {
    const contract = this.contractsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      title: dto.title,
      targetType: dto.targetType,
      targetId: dto.targetId ?? null,
      templateId: dto.templateId ?? null,
      templateVersionId: dto.templateVersionId ?? null,
      status: dto.status ?? ContractStatus.Draft,
      signatureMode: dto.signatureMode ?? ContractSignatureMode.Manual,
      signatureProvider:
        dto.signatureProvider ?? ContractSignatureProvider.None,
      externalDocumentId: null,
      variablesData: dto.variablesData ?? {},
      generatedHtml: dto.generatedHtml ?? null,
      validFrom: dto.validFrom ?? null,
      validUntil: dto.validUntil ?? null,
      signedAt: null,
      completedAt: null,
      cancelledAt: null,
      archivedAt: null,
      createdById: context.userId,
      updatedById: context.userId,
      cancelledById: null,
      metadata: dto.metadata ?? {},
    });

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.Created,
      'Contrato criado.',
      {
        status: saved.status,
        signatureMode: saved.signatureMode,
      },
    );

    return saved;
  }

  async findContract(context: RequestContext, id: string) {
    const contract = await this.getContractOrFail(context, id);

    const [parties, documents, events] = await Promise.all([
      this.partiesRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          contractId: contract.id,
        },
        order: { signatureOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.documentsRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          contractId: contract.id,
        },
        order: { createdAt: 'DESC' },
      }),
      this.eventsRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          contractId: contract.id,
        },
        order: { createdAt: 'DESC' },
      }),
    ]);

    return { ...contract, parties, documents, events };
  }

  async updateContract(
    context: RequestContext,
    id: string,
    dto: UpdateContractRecordDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    Object.assign(contract, {
      ...dto,
      updatedById: context.userId,
    });

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.Updated,
      'Contrato atualizado.',
      {
        updatedFields: Object.keys(dto),
      },
    );

    return saved;
  }

  async cancelContract(context: RequestContext, id: string) {
    const contract = await this.getContractOrFail(context, id);

    if (
      [
        ContractStatus.Completed,
        ContractStatus.Cancelled,
        ContractStatus.Archived,
      ].includes(contract.status)
    ) {
      throw new BadRequestException(
        'Contract cannot be cancelled in current status',
      );
    }

    contract.status = ContractStatus.Cancelled;
    contract.cancelledAt = new Date();
    contract.cancelledById = context.userId;
    contract.updatedById = context.userId;

    const saved = await this.contractsRepository.save(contract);

    const event = await this.createEvent(
      context,
      saved.id,
      ContractEventType.Cancelled,
      'Contrato cancelado.',
    );

    await this.contractNotificationPublisher.publishCanceled({
      contract: saved,
      actorUserId: context.userId,
      sourceEventId: event.id,
      occurredAt: event.createdAt,
      recipients: await this.resolveContractNotificationRecipients(
        context,
        saved,
      ),
    });

    return saved;
  }

  async generateContractHtml(
    context: RequestContext,
    id: string,
    dto: GenerateContractHtmlDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    if (
      [
        ContractStatus.Completed,
        ContractStatus.Cancelled,
        ContractStatus.Archived,
      ].includes(contract.status)
    ) {
      throw new BadRequestException(
        'Contract cannot be generated in current status',
      );
    }

    const templateParts = await this.resolveTemplateParts(context, contract);

    const variablesData = this.deepMerge(
      contract.variablesData ?? {},
      dto.variablesData ?? {},
    );

    const missingVariables = this.getMissingRequiredVariables(
      templateParts.variablesSchema,
      variablesData,
    );

    if (missingVariables.length > 0) {
      throw new BadRequestException({
        message: 'Missing required contract variables',
        missingVariables,
      });
    }

    const headerHtml = this.renderTemplateString(
      this.resolveHeaderHtml({
        fallbackHtml: templateParts.headerHtml ?? '',
        variablesData,
        settings: templateParts,
      }),
      variablesData,
    );
    const bodyHtml = this.renderTemplateString(
      sanitizeContractHtml(templateParts.bodyHtml),
      variablesData,
    );
    const footerHtml = this.renderTemplateString(
      this.resolveFooterHtml({
        fallbackHtml: templateParts.footerHtml ?? '',
        variablesData,
        settings: templateParts,
      }),
      variablesData,
    );

    const generatedHtml = this.wrapContractHtml({
      title: contract.title,
      locale: templateParts.locale,
      headerHtml,
      bodyHtml,
      footerHtml,
    });

    contract.generatedHtml = generatedHtml;
    contract.variablesData = variablesData;
    contract.status = ContractStatus.Generated;
    contract.updatedById = context.userId;

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.Generated,
      dto.note ?? 'HTML do contrato gerado a partir do template.',
      {
        templateId: saved.templateId,
        templateVersionId: saved.templateVersionId,
      },
    );

    return this.findContract(context, saved.id);
  }

  async generateContractPdf(
    context: RequestContext,
    id: string,
    dto: GenerateContractPdfDto,
  ) {
    let contract = await this.getContractOrFail(context, id);

    if (!contract.generatedHtml) {
      if (!dto.generateHtmlIfMissing) {
        throw new BadRequestException(
          'Contract HTML must be generated before PDF generation',
        );
      }

      await this.generateContractHtml(context, id, {
        note: 'HTML gerado automaticamente antes da geração do PDF.',
      });

      contract = await this.getContractOrFail(context, id);
    }

    if (!contract.generatedHtml) {
      throw new BadRequestException('Contract HTML generation failed');
    }

    const fileName =
      dto.fileName ??
      `${this.slugifyFileName(contract.title || 'contract')}-${contract.id}.pdf`;

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage({ javaScriptEnabled: false });

      await page.setContent(contract.generatedHtml, {
        waitUntil: 'networkidle',
      });

      const pdfBuffer = await page.pdf({
        format: dto.format ?? 'A4',
        printBackground: dto.printBackground ?? true,
        margin: {
          top: dto.marginTop ?? '16mm',
          right: dto.marginRight ?? '14mm',
          bottom: dto.marginBottom ?? '16mm',
          left: dto.marginLeft ?? '14mm',
        },
      });

      const fileKey = this.buildContractPdfFileKey({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
        fileName,
      });

      const storage = await this.uploadPdfToObjectStorage({
        buffer: pdfBuffer,
        fileKey,
        contentType: 'application/pdf',
      });

      const document = await this.documentsRepository.save(
        this.documentsRepository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          contractId: contract.id,
          type: ContractDocumentType.GeneratedPdf,
          fileName,
          fileKey: storage.fileKey,
          mimeType: 'application/pdf',
          sizeBytes: String(pdfBuffer.length),
          externalUrl: null,
          uploadedById: context.userId,
          metadata: {
            generatedBy: 'playwright',
            generatedAt: new Date().toISOString(),
            format: dto.format ?? 'A4',
            storageBucket: storage.bucket,
            storageProvider: 'minio',
          },
        }),
      );

      await this.createEvent(
        context,
        contract.id,
        ContractEventType.DocumentAdded,
        dto.note ?? 'PDF do contrato gerado e armazenado.',
        {
          documentId: document.id,
          documentType: document.type,
          fileName: document.fileName,
          fileKey: document.fileKey,
          sizeBytes: document.sizeBytes,
          storageBucket: storage.bucket,
        },
      );

      return {
        fileName,
        fileKey: storage.fileKey,
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer.length,
        document,
        pdfBase64: dto.includeBase64 ? pdfBuffer.toString('base64') : undefined,
      };
    } finally {
      await browser.close();
    }
  }

  async prepareContractSignature(
    context: RequestContext,
    id: string,
    dto: PrepareContractSignatureDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    if (
      [
        ContractStatus.Completed,
        ContractStatus.Cancelled,
        ContractStatus.Archived,
      ].includes(contract.status)
    ) {
      throw new BadRequestException(
        'Contract cannot be prepared for signature in current status',
      );
    }

    const latestPdf = await this.documentsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
        type: ContractDocumentType.GeneratedPdf,
      },
      order: { createdAt: 'DESC' },
    });

    if (!latestPdf) {
      throw new BadRequestException(
        'Contract must have a generated PDF before signature preparation',
      );
    }

    const parties = await this.partiesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
      },
      order: { signatureOrder: 'ASC', createdAt: 'ASC' },
    });

    if (parties.length === 0) {
      throw new BadRequestException(
        'Contract must have at least one signing party before signature preparation',
      );
    }

    const missingPartyData = parties
      .filter((party) => !party.name || !party.email)
      .map((party) => ({
        id: party.id,
        name: party.name,
        email: party.email,
      }));

    if (missingPartyData.length > 0) {
      throw new BadRequestException({
        message: 'All signing parties must have name and email',
        missingPartyData,
      });
    }

    contract.status = ContractStatus.PendingSignature;
    contract.signatureMode = dto.signatureMode;
    contract.signatureProvider =
      dto.signatureProvider ??
      (dto.signatureMode === ContractSignatureMode.Digital
        ? ContractSignatureProvider.Autentique
        : ContractSignatureProvider.None);
    contract.updatedById = context.userId;

    const saved = await this.contractsRepository.save(contract);

    const event = await this.createEvent(
      context,
      saved.id,
      ContractEventType.SignaturePrepared,
      dto.note ?? 'Contrato preparado para assinatura.',
      {
        signatureMode: saved.signatureMode,
        signatureProvider: saved.signatureProvider,
        documentId: latestPdf.id,
        fileKey: latestPdf.fileKey,
        parties: parties.map((party) => ({
          id: party.id,
          role: party.role,
          name: party.name,
          email: party.email,
          signatureOrder: party.signatureOrder,
        })),
      },
    );

    const manualSignatureRecipients = parties
      .filter((party) => Boolean(party.userId?.trim()))
      .map((party) => ({
        userId: party.userId,
        interestReason: NotificationInterestReason.RESPONSIBLE_ROLE,
      }));

    if (
      saved.signatureMode === ContractSignatureMode.Manual &&
      manualSignatureRecipients.length > 0
    ) {
      await this.contractNotificationPublisher.publishManualSignaturePending({
        contract: saved,
        actorUserId: context.userId,
        sourceEventId: event.id,
        occurredAt: event.createdAt,
        recipients: manualSignatureRecipients,
      });
    }

    return {
      contract: saved,
      document: latestPdf,
      parties,
      nextAction:
        saved.signatureMode === ContractSignatureMode.Digital
          ? 'send_to_signature_provider'
          : 'collect_manual_signature',
    };
  }

  /**
   * Who will sign and what is still missing before the contract can go to
   * Autentique. Feeds the confirmation dialog; never calls the provider.
   */
  async getSignatureReadiness(context: RequestContext, id: string) {
    const contract = await this.getContractOrFail(context, id);
    const settings = await this.getOrCreateSignatureProviderSettings(
      context,
      ContractSignatureProvider.Autentique,
    );
    const plan = await this.buildSignaturePlan(context, contract, settings);
    const latestPdf = await this.findLatestGeneratedPdf(context, contract.id);

    return {
      contractId: contract.id,
      provider: ContractSignatureProvider.Autentique,
      status: contract.status,
      sandbox: settings.sandboxEnabled,
      providerActive: settings.status === 'active',
      hasApiToken: Boolean(settings.apiTokenEncrypted),
      hasWebhookSecret: Boolean(settings.webhookSecretEncrypted),
      hasDocumentWebhookSecret: Boolean(
        settings.documentWebhookSecretEncrypted,
      ),
      alreadySent: Boolean(contract.externalDocumentId),
      externalDocumentId: contract.externalDocumentId,
      hasPdf: Boolean(latestPdf?.fileKey),
      signersSource: plan.source,
      signers: plan.signers.map((signer) => ({
        partyId: signer.partyId,
        role: signer.role,
        name: signer.name,
        email: signer.email,
        signatureStatus: signer.signatureStatus,
      })),
      issues: plan.issues,
      warnings: plan.warnings,
      canSend: plan.issues.length === 0,
    };
  }

  /**
   * Sends the contract to Autentique for real. Single idempotent flow: makes
   * sure the PDF and the signing parties exist, moves the contract to
   * PendingSignature, creates the Autentique document and records the
   * external ids. `dryRun: true` only validates. A contract that already has an
   * external document is refused with 409.
   */
  async sendContractToSignatureProvider(
    context: RequestContext,
    id: string,
    dto: SendContractToSignatureProviderDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    if (contract.externalDocumentId) {
      throw new ConflictException({
        message: 'Este contrato já foi enviado ao Autentique.',
        externalDocumentId: contract.externalDocumentId,
      });
    }

    const settings = await this.getOrCreateSignatureProviderSettings(
      context,
      ContractSignatureProvider.Autentique,
    );
    const plan = await this.buildSignaturePlan(context, contract, settings);

    if (plan.issues.length > 0) {
      throw new BadRequestException({
        message: plan.issues.map((issue) => issue.message).join(' '),
        issues: plan.issues,
      });
    }

    if (dto.dryRun === true) {
      return {
        dryRun: true,
        readyToSend: true,
        provider: ContractSignatureProvider.Autentique,
        sandbox: settings.sandboxEnabled,
        signers: plan.signers.map(({ role, name, email }) => ({
          role,
          name,
          email,
        })),
      };
    }

    if (!(await this.claimAutentiqueSend(context, contract.id))) {
      throw new ConflictException(
        'Já existe um envio deste contrato em andamento. Se o último envio ficou sem resposta, confira no painel do Autentique antes de tentar de novo.',
      );
    }

    const prepared = await this.prepareAutentiqueSend(
      context,
      contract,
      plan,
    ).catch(async (error: unknown) => {
      await this.releaseAutentiqueSend(context, contract.id);
      throw error;
    });

    let document: AutentiqueDocument;
    try {
      document = await this.createAutentiqueClient(settings).createDocument({
        name: prepared.contract.title,
        pdf: prepared.pdf,
        fileName: prepared.fileName,
        signers: prepared.parties.map((party) => ({
          name: party.name,
          email: (party.email ?? '').trim().toLowerCase(),
        })),
        sandbox: settings.sandboxEnabled,
        message: dto.message ?? null,
      });
    } catch (error) {
      // Without an answer the document may exist on Autentique: keep the claim
      // so nobody resends blindly; on a definite rejection, free it.
      const uncertain =
        !(error instanceof AutentiqueApiError) || error.outcomeUncertain;
      if (uncertain) {
        await this.markAutentiqueSendUncertain(context, contract.id);
      } else {
        await this.releaseAutentiqueSend(context, contract.id);
      }
      this.logger.warn(
        `Autentique send failed for contract ${contract.id} (tenant ${context.tenantId}, uncertain=${uncertain}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw this.mapAutentiqueError(
        error,
        uncertain
          ? 'O Autentique não confirmou o envio. Confira no painel do Autentique se o documento foi criado antes de tentar de novo (novo envio fica bloqueado por 30 minutos).'
          : undefined,
      );
    }

    // Record the external id before anything else, so a later failure can
    // never lead to a second document for the same contract.
    const sentAt = new Date();
    const mode = settings.sandboxEnabled ? 'sandbox' : 'live';
    // Writing the metadata without the claim keys also releases the claim.
    const metadata = { ...(prepared.contract.metadata ?? {}) };
    delete metadata.autentiqueSendLockAt;
    delete metadata.autentiqueSendUncertainAt;

    try {
      await this.contractsRepository.update(
        {
          id: contract.id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
        {
          externalDocumentId: document.id,
          status: ContractStatus.SentForSignature,
          signatureMode: ContractSignatureMode.Digital,
          signatureProvider: ContractSignatureProvider.Autentique,
          updatedById: context.userId,
          metadata: {
            ...metadata,
            signatureProviderMode: mode,
            signatureProviderSentAt: sentAt.toISOString(),
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Autentique document ${document.id} was created for contract ${contract.id} (tenant ${context.tenantId}) but could not be recorded`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException({
        message:
          'O documento foi criado no Autentique, mas não foi possível registrá-lo no Lyra. Não reenvie; informe o suporte com o ID do documento.',
        externalDocumentId: document.id,
      });
    }

    const signatureByEmail = new Map(
      document.signatures
        .filter((signature) => signature.email)
        .map((signature) => [signature.email!.trim().toLowerCase(), signature]),
    );

    const sentSigners: Array<Record<string, unknown>> = [];
    for (const party of prepared.parties) {
      const signature = signatureByEmail.get(
        (party.email ?? '').trim().toLowerCase(),
      );
      const externalSignerId = signature?.public_id ?? null;

      await this.partiesRepository.update(
        {
          id: party.id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          contractId: contract.id,
        },
        {
          signatureStatus: ContractPartySignatureStatus.Sent,
          metadata: {
            ...(party.metadata ?? {}),
            ...(externalSignerId ? { externalSignerId } : {}),
            ...(signature?.link?.short_link
              ? { signingUrl: signature.link.short_link }
              : {}),
            sentAt: sentAt.toISOString(),
          },
        },
      );

      sentSigners.push({
        partyId: party.id,
        role: party.role,
        name: party.name,
        email: party.email,
        externalSignerId,
      });
    }

    const saved = await this.getContractOrFail(context, contract.id);

    const event = await this.createEvent(
      context,
      saved.id,
      ContractEventType.SignatureSent,
      dto.note ??
        (settings.sandboxEnabled
          ? 'Contrato enviado ao Autentique em sandbox (documento de teste, sem validade jurídica).'
          : 'Contrato enviado ao Autentique para assinatura.'),
      {
        provider: ContractSignatureProvider.Autentique,
        mode,
        externalDocumentId: document.id,
        signers: sentSigners,
      },
    );

    await this.contractNotificationPublisher.publishSentForSignature({
      contract: saved,
      actorUserId: context.userId,
      sourceEventId: event.id,
      occurredAt: event.createdAt,
      recipients: await this.resolveContractNotificationRecipients(
        context,
        saved,
      ),
    });

    return {
      dryRun: false,
      sent: true,
      provider: ContractSignatureProvider.Autentique,
      sandbox: settings.sandboxEnabled,
      externalDocumentId: document.id,
      contract: await this.findContract(context, saved.id),
    };
  }

  /**
   * Manual fallback for a missed webhook: reads the document from Autentique
   * and applies the same monotonic transitions the webhook would.
   */
  async syncSignatureStatus(context: RequestContext, id: string) {
    const contract = await this.getContractOrFail(context, id);

    if (
      !contract.externalDocumentId ||
      contract.signatureProvider !== ContractSignatureProvider.Autentique
    ) {
      throw new BadRequestException(
        'Este contrato não foi enviado ao Autentique.',
      );
    }

    const settings = await this.getOrCreateSignatureProviderSettings(
      context,
      ContractSignatureProvider.Autentique,
    );

    let remote: AutentiqueDocument | null;
    try {
      remote = await this.createAutentiqueClient(settings).getDocument(
        contract.externalDocumentId,
      );
    } catch (error) {
      throw this.mapAutentiqueError(error);
    }

    if (!remote) {
      throw new NotFoundException(
        'Documento não encontrado no Autentique (pode ter sido removido ou, em sandbox, expirado).',
      );
    }

    const snapshot = snapshotFromDocument(remote);
    const result = await this.applyAutentiqueSnapshot(
      context,
      contract,
      snapshot,
      { source: 'sync', actorUserId: context.userId },
    );

    let signedPdfError: string | null = null;
    if (result.needsSignedPdf) {
      try {
        await this.storeAutentiqueSignedPdf(
          context,
          contract.id,
          settings,
          snapshot.signedFileUrl,
          context.userId,
        );
      } catch (error) {
        signedPdfError =
          error instanceof Error
            ? error.message
            : 'Falha ao baixar o PDF assinado.';
        this.logger.warn(
          `Signed PDF download failed for contract ${contract.id}: ${signedPdfError}`,
        );
      }
    }

    return {
      changed: result.changed,
      signedPdfError,
      contract: await this.findContract(context, contract.id),
    };
  }

  /**
   * Public Autentique webhook. The settings id resolves the tenant; the body
   * is accepted only with a valid HMAC under that tenant's webhook secret.
   * Status changes are applied synchronously (fast, retried by Autentique on
   * failure); the signed PDF download runs after the response.
   */
  async handleAutentiqueWebhook(
    settingsId: string,
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
    category: AutentiqueWebhookCategory = 'signature',
  ) {
    const settings = await this.signatureProviderSettingsRepository.findOne({
      where: { id: settingsId, provider: ContractSignatureProvider.Autentique },
    });

    // Each category endpoint is verified only with its own secret.
    const encryptedSecret =
      category === 'document'
        ? settings?.documentWebhookSecretEncrypted
        : settings?.webhookSecretEncrypted;
    let secret: string | null = null;
    if (encryptedSecret) {
      try {
        secret = this.decryptSecret(encryptedSecret);
      } catch {
        this.logger.error(
          `Autentique ${category} webhook secret for settings ${settingsId} could not be decrypted`,
        );
      }
    }

    if (
      !settings ||
      !secret ||
      !verifyAutentiqueWebhookSignature(rawBody, signatureHeader, secret)
    ) {
      throw new UnauthorizedException('Invalid Autentique webhook signature.');
    }

    let body: unknown;
    try {
      body = JSON.parse((rawBody as Buffer).toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid Autentique webhook payload.');
    }

    const event = parseAutentiqueWebhookEvent(body);
    if (!event?.snapshot) {
      return { received: true, handled: false, reason: 'ignored_event' };
    }
    if (!event.type.startsWith(`${category}.`)) {
      return { received: true, handled: false, reason: 'category_mismatch' };
    }

    const scope: ContractScope = {
      tenantId: settings.tenantId,
      workspaceId: settings.workspaceId,
      userId: null,
    };

    const contract = await this.contractsRepository.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        signatureProvider: ContractSignatureProvider.Autentique,
        externalDocumentId: event.snapshot.documentId,
      },
    });

    if (!contract) {
      return { received: true, handled: false, reason: 'unknown_document' };
    }

    if (event.eventId) {
      const duplicate = await this.eventsRepository.findOne({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          contractId: contract.id,
          metadata: Raw(
            (alias) => `${alias} ->> 'providerEventId' = :providerEventId`,
            {
              providerEventId: event.eventId,
            },
          ),
        },
      });
      if (duplicate) {
        return { received: true, handled: false, reason: 'duplicate' };
      }
    }

    const result = await this.applyAutentiqueSnapshot(
      scope,
      contract,
      event.snapshot,
      {
        source: 'webhook',
        actorUserId: null,
        providerEventId: event.eventId,
        providerEventType: event.type,
      },
    );

    if (result.needsSignedPdf) {
      const signedFileUrl = event.snapshot.signedFileUrl;
      setImmediate(() => {
        this.storeAutentiqueSignedPdf(
          scope,
          contract.id,
          settings,
          signedFileUrl,
          null,
        ).catch((error: unknown) =>
          this.logger.warn(
            `Signed PDF download failed for contract ${contract.id}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          ),
        );
      });
    }

    return { received: true, handled: true, changed: result.changed };
  }

  private async buildSignaturePlan(
    context: ContractScope,
    contract: ContractRecord,
    settings: ContractSignatureProviderSetting,
  ): Promise<SignaturePlan> {
    const issues: SignatureReadinessIssue[] = [];
    const warnings: SignatureReadinessIssue[] = [];

    if (contract.externalDocumentId) {
      issues.push({
        code: 'already_sent',
        message: 'Este contrato já foi enviado ao Autentique.',
      });
    } else if (!SIGNATURE_SENDABLE_STATUSES.includes(contract.status)) {
      issues.push({
        code: 'invalid_status',
        message: `Contrato no status "${contract.status}" não pode ser enviado para assinatura.`,
      });
    }

    if (settings.status !== 'active') {
      issues.push({
        code: 'provider_inactive',
        message: 'A integração com o Autentique está inativa.',
      });
    }
    if (!settings.apiTokenEncrypted) {
      issues.push({
        code: 'provider_token_missing',
        message: 'Token de API do Autentique não configurado.',
      });
    }
    if (!settings.webhookSecretEncrypted) {
      warnings.push({
        code: 'webhook_secret_missing',
        message:
          'Secret do webhook de assinaturas não configurado: visualizações, assinaturas e recusas só serão atualizadas pelo botão "Atualizar status".',
      });
    }
    if (!settings.documentWebhookSecretEncrypted) {
      warnings.push({
        code: 'document_webhook_secret_missing',
        message:
          'Secret do webhook de documento não configurado: a conclusão e o PDF assinado só chegarão pelo botão "Atualizar status".',
      });
    }
    if (settings.sandboxEnabled) {
      warnings.push({
        code: 'sandbox',
        message: 'Sandbox ativo: documento de teste, sem validade jurídica.',
      });
    }

    const parties = await this.partiesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
      },
      order: { signatureOrder: 'ASC', createdAt: 'ASC' },
    });

    if (parties.length > 0) {
      issues.push(...validateSigners(parties));
      return {
        source: 'parties',
        signers: parties.map((party) => ({
          partyId: party.id,
          role: party.role,
          name: party.name,
          email: party.email?.trim().toLowerCase() ?? null,
          signatureOrder: party.signatureOrder,
          userId: party.userId,
          signatureStatus: party.signatureStatus,
        })),
        issues,
        warnings,
      };
    }

    const variables = contract.variablesData ?? {};
    const derived = deriveSignatureParties({
      targetType: contract.targetType,
      read: (path) => this.getValueByPath(variables, path),
      settingsMetadata: settings.metadata,
    });
    issues.push(...derived.issues);

    return {
      source: 'derived',
      signers: derived.signers.map((signer) => ({
        partyId: null,
        role: signer.role,
        name: signer.name,
        email: signer.email,
        signatureOrder: signer.signatureOrder,
        userId: signer.userId,
        signatureStatus: null,
      })),
      issues,
      warnings,
    };
  }

  // Runs while holding the send claim: PDF, parties, PendingSignature.
  private async prepareAutentiqueSend(
    context: RequestContext,
    contract: ContractRecord,
    plan: SignaturePlan,
  ) {
    let pdfDocument = await this.findLatestGeneratedPdf(context, contract.id);
    if (!pdfDocument?.fileKey) {
      await this.generateContractPdf(context, contract.id, {
        generateHtmlIfMissing: true,
        note: 'PDF gerado automaticamente para envio ao Autentique.',
      } as GenerateContractPdfDto);
      pdfDocument = await this.findLatestGeneratedPdf(context, contract.id);
    }
    if (!pdfDocument?.fileKey) {
      throw new BadRequestException(
        'Não foi possível gerar o PDF do contrato.',
      );
    }
    const file = await this.getContractDocumentFile(
      context,
      contract.id,
      pdfDocument.id,
    );

    if (plan.source === 'derived') {
      for (const signer of plan.signers) {
        const party = await this.partiesRepository.save(
          this.partiesRepository.create({
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            contractId: contract.id,
            role: signer.role,
            contactId: null,
            userId: signer.userId,
            name: (signer.name ?? '').slice(0, 160),
            email: signer.email,
            document: null,
            signatureStatus: ContractPartySignatureStatus.Pending,
            signedAt: null,
            signatureOrder: signer.signatureOrder,
            metadata: { derivedFrom: 'contract_variables' },
          }),
        );
        await this.createEvent(
          context,
          contract.id,
          ContractEventType.PartyAdded,
          'Signatário derivado das variáveis do contrato.',
          { partyId: party.id, role: party.role },
        );
      }
    }

    const parties = await this.partiesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
      },
      order: { signatureOrder: 'ASC', createdAt: 'ASC' },
    });
    const issues = validateSigners(parties);
    if (parties.length === 0 || issues.length > 0) {
      throw new BadRequestException({
        message:
          issues.map((issue) => issue.message).join(' ') ||
          'O contrato não tem signatários.',
        issues,
      });
    }

    // Column-only update: a full save would drop the send claim kept in
    // metadata.
    await this.contractsRepository.update(
      {
        id: contract.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      {
        status: ContractStatus.PendingSignature,
        signatureMode: ContractSignatureMode.Digital,
        signatureProvider: ContractSignatureProvider.Autentique,
        updatedById: context.userId,
      },
    );

    await this.createEvent(
      context,
      contract.id,
      ContractEventType.SignaturePrepared,
      'Contrato preparado para assinatura digital (Autentique).',
      {
        signatureMode: ContractSignatureMode.Digital,
        signatureProvider: ContractSignatureProvider.Autentique,
        documentId: pdfDocument.id,
        parties: parties.map((party) => ({
          id: party.id,
          role: party.role,
          name: party.name,
          email: party.email,
          signatureOrder: party.signatureOrder,
        })),
      },
    );

    return {
      contract: await this.getContractOrFail(context, contract.id),
      pdf: file.buffer,
      fileName:
        pdfDocument.fileName ??
        `${this.slugifyFileName(contract.title || 'contract')}.pdf`,
      parties,
    };
  }

  /**
   * Applies a normalized Autentique snapshot (webhook or sync). Every write is
   * conditional on the current status being lower, so late, duplicated or
   * concurrent deliveries can never move a party or the contract backwards.
   */
  private async applyAutentiqueSnapshot(
    scope: ContractScope,
    contract: ContractRecord,
    snapshot: AutentiqueDocumentSnapshot,
    options: {
      source: 'webhook' | 'sync';
      actorUserId: string | null;
      providerEventId?: string | null;
      providerEventType?: string | null;
    },
  ) {
    if (!isContractInSignatureFlow(contract.status)) {
      return { changed: false, needsSignedPdf: false };
    }

    const where = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      contractId: contract.id,
    };
    const parties = await this.partiesRepository.find({
      where,
      order: { signatureOrder: 'ASC', createdAt: 'ASC' },
    });
    const plan = planSignatureTransitions(contract.status, parties, snapshot);

    const applied: PartyTransition[] = [];
    for (const transition of plan.partyTransitions) {
      const party = parties.find((item) => item.id === transition.partyId);
      if (!party) continue;

      const at = this.parseProviderDate(transition.at);
      const result = await this.partiesRepository.update(
        {
          ...where,
          id: party.id,
          signatureStatus: In(partyStatusesBelow(transition.to)),
        },
        {
          signatureStatus: transition.to,
          ...(transition.to === ContractPartySignatureStatus.Signed
            ? { signedAt: at ?? new Date() }
            : {}),
          metadata: {
            ...(party.metadata ?? {}),
            ...(transition.externalSignerId
              ? { externalSignerId: transition.externalSignerId }
              : {}),
            ...(transition.signingUrl
              ? { signingUrl: transition.signingUrl }
              : {}),
            providerStatus: transition.to,
            ...(transition.at ? { providerStatusAt: transition.at } : {}),
            ...(transition.reason ? { providerReason: transition.reason } : {}),
          },
        },
      );
      if (result.affected) applied.push(transition);
    }

    let contractStatusChanged = false;
    const nextStatus = plan.nextContractStatus;
    if (nextStatus) {
      const signedAt =
        nextStatus === ContractStatus.DigitallySigned
          ? (this.latestProviderDate(snapshot) ?? new Date())
          : undefined;
      const result = await this.contractsRepository.update(
        {
          id: contract.id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          status: In(contractStatusesBelow(nextStatus)),
        },
        { status: nextStatus, ...(signedAt ? { signedAt } : {}) },
      );
      contractStatusChanged = Boolean(result.affected);
    }

    const changed = applied.length > 0 || contractStatusChanged;
    const fresh = changed
      ? ((await this.contractsRepository.findOne({
          where: {
            id: contract.id,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
          },
        })) ?? contract)
      : contract;

    if (changed) {
      const actorScope = { ...scope, userId: options.actorUserId };
      // This event is also the dedupe anchor for webhook deliveries.
      const event = await this.createEvent(
        actorScope,
        contract.id,
        ContractEventType.SignatureStatusUpdated,
        options.source === 'webhook'
          ? 'Status de assinatura atualizado pelo Autentique.'
          : 'Status de assinatura sincronizado com o Autentique.',
        {
          provider: ContractSignatureProvider.Autentique,
          source: options.source,
          providerEventId: options.providerEventId ?? null,
          providerEventType: options.providerEventType ?? null,
          externalDocumentId: snapshot.documentId,
          transitions: applied.map((transition) => ({
            partyId: transition.partyId,
            from: transition.from,
            to: transition.to,
            at: transition.at,
            reason: transition.reason,
          })),
          contractStatus: contractStatusChanged ? nextStatus : null,
        },
      );

      if (
        contractStatusChanged &&
        nextStatus === ContractStatus.DigitallySigned
      ) {
        await this.createEvent(
          actorScope,
          contract.id,
          ContractEventType.DigitallySigned,
          'Todas as partes assinaram no Autentique.',
          { externalDocumentId: snapshot.documentId },
        );
      }

      await this.publishSignatureNotifications(
        scope,
        fresh,
        applied,
        contractStatusChanged ? nextStatus : null,
        event,
        options.actorUserId,
      );
    }

    return {
      changed,
      needsSignedPdf: fresh.status === ContractStatus.DigitallySigned,
    };
  }

  private async publishSignatureNotifications(
    scope: ContractScope,
    contract: ContractRecord,
    transitions: PartyTransition[],
    contractStatus: ContractStatus | null,
    event: ContractEvent,
    actorUserId: string | null,
  ) {
    const common = {
      contract,
      actorType: actorUserId
        ? NotificationActorType.USER
        : NotificationActorType.INTEGRATION,
      actorUserId,
      sourceEventId: event.id,
      occurredAt: event.createdAt,
      recipients: await this.resolveContractNotificationRecipients(
        scope,
        contract,
      ),
    };
    const reached = (status: ContractPartySignatureStatus) =>
      transitions.some((transition) => transition.to === status);

    if (reached(ContractPartySignatureStatus.Viewed)) {
      await this.contractNotificationPublisher.publishViewed(common);
    }
    if (reached(ContractPartySignatureStatus.Refused)) {
      await this.contractNotificationPublisher.publishRejected(common);
    }
    if (reached(ContractPartySignatureStatus.Failed)) {
      await this.contractNotificationPublisher.publishProviderFailed({
        ...common,
        provider: ContractSignatureProvider.Autentique,
        failureCode: 'delivery_failed',
      });
    }
    if (contractStatus === ContractStatus.DigitallySigned) {
      await this.contractNotificationPublisher.publishSigned(common);
    }
  }

  /**
   * Downloads the signed PDF of a DigitallySigned contract, stores it as a
   * SignedPdf document and completes the contract. Safe to call again: an
   * already stored file is reused and completion is conditional.
   */
  private async storeAutentiqueSignedPdf(
    scope: ContractScope,
    contractId: string,
    settings: ContractSignatureProviderSetting,
    signedFileUrl: string | null,
    actorUserId: string | null,
  ) {
    const contract = await this.contractsRepository.findOne({
      where: {
        id: contractId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
    });
    if (
      !contract ||
      contract.status !== ContractStatus.DigitallySigned ||
      !contract.externalDocumentId
    ) {
      return null;
    }

    const externalDocumentId = contract.externalDocumentId;
    const actorScope = { ...scope, userId: actorUserId };

    let document = await this.documentsRepository.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        contractId,
        type: ContractDocumentType.SignedPdf,
        metadata: Raw(
          (alias) => `${alias} ->> 'externalDocumentId' = :externalDocumentId`,
          {
            externalDocumentId,
          },
        ),
      },
    });

    if (!document) {
      const client = this.createAutentiqueClient(settings);
      let url = signedFileUrl;
      if (!url) {
        const remote = await client.getDocument(externalDocumentId);
        url = remote?.files?.signed ?? null;
      }
      if (!url) {
        throw new Error(
          'O Autentique ainda não disponibilizou o PDF assinado.',
        );
      }

      const buffer = await client.downloadFile(url);
      const fileName = `${this.slugifyFileName(contract.title || 'contract')}-assinado.pdf`;
      const storage = await this.uploadPdfToObjectStorage({
        buffer,
        fileKey: this.buildContractPdfFileKey({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          contractId,
          fileName,
        }),
        contentType: 'application/pdf',
      });

      document = await this.documentsRepository.save(
        this.documentsRepository.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          contractId,
          type: ContractDocumentType.SignedPdf,
          fileName,
          fileKey: storage.fileKey,
          mimeType: 'application/pdf',
          sizeBytes: String(buffer.length),
          externalUrl: null,
          uploadedById: actorUserId,
          metadata: {
            source: 'autentique',
            externalDocumentId,
            sandbox: contract.metadata?.signatureProviderMode === 'sandbox',
            downloadedAt: new Date().toISOString(),
            storageBucket: storage.bucket,
            storageProvider: 'minio',
          },
        }),
      );

      await this.createEvent(
        actorScope,
        contractId,
        ContractEventType.DocumentAdded,
        'PDF assinado baixado do Autentique.',
        {
          documentId: document.id,
          documentType: document.type,
          fileName: document.fileName,
          fileKey: document.fileKey,
          sizeBytes: document.sizeBytes,
        },
      );
    }

    const result = await this.contractsRepository.update(
      {
        id: contractId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        status: ContractStatus.DigitallySigned,
      },
      { status: ContractStatus.Completed, completedAt: new Date() },
    );

    if (result.affected) {
      await this.createEvent(
        actorScope,
        contractId,
        ContractEventType.SignatureCompleted,
        'Contrato concluído por assinatura digital (Autentique).',
        {
          signatureMode: ContractSignatureMode.Digital,
          provider: ContractSignatureProvider.Autentique,
          signedDocumentId: document.id,
        },
      );
    }

    return document;
  }

  // Atomic claim in metadata: only one send per contract can be in flight.
  private async claimAutentiqueSend(
    context: ContractScope,
    contractId: string,
  ) {
    const now = new Date();
    const result = await this.contractsRepository
      .createQueryBuilder()
      .update(ContractRecord)
      .set({
        metadata: () =>
          `COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('autentiqueSendLockAt', CAST(:lockAt AS text))`,
      })
      .where(
        'id = :id AND tenant_id = :tenantId AND workspace_id = :workspaceId',
      )
      .andWhere('external_document_id IS NULL')
      .andWhere(
        `(metadata->>'autentiqueSendLockAt' IS NULL OR (metadata->>'autentiqueSendLockAt')::timestamptz < CAST(:staleBefore AS timestamptz))`,
      )
      .setParameters({
        id: contractId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        lockAt: now.toISOString(),
        staleBefore: new Date(
          now.getTime() - AUTENTIQUE_SEND_LOCK_STALE_MS,
        ).toISOString(),
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  private async releaseAutentiqueSend(
    context: ContractScope,
    contractId: string,
  ) {
    await this.contractsRepository
      .createQueryBuilder()
      .update(ContractRecord)
      .set({
        metadata: () =>
          `COALESCE(metadata, '{}'::jsonb) - 'autentiqueSendLockAt' - 'autentiqueSendUncertainAt'`,
      })
      .where(
        'id = :id AND tenant_id = :tenantId AND workspace_id = :workspaceId',
        {
          id: contractId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      )
      .andWhere('external_document_id IS NULL')
      .execute();
  }

  private async markAutentiqueSendUncertain(
    context: ContractScope,
    contractId: string,
  ) {
    await this.contractsRepository
      .createQueryBuilder()
      .update(ContractRecord)
      .set({
        metadata: () =>
          `COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('autentiqueSendUncertainAt', CAST(:at AS text))`,
      })
      .where(
        'id = :id AND tenant_id = :tenantId AND workspace_id = :workspaceId',
        {
          id: contractId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      )
      .setParameter('at', new Date().toISOString())
      .execute();
  }

  private findLatestGeneratedPdf(context: ContractScope, contractId: string) {
    return this.documentsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId,
        type: ContractDocumentType.GeneratedPdf,
      },
      order: { createdAt: 'DESC' },
    });
  }

  // Overridable seam for specs: no spec ever reaches the real API.
  protected createAutentiqueClient(settings: ContractSignatureProviderSetting) {
    return new AutentiqueClient({
      apiBaseUrl: settings.apiBaseUrl,
      apiToken: settings.apiTokenEncrypted
        ? this.decryptSecret(settings.apiTokenEncrypted)
        : '',
    });
  }

  private mapAutentiqueError(error: unknown, uncertainMessage?: string) {
    if (!(error instanceof AutentiqueApiError)) return error;

    switch (error.code) {
      case 'rate_limited':
        return new HttpException(
          {
            message: error.message,
            retryAfterSeconds: error.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'unauthorized':
        return new BadRequestException(
          'O Autentique recusou o token. Revise a integração em Configurações.',
        );
      case 'invalid_config':
        return new BadRequestException(error.message);
      case 'graphql':
        return new BadRequestException(
          `O Autentique recusou a operação: ${error.message}`,
        );
      default:
        return new BadGatewayException(uncertainMessage ?? error.message);
    }
  }

  private toAutentiqueHttpError<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      throw this.mapAutentiqueError(error);
    }
  }

  private parseProviderDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private latestProviderDate(snapshot: AutentiqueDocumentSnapshot) {
    return (
      snapshot.signers
        .filter(
          (signer) => signer.status === ContractPartySignatureStatus.Signed,
        )
        .map((signer) => this.parseProviderDate(signer.at))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    );
  }

  async uploadManuallySignedContract(
    context: RequestContext,
    id: string,
    dto: UploadManuallySignedContractDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    if (
      [
        ContractStatus.Completed,
        ContractStatus.Cancelled,
        ContractStatus.Archived,
      ].includes(contract.status)
    ) {
      throw new BadRequestException(
        'Contract cannot receive a manually signed upload in current status',
      );
    }

    const mimeType = dto.mimeType ?? 'application/pdf';

    if (mimeType !== 'application/pdf') {
      throw new BadRequestException('Only PDF uploads are supported for now');
    }

    const normalizedBase64 = dto.fileBase64.includes(',')
      ? (dto.fileBase64.split(',').pop() ?? '')
      : dto.fileBase64;

    const buffer = Buffer.from(normalizedBase64, 'base64');

    if (!buffer.length) {
      throw new BadRequestException('Invalid fileBase64 payload');
    }

    const pdfHeader = buffer.subarray(0, 4).toString('utf8');

    if (pdfHeader !== '%PDF') {
      throw new BadRequestException('Uploaded file is not a valid PDF');
    }

    const fileName =
      dto.fileName ??
      `${this.slugifyFileName(contract.title || 'contract')}-signed.pdf`;

    const fileKey = this.buildContractPdfFileKey({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      contractId: contract.id,
      fileName: fileName.replace(/\.pdf$/i, '-signed.pdf'),
    });

    const storage = await this.uploadPdfToObjectStorage({
      buffer,
      fileKey,
      contentType: mimeType,
    });

    const document = await this.documentsRepository.save(
      this.documentsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
        type: ContractDocumentType.SignedPdf,
        fileName,
        fileKey: storage.fileKey,
        mimeType,
        sizeBytes: String(buffer.length),
        externalUrl: null,
        uploadedById: context.userId,
        metadata: {
          uploadedAs: 'manually_signed_contract',
          uploadedAt: new Date().toISOString(),
          storageBucket: storage.bucket,
          storageProvider: 'minio',
        },
      }),
    );

    const now = new Date();

    contract.status = ContractStatus.Completed;
    contract.signatureMode = ContractSignatureMode.Manual;
    contract.signatureProvider = ContractSignatureProvider.None;
    contract.signedAt = now;
    contract.completedAt = now;
    contract.updatedById = context.userId;
    contract.metadata = {
      ...(contract.metadata ?? {}),
      manuallySignedPdfDocumentId: document.id,
      manuallySignedPdfUploadedAt: now.toISOString(),
    };

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.ManualSignedPdfUploaded,
      dto.note ?? 'PDF assinado manualmente enviado e contrato concluído.',
      {
        documentId: document.id,
        fileName: document.fileName,
        fileKey: document.fileKey,
        sizeBytes: document.sizeBytes,
      },
    );

    const signatureEvent = await this.createEvent(
      context,
      saved.id,
      ContractEventType.SignatureCompleted,
      'Contrato concluído por assinatura manual.',
      {
        signatureMode: ContractSignatureMode.Manual,
        signedDocumentId: document.id,
      },
    );

    await this.contractNotificationPublisher.publishSigned({
      contract: saved,
      actorType: NotificationActorType.USER,
      actorUserId: context.userId,
      sourceEventId: signatureEvent.id,
      occurredAt: signatureEvent.createdAt,
      recipients: await this.resolveContractNotificationRecipients(
        context,
        saved,
      ),
    });

    return {
      contract: saved,
      document,
    };
  }

  // Attaches a PDF to a contract WITHOUT the "manually signed / completed"
  // semantics of `uploadManuallySignedContract`. Used by the manual contract
  // flow on the client page, where the user uploads the contract document they
  // produced outside the system to enable download/e-mail from Lyra.
  async uploadContractAttachment(
    context: RequestContext,
    id: string,
    dto: UploadManuallySignedContractDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    if (
      [ContractStatus.Cancelled, ContractStatus.Archived].includes(
        contract.status,
      )
    ) {
      throw new BadRequestException(
        'Contract cannot receive an attachment in current status',
      );
    }

    const mimeType = dto.mimeType ?? 'application/pdf';

    if (mimeType !== 'application/pdf') {
      throw new BadRequestException('Only PDF uploads are supported for now');
    }

    const normalizedBase64 = dto.fileBase64.includes(',')
      ? (dto.fileBase64.split(',').pop() ?? '')
      : dto.fileBase64;

    const buffer = Buffer.from(normalizedBase64, 'base64');

    if (!buffer.length) {
      throw new BadRequestException('Invalid fileBase64 payload');
    }

    if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
      throw new BadRequestException('Uploaded file is not a valid PDF');
    }

    const fileName =
      dto.fileName ??
      `${this.slugifyFileName(contract.title || 'contract')}.pdf`;

    const fileKey = this.buildContractPdfFileKey({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      contractId: contract.id,
      fileName,
    });

    const storage = await this.uploadPdfToObjectStorage({
      buffer,
      fileKey,
      contentType: mimeType,
    });

    const document = await this.documentsRepository.save(
      this.documentsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
        type: ContractDocumentType.Attachment,
        fileName,
        fileKey: storage.fileKey,
        mimeType,
        sizeBytes: String(buffer.length),
        externalUrl: null,
        uploadedById: context.userId,
        metadata: {
          uploadedAs: 'manual_contract_pdf',
          uploadedAt: new Date().toISOString(),
          storageBucket: storage.bucket,
          storageProvider: 'minio',
        },
      }),
    );

    const existingClientContract =
      ((contract.metadata ?? {}).clientContract as
        | Record<string, unknown>
        | undefined) ?? {};

    contract.metadata = {
      ...(contract.metadata ?? {}),
      clientContract: {
        ...existingClientContract,
        attachedPdf: {
          documentId: document.id,
          fileName: document.fileName,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          uploadedAt: new Date().toISOString(),
        },
      },
    };
    contract.updatedById = context.userId;

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.DocumentAdded,
      dto.note ?? 'PDF do contrato manual anexado.',
      {
        documentId: document.id,
        fileName: document.fileName,
        fileKey: document.fileKey,
        sizeBytes: document.sizeBytes,
      },
    );

    return { ...saved, attachedDocument: document };
  }

  // Returns a stored contract document as base64 so the web client can download
  // it (mirrors the generate-pdf response shape).
  async getContractDocumentBase64(
    context: RequestContext,
    contractId: string,
    documentId: string,
  ) {
    const file = await this.getContractDocumentFile(
      context,
      contractId,
      documentId,
    );

    return {
      status: 'ok',
      filename: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      base64: file.buffer.toString('base64'),
    };
  }

  async markManuallySigned(
    context: RequestContext,
    id: string,
    dto: MarkContractManuallySignedDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    if (
      [
        ContractStatus.Completed,
        ContractStatus.Cancelled,
        ContractStatus.Archived,
      ].includes(contract.status)
    ) {
      throw new BadRequestException(
        'Contract cannot be marked as manually signed in current status',
      );
    }

    const signedAt = dto.signedAt ? new Date(dto.signedAt) : new Date();

    contract.status = ContractStatus.Completed;
    contract.signatureMode = ContractSignatureMode.Manual;
    contract.signatureProvider = ContractSignatureProvider.None;
    contract.signedAt = signedAt;
    contract.completedAt = signedAt;
    contract.updatedById = context.userId;
    contract.metadata = {
      ...(contract.metadata ?? {}),
      manuallySignedWithoutUpload: true,
      manuallySignedAt: signedAt.toISOString(),
      manuallySignedByName: dto.signedByName ?? null,
    };

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.ManuallySigned,
      dto.note ??
        'Contrato marcado como assinado manualmente sem upload de PDF.',
      {
        signatureMode: ContractSignatureMode.Manual,
        signedAt: signedAt.toISOString(),
        signedByName: dto.signedByName ?? null,
        hasSignedPdfUpload: false,
      },
    );

    const signatureEvent = await this.createEvent(
      context,
      saved.id,
      ContractEventType.SignatureCompleted,
      'Contrato concluído por confirmação manual de assinatura.',
      {
        signatureMode: ContractSignatureMode.Manual,
        signedAt: signedAt.toISOString(),
        hasSignedPdfUpload: false,
      },
    );

    await this.contractNotificationPublisher.publishSigned({
      contract: saved,
      actorType: NotificationActorType.USER,
      actorUserId: context.userId,
      sourceEventId: signatureEvent.id,
      occurredAt: signatureEvent.createdAt,
      recipients: await this.resolveContractNotificationRecipients(
        context,
        saved,
      ),
    });

    return this.findContract(context, saved.id);
  }

  async addParty(
    context: RequestContext,
    contractId: string,
    dto: CreateContractPartyDto,
  ) {
    await this.getContractOrFail(context, contractId);

    const party = this.partiesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      contractId,
      role: dto.role,
      contactId: dto.contactId ?? null,
      userId: dto.userId ?? null,
      name: dto.name,
      email: dto.email ?? null,
      document: dto.document ?? null,
      signatureStatus:
        dto.signatureStatus ?? ContractPartySignatureStatus.Pending,
      signedAt: null,
      signatureOrder: dto.signatureOrder ?? 1,
      metadata: dto.metadata ?? {},
    });

    const saved = await this.partiesRepository.save(party);

    await this.createEvent(
      context,
      contractId,
      ContractEventType.PartyAdded,
      'Parte adicionada ao contrato.',
      {
        partyId: saved.id,
        role: saved.role,
      },
    );

    return saved;
  }

  async updateParty(
    context: RequestContext,
    contractId: string,
    partyId: string,
    dto: UpdateContractPartyDto,
  ) {
    await this.getContractOrFail(context, contractId);

    const party = await this.partiesRepository.findOne({
      where: {
        id: partyId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId,
      },
    });

    if (!party) {
      throw new NotFoundException('Contract party not found');
    }

    Object.assign(party, dto);

    if (
      dto.signatureStatus === ContractPartySignatureStatus.Signed &&
      !party.signedAt
    ) {
      party.signedAt = new Date();
    }

    const saved = await this.partiesRepository.save(party);

    await this.createEvent(
      context,
      contractId,
      ContractEventType.PartyUpdated,
      'Parte atualizada no contrato.',
      {
        partyId: saved.id,
        updatedFields: Object.keys(dto),
      },
    );

    return saved;
  }

  async removeParty(
    context: RequestContext,
    contractId: string,
    partyId: string,
  ) {
    await this.getContractOrFail(context, contractId);

    const result = await this.partiesRepository.delete({
      id: partyId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      contractId,
    });

    if (!result.affected) {
      throw new NotFoundException('Contract party not found');
    }

    await this.createEvent(
      context,
      contractId,
      ContractEventType.PartyRemoved,
      'Parte removida do contrato.',
      {
        partyId,
      },
    );

    return { success: true };
  }

  async getContractDocumentFile(
    context: ContractScope,
    contractId: string,
    documentId: string,
  ) {
    await this.getContractOrFail(context, contractId);

    const document = await this.documentsRepository.findOne({
      where: {
        id: documentId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId,
      },
    });

    if (!document) {
      throw new NotFoundException('Contract document not found');
    }

    if (!document.fileKey) {
      throw new BadRequestException('Contract document has no file key');
    }

    const client = this.getObjectStorageClient();
    const bucket = this.getObjectStorageBucket();

    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: document.fileKey,
      }),
    );

    if (!response.Body) {
      throw new NotFoundException('Contract document file not found');
    }

    const buffer = await this.streamToBuffer(
      response.Body as AsyncIterable<Uint8Array>,
    );

    return {
      buffer,
      fileName: document.fileName ?? 'contract-document.pdf',
      mimeType: document.mimeType ?? 'application/octet-stream',
      sizeBytes: buffer.length,
      document,
    };
  }

  async listEvents(context: RequestContext, contractId: string) {
    await this.getContractOrFail(context, contractId);

    return this.eventsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId,
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async resolveTemplatePartsForTemplate(
    context: RequestContext,
    templateId: string,
    templateVersionId?: string | null,
  ): Promise<{
    templateVersionId: string | null;
    headerHtml: string | null;
    bodyHtml: string;
    footerHtml: string | null;
    headerPreset: ContractHeaderPreset | null;
    footerPreset: ContractFooterPreset | null;
    showLogo: boolean;
    showCompanyData: boolean;
    showContractNumber: boolean;
    showPoweredByLyra: boolean;
    variablesSchema: Record<string, unknown>;
    locale: string;
  }> {
    if (templateVersionId) {
      const version = await this.templateVersionsRepository.findOne({
        where: {
          id: templateVersionId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          templateId,
        },
      });

      if (!version) {
        throw new NotFoundException('Contract template version not found');
      }

      return {
        templateVersionId: version.id,
        headerHtml: version.headerHtml,
        bodyHtml: version.bodyHtml,
        footerHtml: version.footerHtml,
        headerPreset: version.headerPreset,
        footerPreset: version.footerPreset,
        showLogo: version.showLogo,
        showCompanyData: version.showCompanyData,
        showContractNumber: version.showContractNumber,
        showPoweredByLyra: version.showPoweredByLyra,
        variablesSchema: version.variablesSchema ?? {},
        locale: version.locale ?? 'pt-BR',
      };
    }

    const latestVersion = await this.templateVersionsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        templateId,
      },
      order: { version: 'DESC' },
    });

    if (latestVersion) {
      return {
        templateVersionId: latestVersion.id,
        headerHtml: latestVersion.headerHtml,
        bodyHtml: latestVersion.bodyHtml,
        footerHtml: latestVersion.footerHtml,
        headerPreset: latestVersion.headerPreset,
        footerPreset: latestVersion.footerPreset,
        showLogo: latestVersion.showLogo,
        showCompanyData: latestVersion.showCompanyData,
        showContractNumber: latestVersion.showContractNumber,
        showPoweredByLyra: latestVersion.showPoweredByLyra,
        variablesSchema: latestVersion.variablesSchema ?? {},
        locale: latestVersion.locale ?? 'pt-BR',
      };
    }

    const template = await this.getTemplateOrFail(context, templateId);

    return {
      templateVersionId: null,
      headerHtml: template.headerHtml,
      bodyHtml: template.bodyHtml,
      footerHtml: template.footerHtml,
      headerPreset: template.headerPreset,
      footerPreset: template.footerPreset,
      showLogo: template.showLogo,
      showCompanyData: template.showCompanyData,
      showContractNumber: template.showContractNumber,
      showPoweredByLyra: template.showPoweredByLyra,
      variablesSchema: template.variablesSchema ?? {},
      locale: template.locale ?? 'pt-BR',
    };
  }

  private async resolveTemplateParts(
    context: RequestContext,
    contract: ContractRecord,
  ): Promise<{
    headerHtml: string | null;
    bodyHtml: string;
    footerHtml: string | null;
    headerPreset: ContractHeaderPreset | null;
    footerPreset: ContractFooterPreset | null;
    showLogo: boolean;
    showCompanyData: boolean;
    showContractNumber: boolean;
    showPoweredByLyra: boolean;
    variablesSchema: Record<string, unknown>;
    locale: string;
  }> {
    if (contract.templateVersionId) {
      const version = await this.templateVersionsRepository.findOne({
        where: {
          id: contract.templateVersionId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      if (!version) {
        throw new NotFoundException('Contract template version not found');
      }

      return {
        headerHtml: version.headerHtml,
        bodyHtml: version.bodyHtml,
        footerHtml: version.footerHtml,
        headerPreset: version.headerPreset,
        footerPreset: version.footerPreset,
        showLogo: version.showLogo,
        showCompanyData: version.showCompanyData,
        showContractNumber: version.showContractNumber,
        showPoweredByLyra: version.showPoweredByLyra,
        variablesSchema: version.variablesSchema ?? {},
        locale: version.locale ?? 'pt-BR',
      };
    }

    if (contract.templateId) {
      const latestVersion = await this.templateVersionsRepository.findOne({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          templateId: contract.templateId,
        },
        order: { version: 'DESC' },
      });

      if (latestVersion) {
        contract.templateVersionId = latestVersion.id;

        return {
          headerHtml: latestVersion.headerHtml,
          bodyHtml: latestVersion.bodyHtml,
          footerHtml: latestVersion.footerHtml,
          headerPreset: latestVersion.headerPreset,
          footerPreset: latestVersion.footerPreset,
          showLogo: latestVersion.showLogo,
          showCompanyData: latestVersion.showCompanyData,
          showContractNumber: latestVersion.showContractNumber,
          showPoweredByLyra: latestVersion.showPoweredByLyra,
          variablesSchema: latestVersion.variablesSchema ?? {},
          locale: latestVersion.locale ?? 'pt-BR',
        };
      }

      const template = await this.getTemplateOrFail(
        context,
        contract.templateId,
      );

      return {
        headerHtml: template.headerHtml,
        bodyHtml: template.bodyHtml,
        footerHtml: template.footerHtml,
        headerPreset: template.headerPreset,
        footerPreset: template.footerPreset,
        showLogo: template.showLogo,
        showCompanyData: template.showCompanyData,
        showContractNumber: template.showContractNumber,
        showPoweredByLyra: template.showPoweredByLyra,
        variablesSchema: template.variablesSchema ?? {},
        locale: template.locale ?? 'pt-BR',
      };
    }

    throw new BadRequestException('Contract has no template linked');
  }

  private renderTemplateString(
    template: string,
    variablesData: Record<string, unknown>,
  ) {
    return template.replace(/{{([\s\S]*?)}}/g, (_, rawToken: string) => {
      const keys = this.getTemplateVariableCandidates(rawToken);
      const value = keys
        .map((key) => this.getValueByPath(variablesData, key))
        .find(
          (candidate) =>
            candidate !== undefined && candidate !== null && candidate !== '',
        );

      if (value === undefined || value === null) {
        return '';
      }

      if (Array.isArray(value)) {
        return this.escapeHtml(value.join(', '));
      }

      if (typeof value === 'object') {
        return this.escapeHtml(JSON.stringify(value));
      }

      return this.escapeHtml(String(value));
    });
  }

  private getTemplateVariableCandidates(rawToken: string) {
    const normalized = rawToken
      // Rich-text editors can auto-link values such as member.email while
      // keeping the anchor inside the {{ ... }} token.
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&sol;|&#47;|&#x2f;/gi, '/');

    return normalized
      .split('/')
      .map((key) => key.trim())
      .filter((key) => /^[a-zA-Z0-9_.-]+$/.test(key));
  }

  private getMissingRequiredVariables(
    variablesSchema: Record<string, unknown>,
    variablesData: Record<string, unknown>,
  ) {
    const required = Array.isArray(variablesSchema.required)
      ? variablesSchema.required
      : [];

    return required
      .filter((key): key is string => typeof key === 'string')
      .filter((key) => {
        const value = this.getValueByPath(variablesData, key);

        return value === undefined || value === null || value === '';
      });
  }

  private getValueByPath(source: Record<string, unknown>, path: string) {
    if (Object.prototype.hasOwnProperty.call(source, path)) {
      const flatValue = source[path];
      if (flatValue !== undefined && flatValue !== null) {
        return flatValue;
      }
    }

    const value = path.split('.').reduce<unknown>((acc, part) => {
      if (acc === undefined || acc === null || typeof acc !== 'object') {
        return undefined;
      }

      return (acc as Record<string, unknown>)[part];
    }, source);

    if (value !== undefined && value !== null) {
      return value;
    }

    const aliasMap: Record<string, string> = {
      'agency.cnpj': 'agency.taxId',
      'agency.taxId': 'agency.cnpj',
      'client.cnpj': 'client.taxId',
      'client.taxId': 'client.cnpj',
      'agency.name': 'agency.legalName',
      'agency.legalName': 'agency.name',
      'agency.representative': 'agency.signerName',
      'agency.signerName': 'agency.representative',
      'company.legalName': 'agency.legalName',
      'company.taxId': 'agency.taxId',
      'contract.signatureDate': 'contract.date',
      'contract.date': 'contract.signatureDate',
      'contract.monthlyValue': 'payment.monthlyAmount',
      'payment.monthlyAmount': 'contract.monthlyValue',
      'contract.hourlyValue': 'payment.hourlyAmount',
      'payment.hourlyAmount': 'contract.hourlyValue',
      'contract.paymentTerms': 'payment.paymentTerms',
      'payment.paymentTerms': 'contract.paymentTerms',
      'contractor.fullName': 'member.displayName',
      'member.displayName': 'contractor.fullName',
      'contract.dueDay': 'contract.invoiceDay',
      'contract.invoiceDay': 'contract.dueDay',
      'client.signatory.name': 'client.signatory',
      'client.signatory': 'client.signatory.name',
    };

    const aliasPath = aliasMap[path];
    if (!aliasPath) {
      return undefined;
    }

    return aliasPath.split('.').reduce<unknown>((acc, part) => {
      if (acc === undefined || acc === null || typeof acc !== 'object') {
        return undefined;
      }

      return (acc as Record<string, unknown>)[part];
    }, source);
  }

  private deepMerge(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
  ): Record<string, unknown> {
    const output: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(override)) {
      const current = output[key];

      if (
        current &&
        value &&
        typeof current === 'object' &&
        typeof value === 'object' &&
        !Array.isArray(current) &&
        !Array.isArray(value)
      ) {
        output[key] = this.deepMerge(
          current as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        output[key] = value;
      }
    }

    return output;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private async getOrCreateSignatureProviderSettings(
    context: RequestContext,
    provider: ContractSignatureProvider,
  ) {
    let settings = await this.signatureProviderSettingsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        provider,
      },
    });

    if (!settings) {
      settings = await this.signatureProviderSettingsRepository.save(
        this.signatureProviderSettingsRepository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          provider,
          status: 'inactive',
          apiBaseUrl:
            provider === ContractSignatureProvider.Autentique
              ? 'https://api.autentique.com.br/v2'
              : null,
          apiTokenEncrypted: null,
          webhookSecretEncrypted: null,
          documentWebhookSecretEncrypted: null,
          defaultSignatureMode: ContractSignatureMode.Digital,
          sandboxEnabled: false,
          metadata: {},
          createdById: context.userId,
          updatedById: context.userId,
        }),
      );
    }

    return settings;
  }

  private serializeSignatureProviderSettings(
    settings: ContractSignatureProviderSetting,
  ) {
    return {
      id: settings.id,
      provider: settings.provider,
      status: settings.status,
      apiBaseUrl: settings.apiBaseUrl,
      hasApiToken: Boolean(settings.apiTokenEncrypted),
      hasWebhookSecret: Boolean(settings.webhookSecretEncrypted),
      hasDocumentWebhookSecret: Boolean(
        settings.documentWebhookSecretEncrypted,
      ),
      defaultSignatureMode: settings.defaultSignatureMode,
      sandboxEnabled: settings.sandboxEnabled,
      // Autentique registers one endpoint per event category, each with its
      // own secret: `webhookUrl` takes `signature.*`, the document URL takes
      // `document.finished`.
      webhookUrl: this.buildAutentiqueWebhookUrl(settings, 'signature'),
      documentWebhookUrl: this.buildAutentiqueWebhookUrl(settings, 'document'),
      account: settings.metadata?.autentiqueAccount ?? null,
      metadata: settings.metadata,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  // URL to paste in the Autentique panel. Null until the public API base is
  // configured (CONTRACTS_WEBHOOK_PUBLIC_BASE_URL, e.g. https://host/api).
  private buildAutentiqueWebhookUrl(
    settings: ContractSignatureProviderSetting,
    category: AutentiqueWebhookCategory,
  ) {
    const base = process.env.CONTRACTS_WEBHOOK_PUBLIC_BASE_URL?.trim().replace(
      /\/+$/,
      '',
    );
    if (!base || settings.provider !== ContractSignatureProvider.Autentique) {
      return null;
    }
    const path = `${base}/agency/contracts/webhooks/autentique/${settings.id}`;
    return category === 'document' ? `${path}/documents` : path;
  }

  private getSecretEncryptionKey() {
    const configured =
      process.env.CONTRACTS_PROVIDER_ENCRYPTION_KEY ??
      process.env.SETTINGS_ENCRYPTION_KEY;

    if (configured === undefined || configured.trim() === '') {
      // Fail closed: production never encrypts provider secrets with a key
      // that is public in the source code.
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException(
          'Contracts provider encryption key is not configured.',
        );
      }
      return createHash('sha256')
        .update('lyra-dev-contracts-provider-encryption-key')
        .digest();
    }

    return createHash('sha256').update(configured).digest();
  }

  private encryptSecret(value: string) {
    const iv = randomBytes(12);
    const key = this.getSecretEncryptionKey();
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  private decryptSecret(value: string) {
    const [version, ivBase64, tagBase64, encryptedBase64] = value.split(':');

    if (version !== 'v1' || !ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new BadRequestException('Invalid encrypted secret format');
    }

    const key = this.getSecretEncryptionKey();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivBase64, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private async streamToBuffer(stream: AsyncIterable<Uint8Array>) {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  private getObjectStorageClient() {
    return new S3Client({
      region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? 'http://localhost:9200',
      forcePathStyle:
        (process.env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
      credentials: {
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? 'lyraadmin',
        secretAccessKey:
          process.env.OBJECT_STORAGE_SECRET_KEY ?? 'lyra_minio_dev_password',
      },
    });
  }

  private getObjectStorageBucket() {
    return process.env.OBJECT_STORAGE_BUCKET ?? 'lyra-contracts';
  }

  private async ensureObjectStorageBucketExists(
    client: S3Client,
    bucket: string,
  ) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }

  private buildContractPdfFileKey({
    tenantId,
    workspaceId,
    contractId,
    fileName,
  }: {
    tenantId: string;
    workspaceId: string;
    contractId: string;
    fileName: string;
  }) {
    const safeFileName = this.slugifyFileName(fileName.replace(/\.pdf$/i, ''));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    return [
      'contracts',
      tenantId,
      workspaceId,
      contractId,
      `${timestamp}-${safeFileName}.pdf`,
    ].join('/');
  }

  private async uploadPdfToObjectStorage({
    buffer,
    fileKey,
    contentType,
  }: {
    buffer: Buffer;
    fileKey: string;
    contentType: string;
  }) {
    const client = this.getObjectStorageClient();
    const bucket = this.getObjectStorageBucket();

    await this.ensureObjectStorageBucketExists(client, bucket);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fileKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return {
      bucket,
      fileKey,
    };
  }

  private slugifyFileName(value: string) {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

    return normalized || 'contract';
  }

  private normalizeHtmlLang(locale?: string | null) {
    const normalized = (locale ?? 'pt-BR').trim();

    const supportedLocales: Record<string, string> = {
      pt: 'pt-BR',
      'pt-br': 'pt-BR',
      'pt-BR': 'pt-BR',
      en: 'en-US',
      'en-us': 'en-US',
      'en-US': 'en-US',
      es: 'es',
      'es-es': 'es-ES',
      'es-ES': 'es-ES',
      'es-mx': 'es-MX',
      'es-MX': 'es-MX',
    };

    return (
      supportedLocales[normalized] ??
      supportedLocales[normalized.toLowerCase()] ??
      'pt-BR'
    );
  }

  private resolveHeaderHtml({
    fallbackHtml,
    variablesData,
    settings,
  }: {
    fallbackHtml: string;
    variablesData: Record<string, unknown>;
    settings: LetterheadSettings;
  }) {
    if (!settings.headerPreset) {
      return sanitizeContractHtml(fallbackHtml);
    }

    if (settings.headerPreset === ContractHeaderPreset.None) {
      return '';
    }

    return this.renderHeaderPreset({
      preset: settings.headerPreset,
      variablesData,
      settings,
    });
  }

  private resolveFooterHtml({
    fallbackHtml,
    variablesData,
    settings,
  }: {
    fallbackHtml: string;
    variablesData: Record<string, unknown>;
    settings: LetterheadSettings;
  }) {
    if (!settings.footerPreset) {
      return sanitizeContractHtml(fallbackHtml);
    }

    return this.renderFooterPreset({
      preset: settings.footerPreset,
      variablesData,
      settings,
    });
  }

  private renderHeaderPreset({
    preset,
    variablesData,
    settings,
  }: {
    preset: ContractHeaderPreset;
    variablesData: Record<string, unknown>;
    settings: LetterheadSettings;
  }) {
    const agencyName =
      this.resolvePlainVariable(variablesData, 'agency.name') ||
      this.resolvePlainVariable(variablesData, 'agency.legalName') ||
      'Sua agência';
    const taxId = this.resolvePlainVariable(variablesData, 'agency.taxId');
    const address = this.resolvePlainVariable(variablesData, 'agency.address');
    const email = this.resolvePlainVariable(variablesData, 'agency.email');
    const logoUrl =
      this.resolvePlainVariable(variablesData, 'agency.logoUrl') ||
      this.resolvePlainVariable(variablesData, 'company.logoUrl');
    const slogan =
      this.resolvePlainVariable(variablesData, 'agency.slogan') ||
      this.resolvePlainVariable(variablesData, 'company.slogan') ||
      this.resolvePlainVariable(variablesData, 'agency.website') ||
      this.resolvePlainVariable(variablesData, 'company.website') ||
      'Excelência em gestão de contratos';
    const contractNumber = this.resolvePlainVariable(
      variablesData,
      'contract.number',
    );
    const numberHtml =
      settings.showContractNumber !== false && contractNumber
        ? `<span class="contract-letterhead-number">Contrato nº ${contractNumber}</span>`
        : '';
    const companyData = [
      agencyName ? `<strong>${agencyName}</strong>` : '',
      taxId ? `<span>Tax ID/CNPJ: ${taxId}</span>` : '',
      address ? `<span>${address}</span>` : '',
      email ? `<span>${email}</span>` : '',
      numberHtml,
    ]
      .filter(Boolean)
      .join('');
    const logo =
      settings.showLogo !== false
        ? logoUrl
          ? `<div class="contract-letterhead-logo is-image"><img src="${logoUrl}" alt="${agencyName}" /></div>`
          : `<div class="contract-letterhead-logo">${this.escapeHtml(agencyName).slice(0, 2).toUpperCase()}</div>`
        : '';

    if (preset === ContractHeaderPreset.Minimal) {
      return `
        <div class="contract-letterhead contract-letterhead-minimal">
          ${logo}
        </div>
      `;
    }

    if (preset === ContractHeaderPreset.Corporate) {
      return `
        <div class="contract-letterhead contract-letterhead-corporate">
          <div class="contract-letterhead-corporate-body">
            <div class="contract-letterhead-brand contract-letterhead-brand-logo-only">
              ${logo}
            </div>
            <div class="contract-letterhead-slogan">${slogan}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="contract-letterhead contract-letterhead-classic">
        <div class="contract-letterhead-top">
          <div class="contract-letterhead-brand contract-letterhead-brand-logo-only">
            ${logo}
          </div>
          ${settings.showCompanyData !== false ? `<div class="contract-letterhead-data">${companyData}</div>` : ''}
        </div>
      </div>
    `;
  }

  private renderFooterPreset({
    preset,
    variablesData,
    settings,
  }: {
    preset: ContractFooterPreset;
    variablesData: Record<string, unknown>;
    settings: LetterheadSettings;
  }) {
    const agencyName =
      this.resolvePlainVariable(variablesData, 'agency.legalName') ||
      this.resolvePlainVariable(variablesData, 'agency.name') ||
      'Sua agência';
    const taxId = this.resolvePlainVariable(variablesData, 'agency.taxId');
    const email = this.resolvePlainVariable(variablesData, 'agency.email');
    const contractNumber = this.resolvePlainVariable(
      variablesData,
      'contract.number',
    );
    const city = this.resolvePlainVariable(variablesData, 'contract.city');
    const jurisdiction = this.resolvePlainVariable(
      variablesData,
      'contract.jurisdiction',
    );
    const powered =
      settings.showPoweredByLyra !== false
        ? '<span class="contract-letterhead-powered">Documento gerado por Lyra Suite</span>'
        : '';

    if (preset === ContractFooterPreset.None) {
      return powered
        ? `<div class="contract-letterhead-footer contract-letterhead-footer-none">${powered}</div>`
        : '';
    }

    if (preset === ContractFooterPreset.Company) {
      return `
        <div class="contract-letterhead-footer contract-letterhead-footer-company">
          <span>${agencyName}</span>
          ${taxId ? `<span>Tax ID/CNPJ: ${taxId}</span>` : ''}
          ${email ? `<span>${email}</span>` : ''}
          ${powered}
        </div>
      `;
    }

    if (preset === ContractFooterPreset.Legal) {
      return `
        <div class="contract-letterhead-footer contract-letterhead-footer-legal">
          ${contractNumber ? `<span>Contrato nº ${contractNumber}</span>` : ''}
          ${jurisdiction || city ? `<span>Foro: ${jurisdiction || city}</span>` : ''}
          ${powered}
        </div>
      `;
    }

    return `
      <div class="contract-letterhead-footer contract-letterhead-footer-lyra">
        ${powered}
        <span>${agencyName}</span>
      </div>
    `;
  }

  private resolvePlainVariable(
    variablesData: Record<string, unknown>,
    key: string,
  ) {
    const value = this.getValueByPath(variablesData, key);
    if (value === undefined || value === null) {
      return '';
    }
    if (Array.isArray(value)) {
      return this.escapeHtml(value.join(', '));
    }
    if (typeof value === 'object') {
      return this.escapeHtml(JSON.stringify(value));
    }
    return this.escapeHtml(String(value));
  }

  private wrapContractHtml({
    title,
    locale,
    headerHtml,
    bodyHtml,
    footerHtml,
  }: {
    title: string;
    locale?: string;
    headerHtml: string;
    bodyHtml: string;
    footerHtml: string;
  }) {
    const htmlLang = this.normalizeHtmlLang(locale);

    return `<!doctype html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8" />
  <title>${this.escapeHtml(title)}</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 32px;
      color: #111827;
      background: #ffffff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.55;
    }

    .contract-page {
      width: 100%;
      max-width: 794px;
      margin: 0 auto;
    }

    .contract-header {
      margin-bottom: 24px;
      padding-bottom: 12px;
    }

    .contract-body {
      white-space: normal;
    }

    .contract-footer {
      margin-top: 32px;
      padding-top: 16px;
      color: #374151;
    }

    .contract-letterhead {
      color: #0f172a;
    }

    .contract-letterhead-classic {
      position: relative;
      padding: 0 0 18px;
      border-bottom: 1px solid #d8dee9;
    }

    .contract-letterhead-classic::after,
    .contract-letterhead-minimal::after {
      content: "";
      position: absolute;
      left: 0;
      bottom: -1px;
      width: 112px;
      height: 2px;
      border-radius: 999px;
      background: linear-gradient(90deg, #0f172a, #64748b);
    }

    .contract-letterhead-top,
    .contract-letterhead-corporate-body {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
    }

    .contract-letterhead-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #0f172a;
      font-size: 15px;
      letter-spacing: 0.01em;
    }

    .contract-letterhead-logo {
      display: inline-grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border-radius: 12px;
      background: linear-gradient(135deg, #0f172a, #334155);
      color: #ffffff;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      box-shadow: 0 10px 22px rgba(15, 23, 42, 0.16);
    }

    .contract-letterhead-logo.is-image {
      width: auto;
      min-width: 52px;
      max-width: 156px;
      height: 48px;
      padding: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }

    .contract-letterhead-logo img {
      display: block;
      width: auto;
      max-width: 156px;
      height: 48px;
      object-fit: contain;
    }

    .contract-letterhead-data {
      display: grid;
      gap: 4px;
      max-width: 320px;
      color: #475569;
      font-size: 10.5px;
      text-align: right;
    }

    .contract-letterhead-data strong {
      color: #0f172a;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .contract-letterhead-title {
      margin-top: 16px;
    }

    .contract-letterhead-title h1,
    .contract-letterhead-minimal h1,
    .contract-letterhead-corporate h1 {
      margin: 0 0 6px;
      color: #0f172a;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }

    .contract-letterhead-number {
      display: inline-flex;
      width: fit-content;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      padding: 3px 9px;
      background: #f8fafc;
      color: #475569;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .contract-letterhead-minimal {
      position: relative;
      display: flex;
      justify-content: center;
      text-align: center;
      border-bottom: 1px solid #d8dee9;
      padding: 0 0 18px;
    }

    .contract-letterhead-minimal strong {
      display: block;
      margin-bottom: 8px;
      color: #0f172a;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }

    .contract-letterhead-band {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: -32px -32px 20px;
      padding: 18px 32px;
      background:
        linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.96)),
        radial-gradient(circle at top left, rgba(148, 163, 184, 0.24), transparent 42%);
      color: #ffffff;
    }

    .contract-letterhead-band strong {
      font-size: 14px;
      letter-spacing: 0.04em;
    }

    .contract-letterhead-band .contract-letterhead-logo {
      background: rgba(255, 255, 255, 0.18);
      box-shadow: none;
    }

    .contract-letterhead-corporate-body {
      align-items: center;
      padding: 18px 0;
      border-bottom: 1px solid #d8dee9;
    }

    .contract-letterhead-slogan {
      max-width: 340px;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 1.4;
      text-align: right;
      text-transform: uppercase;
    }

    .contract-letterhead-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      border-top: 1px solid #d8dee9;
      padding-top: 14px;
      color: #64748b;
      font-size: 10px;
      letter-spacing: 0.02em;
    }

    .contract-letterhead-footer-company,
    .contract-letterhead-footer-legal,
    .contract-letterhead-footer-none {
      justify-content: center;
      flex-wrap: wrap;
    }

    .contract-letterhead-footer span {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
    }

    .contract-letterhead-powered {
      border: 1px solid #d8dee9;
      border-radius: 999px;
      padding: 3px 9px;
      background: #f8fafc;
      color: #334155;
      font-weight: 700;
    }

    h1, h2, h3 {
      margin: 0 0 12px;
      line-height: 1.25;
    }

    p {
      margin: 0 0 10px;
    }

    ul, ol {
      margin-top: 0;
      padding-left: 20px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
    }

    th, td {
      border: 1px solid #d1d5db;
      padding: 8px;
      vertical-align: top;
    }

    table.is-borderless,
    table.is-borderless th,
    table.is-borderless td {
      border: none;
    }

    .signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-top: 48px;
    }

    .signature-line {
      border-top: 1px solid #111827;
      padding-top: 8px;
      text-align: center;
    }

    table.team-doc-signature {
      width: 100%;
      margin-top: 64px;
      border: none;
    }

    table.team-doc-signature td {
      border: none;
      padding-top: 40px;
    }
  </style>
</head>
<body>
  <main class="contract-page">
    ${headerHtml ? `<section class="contract-header">${headerHtml}</section>` : ''}
    <section class="contract-body">${bodyHtml}</section>
    ${footerHtml ? `<section class="contract-footer">${footerHtml}</section>` : ''}
  </main>
</body>
</html>`;
  }

  private async getTemplateOrFail(context: RequestContext, id: string) {
    const template = await this.templatesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!template) {
      throw new NotFoundException('Contract template not found');
    }

    return template;
  }

  private async getContractOrFail(context: ContractScope, id: string) {
    const contract = await this.contractsRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!contract || contract.archivedAt) {
      throw new NotFoundException('Contract not found');
    }

    return contract;
  }

  private async getNextTemplateVersion(
    context: RequestContext,
    templateId: string,
  ) {
    const lastVersion = await this.templateVersionsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        templateId,
      },
      order: { version: 'DESC' },
    });

    return (lastVersion?.version ?? 0) + 1;
  }

  private async createTemplateVersionFromTemplate(
    context: RequestContext,
    template: ContractTemplate,
    status: ContractTemplateStatus,
  ) {
    const nextVersion = await this.getNextTemplateVersion(context, template.id);

    const version = this.templateVersionsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      templateId: template.id,
      version: nextVersion,
      status,
      signatureMode: template.defaultSignatureMode,
      headerHtml: template.headerHtml,
      bodyHtml: template.bodyHtml,
      footerHtml: template.footerHtml,
      headerPreset: template.headerPreset,
      footerPreset: template.footerPreset,
      showLogo: template.showLogo,
      showCompanyData: template.showCompanyData,
      showContractNumber: template.showContractNumber,
      showPoweredByLyra: template.showPoweredByLyra,
      variablesSchema: template.variablesSchema ?? {},
      locale: template.locale,
      countryCode: template.countryCode,
      jurisdictionRegion: template.jurisdictionRegion,
      templateSource: template.templateSource,
      editorMode: template.editorMode,
      legalDisclaimer: template.legalDisclaimer,
      metadata: template.metadata ?? {},
      createdById: context.userId,
    });

    return this.templateVersionsRepository.save(version);
  }

  private async createEvent(
    context: ContractScope,
    contractId: string,
    type: ContractEventType,
    message?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    const event = this.eventsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      contractId,
      type,
      actorUserId: context.userId ?? null,
      message: message ?? null,
      metadata: metadata ?? {},
    });

    return this.eventsRepository.save(event);
  }

  private async resolveContractNotificationRecipients(
    context: ContractScope,
    contract: ContractRecord,
  ) {
    const parties = await this.partiesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
      },
      order: { signatureOrder: 'ASC', createdAt: 'ASC' },
    });

    return this.contractRecipientsFrom(contract, parties);
  }

  private contractRecipientsFrom(
    contract: ContractRecord,
    parties: ContractParty[],
  ) {
    return [
      {
        userId: contract.createdById,
        interestReason: NotificationInterestReason.REQUESTER,
      },
      ...parties.map((party) => ({
        userId: party.userId,
        interestReason: NotificationInterestReason.PARTICIPANT,
      })),
    ];
  }
}
