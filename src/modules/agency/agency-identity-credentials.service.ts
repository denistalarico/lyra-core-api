import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomInt } from 'crypto';
import { verify } from 'otplib';
import { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import {
  EmailService,
  type EmailTransportOverride,
} from '../email/email.service';
import { renderTransactionalEmail } from '../email/templates/transactional-email.template';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
  type AuthSurface,
} from './entities/agency-auth.entities';
import { AgencyWorkspaceEmailSettingsEntity } from './entities/agency-settings.entities';

const AGENCY_CONNECTION = 'agency';

export type TwoFactorMethod = 'email' | 'authenticator';

export type LoginEventType = 'login_success' | 'login_failed' | 'logout';

type LoginEventClient = {
  deviceName?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  location?: string | null;
};

/**
 * Credential primitives of a `lyra_agency.user_security_settings` identity,
 * shared by every surface that authenticates that identity (Agency today,
 * Client Area since CA1).
 *
 * Extracted from `AgencyAuthService` rather than copied so password hashing,
 * 2FA code verification and login auditing cannot drift between surfaces.
 * Nothing here decides *who may log in where* — membership rules
 * (`workspace_users` for Agency, `client_area_memberships` for Client Area)
 * stay in each surface's auth service.
 */
@Injectable()
export class AgencyIdentityCredentialsService {
  constructor(
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyEmailTwoFactorCodeEntity, AGENCY_CONNECTION)
    private readonly emailTwoFactorRepo: Repository<AgencyEmailTwoFactorCodeEntity>,
    @InjectRepository(AgencyUserLoginEventEntity, AGENCY_CONNECTION)
    private readonly loginEventsRepo: Repository<AgencyUserLoginEventEntity>,
    @InjectRepository(AgencyWorkspaceEmailSettingsEntity, AGENCY_CONNECTION)
    private readonly emailSettingsRepo: Repository<AgencyWorkspaceEmailSettingsEntity>,
    private readonly emailService: EmailService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async verifyPassword(
    security: AgencyUserSecuritySettingsEntity,
    password: string,
  ): Promise<boolean> {
    if (!security.passwordHash) {
      return false;
    }

    return argon2.verify(security.passwordHash, password).catch(() => false);
  }

  /** CA2 — the one place a new identity password is hashed (argon2). */
  hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  hasTwoFactorEnabled(security: AgencyUserSecuritySettingsEntity) {
    return (
      security.twoFactorEnabled || Boolean(security.twoFactorSecretEncrypted)
    );
  }

  getTwoFactorMethod(
    security: AgencyUserSecuritySettingsEntity,
  ): TwoFactorMethod {
    return security.twoFactorMethod === 'email' ? 'email' : 'authenticator';
  }

  async verifyTwoFactorCode(
    method: TwoFactorMethod,
    identity: { tenantId: string; userId: string },
    code: string,
  ) {
    if (method === 'email') {
      await this.verifyEmailTwoFactorCode(identity, code);
    } else {
      await this.verifyAuthenticatorCode(identity, code);
    }
  }

  async sendEmailTwoFactorCode(
    security: AgencyUserSecuritySettingsEntity,
    purpose: 'login' | 'setup',
    productName: string,
  ) {
    const code = String(randomInt(100000, 999999));

    await this.emailTwoFactorRepo.save(
      this.emailTwoFactorRepo.create({
        tenantId: security.tenantId,
        userId: security.userId,
        codeHash: this.hashToken(code),
        purpose,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      }),
    );

    const { html, text } = renderTransactionalEmail({
      title: 'Codigo de verificacao',
      intro: `Use este codigo para concluir seu acesso ao ${productName}.`,
      secondaryText: `<strong>Codigo:</strong> ${code}`,
      footerText:
        'Este codigo expira em 5 minutos. Se voce nao solicitou este acesso, ignore este e-mail.',
    });

    await this.emailService.sendEmail({
      to: security.currentEmail,
      subject: `Codigo de verificacao do ${productName}`,
      html,
      text,
      override: await this.getEmailTransportOverride(security.tenantId),
    });
  }

  async recordLoginEvent(
    tenantId: string,
    userId: string,
    eventType: LoginEventType,
    client: LoginEventClient,
    surface: AuthSurface = 'agency',
  ) {
    await this.loginEventsRepo.save(
      this.loginEventsRepo.create({
        tenantId,
        userId,
        eventType,
        surface,
        deviceName: client.deviceName ?? null,
        userAgent: client.userAgent ?? null,
        ipAddress: client.ipAddress ?? null,
        location: client.location ?? client.ipAddress ?? null,
      }),
    );
  }

  async getEmailTransportOverride(
    tenantId: string,
    workspaceId?: string,
  ): Promise<EmailTransportOverride | undefined> {
    const settings = await this.emailSettingsRepo.findOne({
      where: workspaceId ? { tenantId, workspaceId } : { tenantId },
      order: { updatedAt: 'DESC' },
    });

    if (
      !settings?.smtpHost ||
      !settings.smtpUser ||
      !settings.smtpPasswordEncrypted ||
      !settings.fromEmail
    ) {
      return undefined;
    }

    const smtpPassword = this.cryptoService.decrypt(
      settings.smtpPasswordEncrypted,
    );

    if (!smtpPassword) {
      return undefined;
    }

    return {
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort ?? 587,
      smtpSecure: settings.smtpSecure,
      smtpUser: settings.smtpUser,
      smtpPassword,
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
    };
  }

  hashToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private async verifyEmailTwoFactorCode(
    identity: { tenantId: string; userId: string },
    code: string,
  ) {
    const codeHash = this.hashToken(code.trim());
    const record = await this.emailTwoFactorRepo.findOne({
      where: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        purpose: 'login',
      },
      order: { createdAt: 'DESC' },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.codeHash !== codeHash
    ) {
      if (record) {
        record.attempts += 1;
        await this.emailTwoFactorRepo.save(record);
      }

      throw new UnauthorizedException('Invalid 2FA code');
    }

    record.usedAt = new Date();
    await this.emailTwoFactorRepo.save(record);
  }

  private async verifyAuthenticatorCode(
    identity: { tenantId: string; userId: string },
    code: string,
  ) {
    const security = await this.securityRepo.findOne({
      where: { tenantId: identity.tenantId, userId: identity.userId },
    });
    const secret = this.cryptoService.decrypt(
      security?.twoFactorSecretEncrypted,
    );

    if (!secret || !(await isValidAuthenticatorCode(code, secret))) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
  }
}

/**
 * otplib v13 `verify()` is async and resolves to `{ valid }`. The code this
 * was extracted from tested `!verify(...)` — a pending Promise is always
 * truthy, so any authenticator code was accepted at Agency login. Every other
 * call site in the API already awaits `.valid`; this one now does too, for
 * both surfaces. Malformed tokens make otplib throw, which is a rejection.
 */
async function isValidAuthenticatorCode(code: string, secret: string) {
  try {
    return (await verify({ token: code.trim(), secret })).valid;
  } catch {
    return false;
  }
}
