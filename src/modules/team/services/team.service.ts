import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { FilesService } from '../../../common/files/files.service';
import {
  TeamDepartment,
  TeamMember,
  TeamMemberSkill,
  TeamSkill,
  TeamConfigOption,
  TeamMemberLifecycleStep,
} from '../entities';
import {
  CreateTeamDepartmentDto,
  CreateTeamMemberDto,
  CreateTeamSkillDto,
  ListTeamMembersQueryDto,
  UpdateTeamDepartmentDto,
  UpdateTeamMemberDto,
  UpdateTeamSkillDto,
  CreateTeamConfigOptionDto,
  UpdateTeamConfigOptionDto,
  UpsertTeamMemberSkillDto,
} from '../dto';
import {
  TeamAttendanceSource,
  TeamAttendanceType,
  TeamConfigOptionType,
  TeamMemberStatus,
  TeamPresenceSource,
  TeamPresenceStatus,
  TeamRecordStatus,
  TeamSkillLevel,
} from '../enums';
import { NotificationInterestReason } from '../../notifications/enums';
import { TEAM_DEFAULT_DEPARTMENTS, TEAM_DEFAULT_SKILLS } from './team-defaults';
import { TEAM_PAYMENT_TEMPLATE_PRESETS } from './team-payment-presets';
import {
  LIFECYCLE_STEP_TYPE_DEFAULT_ICON,
  TEAM_LIFECYCLE_STEP_TYPE_PRESETS,
} from './team-lifecycle-step-type-presets';
import { CLIENT_LIFECYCLE_STEP_TYPE_PRESETS } from '../../clients/services/client-lifecycle-step-type-presets';
import { TeamNotificationPublisher } from './team-notification.publisher';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
import { ContractsService } from '../../contracts/services/contracts.service';
import { PreviewContractTemplateDto } from '../../contracts/dto/preview-contract-template.dto';
import { ContractFooterPreset, ContractHeaderPreset } from '../../contracts/enums';
import sanitizeHtml from 'sanitize-html';
import {
  buildFlatSampleTokenMap,
  buildMockPaymentDocumentContext,
} from './team-payment-document-context';

const PAYMENT_CONFIG_OPTION_TYPES = Object.keys(TEAM_PAYMENT_TEMPLATE_PRESETS);

// Tipos de config-option cuja estrutura (nome/ícone/cor/escopo) é protegida quando
// `metadata.isSystemDefault === true` — Team e Clients compartilham essa regra.
const LIFECYCLE_STEP_TYPE_CONFIG_TYPES: string[] = [
  TeamConfigOptionType.LifecycleStepType,
  TeamConfigOptionType.ClientLifecycleStepType,
];

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function hashPinCode(tenantId: string, workspaceId: string, pinCode: string) {
  return createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${pinCode}`)
    .digest('hex');
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function appendSlugSuffix(baseSlug: string, suffix: number) {
  const safeBase = baseSlug || 'item';
  const suffixText = `-${suffix}`;
  return `${safeBase.slice(0, 160 - suffixText.length)}${suffixText}`;
}

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(TeamDepartment, 'agency')
    private readonly departmentRepository: Repository<TeamDepartment>,
    @InjectRepository(TeamSkill, 'agency')
    private readonly skillRepository: Repository<TeamSkill>,
    @InjectRepository(TeamConfigOption, 'agency')
    private readonly configOptionRepository: Repository<TeamConfigOption>,
    @InjectRepository(TeamMember, 'agency')
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(TeamMemberSkill, 'agency')
    private readonly memberSkillRepository: Repository<TeamMemberSkill>,
    @InjectRepository(AgencyUserProfileEntity, 'agency')
    private readonly userProfileRepository: Repository<AgencyUserProfileEntity>,
    @InjectRepository(TeamMemberLifecycleStep, 'agency')
    private readonly lifecycleStepRepository: Repository<TeamMemberLifecycleStep>,
    private readonly filesService: FilesService,
    private readonly teamNotificationPublisher: TeamNotificationPublisher,
    private readonly pdfRendererService: DocumentPdfRendererService,
    private readonly contractsService: ContractsService,
  ) {}

  health() {
    return {
      module: 'team',
      status: 'ok',
    };
  }

  async seedDefaults(ctx: RequestContext) {
    let departmentsCreated = 0;
    let skillsCreated = 0;

    for (const [slug, name, description] of TEAM_DEFAULT_DEPARTMENTS) {
      const existing = await this.departmentRepository.findOne({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, slug },
      });

      if (!existing) {
        await this.departmentRepository.save(
          this.departmentRepository.create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            slug,
            name,
            description,
            isSystemDefault: true,
            status: TeamRecordStatus.Active,
            createdById: ctx.userId || null,
            position: departmentsCreated,
          }),
        );
        departmentsCreated += 1;
      }
    }

    for (const [slug, name, category] of TEAM_DEFAULT_SKILLS) {
      const existing = await this.skillRepository.findOne({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, slug },
      });

      if (!existing) {
        await this.skillRepository.save(
          this.skillRepository.create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            slug,
            name,
            category,
            isSystemDefault: true,
            status: TeamRecordStatus.Active,
            createdById: ctx.userId || null,
            position: skillsCreated,
          }),
        );
        skillsCreated += 1;
      }
    }

    return {
      departmentsCreated,
      skillsCreated,
    };
  }

  listDepartments(ctx: RequestContext) {
    return this.departmentRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { position: 'ASC', name: 'ASC' },
    });
  }

  private async buildUniqueDepartmentSlug(
    ctx: RequestContext,
    name: string,
    ignoreId?: string,
  ) {
    const baseSlug = slugify(name) || 'departamento';
    let candidate = baseSlug;
    let suffix = 2;

    while (true) {
      const existing = await this.departmentRepository.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          slug: candidate,
        },
      });

      if (!existing || existing.id === ignoreId) {
        return candidate;
      }

      candidate = appendSlugSuffix(baseSlug, suffix);
      suffix += 1;
    }
  }

  async createDepartment(ctx: RequestContext, dto: CreateTeamDepartmentDto) {
    const entity = this.departmentRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: dto.name,
      slug: await this.buildUniqueDepartmentSlug(ctx, dto.name),
      description: dto.description ?? null,
      color: dto.color ?? null,
      metadata: dto.metadata ?? {},
      icon: dto.icon ?? null,
      managerMemberId: dto.managerMemberId ?? null,
      parentDepartmentId: dto.parentDepartmentId ?? null,
      status: TeamRecordStatus.Active,
      createdById: ctx.userId || null,
    });

    return this.departmentRepository.save(entity);
  }

  async updateDepartment(
    ctx: RequestContext,
    id: string,
    dto: UpdateTeamDepartmentDto,
  ) {
    const entity = await this.findDepartment(ctx, id);

    if (dto.name !== undefined) {
      entity.name = dto.name;
      entity.slug = await this.buildUniqueDepartmentSlug(ctx, dto.name, id);
    }

    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.color !== undefined) entity.color = dto.color;
    if (dto.icon !== undefined) entity.icon = dto.icon;
    if (dto.managerMemberId !== undefined)
      entity.managerMemberId = dto.managerMemberId;
    if (dto.parentDepartmentId !== undefined)
      entity.parentDepartmentId = dto.parentDepartmentId;
    if (dto.status !== undefined) entity.status = dto.status;

    return this.departmentRepository.save(entity);
  }

  async archiveDepartment(ctx: RequestContext, id: string) {
    const entity = await this.findDepartment(ctx, id);
    entity.status = TeamRecordStatus.Archived;
    return this.departmentRepository.save(entity);
  }

  async deleteDepartment(ctx: RequestContext, id: string) {
    const entity = await this.findDepartment(ctx, id);
    await this.departmentRepository.remove(entity);
    return { deleted: true, id };
  }

  listSkills(ctx: RequestContext) {
    return this.skillRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, status: TeamRecordStatus.Active },
      order: { category: 'ASC', position: 'ASC', name: 'ASC' },
    });
  }

  createSkill(ctx: RequestContext, dto: CreateTeamSkillDto) {
    const entity = this.skillRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: dto.name,
      slug: slugify(`${dto.category}-${dto.name}`),
      category: dto.category,
      description: dto.description ?? null,
      color: dto.color ?? null,
      status: TeamRecordStatus.Active,
      createdById: ctx.userId || null,
    });

    return this.skillRepository.save(entity);
  }

  async updateSkill(ctx: RequestContext, id: string, dto: UpdateTeamSkillDto) {
    const entity = await this.findSkill(ctx, id);

    if (dto.name !== undefined) {
      entity.name = dto.name;
      entity.slug = slugify(dto.name);
    }

    if (dto.category !== undefined) entity.category = dto.category;
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.color !== undefined) entity.color = dto.color;
    if (dto.status !== undefined) entity.status = dto.status;

    return this.skillRepository.save(entity);
  }

  async archiveSkill(ctx: RequestContext, id: string) {
    const entity = await this.findSkill(ctx, id);
    entity.status = TeamRecordStatus.Archived;
    return this.skillRepository.save(entity);
  }

  async listMembers(ctx: RequestContext, query: ListTeamMembersQueryDto) {
    const members = await this.memberRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.workerType ? { workerType: query.workerType } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.search ? { displayName: ILike(`%${query.search}%`) } : {}),
      },
      order: { displayName: 'ASC' },
    });

    return this.withUserProfileAvatars(ctx, members);
  }

  async getMember(ctx: RequestContext, id: string) {
    const member = await this.findMember(ctx, id);
    const [memberWithAvatar] = await this.withUserProfileAvatars(ctx, [member]);
    const skills = await this.memberSkillRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId: id,
      },
      order: { createdAt: 'ASC' },
    });

    return {
      ...memberWithAvatar,
      skills,
    };
  }

  private async withUserProfileAvatars(
    ctx: RequestContext,
    members: TeamMember[],
  ) {
    const userIds = members
      .map((member) => member.userId)
      .filter((userId): userId is string => Boolean(userId));

    if (userIds.length === 0) {
      return members;
    }

    const profiles = await this.userProfileRepository.find({
      where: {
        tenantId: ctx.tenantId,
        userId: In(userIds),
      },
    });

    const profileByUserId = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    );

    return members.map((member) => {
      const profile = member.userId
        ? profileByUserId.get(member.userId)
        : undefined;
      const profileAvatarUrl = profile?.avatarUrl ?? null;
      const memberAvatarUrl = member.avatarUrl ?? null;
      const shouldUseProfileAvatar =
        Boolean(profileAvatarUrl) &&
        (!memberAvatarUrl ||
          memberAvatarUrl.includes('/users/') ||
          memberAvatarUrl.includes(`/users/${member.userId}/`));

      if (!shouldUseProfileAvatar) {
        return member;
      }

      return {
        ...member,
        avatarUrl: profileAvatarUrl,
        avatarPath: profile?.avatarPath ?? null,
      };
    });
  }

  async listConfigOptions(
    ctx: RequestContext,
    type?: string,
  ) {
    if (type && PAYMENT_CONFIG_OPTION_TYPES.includes(type)) {
      await this.ensurePaymentTemplateDefaults(ctx, type);
    }

    if (type === TeamConfigOptionType.LifecycleStepType) {
      await this.ensureLifecycleStepTypeDefaults(ctx);
    }

    if (type === TeamConfigOptionType.ClientLifecycleStepType) {
      await this.ensureClientLifecycleStepTypeDefaults(ctx);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      status: 'active',
    };

    if (type) where.type = type;

    return this.configOptionRepository.find({ where, order: { name: 'ASC' } });
  }

  private async ensurePaymentTemplateDefaults(ctx: RequestContext, type: string) {
    const presets = TEAM_PAYMENT_TEMPLATE_PRESETS[type];
    if (!presets?.length) return;

    const optionType = type as TeamConfigOption['type'];

    const existing = await this.configOptionRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type: optionType },
    });

    const requiredSystemPresets = presets.filter((preset) =>
      Boolean((preset.metadata as Record<string, unknown>).systemKey),
    );
    for (const preset of requiredSystemPresets) {
      const metadata = preset.metadata as Record<string, unknown>;
      const legacyMatch = existing.find((option) => {
        const current = (option.metadata ?? {}) as Record<string, unknown>;
        return !current.systemKey &&
          current.isSystemTemplate === true &&
          current.templateRenderer === metadata.templateRenderer &&
          current.countryScope === metadata.countryScope;
      });
      if (legacyMatch) {
        legacyMatch.metadata = { ...legacyMatch.metadata, ...metadata };
        legacyMatch.updatedById = ctx.userId || null;
        await this.configOptionRepository.save(legacyMatch);
      }
    }
    const presetsToCreate = existing.length === 0
      ? presets
      : requiredSystemPresets.filter((preset) => {
          const metadata = preset.metadata as Record<string, unknown>;
          const systemKey = String(metadata.systemKey);
          return !existing.some((option) => {
            const current = (option.metadata ?? {}) as Record<string, unknown>;
            return current.systemKey === systemKey || (
              current.isSystemTemplate === true &&
              current.templateRenderer === metadata.templateRenderer &&
              current.countryScope === metadata.countryScope
            );
          });
        });

    if (presetsToCreate.length === 0) return;

    // This method can run concurrently when the payments page loads multiple
    // configuration resources. Let the unique index arbitrate that race and
    // keep any template that another request (or the user) created first.
    await this.configOptionRepository
      .createQueryBuilder()
      .insert()
      .into(TeamConfigOption)
      .values(
        presetsToCreate.map((preset) => ({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          type: optionType,
          name: preset.name,
          description: preset.description,
          color: preset.color,
          status: 'active' as const,
          metadata: preset.metadata,
          createdById: ctx.userId || null,
          updatedById: ctx.userId || null,
        })) as QueryDeepPartialEntity<TeamConfigOption>[],
      )
      .orIgnore()
      .execute();
  }

  private async ensureLifecycleStepTypeDefaults(ctx: RequestContext) {
    const existing = await this.configOptionRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: TeamConfigOptionType.LifecycleStepType,
      },
    });

    const existingSystemKeys = new Set(
      existing
        .map((option) => (option.metadata as Record<string, unknown> | null)?.systemKey)
        .filter((key): key is string => typeof key === 'string'),
    );

    const presetsToCreate = TEAM_LIFECYCLE_STEP_TYPE_PRESETS.filter(
      (preset) => !existingSystemKeys.has(preset.metadata.systemKey),
    );

    if (presetsToCreate.length === 0) return;

    // Garantia individual por systemKey: o índice único (tenant, workspace, type, name)
    // arbitra corridas concorrentes sem duplicar presets já criados por outra request.
    await this.configOptionRepository
      .createQueryBuilder()
      .insert()
      .into(TeamConfigOption)
      .values(
        presetsToCreate.map((preset) => ({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          type: TeamConfigOptionType.LifecycleStepType,
          name: preset.name,
          description: preset.description,
          color: preset.color,
          status: 'active' as const,
          metadata: preset.metadata,
          createdById: ctx.userId || null,
          updatedById: ctx.userId || null,
        })) as QueryDeepPartialEntity<TeamConfigOption>[],
      )
      .orIgnore()
      .execute();
  }

  private async ensureClientLifecycleStepTypeDefaults(ctx: RequestContext) {
    const existing = await this.configOptionRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: TeamConfigOptionType.ClientLifecycleStepType,
      },
    });

    const existingSystemKeys = new Set(
      existing
        .map((option) => (option.metadata as Record<string, unknown> | null)?.systemKey)
        .filter((key): key is string => typeof key === 'string'),
    );

    const presetsToCreate = CLIENT_LIFECYCLE_STEP_TYPE_PRESETS.filter(
      (preset) => !existingSystemKeys.has(preset.metadata.systemKey),
    );

    if (presetsToCreate.length === 0) return;

    // Garantia individual por systemKey: o índice único (tenant, workspace, type, name)
    // arbitra corridas concorrentes sem duplicar presets já criados por outra request.
    await this.configOptionRepository
      .createQueryBuilder()
      .insert()
      .into(TeamConfigOption)
      .values(
        presetsToCreate.map((preset) => ({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          type: TeamConfigOptionType.ClientLifecycleStepType,
          name: preset.name,
          description: preset.description,
          color: preset.color,
          status: 'active' as const,
          metadata: preset.metadata,
          createdById: ctx.userId || null,
          updatedById: ctx.userId || null,
        })) as QueryDeepPartialEntity<TeamConfigOption>[],
      )
      .orIgnore()
      .execute();
  }

  async renderDocumentTemplatePdf(ctx: RequestContext, optionId: string): Promise<Buffer> {
    const option = await this.loadDocumentTemplateOption(ctx, optionId);
    const metadata = (option.metadata ?? {}) as Record<string, unknown>;
    const html = this.buildDocumentHtml(ctx, option);

    return this.pdfRendererService.renderHtmlToPdf(html, {
      format: metadata.defaultPageSize === 'LETTER' ? 'Letter' : 'A4',
    });
  }

  async renderDocumentTemplateHtml(ctx: RequestContext, optionId: string): Promise<string> {
    const option = await this.loadDocumentTemplateOption(ctx, optionId);
    return this.buildDocumentHtml(ctx, option);
  }

  async renderAttendanceReportPdf(html: string): Promise<Buffer> {
    if (!html.includes('<title>Relatório de Presença</title>')) {
      throw new BadRequestException('Conteúdo inválido para o relatório de presença.');
    }
    if (/url\s*\(|@import/i.test(html)) {
      throw new BadRequestException('URLs em estilos não são permitidas no relatório.');
    }

    const safeHtml = sanitizeHtml(html, {
      allowedTags: [
        'html', 'head', 'meta', 'title', 'style', 'body', 'header', 'section',
        'div', 'span', 'p', 'small', 'strong', 'b', 'h1', 'h2', 'table',
        'thead', 'tbody', 'tr', 'th', 'td', 'img', 'br',
      ],
      allowedAttributes: {
        html: ['lang'],
        meta: ['charset'],
        '*': ['class'],
        img: ['src', 'alt'],
      },
      allowedSchemes: ['http', 'https', 'data'],
      allowedSchemesByTag: { img: ['http', 'https', 'data'] },
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard',
    });

    return this.pdfRendererService.renderHtmlToPdf(safeHtml, {
      format: 'A4',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  }

  private async loadDocumentTemplateOption(ctx: RequestContext, optionId: string) {
    const option = await this.configOptionRepository.findOne({
      where: {
        id: optionId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'payment_document_template',
      },
    });

    if (!option) {
      throw new NotFoundException('Modelo de documento não encontrado');
    }

    return option;
  }

  /**
   * Despacha a renderização por `templateRenderer`: os 3 modelos protegidos
   * usam builders dedicados (HTML confiável, gerado pelo backend); `custom_html`
   * (default) sanitiza+interpola o bodyHtml do usuário via ContractsService,
   * que já resolve header/footer preset — reaproveitado aqui para fechar o gap
   * de PDF sem header/footer que existia antes desta mudança.
   */
  private buildDocumentHtml(ctx: RequestContext, option: TeamConfigOption): string {
    const metadata = (option.metadata ?? {}) as Record<string, unknown>;
    const templateRenderer = String(metadata.templateRenderer ?? 'custom_html');
    const context = buildMockPaymentDocumentContext(option);
    const presentation = {
      headerPreset: String(metadata.headerPreset ?? 'classic'),
      footerPreset: String(metadata.footerPreset ?? 'lyra'),
      showLogo: metadata.showLogo !== false,
      showCompanyData: metadata.showCompanyData !== false,
      showDocumentNumber: metadata.showDocumentNumber === true,
      documentNumber: context.document.number,
      showPoweredByLyra: metadata.showPoweredByLyra !== false,
    };

    if (templateRenderer === 'attendance_report') {
      return this.pdfRendererService.buildTeamAttendanceReportHtml({
        agency: context.agency,
        member: context.member,
        period: context.period,
        attendance: context.attendance,
        signature: context.signature,
        document: context.document,
        presentation,
      });
    }

    if (templateRenderer === 'payslip') {
      return this.pdfRendererService.buildTeamPayslipHtml({
        agency: context.agency,
        member: context.member,
        period: context.period,
        payment: context.payment,
        benefits: context.benefits,
        deductions: context.deductions,
        signature: context.signature,
        document: context.document,
        pageSize: context.document.pageSize,
        presentation,
      });
    }

    if (templateRenderer === 'payment_statement') {
      return this.pdfRendererService.buildTeamPaymentStatementHtml({
        agency: context.agency,
        member: context.member,
        contract: context.contract,
        period: context.period,
        payment: context.payment,
        benefits: context.benefits,
        deductions: context.deductions,
        signature: context.signature,
        document: context.document,
        presentation,
      });
    }

    if (templateRenderer === 'benefit_acknowledgment') {
      return this.pdfRendererService.buildTeamBenefitAcknowledgmentHtml({
        agency: context.agency,
        member: context.member,
        period: context.period,
        payment: context.payment,
        benefits: context.benefits,
        signature: context.signature,
        document: context.document,
        presentation,
      });
    }

    const bodyHtml = typeof metadata.bodyHtml === 'string' ? metadata.bodyHtml : '';

    if (!bodyHtml.trim()) {
      throw new BadRequestException('Modelo de documento não possui conteúdo HTML.');
    }

    const signatureRequired = metadata.signatureRequired !== false;
    const bodyWithSignature = signatureRequired
      ? `${bodyHtml}${this.pdfRendererService.buildSignatureBlockHtml({
          memberLabel: context.signature.memberName,
          memberRole: context.signature.memberRole,
          agencyLabel: context.signature.agencySignerName,
          agencyRole: context.signature.agencySignerRole,
          city: context.signature.city,
          date: context.signature.date,
        })}`
      : bodyHtml;

    const dto: PreviewContractTemplateDto = {
      bodyHtml: bodyWithSignature,
      headerPreset: (metadata.headerPreset as ContractHeaderPreset) ?? ContractHeaderPreset.Classic,
      footerPreset: (metadata.footerPreset as ContractFooterPreset) ?? ContractFooterPreset.Lyra,
      showLogo: metadata.showLogo !== false,
      showCompanyData: metadata.showCompanyData !== false,
      showContractNumber: Boolean(metadata.showDocumentNumber),
      showPoweredByLyra: metadata.showPoweredByLyra !== false,
      locale: context.document.locale,
      title: option.name,
      variablesData: buildFlatSampleTokenMap(option),
    };

    return this.contractsService.previewTemplate(ctx, dto).html;
  }

  async createConfigOption(
    ctx: RequestContext,
    dto: CreateTeamConfigOptionDto,
  ) {
    const name = dto.name.trim();
    let metadata = dto.metadata ?? {};

    if (LIFECYCLE_STEP_TYPE_CONFIG_TYPES.includes(dto.type)) {
      const rawMetadata = metadata as Record<string, unknown>;
      metadata = {
        ...rawMetadata,
        isSystemDefault: false,
        icon: typeof rawMetadata.icon === 'string' && rawMetadata.icon
          ? rawMetadata.icon
          : LIFECYCLE_STEP_TYPE_DEFAULT_ICON,
        scope: rawMetadata.scope === 'onboarding' || rawMetadata.scope === 'offboarding'
          ? rawMetadata.scope
          : 'both',
      };
    }

    // For seniority, uniqueness is scoped by skillCategory — find only within the same category
    const skillCategory =
      dto.type === 'seniority' &&
      metadata &&
      typeof (metadata as Record<string, unknown>).skillCategory === 'string'
        ? (metadata as Record<string, unknown>).skillCategory
        : undefined;

    const allByName = await this.configOptionRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: dto.type,
        name,
      },
    });

    const existing = skillCategory
      ? allByName.find(
          (o) =>
            o.metadata &&
            (o.metadata as Record<string, unknown>).skillCategory === skillCategory,
        )
      : allByName[0];

    if (existing) {
      existing.status = 'active';
      existing.updatedById = ctx.userId || null;
      existing.metadata = metadata;
      return this.configOptionRepository.save(existing);
    }

    return this.configOptionRepository.save(
      this.configOptionRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: dto.type,
        name,
        status: 'active',
        metadata,
        createdById: ctx.userId || null,
        updatedById: ctx.userId || null,
      }),
    );
  }

  async updateConfigOption(
    ctx: RequestContext,
    id: string,
    dto: UpdateTeamConfigOptionDto,
  ) {
    const entity = await this.configOptionRepository.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!entity) {
      throw new NotFoundException('Config option not found');
    }

    const protectedMetadata = (entity.metadata ?? {}) as Record<string, unknown>;
    const isProtectedTemplate =
      entity.type === 'payment_document_template' && protectedMetadata.isSystemTemplate === true;
    const isSystemLifecycleStepType =
      LIFECYCLE_STEP_TYPE_CONFIG_TYPES.includes(entity.type) && protectedMetadata.isSystemDefault === true;

    if (isSystemLifecycleStepType) {
      // Tipos padrão só podem ter o status (ativo/arquivado) alterado — estrutura
      // (nome, descrição, cor, ícone, escopo) é fixa para manter consistência visual.
      if (dto.status !== undefined) {
        entity.status = dto.status;
      }
      entity.updatedById = ctx.userId || null;
      return this.configOptionRepository.save(entity);
    }

    if (dto.type !== undefined) {
      entity.type = dto.type;
    }

    if (dto.name !== undefined) {
      entity.name = dto.name;
    }

    if (dto.description !== undefined) {
      entity.description = dto.description ?? null;
    }

    if (dto.color !== undefined) {
      entity.color = dto.color ?? null;
    }

    if (dto.metadata !== undefined) {
      const nextMetadata = (dto.metadata ?? {}) as Record<string, unknown>;
      entity.metadata = isProtectedTemplate
        ? {
            ...nextMetadata,
            systemKey: protectedMetadata.systemKey,
            documentType: protectedMetadata.documentType,
            bodyHtml: protectedMetadata.bodyHtml,
            isSystemTemplate: true,
            lockedBody: true,
            templateRenderer: protectedMetadata.templateRenderer,
            signatureRequired: true,
            signatureBlocks: protectedMetadata.signatureBlocks,
          }
        : LIFECYCLE_STEP_TYPE_CONFIG_TYPES.includes(entity.type)
          ? {
              ...nextMetadata,
              isSystemDefault: false,
              icon:
                typeof nextMetadata.icon === 'string' && nextMetadata.icon
                  ? nextMetadata.icon
                  : LIFECYCLE_STEP_TYPE_DEFAULT_ICON,
              scope:
                nextMetadata.scope === 'onboarding' || nextMetadata.scope === 'offboarding'
                  ? nextMetadata.scope
                  : 'both',
            }
          : nextMetadata;
    }

    if (dto.status !== undefined) {
      entity.status = dto.status;
    }

    entity.updatedById = ctx.userId || null;

    return this.configOptionRepository.save(entity);
  }

  async deleteConfigOption(ctx: RequestContext, id: string) {
    const option = await this.configOptionRepository.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!option) {
      throw new NotFoundException('Team config option not found');
    }

    if (option.type === 'payment_document_template' && option.metadata?.isSystemTemplate === true) {
      throw new BadRequestException('Modelos padrão do sistema não podem ser excluídos.');
    }

    if (option.type === TeamConfigOptionType.LifecycleStepType) {
      if (option.metadata?.isSystemDefault === true) {
        throw new BadRequestException('Tipos padrão do sistema não podem ser excluídos.');
      }

      const stepConfigs = await this.configOptionRepository.find({
        where: [
          { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type: 'onboarding_task' },
          { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type: 'offboarding_task' },
        ],
      });
      const inUseByConfig = stepConfigs.some(
        (candidate) => (candidate.metadata as Record<string, unknown> | null)?.stepTypeId === id,
      );
      const inUseByStep = inUseByConfig
        ? true
        : (await this.lifecycleStepRepository.count({
            where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, stepTypeId: id },
          })) > 0;
      const inUse = inUseByConfig || inUseByStep;

      if (inUse) {
        throw new BadRequestException(
          'Este tipo de etapa está em uso e não pode ser excluído. Desative-o em vez de excluí-lo.',
        );
      }
    }

    if (option.type === TeamConfigOptionType.ClientLifecycleStepType) {
      if (option.metadata?.isSystemDefault === true) {
        throw new BadRequestException('Tipos padrão do sistema não podem ser excluídos.');
      }

      const stepConfigs = await this.configOptionRepository.find({
        where: [
          { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type: 'client_onboarding_task' },
          { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type: 'client_offboarding_task' },
        ],
      });
      const inUseByConfig = stepConfigs.some(
        (candidate) => (candidate.metadata as Record<string, unknown> | null)?.stepTypeId === id,
      );

      if (inUseByConfig) {
        throw new BadRequestException(
          'Este tipo de etapa está em uso e não pode ser excluído. Desative-o em vez de excluí-lo.',
        );
      }
    }

    await this.configOptionRepository.remove(option);

    return {
      deleted: true,
      id,
    };
  }

  async createMember(ctx: RequestContext, dto: CreateTeamMemberDto) {
    const entity = this.memberRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      displayName: dto.displayName,
      legalName: dto.legalName ?? null,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      avatarUrl: dto.avatarUrl ?? null,
      userId: dto.userId ?? null,
      contactId: dto.contactId ?? null,
      contractId: dto.contractId ?? null,
      departmentId: dto.departmentId ?? null,
      managerMemberId: dto.managerMemberId ?? null,
      jobTitle: dto.jobTitle ?? null,
      roleName: dto.roleName ?? null,
      seniority: dto.seniority ?? null,
      workerType: dto.workerType,
      workMode: dto.workMode,
      workLocation: dto.workLocation ?? null,
      country: dto.country ?? null,
      timezone: dto.timezone ?? null,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      attendanceEnabled: dto.attendanceEnabled ?? false,
      overtimeApprovalRequired: dto.overtimeApprovalRequired ?? true,
      hourlyCost: dto.hourlyCost ?? null,
      monthlyCost: dto.monthlyCost ?? null,
      currency: dto.currency ?? 'USD',
      notes: dto.notes ?? null,
      metadata: dto.metadata ?? {},
      status: dto.status ?? TeamMemberStatus.Active,
      createdById: ctx.userId || null,
    });

    const saved = await this.memberRepository.save(entity);

    if (saved.userId) {
      await this.teamNotificationPublisher.publishMemberInvited({
        member: saved,
        actorUserId: ctx.userId || null,
      });
    }

    const [memberWithAvatar] = await this.withUserProfileAvatars(ctx, [saved]);
    return memberWithAvatar;
  }

  async updateMember(
    ctx: RequestContext,
    id: string,
    dto: UpdateTeamMemberDto,
  ) {
    const entity = await this.findMember(ctx, id);
    const previousStatus = entity.status;
    const previousDepartmentId = entity.departmentId;
    const previousRoleName = entity.roleName;

    Object.assign(entity, {
      ...dto,
      updatedById: ctx.userId || null,
    });

    const saved = await this.memberRepository.save(entity);
    const actorUserId = ctx.userId || null;

    if (saved.userId) {
      if (
        dto.status !== undefined &&
        dto.status !== previousStatus &&
        dto.status === TeamMemberStatus.Active
      ) {
        await this.teamNotificationPublisher.publishMemberActivated({
          member: saved,
          actorUserId,
        });
      }

      if (
        dto.status !== undefined &&
        dto.status !== previousStatus &&
        (dto.status === TeamMemberStatus.Inactive ||
          dto.status === TeamMemberStatus.Archived)
      ) {
        await this.teamNotificationPublisher.publishMemberDeactivated({
          member: saved,
          actorUserId,
        });
      }

      if (
        dto.departmentId !== undefined &&
        dto.departmentId !== previousDepartmentId
      ) {
        await this.teamNotificationPublisher.publishDepartmentChanged({
          member: saved,
          actorUserId,
          previousDepartmentId,
        });
      }

      if (dto.roleName !== undefined && dto.roleName !== previousRoleName) {
        await this.teamNotificationPublisher.publishRoleChanged({
          member: saved,
          actorUserId,
          previousRoleName,
        });
      }
    }

    const [memberWithAvatar] = await this.withUserProfileAvatars(ctx, [saved]);
    return memberWithAvatar;
  }

  async uploadMemberAvatar(
    ctx: RequestContext,
    memberId: string,
    file: Express.Multer.File,
  ) {
    const member = await this.findMember(ctx, memberId);
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `agency/tenants/${ctx.tenantId}/workspaces/${ctx.workspaceId}/team/members/${memberId}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

    member.avatarUrl = stored.url;
    member.updatedById = ctx.userId || null;

    await this.memberRepository.save(member);

    return {
      avatarUrl: stored.url,
      avatarPath: stored.path,
    };
  }

  async archiveMember(ctx: RequestContext, id: string) {
    const entity = await this.findMember(ctx, id);
    const previousStatus = entity.status;
    entity.status = TeamMemberStatus.Archived;
    entity.archivedAt = new Date();
    entity.updatedById = ctx.userId || null;

    const saved = await this.memberRepository.save(entity);

    if (saved.userId && previousStatus !== TeamMemberStatus.Archived) {
      await this.teamNotificationPublisher.publishMemberDeactivated({
        member: saved,
        actorUserId: ctx.userId || null,
      });
    }

    return saved;
  }

  async deleteMember(ctx: RequestContext, id: string) {
    const entity = await this.findMember(ctx, id);

    await this.memberRepository.remove(entity);

    return {
      deleted: true,
      id,
    };
  }

  async upsertMemberSkill(
    ctx: RequestContext,
    memberId: string,
    dto: UpsertTeamMemberSkillDto,
  ) {
    await this.findMember(ctx, memberId);
    await this.findSkill(ctx, dto.skillId);

    const existing = await this.memberSkillRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        skillId: dto.skillId,
      },
    });

    if (existing) {
      existing.level = dto.level ?? existing.level;
      existing.notes = dto.notes ?? existing.notes;
      existing.metadata = {
        ...(existing.metadata ?? {}),
        ...(dto.metadata ?? {}),
      };
      return this.memberSkillRepository.save(existing);
    }

    const created = await this.memberSkillRepository.save(
      this.memberSkillRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        skillId: dto.skillId,
        level: dto.level ?? TeamSkillLevel.Intermediate,
        notes: dto.notes ?? null,
        metadata: dto.metadata ?? {},
      }),
    );

    const member = await this.findMember(ctx, memberId);

    if (member.userId) {
      await this.teamNotificationPublisher.publishSkillAssigned({
        member,
        actorUserId: ctx.userId || null,
        skillId: dto.skillId,
        occurredAt: created.createdAt,
        recipients: [
          {
            userId: member.userId,
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      });
    }

    return created;
  }

  async removeMemberSkill(
    ctx: RequestContext,
    memberId: string,
    skillId: string,
  ) {
    const existing = await this.memberSkillRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        skillId,
      },
    });

    if (!existing) return { deleted: false };

    await this.memberSkillRepository.delete(existing.id);
    return { deleted: true };
  }

  private async findDepartment(ctx: RequestContext, id: string) {
    const entity = await this.departmentRepository.findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, id },
    });

    if (!entity) throw new NotFoundException('Department not found');
    return entity;
  }

  private async findSkill(ctx: RequestContext, id: string) {
    const entity = await this.skillRepository.findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, id },
    });

    if (!entity) throw new NotFoundException('Skill not found');
    return entity;
  }

  private async findMember(ctx: RequestContext, id: string) {
    const entity = await this.memberRepository.findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, id },
    });

    if (!entity) throw new NotFoundException('Team member not found');
    return entity;
  }
}
