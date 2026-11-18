import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import { AgencySettingsService } from '../agency/agency-settings.service';
import { emailFrontendUrl } from '../email/email-frontend-url';
import { EmailService } from '../email/email.service';
import { renderTransactionalEmail } from '../email/templates/transactional-email.template';
import { FinanceFiscalProfile } from '../finance/entities/finance-fiscal-profile.entity';
import {
  FinanceBrazilTaxRegime,
  FinanceFiscalDocumentModel,
  FinanceServiceCityOrigin,
} from '../finance/enums';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../notifications/enums';
import { NotificationEventProcessorService } from '../notifications/services';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { FiscalIntakeRequestEntity } from './entities/fiscal-intake-request.entity';
import {
  type FiscalAuditAction,
  FiscalProfileAuditEventEntity,
} from './entities/fiscal-profile-audit-event.entity';
import { FiscalCertificateCrypto } from './fiscal-certificate.crypto';
import {
  assertCertificateAcceptable,
  inspectCertificate,
} from './fiscal-certificate.inspector';
import {
  FISCAL_INTAKE_DEFAULT_DAYS,
  FISCAL_INTAKE_MAX_ATTEMPTS,
  type FiscalCertificateMeta,
  type FiscalIntakeData,
  type FiscalIntakeScope,
  type FiscalIntakeStatus,
  onlyDigits,
  parseFiscalIntakeData,
} from './fiscal-intake.types';

export type FiscalAgencyContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

export type UploadedCertificate = {
  buffer: Buffer;
  originalname?: string;
  size: number;
};

export const FISCAL_MANAGE_PERMISSION =
  'agency.finance.fiscal.manage.owner_only';
const DAY_MS = 86_400_000;

export function hashFiscalToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function effectiveStatus(
  request: Pick<FiscalIntakeRequestEntity, 'status' | 'expiresAt'>,
  now = new Date(),
): FiscalIntakeStatus {
  return request.status === 'open' && request.expiresAt <= now
    ? 'expired'
    : request.status;
}

function maskCnpj(cnpj: string | null | undefined) {
  const digits = onlyDigits(cnpj);
  return digits.length === 14
    ? `${digits.slice(0, 2)}.***.***/${digits.slice(8, 12)}-${digits.slice(12)}`
    : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const REGIME_TO_PROFILE: Record<
  FiscalIntakeData['taxation']['regime'],
  FinanceBrazilTaxRegime
> = {
  mei: FinanceBrazilTaxRegime.SimplesNacional,
  simples_nacional: FinanceBrazilTaxRegime.SimplesNacional,
  lucro_presumido: FinanceBrazilTaxRegime.NormalLucroPresumido,
  lucro_real: FinanceBrazilTaxRegime.NormalLucroReal,
};

/**
 * Maps the accountant's data onto the existing fiscal profile (Settings >
 * Finance > Fiscal). Fields the profile already has are written there; the
 * rest (identity, address, all services, issuer, accountant) goes to
 * `company_data`, versioned by `data.version`.
 */
export function applyIntakeToProfile(
  profile: FinanceFiscalProfile,
  data: FiscalIntakeData,
  requestId: string,
) {
  const [service] = data.services;
  profile.fiscalCountry = 'BR';
  profile.defaultDocumentModel = FinanceFiscalDocumentModel.Nfse;
  profile.municipalRegistration = data.company.municipalRegistration;
  profile.brazilTaxRegime = REGIME_TO_PROFILE[data.taxation.regime];
  profile.isSimplesNacional =
    data.taxation.regime === 'mei' ||
    data.taxation.regime === 'simples_nacional';
  profile.hasSpecialTaxRegime = Boolean(data.taxation.specialRegime);
  profile.specialTaxRegimeCode = data.taxation.specialRegime;
  profile.cnae = [data.taxation.mainCnae, ...data.taxation.secondaryCnaes].join(
    ',',
  );
  profile.nfseSeries = data.issuance.series;
  profile.nextRpsNumber = data.issuance.nextNumber;
  if (service) {
    profile.cityServiceCode = service.lc116Code;
    profile.cityTaxationCode = service.municipalTaxCode;
    profile.defaultNbsCode = service.nbsCode;
    profile.issRate = service.issRate;
    profile.cityServiceDescription = service.description;
    profile.serviceCityOrigin =
      service.incidence === 'customer'
        ? FinanceServiceCityOrigin.Customer
        : FinanceServiceCityOrigin.Provider;
    profile.ibsCbsCst = service.ibsCbsCst ?? profile.ibsCbsCst;
  }
  profile.companyData = { ...data, approvedFromRequestId: requestId };
}

/**
 * Forms addon F5 — accountant fiscal intake (§8). The agency side lives under
 * the Finance fiscal permission; the public side is reached only with the
 * link token (stored as sha256), capped per link on top of the edge limit.
 */
@Injectable()
export class FiscalIntakeService {
  private readonly logger = new Logger(FiscalIntakeService.name);

  constructor(
    @InjectRepository(FiscalIntakeRequestEntity, 'agency')
    private readonly requests: Repository<FiscalIntakeRequestEntity>,
    @InjectRepository(FiscalProfileAuditEventEntity, 'agency')
    private readonly audit: Repository<FiscalProfileAuditEventEntity>,
    @InjectRepository(FinanceFiscalProfile, 'agency')
    private readonly profiles: Repository<FinanceFiscalProfile>,
    @InjectRepository(AgencyWorkspaceUserEntity, 'agency')
    private readonly workspaceUsers: Repository<AgencyWorkspaceUserEntity>,
    @InjectDataSource('agency')
    private readonly dataSource: DataSource,
    private readonly crypto: FiscalCertificateCrypto,
    private readonly mailer: EmailService,
    private readonly settings: AgencySettingsService,
    private readonly permissions: PlatformPermissionService,
    private readonly notifications: NotificationEventProcessorService,
  ) {}

  // ── Agency side ──────────────────────────────────────────────────────────

  async overview(ctx: FiscalAgencyContext) {
    const [profile, requests, events] = await Promise.all([
      this.profiles.findOne({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      }),
      this.requests.find({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        order: { createdAt: 'DESC' },
        take: 10,
      }),
      this.audit.find({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
    ]);
    const expiresAt = profile?.certificateExpiresAt ?? null;
    return {
      certificateUploadEnabled: this.crypto.isAvailable(),
      profile: profile
        ? {
            companyData: profile.companyData ?? {},
            certificate: profile.certificateMeta
              ? {
                  meta: profile.certificateMeta,
                  expiresAt,
                  daysToExpiry: expiresAt
                    ? Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS)
                    : null,
                }
              : null,
            intakeApprovedAt: profile.intakeApprovedAt,
          }
        : null,
      requests: requests.map((request) => this.toAgencyView(request)),
      audit: events.map((event) => ({
        id: event.id,
        action: event.action,
        actorKind: event.actorKind,
        actorUserId: event.actorUserId,
        intakeRequestId: event.intakeRequestId,
        details: event.details,
        createdAt: event.createdAt,
      })),
    };
  }

  async createRequest(
    ctx: FiscalAgencyContext,
    input: {
      scope?: FiscalIntakeScope;
      recipientName?: string | null;
      recipientEmail?: string | null;
      sendEmail?: boolean;
      expiresInDays?: number;
    },
  ) {
    const scope = input.scope ?? 'full';
    if (scope === 'certificate') {
      if (!this.crypto.isAvailable())
        throw new BadRequestException(
          'O envio de certificado está desativado: configure a FISCAL_CERT_ENCRYPTION_KEY.',
        );
      if (!(await this.profileCnpj(ctx)))
        throw new BadRequestException(
          'Informe o CNPJ da empresa (Configurações > Empresa) ou peça os dados completos: o certificado é conferido pelo CNPJ.',
        );
    }
    const email = input.recipientEmail?.trim().toLowerCase() || null;
    if (input.sendEmail && !email)
      throw new BadRequestException(
        'Informe o e-mail do contador para enviar o link.',
      );

    // One active link at a time (§8.1).
    await this.requests.update(
      { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, status: 'open' },
      { status: 'revoked' },
    );

    const token = randomBytes(32).toString('base64url');
    const days = Math.min(
      Math.max(
        Math.trunc(input.expiresInDays ?? FISCAL_INTAKE_DEFAULT_DAYS),
        1,
      ),
      30,
    );
    const request = await this.requests.save(
      this.requests.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        scope,
        status: 'open',
        tokenHash: hashFiscalToken(token),
        expiresAt: new Date(Date.now() + days * DAY_MS),
        recipientName: input.recipientName?.trim().slice(0, 160) || null,
        recipientEmail: email,
        createdByUserId: ctx.userId,
      }),
    );
    await this.record(ctx, 'intake_link_created', 'user', request.id, {
      scope,
      expiresInDays: days,
      emailed: Boolean(input.sendEmail),
    });

    const path = `/f/fiscal/${token}`;
    if (input.sendEmail && email) await this.sendLinkEmail(ctx, request, path);
    return { request: this.toAgencyView(request), path, token };
  }

  async revokeRequest(ctx: FiscalAgencyContext, id: string) {
    const result = await this.requests.update(
      {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        status: 'open',
      },
      { status: 'revoked' },
    );
    if (!result.affected)
      throw new NotFoundException('Link não encontrado ou já encerrado.');
    await this.record(ctx, 'intake_link_revoked', 'user', id, {});
    return { ok: true };
  }

  async approve(ctx: FiscalAgencyContext, id: string) {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const request = await this.loadWithSecrets(manager, ctx, id);
      if (request.status !== 'submitted')
        throw new ConflictException(
          'Só um envio aguardando revisão pode ser aprovado.',
        );

      const repo = manager.getRepository(FinanceFiscalProfile);
      const profile =
        (await repo.findOne({
          where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        })) ??
        repo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          fiscalCountry: 'BR',
        });
      const replaced = Boolean(profile.certificateMeta);

      if (request.data) applyIntakeToProfile(profile, request.data, request.id);
      if (request.certificateEncrypted && request.certificateMeta) {
        profile.certificateEncrypted = request.certificateEncrypted;
        profile.certificatePasswordEncrypted =
          request.certificatePasswordEncrypted;
        profile.certificateKeyVersion = request.certificateKeyVersion;
        profile.certificateMeta = request.certificateMeta;
        profile.certificateExpiresAt = new Date(
          request.certificateMeta.validTo,
        );
        profile.certificateFileName = request.certificateMeta.fileName;
        profile.certificateObjectKey = null;
        profile.certificateAlertLevel = null;
      }
      if (request.municipalPortalPasswordEncrypted)
        profile.municipalPortalPasswordEncrypted =
          request.municipalPortalPasswordEncrypted;
      profile.intakeApprovedAt = new Date();
      profile.intakeApprovedByUserId = ctx.userId;
      await repo.save(profile);

      // The approved ciphertext now lives only in the profile.
      await manager.getRepository(FiscalIntakeRequestEntity).update(
        { id: request.id, status: 'submitted' },
        {
          status: 'approved',
          reviewedByUserId: ctx.userId,
          reviewedAt: new Date(),
          certificateEncrypted: null,
          certificatePasswordEncrypted: null,
          municipalPortalPasswordEncrypted: null,
        },
      );
      return {
        request,
        replaced,
        withCertificate: Boolean(request.certificateMeta),
      };
    });

    await this.record(ctx, 'intake_approved', 'user', id, {
      scope: outcome.request.scope,
    });
    if (outcome.withCertificate && outcome.replaced)
      await this.record(ctx, 'certificate_replaced', 'user', id, {
        fingerprintSha256:
          outcome.request.certificateMeta?.fingerprintSha256 ?? null,
      });
    return { ok: true };
  }

  async reject(ctx: FiscalAgencyContext, id: string, note?: string | null) {
    const result = await this.requests.update(
      {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        status: 'submitted',
      },
      {
        status: 'rejected',
        reviewedByUserId: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: note?.trim().slice(0, 1000) || null,
        certificateEncrypted: null,
        certificatePasswordEncrypted: null,
        municipalPortalPasswordEncrypted: null,
      },
    );
    if (!result.affected)
      throw new NotFoundException('Envio não encontrado ou já revisado.');
    await this.record(ctx, 'intake_rejected', 'user', id, {});
    return { ok: true };
  }

  // ── Public side (accountant, token only) ─────────────────────────────────

  async publicView(token: string) {
    const request = await this.findByToken(token);
    const status = effectiveStatus(request);
    const company = await this.settings.getCompany(
      request.tenantId,
      request.workspaceId,
    );
    const agencyName =
      company.tradeName ||
      company.workspaceName ||
      company.legalName ||
      'Agência';
    const base = { status, scope: request.scope, agencyName };
    if (status === 'open') {
      return {
        ...base,
        recipientName: request.recipientName,
        expiresAt: request.expiresAt,
        certificateUploadEnabled: this.crypto.isAvailable(),
        expectedCnpj:
          request.scope === 'certificate'
            ? maskCnpj(await this.profileCnpj(request))
            : null,
      };
    }
    if (status === 'submitted' || status === 'approved') {
      // Locked link: a summary without secrets (§8.1).
      return {
        ...base,
        submittedAt: request.submittedAt,
        summary: {
          legalName: request.data?.company.legalName ?? null,
          cnpj: maskCnpj(
            request.data?.company.cnpj ?? request.certificateMeta?.cnpj,
          ),
          certificate: request.certificateMeta
            ? {
                holder: request.certificateMeta.holder,
                validTo: request.certificateMeta.validTo,
              }
            : null,
        },
      };
    }
    return base;
  }

  async inspectPublic(
    token: string,
    file: UploadedCertificate | undefined,
    password: string | undefined,
    cnpj?: string,
  ) {
    const request = await this.openRequest(token);
    await this.countAttempt(request);
    if (!file) throw new BadRequestException('Envie o arquivo do certificado.');
    const inspection = inspectCertificate(
      file.buffer,
      password ?? '',
      file.originalname ?? null,
    );
    const expected =
      request.scope === 'certificate'
        ? await this.profileCnpj(request)
        : cnpj
          ? onlyDigits(cnpj)
          : null;
    return { meta: assertCertificateAcceptable(inspection, expected) };
  }

  async submitPublic(
    token: string,
    body: {
      data?: string;
      certificatePassword?: string;
      portalPassword?: string;
    },
    file: UploadedCertificate | undefined,
  ) {
    const request = await this.openRequest(token);
    await this.countAttempt(request);

    let data: FiscalIntakeData | null = null;
    if (request.scope === 'full') {
      let raw: unknown;
      try {
        raw = JSON.parse(body.data ?? '');
      } catch {
        throw new BadRequestException('Dados do formulário inválidos.');
      }
      data = parseFiscalIntakeData(raw);
    }

    if (request.scope === 'certificate' && !file)
      throw new BadRequestException('Envie o novo certificado A1.');
    const needsKey = Boolean(file) || Boolean(body.portalPassword?.trim());
    if (needsKey && !this.crypto.isAvailable())
      throw new BadRequestException(
        'O envio de certificado e senhas está desativado no momento. Envie os dados sem eles.',
      );

    let certificate: {
      payload: Buffer;
      keyVersion: number;
      meta: FiscalCertificateMeta;
      password: string;
    } | null = null;
    if (file) {
      const password = body.certificatePassword ?? '';
      const inspection = inspectCertificate(
        file.buffer,
        password,
        file.originalname ?? null,
      );
      const expected = data?.company.cnpj ?? (await this.profileCnpj(request));
      const meta = assertCertificateAcceptable(inspection, expected);
      const { payload, keyVersion } = this.crypto.encrypt(file.buffer);
      certificate = {
        payload,
        keyVersion,
        meta,
        password: this.crypto.encryptText(password),
      };
    }
    const portalPassword =
      body.portalPassword?.trim() && request.scope === 'full'
        ? this.crypto.encryptText(body.portalPassword.trim())
        : null;

    const result = await this.requests.update(
      { id: request.id, status: 'open' },
      {
        status: 'submitted',
        submittedAt: new Date(),
        data,
        certificateEncrypted: certificate?.payload ?? null,
        certificatePasswordEncrypted: certificate?.password ?? null,
        certificateKeyVersion: certificate?.keyVersion ?? null,
        certificateMeta: certificate?.meta ?? null,
        municipalPortalPasswordEncrypted: portalPassword,
      },
    );
    if (!result.affected)
      throw new ConflictException('Este link já foi usado.');

    const actor = {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      userId: null,
    };
    await this.record(actor, 'intake_submitted', 'accountant', request.id, {
      scope: request.scope,
    });
    if (certificate)
      await this.record(
        actor,
        'certificate_uploaded',
        'accountant',
        request.id,
        {
          fingerprintSha256: certificate.meta.fingerprintSha256,
          validTo: certificate.meta.validTo,
        },
      );
    await this.notifySubmitted(request);
    return { ok: true };
  }

  // ── Expiry alerts (§8.1.4) ───────────────────────────────────────────────

  @Cron('0 0 9 * * *', { name: 'fiscal-certificate-expiry-alerts' })
  async certificateAlerts(now = new Date()): Promise<void> {
    const due = await this.profiles
      .createQueryBuilder('p')
      .where('p.certificate_meta IS NOT NULL')
      .andWhere('p.certificate_expires_at IS NOT NULL')
      .andWhere('p.certificate_expires_at < :limit', {
        limit: new Date(now.getTime() + 30 * DAY_MS),
      })
      .getMany();
    for (const profile of due) {
      const days = Math.ceil(
        (profile.certificateExpiresAt!.getTime() - now.getTime()) / DAY_MS,
      );
      const level = days <= 0 ? 0 : days <= 7 ? 7 : 30;
      if (
        profile.certificateAlertLevel !== null &&
        profile.certificateAlertLevel <= level
      )
        continue;
      try {
        await this.publish(profile, {
          eventType: 'finance.fiscal_certificate_expiring',
          eventId: `fiscal.certificate:${profile.id}:${profile.certificateMeta?.['fingerprintSha256'] as string}:${level}`,
          title:
            level === 0
              ? 'Certificado A1 vencido'
              : 'Certificado A1 perto do vencimento',
          body:
            level === 0
              ? 'O certificado digital da empresa venceu. Peça um novo ao contador.'
              : `O certificado digital da empresa vence em ${days} dia(s). Peça um novo ao contador.`,
          recipients: await this.fiscalManagers(
            profile.tenantId,
            profile.workspaceId,
          ),
        });
        await this.profiles.update(
          { id: profile.id },
          { certificateAlertLevel: level },
        );
      } catch (error) {
        this.logger.warn(
          `Fiscal certificate alert ${profile.workspaceId}: ${(error as Error).message}`,
        );
      }
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private toAgencyView(request: FiscalIntakeRequestEntity) {
    return {
      id: request.id,
      scope: request.scope,
      status: effectiveStatus(request),
      recipientName: request.recipientName,
      recipientEmail: request.recipientEmail,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
      submittedAt: request.submittedAt,
      reviewedAt: request.reviewedAt,
      reviewNote: request.reviewNote,
      data: request.data,
      certificateMeta: request.certificateMeta,
    };
  }

  private async findByToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token ?? ''))
      throw new NotFoundException('Link inválido.');
    const request = await this.requests.findOne({
      where: { tokenHash: hashFiscalToken(token) },
    });
    if (!request) throw new NotFoundException('Link inválido.');
    return request;
  }

  private async openRequest(token: string) {
    const request = await this.findByToken(token);
    const status = effectiveStatus(request);
    if (status !== 'open')
      throw new ConflictException(
        status === 'expired'
          ? 'Este link expirou.'
          : 'Este link não aceita mais envios.',
      );
    return request;
  }

  private async countAttempt(request: FiscalIntakeRequestEntity) {
    const rows: unknown = await this.dataSource.query(
      `UPDATE fiscal_intake_requests SET attempt_count = attempt_count + 1
        WHERE id = $1 AND attempt_count < $2 RETURNING id`,
      [request.id, FISCAL_INTAKE_MAX_ATTEMPTS],
    );
    // pg returns [rows, count] for UPDATE … RETURNING through TypeORM.
    const list =
      Array.isArray(rows) && Array.isArray(rows[0])
        ? (rows[0] as unknown[])
        : (rows as unknown[]);
    if (!Array.isArray(list) || list.length === 0)
      throw new HttpException(
        'Muitas tentativas neste link. Peça um novo link à agência.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private async profileCnpj(
    request: Pick<FiscalIntakeRequestEntity, 'tenantId' | 'workspaceId'>,
  ) {
    const profile = await this.profiles.findOne({
      where: { tenantId: request.tenantId, workspaceId: request.workspaceId },
    });
    const company = (profile?.companyData?.['company'] ?? null) as {
      cnpj?: string;
    } | null;
    const approved = onlyDigits(company?.cnpj);
    if (approved) return approved;
    // Before any approved intake: the CNPJ of Settings > Company, when it is one.
    const settings = await this.settings.getCompany(
      request.tenantId,
      request.workspaceId,
    );
    const taxId = onlyDigits(settings.taxId);
    return taxId.length === 14 ? taxId : null;
  }

  private async loadWithSecrets(
    manager: EntityManager,
    ctx: FiscalAgencyContext,
    id: string,
  ) {
    const request = await manager
      .getRepository(FiscalIntakeRequestEntity)
      .createQueryBuilder('r')
      .addSelect([
        'r.certificateEncrypted',
        'r.certificatePasswordEncrypted',
        'r.municipalPortalPasswordEncrypted',
      ])
      .where(
        'r.id = :id AND r.tenant_id = :tenantId AND r.workspace_id = :workspaceId',
        {
          id,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      )
      .setLock('pessimistic_write')
      .getOne();
    if (!request) throw new NotFoundException('Envio não encontrado.');
    return request;
  }

  private async record(
    ctx: FiscalAgencyContext,
    action: FiscalAuditAction,
    actorKind: 'user' | 'accountant' | 'system',
    intakeRequestId: string | null,
    details: Record<string, unknown>,
  ) {
    await this.audit.save(
      this.audit.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        action,
        actorKind,
        actorUserId: actorKind === 'user' ? ctx.userId : null,
        intakeRequestId,
        details,
      }),
    );
  }

  private async sendLinkEmail(
    ctx: FiscalAgencyContext,
    request: FiscalIntakeRequestEntity,
    path: string,
  ) {
    const company = await this.settings.getCompany(
      ctx.tenantId,
      ctx.workspaceId,
    );
    const agencyName =
      company.tradeName ||
      company.workspaceName ||
      company.legalName ||
      'Agência';
    const url = `${emailFrontendUrl(process.env.FRONTEND_APP_URL, process.env.APP_FRONTEND_URL)}${path}`;
    const certificateOnly = request.scope === 'certificate';
    const { html, text } = renderTransactionalEmail({
      title: certificateOnly
        ? 'Novo certificado digital'
        : 'Dados fiscais para emissão de notas',
      intro: `${escapeHtml(agencyName)} pediu ${certificateOnly ? 'o novo certificado A1 (e-CNPJ)' : 'os dados de emissão de NFS-e e o certificado A1 (e-CNPJ)'} da empresa.`,
      buttonLabel: certificateOnly
        ? 'Enviar certificado'
        : 'Preencher dados fiscais',
      buttonUrl: url,
      secondaryText: `O link é de uso único e expira em ${request.expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. O certificado é guardado criptografado.`,
      footerText:
        'E-mail automático enviado a pedido da agência. Se você não esperava este pedido, ignore esta mensagem.',
    });
    await this.mailer.sendEmail({
      to: request.recipientEmail!,
      subject: `${agencyName} — ${certificateOnly ? 'novo certificado digital' : 'dados fiscais'}`,
      html,
      text,
    });
  }

  private async notifySubmitted(request: FiscalIntakeRequestEntity) {
    try {
      const recipients = request.createdByUserId
        ? [request.createdByUserId]
        : await this.fiscalManagers(request.tenantId, request.workspaceId);
      await this.publish(request, {
        eventType: 'finance.fiscal_intake_submitted',
        eventId: `fiscal.intake_submitted:${request.id}`,
        title: 'Dados fiscais recebidos',
        body: `${request.recipientName || 'O contador'} enviou ${request.scope === 'certificate' ? 'o novo certificado' : 'os dados fiscais'}. Revise e aprove.`,
        recipients,
      });
    } catch (error) {
      this.logger.warn(
        `Fiscal intake notification ${request.id}: ${(error as Error).message}`,
      );
    }
  }

  private async publish(
    scope: { tenantId: string; workspaceId: string; id: string },
    input: {
      eventType: string;
      eventId: string;
      title: string;
      body: string;
      recipients: string[];
    },
  ) {
    if (!input.recipients.length) return;
    await this.notifications.process({
      eventId: input.eventId,
      eventType: input.eventType,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      productKey: NotificationProductKey.AGENCY,
      moduleKey: 'finance',
      actorType: NotificationActorType.SYSTEM,
      actorUserId: null,
      initiatedByUserId: null,
      resourceType: 'finance_fiscal_profile',
      resourceId: scope.id,
      occurredAt: new Date().toISOString(),
      recipients: input.recipients.map((userId) => ({
        userId,
        interestReason: NotificationInterestReason.RESPONSIBLE_ROLE,
      })),
      payload: {
        title: input.title,
        body: input.body,
        actionUrl: '/finance/settings?tab=fiscal',
      },
    });
  }

  private async fiscalManagers(tenantId: string, workspaceId: string) {
    const users = await this.workspaceUsers.find({
      where: { tenantId, workspaceId, status: 'active' },
    });
    const allowed: string[] = [];
    for (const user of users) {
      if (!user.userId) continue;
      const can = await this.permissions.can(
        { tenantId, workspaceId, userId: user.userId, role: user.role },
        FISCAL_MANAGE_PERMISSION,
      );
      if (can) allowed.push(user.userId);
    }
    return allowed;
  }
}

/**
 * The only door to the decrypted certificate (§8.4/§8.5). Nothing calls it
 * yet: the future NF integration will. Every call leaves an audit row first.
 */
@Injectable()
export class FiscalProfileReader {
  constructor(
    @InjectRepository(FinanceFiscalProfile, 'agency')
    private readonly profiles: Repository<FinanceFiscalProfile>,
    @InjectRepository(FiscalProfileAuditEventEntity, 'agency')
    private readonly audit: Repository<FiscalProfileAuditEventEntity>,
    private readonly crypto: FiscalCertificateCrypto,
  ) {}

  async readCertificate(
    tenantId: string,
    workspaceId: string,
    purpose: string,
  ) {
    const profile = await this.profiles
      .createQueryBuilder('p')
      .addSelect(['p.certificateEncrypted', 'p.certificatePasswordEncrypted'])
      .where('p.tenant_id = :tenantId AND p.workspace_id = :workspaceId', {
        tenantId,
        workspaceId,
      })
      .getOne();
    if (!profile?.certificateEncrypted || !profile.certificateKeyVersion)
      throw new NotFoundException('Nenhum certificado aprovado.');
    await this.audit.save(
      this.audit.create({
        tenantId,
        workspaceId,
        action: 'certificate_decrypted',
        actorKind: 'system',
        actorUserId: null,
        intakeRequestId: null,
        details: { purpose: purpose.slice(0, 120) },
      }),
    );
    return {
      pfx: this.crypto.decrypt(
        profile.certificateEncrypted,
        profile.certificateKeyVersion,
      ),
      password: profile.certificatePasswordEncrypted
        ? this.crypto.decryptText(profile.certificatePasswordEncrypted)
        : '',
      meta: profile.certificateMeta,
    };
  }
}
