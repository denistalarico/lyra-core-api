import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt } from 'crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { In, IsNull, MoreThanOrEqual } from 'typeorm';
import { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import {
  ACCOUNT_LOCKOUT_LOOKBACK_MS,
  accountLockedUntil,
} from '../../common/security/account-lockout.policy';
import {
  EmailService,
  type EmailTransportOverride,
} from '../email/email.service';
import {
  renderTransactionalEmail,
  type TransactionalEmailBrand,
} from '../email/templates/transactional-email.template';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
  type AuthSurface,
} from './entities/agency-auth.entities';
import { AgencyWorkspaceEmailSettingsEntity } from './entities/agency-settings.entities';

const AGENCY_CONNECTION = 'agency';
const EMAIL_TWO_FACTOR_MAX_ATTEMPTS = 5;
const LOCKOUT_EVENTS_LIMIT = 500;

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
  private decoyPasswordHash?: Promise<string>;

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
      return this.verifyDecoyPassword(password);
    }

    return argon2.verify(security.passwordHash, password).catch(() => false);
  }

  /**
   * SEC-02 — spends one argon2 verification when there is no password to
   * check, so an unknown email costs about as much as a wrong password.
   */
  async verifyDecoyPassword(password: string): Promise<false> {
    this.decoyPasswordHash ??= argon2.hash(randomBytes(16).toString('hex'));
    await argon2
      .verify(await this.decoyPasswordHash, password)
      .catch(() => false);
    return false;
  }

  /**
   * SEC-02 — when the account lock of these identities ends (epoch ms), or
   * null. Rebuilt from the recorded `login_failed`/`login_success` events of
   * every surface, so it survives restarts.
   */
  async accountLockedUntil(
    identities: ReadonlyArray<{ tenantId: string; userId: string }>,
    now = Date.now(),
  ): Promise<number | null> {
    if (identities.length === 0) {
      return null;
    }

    const since = new Date(now - ACCOUNT_LOCKOUT_LOOKBACK_MS);
    const events = await this.loginEventsRepo.find({
      select: {
        tenantId: true,
        userId: true,
        eventType: true,
        createdAt: true,
      },
      where: identities.map(({ tenantId, userId }) => ({
        tenantId,
        userId,
        eventType: In(['login_failed', 'login_success']),
        createdAt: MoreThanOrEqual(since),
      })),
      order: { createdAt: 'DESC' },
      take: LOCKOUT_EVENTS_LIMIT,
    });

    let lockedUntil: number | null = null;
    for (const { tenantId, userId } of identities) {
      const until = accountLockedUntil(
        events
          .filter(
            (event) => event.tenantId === tenantId && event.userId === userId,
          )
          .map((event) => ({
            failed: event.eventType === 'login_failed',
            at: event.createdAt.getTime(),
          })),
        now,
      );
      if (until !== null && (lockedUntil === null || until > lockedUntil)) {
        lockedUntil = until;
      }
    }

    return lockedUntil;
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
    brand?: TransactionalEmailBrand,
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
      brand,
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

  /** CA14 — additive setup primitives; existing Agency flows are unchanged. */
  async beginTwoFactorSetup(
    security: AgencyUserSecuritySettingsEntity,
    method: TwoFactorMethod,
    issuer: string,
  ) {
    if (method === 'email') {
      await this.sendEmailTwoFactorCode(security, 'setup', issuer);
      return { method, email: security.currentEmail };
    }
    const secret = generateSecret();
    const otpauth = generateURI({
      issuer,
      label: security.currentEmail,
      secret,
    });
    await this.securityRepo.update(
      { tenantId: security.tenantId, userId: security.userId },
      {
        twoFactorPendingSecretEncrypted: this.cryptoService.encrypt(secret),
      },
    );
    return { method, otpauth, qrCodeDataUrl: await QRCode.toDataURL(otpauth) };
  }

  async confirmTwoFactorSetup(
    identity: { tenantId: string; userId: string },
    method: TwoFactorMethod,
    code: string,
  ) {
    await this.securityRepo.manager.transaction(async (manager) => {
      const security = manager.getRepository(AgencyUserSecuritySettingsEntity);
      const row = await security.findOne({
        where: identity,
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new UnauthorizedException('Invalid identity.');
      if (method === 'email') {
        const codes = manager.getRepository(AgencyEmailTwoFactorCodeEntity);
        const pending = await codes.findOne({
          where: { ...identity, purpose: 'setup' },
          order: { createdAt: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !pending ||
          pending.usedAt ||
          pending.attempts >= 5 ||
          pending.expiresAt.getTime() <= Date.now() ||
          pending.codeHash !== this.hashToken(code.trim())
        ) {
          throw new UnauthorizedException('Invalid 2FA code');
        }
        await codes.update(
          { id: pending.id, usedAt: IsNull() },
          { usedAt: new Date() },
        );
      } else {
        const secret = this.cryptoService.decrypt(
          row.twoFactorPendingSecretEncrypted,
        );
        if (!secret || !(await isValidAuthenticatorCode(code, secret)))
          throw new UnauthorizedException('Invalid 2FA code');
      }
      await security.update(identity, {
        twoFactorEnabled: true,
        twoFactorMethod: method,
        twoFactorSecretEncrypted:
          method === 'authenticator'
            ? row.twoFactorPendingSecretEncrypted
            : null,
        twoFactorPendingSecretEncrypted: null,
      });
    });
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

    // SEC-02 — `attempts` was counted but never enforced; a code dies after
    // EMAIL_TWO_FACTOR_MAX_ATTEMPTS wrong guesses and a new one must be sent.
    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.attempts >= EMAIL_TWO_FACTOR_MAX_ATTEMPTS ||
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
