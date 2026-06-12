import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
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
import { getContractTemplateContentByPresetKey } from '../contracts-template-content';
import { sendAutentiqueSignatureRequestMock } from '../autentique-signature-adapter';
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
  MockSignatureProviderCallbackDto,
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

  getTemplatePresets() {
    return CONTRACT_TEMPLATE_PRESETS;
  }

  async createTemplateFromPreset(
    context: RequestContext,
    dto: CreateContractTemplateFromPresetDto,
  ) {
    const preset = CONTRACT_TEMPLATE_PRESETS.find((p) => p.key === dto.presetKey);
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
      defaultSignatureMode: dto.defaultSignatureMode ?? preset.defaultSignatureMode,
      headerHtml: content?.headerHtml ?? null,
      bodyHtml: content?.bodyHtml ?? `<p>Modelo ${preset.label}</p>`,
      footerHtml: content?.footerHtml ?? null,
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
      legalDisclaimer:
        'Este modelo é fornecido como estrutura operacional e deve ser revisado por um profissional jurídico antes do uso.',
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
      defaultSignatureMode: dto.defaultSignatureMode ?? ContractSignatureMode.Manual,
      headerHtml: dto.headerHtml ?? null,
      bodyHtml: dto.bodyHtml,
      footerHtml: dto.footerHtml ?? null,
      variablesSchema: dto.variablesSchema ?? {},
      locale: dto.locale ?? 'pt-BR',
      countryCode: dto.countryCode ?? 'BR',
      jurisdictionRegion: dto.jurisdictionRegion ?? null,
      templateSource: ContractTemplateSource.Custom,
      editorMode: dto.editorMode ?? ContractTemplateEditorMode.Html,
      legalDisclaimer:
        dto.legalDisclaimer ??
        'Este modelo é fornecido como estrutura operacional e deve ser revisado por um profissional jurídico antes do uso.',
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

  previewTemplate(
    _context: RequestContext,
    dto: PreviewContractTemplateDto,
  ) {
    const variablesData = dto.variablesData ?? {};
    const headerHtml = this.renderTemplateString(dto.headerHtml ?? '', variablesData);
    const bodyHtml = this.renderTemplateString(dto.bodyHtml, variablesData);
    const footerHtml = this.renderTemplateString(dto.footerHtml ?? '', variablesData);

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
    const settings = await this.getOrCreateSignatureProviderSettings(context, provider);
    return this.serializeSignatureProviderSettings(settings);
  }

  async updateSignatureProviderSettings(
    context: RequestContext,
    provider: ContractSignatureProvider,
    dto: UpdateSignatureProviderSettingsDto,
  ) {
    const settings = await this.getOrCreateSignatureProviderSettings(context, provider);

    if (dto.status !== undefined) settings.status = dto.status as 'active' | 'inactive';
    if (dto.apiBaseUrl !== undefined) settings.apiBaseUrl = dto.apiBaseUrl ?? null;
    if (dto.apiToken !== undefined) {
      settings.apiTokenEncrypted =
        dto.apiToken ? this.encryptSecret(dto.apiToken) : null;
    }
    if (dto.webhookSecret !== undefined) {
      settings.webhookSecretEncrypted =
        dto.webhookSecret ? this.encryptSecret(dto.webhookSecret) : null;
    }
    if (dto.defaultSignatureMode !== undefined) {
      settings.defaultSignatureMode = dto.defaultSignatureMode;
    }
    if (dto.sandboxEnabled !== undefined) settings.sandboxEnabled = dto.sandboxEnabled;
    if (dto.metadata !== undefined) settings.metadata = dto.metadata;
    settings.updatedById = context.userId;

    const saved = await this.signatureProviderSettingsRepository.save(settings);
    return this.serializeSignatureProviderSettings(saved);
  }

  async testSignatureProviderSettings(
    context: RequestContext,
    provider: ContractSignatureProvider,
  ) {
    const settings = await this.getOrCreateSignatureProviderSettings(context, provider);

    const hasApiBaseUrl = Boolean(settings.apiBaseUrl);
    const hasApiToken = Boolean(settings.apiTokenEncrypted);

    return {
      provider,
      ok: hasApiBaseUrl && hasApiToken && settings.status === 'active',
      status: settings.status,
      checks: {
        hasApiBaseUrl,
        hasApiToken,
        sandboxEnabled: settings.sandboxEnabled,
      },
      message:
        settings.status === 'active' && hasApiBaseUrl && hasApiToken
          ? 'Integração configurada e ativa.'
          : !hasApiBaseUrl
            ? 'URL da API não configurada.'
            : !hasApiToken
              ? 'Token de API não configurado.'
              : 'Provedor inativo. Configure e ative para habilitar.',
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
      variablesSchema: dto.variablesSchema ?? {},
      locale: 'pt-BR',
      countryCode: 'BR',
      jurisdictionRegion: null,
      templateSource: ContractTemplateSource.Custom,
      editorMode: ContractTemplateEditorMode.Html,
      legalDisclaimer:
        'Este modelo é fornecido como estrutura operacional e deve ser revisado por um profissional jurídico antes do uso.',
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
      templateParts.headerHtml ?? '',
      variablesData,
    );
    const bodyHtml = this.renderTemplateString(
      templateParts.bodyHtml,
      variablesData,
    );
    const footerHtml = this.renderTemplateString(
      templateParts.footerHtml ?? '',
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
      const page = await browser.newPage();

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

  async sendContractToSignatureProvider(
    context: RequestContext,
    id: string,
    dto: SendContractToSignatureProviderDto,
  ) {
    const contract = await this.getContractOrFail(context, id);

    if (contract.signatureMode !== ContractSignatureMode.Digital) {
      throw new BadRequestException(
        'Contract signature mode must be digital before sending to provider',
      );
    }

    if (contract.signatureProvider !== ContractSignatureProvider.Autentique) {
      throw new BadRequestException(
        'Only Autentique provider is supported at this stage',
      );
    }

    if (contract.status !== ContractStatus.PendingSignature) {
      throw new BadRequestException(
        'Contract must be pending signature before sending to provider',
      );
    }

    const settings = await this.getOrCreateSignatureProviderSettings(
      context,
      ContractSignatureProvider.Autentique,
    );

    if (settings.status !== 'active') {
      throw new BadRequestException('Autentique provider is not active');
    }

    if (!settings.apiBaseUrl || !settings.apiTokenEncrypted) {
      throw new BadRequestException(
        'Autentique provider settings are incomplete',
      );
    }

    const apiToken = this.decryptSecret(settings.apiTokenEncrypted);

    const latestPdf = await this.documentsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
        type: ContractDocumentType.GeneratedPdf,
      },
      order: { createdAt: 'DESC' },
    });

    if (!latestPdf || !latestPdf.fileKey) {
      throw new BadRequestException(
        'Contract must have a generated PDF stored before sending to provider',
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
        'Contract must have signing parties before sending to provider',
      );
    }

    const invalidParties = parties
      .filter((party) => !party.name || !party.email)
      .map((party) => ({
        id: party.id,
        name: party.name,
        email: party.email,
      }));

    if (invalidParties.length > 0) {
      throw new BadRequestException({
        message: 'All signing parties must have name and email',
        invalidParties,
      });
    }

    const providerPayload = {
      provider: ContractSignatureProvider.Autentique,
      apiBaseUrl: settings.apiBaseUrl,
      contract: {
        id: contract.id,
        title: contract.title,
        targetType: contract.targetType,
        targetId: contract.targetId,
      },
      document: {
        id: latestPdf.id,
        fileName: latestPdf.fileName,
        fileKey: latestPdf.fileKey,
        mimeType: latestPdf.mimeType,
        sizeBytes: latestPdf.sizeBytes,
      },
      signers: parties.map((party) => ({
        id: party.id,
        role: party.role,
        name: party.name,
        email: party.email,
        document: party.document,
        signatureOrder: party.signatureOrder,
      })),
      options: {
        message:
          dto.message ??
          'Você recebeu um contrato para assinatura eletrônica.',
        sandboxEnabled: settings.sandboxEnabled,
      },
    };

    await this.createEvent(
      context,
      contract.id,
      ContractEventType.SignatureSendPrepared,
      dto.note ?? 'Envio para assinatura digital preparado.',
      {
        dryRun: dto.dryRun ?? true,
        provider: ContractSignatureProvider.Autentique,
        documentId: latestPdf.id,
        fileKey: latestPdf.fileKey,
        signersCount: parties.length,
      },
    );

    if (dto.dryRun !== false) {
      return {
        dryRun: true,
        readyToSend: true,
        provider: ContractSignatureProvider.Autentique,
        hasApiToken: Boolean(apiToken),
        payload: providerPayload,
      };
    }

    if (dto.mockProvider !== true) {
      throw new BadRequestException(
        'Real Autentique API call is not implemented yet. Use dryRun: true or mockProvider: true for now.',
      );
    }

    const mockResult = sendAutentiqueSignatureRequestMock(
      providerPayload as Parameters<typeof sendAutentiqueSignatureRequestMock>[0],
    );

    contract.status = ContractStatus.SentForSignature;
    contract.externalDocumentId = mockResult.externalDocumentId;
    contract.updatedById = context.userId;
    contract.metadata = {
      ...(contract.metadata ?? {}),
      signatureProviderMode: 'mock',
      signatureProviderSentAt: new Date().toISOString(),
      signatureProviderSigningUrl: mockResult.signingUrl,
    };

    const saved = await this.contractsRepository.save(contract);

    await this.createEvent(
      context,
      saved.id,
      ContractEventType.SignatureSent,
      dto.note ?? 'Contrato enviado para assinatura digital em modo mock.',
      {
        provider: ContractSignatureProvider.Autentique,
        mode: 'mock',
        externalDocumentId: mockResult.externalDocumentId,
        signingUrl: mockResult.signingUrl,
        signers: mockResult.signers.map((signer) => ({
          id: signer.id,
          name: signer.name,
          email: signer.email,
          externalSignerId: signer.externalSignerId,
          signingUrl: signer.signingUrl,
        })),
      },
    );

    // contract.sent_for_signature represents a real send confirmed by the
    // provider. Mock mode persists local state for development but must not
    // produce that notification — no external send actually happened.

    return {
      dryRun: false,
      mockProvider: true,
      sent: true,
      provider: ContractSignatureProvider.Autentique,
      contract: saved,
      result: mockResult,
    };
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
      ? dto.fileBase64.split(',').pop() ?? ''
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
      dto.note ?? 'Contrato marcado como assinado manualmente sem upload de PDF.',
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
    context: RequestContext,
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
    return template.replace(
      /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g,
      (_, key: string) => {
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
      },
    );
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
    return path.split('.').reduce<unknown>((acc, part) => {
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
      defaultSignatureMode: settings.defaultSignatureMode,
      sandboxEnabled: settings.sandboxEnabled,
      metadata: settings.metadata,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  private getSecretEncryptionKey() {
    const raw =
      process.env.CONTRACTS_PROVIDER_ENCRYPTION_KEY ??
      process.env.SETTINGS_ENCRYPTION_KEY ??
      'lyra-dev-contracts-provider-encryption-key';

    return createHash('sha256').update(raw).digest();
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
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    }

    .contract-body {
      white-space: normal;
    }

    .contract-footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      color: #374151;
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

  private async getContractOrFail(context: RequestContext, id: string) {
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
    context: RequestContext,
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
      actorUserId: context.userId,
      message: message ?? null,
      metadata: metadata ?? {},
    });

    return this.eventsRepository.save(event);
  }

  private async resolveContractNotificationRecipients(
    context: RequestContext,
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
