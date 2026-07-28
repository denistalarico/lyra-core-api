import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import type { LoginRequestContext } from '../../auth/utils/login-context.util';
import { EmailService } from '../../email/email.service';
import { renderTransactionalEmail } from '../../email/templates/transactional-email.template';
import { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import {
  PlatformAdminIdentityEntity,
  PlatformAdminIdentityTokenEntity,
  type PlatformAdminIdentityTokenPurpose,
  PlatformAdminInvitationEntity,
  PlatformAdminSessionEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import { normalizeAdminEmail } from '../utils/admin-identity.util';
import { AdminAuditService } from './admin-audit.service';

const AGENCY_CONNECTION = 'agency';
const GENERIC_REQUEST_MESSAGE =
  'Se existir uma conta válida, enviaremos as instruções.';

@Injectable()
export class AdminIdentityLifecycleService {
  constructor(
    @InjectRepository(PlatformAdminIdentityEntity, AGENCY_CONNECTION)
    private readonly identityRepository: Repository<PlatformAdminIdentityEntity>,
    @InjectRepository(PlatformAdminIdentityTokenEntity, AGENCY_CONNECTION)
    private readonly tokenRepository: Repository<PlatformAdminIdentityTokenEntity>,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly identityGateway: AdminIdentityGateway,
    private readonly auditService: AdminAuditService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async provisionFromInvitation(
    invitation: PlatformAdminInvitationEntity,
    client: LoginRequestContext,
  ) {
    let identity = await this.identityRepository.findOne({
      where: { normalizedEmail: invitation.normalizedEmail },
    });
    if (!identity) {
      identity = this.identityRepository.create({
        email: invitation.email,
        normalizedEmail: invitation.normalizedEmail,
        displayName: invitation.email.split('@')[0] || 'Administrador',
        status: 'pending',
        passwordHash: null,
        passwordConfiguredAt: null,
        twoFactorEnabled: false,
        twoFactorMethod: null,
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
        emailVerifiedAt: null,
        lastPasswordChangeAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        metadata: {},
      });
      try {
        identity = await this.identityRepository.save(identity);
      } catch (error) {
        const existing = await this.identityRepository.findOne({
          where: { normalizedEmail: invitation.normalizedEmail },
        });
        if (!existing) throw error;
        identity = existing;
      }
    }
    if (identity.status === 'disabled' || identity.status === 'active') {
      await this.auditDenied('admin.identity.action_denied', client, identity, {
        invitationId: invitation.id,
        reason: 'identity_not_pending',
      });
      throw new UnauthorizedException('Administrative invitation is invalid.');
    }

    const rawToken = await this.issueToken(
      identity,
      'initial_password_setup',
      this.duration('ADMIN_ACTIVATION_TOKEN_TTL', 24 * 60 * 60_000),
      { invitationId: invitation.id },
    );
    await this.sendActionEmail(
      identity.email,
      'Ative sua conta Lyra Admin',
      'Defina seu nome e uma senha para ativar o acesso administrativo.',
      'Ativar conta',
      `/activate-account?token=${encodeURIComponent(rawToken)}`,
      'Este link é pessoal, de uso único e expira automaticamente.',
    );
    await this.auditService.record({
      action: 'admin.identity.provisioning_started',
      targetType: 'platform_admin_identity',
      targetId: identity.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: {
        identitySource: 'platform_admin',
        identityId: identity.id,
        invitationId: invitation.id,
        result: 'activation_required',
      },
    });
    return {
      status: 'activation_required' as const,
      emailMasked: maskEmail(identity.email),
      activationEmailSent: true,
    };
  }

  validateActivation(rawToken: string) {
    return this.validateToken(rawToken, 'initial_password_setup', true);
  }

  async completeActivation(
    rawToken: string,
    displayNameInput: string,
    password: string,
    passwordConfirmation: string,
    client: LoginRequestContext,
  ) {
    const displayName = displayNameInput.trim();
    if (!displayName)
      throw new BadRequestException('Display name is required.');

    const completed = await this.dataSource
      .transaction(async (manager) => {
        const token = await this.lockToken(
          manager,
          rawToken,
          'initial_password_setup',
        );
        const identity = await manager.findOne(PlatformAdminIdentityEntity, {
          where: { id: token.identityId },
          lock: { mode: 'pessimistic_write' },
        });
        const invitationValue = token.metadata.invitationId;
        const invitationId =
          typeof invitationValue === 'string' ? invitationValue : '';
        const invitation = invitationId
          ? await manager.findOne(PlatformAdminInvitationEntity, {
              where: { id: invitationId },
              lock: { mode: 'pessimistic_write' },
            })
          : null;
        if (
          !identity ||
          identity.status !== 'pending' ||
          !invitation ||
          invitation.status !== 'pending' ||
          invitation.normalizedEmail !== identity.normalizedEmail ||
          invitation.expiresAt.getTime() <= Date.now()
        ) {
          throw new UnauthorizedException('Activation token is invalid.');
        }
        this.assertPassword(
          identity.normalizedEmail,
          password,
          passwordConfirmation,
        );
        const now = new Date();
        identity.displayName = displayName;
        identity.passwordHash = await argon2.hash(password);
        identity.passwordConfiguredAt = now;
        identity.lastPasswordChangeAt = now;
        identity.emailVerifiedAt = now;
        identity.status = 'active';
        identity.failedLoginAttempts = 0;
        identity.lockedUntil = null;
        await manager.save(identity);

        let admin = await manager.findOne(PlatformInternalAdminEntity, {
          where: {
            identitySource: 'platform_admin',
            platformAdminIdentityId: identity.id,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!admin) {
          admin = manager.create(PlatformInternalAdminEntity, {
            identitySource: 'platform_admin',
            identityTenantId: null,
            userId: null,
            platformAdminIdentityId: identity.id,
            status: 'active',
            roleKey: invitation.roleKey,
            twoFactorRequired: true,
            createdBy: invitation.invitedByAdminId,
            updatedBy: null,
            metadata: {},
          });
        }
        admin.status = 'active';
        admin.roleKey = invitation.roleKey;
        admin.twoFactorRequired = true;
        await manager.save(admin);

        invitation.status = 'accepted';
        invitation.acceptedAt = now;
        invitation.acceptedByUserId = null;
        invitation.metadata = {
          ...invitation.metadata,
          acceptedIdentitySource: 'platform_admin',
          acceptedIdentityId: identity.id,
        };
        await manager.save(invitation);
        token.consumedAt = now;
        await manager.save(token);
        return { identity, invitation, admin };
      })
      .catch(async (error: unknown) => {
        await this.auditService.record({
          action: 'admin.identity.activation_failed',
          outcome: 'denied',
          ipAddress: client.ipAddress,
          userAgent: client.userAgent,
          metadata: {
            identitySource: 'platform_admin',
            reason: 'invalid_or_expired_activation',
            result: 'denied',
          },
        });
        throw error;
      });

    await this.auditService.record({
      actorAdminId: completed.admin.id,
      action: 'admin.identity.activated',
      targetType: 'platform_admin_identity',
      targetId: completed.identity.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: {
        identitySource: 'platform_admin',
        identityId: completed.identity.id,
        invitationId: completed.invitation.id,
        result: 'activated',
      },
    });
    return { activated: true, redirectTo: '/login' };
  }

  async requestPasswordReset(emailInput: string, client: LoginRequestContext) {
    const normalizedEmail = normalizeAdminEmail(emailInput);
    const candidates =
      await this.identityGateway.findCandidatesByEmail(normalizedEmail);
    if (candidates.length === 1 && candidates[0].source === 'platform_admin') {
      const verified = await this.identityRepository.findOne({
        where: { id: candidates[0].subjectId, status: 'active' },
      });
      if (verified?.emailVerifiedAt) {
        const token = await this.issueToken(
          verified,
          'password_reset',
          this.duration('ADMIN_PASSWORD_RESET_TTL', 30 * 60_000),
        );
        await this.sendActionEmail(
          verified.email,
          'Redefinição de senha do Lyra Admin',
          'Recebemos uma solicitação para redefinir sua senha administrativa.',
          'Redefinir senha',
          `/reset-password?token=${encodeURIComponent(token)}`,
          'Se você não solicitou a alteração, ignore esta mensagem.',
        );
        await this.auditRequested(
          'admin.identity.password_reset_requested',
          verified,
          client,
        );
      }
    } else if (
      candidates.length === 1 &&
      candidates[0].source === 'agency' &&
      candidates[0].status === 'active'
    ) {
      await this.sendAgencyRecoveryGuidance(candidates[0].email);
    } else if (candidates.length > 1) {
      await this.auditDenied('admin.identity.action_denied', client, null, {
        identitySource: 'ambiguous',
        reason: 'ambiguous_identity',
      });
    }
    return { message: GENERIC_REQUEST_MESSAGE };
  }

  validatePasswordReset(rawToken: string) {
    return this.validateToken(rawToken, 'password_reset');
  }

  async resetPassword(
    rawToken: string,
    password: string,
    passwordConfirmation: string,
    client: LoginRequestContext,
  ) {
    const identity = await this.consumeForPassword(
      rawToken,
      'password_reset',
      password,
      passwordConfirmation,
    );
    await this.auditCompleted(
      'admin.identity.password_reset_completed',
      identity,
      client,
    );
    await this.sendNotice(
      identity.email,
      'Senha do Lyra Admin alterada',
      'Sua senha administrativa foi alterada. Todas as sessões anteriores foram encerradas.',
    );
    return { reset: true, redirectTo: '/login' };
  }

  async requestTwoFactorRecovery(
    emailInput: string,
    client: LoginRequestContext,
  ) {
    const normalizedEmail = normalizeAdminEmail(emailInput);
    const candidates =
      await this.identityGateway.findCandidatesByEmail(normalizedEmail);
    if (candidates.length === 1 && candidates[0].source === 'platform_admin') {
      const identity = await this.identityRepository.findOne({
        where: { id: candidates[0].subjectId, status: 'active' },
      });
      if (identity?.emailVerifiedAt && identity.twoFactorEnabled) {
        const token = await this.issueToken(
          identity,
          'two_factor_recovery',
          this.duration('ADMIN_TWO_FACTOR_RECOVERY_TTL', 15 * 60_000),
        );
        await this.sendActionEmail(
          identity.email,
          'Recuperação do 2FA do Lyra Admin',
          'Use o link abaixo somente se você perdeu acesso ao método de verificação.',
          'Recuperar 2FA',
          `/recover-two-factor?token=${encodeURIComponent(token)}`,
          'O link expira rapidamente e pode ser usado uma única vez.',
        );
        await this.auditRequested(
          'admin.identity.two_factor_recovery_requested',
          identity,
          client,
        );
      }
    }
    return { message: GENERIC_REQUEST_MESSAGE };
  }

  validateTwoFactorRecovery(rawToken: string) {
    return this.validateToken(rawToken, 'two_factor_recovery');
  }

  async completeTwoFactorRecovery(
    rawToken: string,
    client: LoginRequestContext,
  ) {
    const identity = await this.consumeTokenWithIdentity(
      rawToken,
      'two_factor_recovery',
      (record) => {
        record.twoFactorEnabled = false;
        record.twoFactorMethod = null;
        record.twoFactorSecretEncrypted = null;
        record.twoFactorPendingSecretEncrypted = null;
      },
    );
    await this.auditCompleted(
      'admin.identity.two_factor_recovered',
      identity,
      client,
    );
    await this.sendNotice(
      identity.email,
      '2FA do Lyra Admin recuperado',
      'O método anterior foi removido. Um novo 2FA será obrigatório no próximo login.',
    );
    return {
      recovered: true,
      requiresTwoFactorSetup: true,
      redirectTo: '/login',
    };
  }

  private async consumeForPassword(
    rawToken: string,
    purpose: PlatformAdminIdentityTokenPurpose,
    password: string,
    confirmation: string,
  ) {
    return this.consumeTokenWithIdentity(
      rawToken,
      purpose,
      async (identity) => {
        this.assertPassword(identity.normalizedEmail, password, confirmation);
        identity.passwordHash = await argon2.hash(password);
        identity.passwordConfiguredAt ??= new Date();
        identity.lastPasswordChangeAt = new Date();
        identity.failedLoginAttempts = 0;
        identity.lockedUntil = null;
        if (identity.status === 'locked') identity.status = 'active';
      },
    );
  }

  private async consumeTokenWithIdentity(
    rawToken: string,
    purpose: PlatformAdminIdentityTokenPurpose,
    mutate: (identity: PlatformAdminIdentityEntity) => Promise<void> | void,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const token = await this.lockToken(manager, rawToken, purpose);
      const identity = await manager.findOne(PlatformAdminIdentityEntity, {
        where: { id: token.identityId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!identity || identity.status === 'disabled') {
        throw new UnauthorizedException('Recovery token is invalid.');
      }
      await mutate(identity);
      await manager.save(identity);
      await manager.update(
        PlatformAdminSessionEntity,
        {
          platformAdminIdentityId: identity.id,
          status: 'active',
        },
        { status: 'revoked', revokedAt: new Date() },
      );
      token.consumedAt = new Date();
      await manager.save(token);
      return identity;
    });
  }

  private async validateToken(
    rawToken: string,
    purpose: PlatformAdminIdentityTokenPurpose,
    activation = false,
  ) {
    const token = await this.findToken(rawToken, purpose);
    if (!token) return { valid: false };
    const identity = await this.identityRepository.findOne({
      where: { id: token.identityId },
    });
    if (!identity || (activation && identity.status !== 'pending')) {
      return { valid: false };
    }
    if (activation) {
      const invitationValue = token.metadata.invitationId;
      const invitationId =
        typeof invitationValue === 'string' ? invitationValue : '';
      const invitation = invitationId
        ? await this.dataSource
            .getRepository(PlatformAdminInvitationEntity)
            .findOne({ where: { id: invitationId } })
        : null;
      if (
        !invitation ||
        invitation.status !== 'pending' ||
        invitation.normalizedEmail !== identity.normalizedEmail ||
        invitation.expiresAt.getTime() <= Date.now()
      ) {
        return { valid: false };
      }
    }
    return {
      valid: true,
      emailMasked: maskEmail(identity.email),
      ...(activation ? { displayName: identity.displayName } : {}),
      expiresAt: token.expiresAt,
      ...(activation
        ? { requiresPasswordSetup: !identity.passwordConfiguredAt }
        : {}),
    };
  }

  private async issueToken(
    identity: PlatformAdminIdentityEntity,
    purpose: PlatformAdminIdentityTokenPurpose,
    ttlMs: number,
    metadata: Record<string, unknown> = {},
  ) {
    const rawToken = randomBytes(48).toString('base64url');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        PlatformAdminIdentityTokenEntity,
        {
          identityId: identity.id,
          purpose,
          consumedAt: IsNull(),
          revokedAt: IsNull(),
        },
        { revokedAt: new Date() },
      );
      await manager.save(
        manager.create(PlatformAdminIdentityTokenEntity, {
          identityId: identity.id,
          purpose,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + ttlMs),
          consumedAt: null,
          revokedAt: null,
          metadata,
        }),
      );
    });
    return rawToken;
  }

  private findToken(
    rawToken: string,
    purpose: PlatformAdminIdentityTokenPurpose,
  ) {
    return this.tokenRepository
      .createQueryBuilder('token')
      .addSelect('token.tokenHash')
      .where('token.tokenHash = :tokenHash', { tokenHash: hashToken(rawToken) })
      .andWhere('token.purpose = :purpose', { purpose })
      .andWhere('token.consumedAt IS NULL')
      .andWhere('token.revokedAt IS NULL')
      .andWhere('token.expiresAt > :now', { now: new Date() })
      .getOne();
  }

  private async lockToken(
    manager: DataSource['manager'],
    rawToken: string,
    purpose: PlatformAdminIdentityTokenPurpose,
  ) {
    const token = await manager
      .createQueryBuilder(PlatformAdminIdentityTokenEntity, 'token')
      .addSelect('token.tokenHash')
      .setLock('pessimistic_write')
      .where('token.tokenHash = :tokenHash', { tokenHash: hashToken(rawToken) })
      .andWhere('token.purpose = :purpose', { purpose })
      .andWhere('token.consumedAt IS NULL')
      .andWhere('token.revokedAt IS NULL')
      .andWhere('token.expiresAt > :now', { now: new Date() })
      .getOne();
    if (!token) throw new UnauthorizedException('Recovery token is invalid.');
    return token;
  }

  private assertPassword(
    email: string,
    password: string,
    confirmation: string,
  ) {
    if (password !== confirmation) {
      throw new BadRequestException('Password confirmation does not match.');
    }
    if (
      password.length < 12 ||
      password.length > 128 ||
      normalizeAdminEmail(password) === email
    ) {
      throw new BadRequestException(
        'Password does not meet the security policy.',
      );
    }
  }

  private duration(name: string, fallback: number) {
    const value = this.configService.get<string>(name);
    const match = value?.match(/^(\d+)(m|h|d)$/);
    if (!match) return fallback;
    const amount = Number(match[1]);
    return (
      amount *
      (match[2] === 'd' ? 86_400_000 : match[2] === 'h' ? 3_600_000 : 60_000)
    );
  }

  private async sendActionEmail(
    to: string,
    subject: string,
    intro: string,
    buttonLabel: string,
    path: string,
    footerText: string,
  ) {
    const url = `${this.adminWebUrl()}${path}`;
    const { html, text } = renderTransactionalEmail({
      title: subject,
      intro,
      buttonLabel,
      buttonUrl: url,
      footerText,
    });
    await this.emailService.sendEmail({ to, subject, html, text });
  }

  private async sendNotice(to: string, subject: string, intro: string) {
    const { html, text } = renderTransactionalEmail({ title: subject, intro });
    await this.emailService.sendEmail({ to, subject, html, text });
  }

  private async sendAgencyRecoveryGuidance(to: string) {
    const agencyUrl = (
      this.configService.get<string>('AGENCY_WEB_URL') ??
      'http://localhost:3001'
    ).replace(/\/$/, '');
    const { html, text } = renderTransactionalEmail({
      title: 'Recuperação da identidade Agency',
      intro:
        'Seu acesso administrativo usa uma identidade Agency. A senha não é copiada para o Lyra Admin.',
      buttonLabel: 'Usar recuperação Agency',
      buttonUrl: `${agencyUrl}/forgot-password`,
    });
    await this.emailService.sendEmail({
      to,
      subject: 'Instruções de recuperação de acesso',
      html,
      text,
    });
  }

  private adminWebUrl() {
    return (
      this.configService.get<string>('ADMIN_WEB_URL') ??
      this.configService.get<string>('ADMIN_FRONTEND_URL') ??
      'http://localhost:3004'
    ).replace(/\/$/, '');
  }

  private auditRequested(
    action: string,
    identity: PlatformAdminIdentityEntity,
    client: LoginRequestContext,
  ) {
    return this.auditService.record({
      action,
      targetType: 'platform_admin_identity',
      targetId: identity.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { identitySource: 'platform_admin', identityId: identity.id },
    });
  }

  private auditCompleted(
    action: string,
    identity: PlatformAdminIdentityEntity,
    client: LoginRequestContext,
  ) {
    return this.auditRequested(action, identity, client);
  }

  private auditDenied(
    action: string,
    client: LoginRequestContext,
    identity: PlatformAdminIdentityEntity | null,
    metadata: Record<string, unknown>,
  ) {
    return this.auditService.record({
      action,
      targetType: identity ? 'platform_admin_identity' : null,
      targetId: identity?.id ?? null,
      outcome: 'denied',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata,
    });
  }
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}
