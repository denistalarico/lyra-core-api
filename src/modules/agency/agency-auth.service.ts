import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt } from 'crypto';
import type { Request } from 'express';
import { verify } from 'otplib';
import { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { EmailService } from '../email/email.service';
import { renderTransactionalEmail } from '../email/templates/transactional-email.template';
import { LoginDto } from '../auth/dto/login.dto';
import { RefreshTokenDto } from '../auth/dto/refresh-token.dto';
import type { AuthTokenPayload } from '../auth/types/auth-token-payload.type';
import {
  extractLoginContext,
  type LoginRequestContext,
} from '../auth/utils/login-context.util';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyPasswordResetEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
} from './entities/agency-auth.entities';
import {
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from './entities/agency-settings.entities';

const AGENCY_CONNECTION = 'agency';

type AgencyLoginContext = {
  security: AgencyUserSecuritySettingsEntity;
  workspaceUser: AgencyWorkspaceUserEntity;
};

type TwoFactorMethod = 'email' | 'authenticator';

type AgencyTwoFactorTokenPayload = {
  sub: string;
  tenantId: string;
  type: 'agency-2fa';
  method: TwoFactorMethod;
};

@Injectable()
export class AgencyAuthService {
  constructor(
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepo: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyWorkspaceUserPermissionEntity, AGENCY_CONNECTION)
    private readonly permissionsRepo: Repository<AgencyWorkspaceUserPermissionEntity>,
    @InjectRepository(AgencyUserSessionEntity, AGENCY_CONNECTION)
    private readonly sessionsRepo: Repository<AgencyUserSessionEntity>,
    @InjectRepository(AgencyPasswordResetEntity, AGENCY_CONNECTION)
    private readonly passwordResetRepo: Repository<AgencyPasswordResetEntity>,
    @InjectRepository(AgencyEmailTwoFactorCodeEntity, AGENCY_CONNECTION)
    private readonly emailTwoFactorRepo: Repository<AgencyEmailTwoFactorCodeEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async login(dto: LoginDto, req: Request) {
    const email = dto.email.trim().toLowerCase();
    const loginContext = await this.findLoginContext(email, dto.password);

    if (!loginContext) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.hasTwoFactorEnabled(loginContext.security)) {
      return this.createTwoFactorChallenge(loginContext.security);
    }

    return this.createAuthenticatedSession(
      loginContext,
      extractLoginContext(req),
    );
  }

  async refresh(dto: RefreshTokenDto) {
    const session = await this.sessionsRepo.findOne({
      where: { sessionTokenHash: this.hashToken(dto.refreshToken) },
    });

    if (!session || session.revokedAt || session.status === 'expired') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
      await this.sessionsRepo.update(session.id, {
        status: 'expired',
        revokedAt: new Date(),
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    const security = await this.securityRepo.findOne({
      where: { tenantId: session.tenantId, userId: session.userId },
    });
    const workspaceUser = security
      ? await this.findActiveWorkspaceUser(security)
      : null;

    if (!security || !workspaceUser) {
      throw new UnauthorizedException('Invalid session context');
    }

    const payload = this.buildTokenPayload(security, workspaceUser, session.id);

    return {
      accessToken: await this.signAccessToken(payload),
      user: await this.buildUserResponse(payload),
    };
  }

  async logout(refreshToken: string) {
    await this.sessionsRepo.update(
      { sessionTokenHash: this.hashToken(refreshToken) },
      { status: 'expired', revokedAt: new Date() },
    );

    return { success: true };
  }

  async forgotPassword(email: string) {
    const security = await this.findSecurityForPasswordReset(
      email.trim().toLowerCase(),
    );

    if (security?.currentEmail) {
      await this.sendPasswordResetEmail(security);
    }

    return { success: true };
  }

  async resetPassword(token: string, password: string) {
    const resetRequest = await this.passwordResetRepo.findOne({
      where: { tokenHash: this.hashToken(token) },
      order: { createdAt: 'DESC' },
    });

    if (
      !resetRequest ||
      resetRequest.usedAt ||
      resetRequest.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const security = await this.securityRepo.findOne({
      where: {
        tenantId: resetRequest.tenantId,
        userId: resetRequest.userId,
      },
    });

    if (!security) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    security.passwordHash = await argon2.hash(password);
    security.passwordUpdatedAt = new Date();
    resetRequest.usedAt = new Date();

    await this.securityRepo.save(security);
    await this.passwordResetRepo.save(resetRequest);
    await this.sessionsRepo.update(
      { tenantId: security.tenantId, userId: security.userId },
      { status: 'expired', revokedAt: new Date() },
    );

    return { success: true };
  }

  async loginWith2FA(token: string, code: string, req: Request) {
    const payload = await this.verifyTwoFactorToken(token);

    if (payload.method === 'email') {
      await this.verifyEmailTwoFactorCode(payload, code);
    } else {
      await this.verifyAuthenticatorCode(payload, code);
    }

    const security = await this.securityRepo.findOne({
      where: { tenantId: payload.tenantId, userId: payload.sub },
    });
    const workspaceUser = security
      ? await this.findActiveWorkspaceUser(security)
      : null;

    if (!security || !workspaceUser) {
      throw new UnauthorizedException('Invalid 2FA context');
    }

    return this.createAuthenticatedSession(
      { security, workspaceUser },
      extractLoginContext(req),
    );
  }

  async sendTwoFactorEmail(token: string) {
    const payload = await this.verifyTwoFactorToken(token);

    if (payload.method !== 'email') {
      throw new UnauthorizedException('Invalid 2FA method');
    }

    const security = await this.securityRepo.findOne({
      where: { tenantId: payload.tenantId, userId: payload.sub },
    });

    if (!security) {
      throw new UnauthorizedException('Invalid 2FA context');
    }

    await this.sendEmailTwoFactorCode(security, 'login');

    return { success: true };
  }

  async getAuthenticatedUser(payload: AuthTokenPayload) {
    return { user: await this.buildUserResponse(payload) };
  }

  private async findLoginContext(email: string, password: string) {
    const securityRecords = await this.securityRepo.find({
      where: { currentEmail: email },
      order: { updatedAt: 'DESC' },
    });

    for (const security of securityRecords) {
      if (!security.passwordHash) {
        continue;
      }

      const isValidPassword = await argon2
        .verify(security.passwordHash, password)
        .catch(() => false);

      if (!isValidPassword) {
        continue;
      }

      const workspaceUser = await this.findActiveWorkspaceUser(security);

      if (workspaceUser) {
        return { security, workspaceUser };
      }
    }

    return null;
  }

  private async findSecurityForPasswordReset(email: string) {
    const securityRecords = await this.securityRepo.find({
      where: { currentEmail: email },
      order: { updatedAt: 'DESC' },
    });

    for (const security of securityRecords) {
      if (await this.findActiveWorkspaceUser(security)) {
        return security;
      }
    }

    return null;
  }

  private findActiveWorkspaceUser(security: AgencyUserSecuritySettingsEntity) {
    return this.workspaceUsersRepo.findOne({
      where: {
        tenantId: security.tenantId,
        userId: security.userId,
        status: 'active',
      },
      order: { updatedAt: 'DESC' },
    });
  }

  private hasTwoFactorEnabled(security: AgencyUserSecuritySettingsEntity) {
    return (
      security.twoFactorEnabled || Boolean(security.twoFactorSecretEncrypted)
    );
  }

  private getTwoFactorMethod(
    security: AgencyUserSecuritySettingsEntity,
  ): TwoFactorMethod {
    return security.twoFactorMethod === 'email' ? 'email' : 'authenticator';
  }

  private async createTwoFactorChallenge(
    security: AgencyUserSecuritySettingsEntity,
  ) {
    const method = this.getTwoFactorMethod(security);

    if (method === 'email') {
      await this.sendEmailTwoFactorCode(security, 'login');
    }

    return {
      requiresTwoFactor: true,
      method,
      tempToken: await this.jwtService.signAsync<AgencyTwoFactorTokenPayload>(
        {
          sub: security.userId,
          tenantId: security.tenantId,
          type: 'agency-2fa',
          method,
        },
        { secret: this.getTwoFactorTokenSecret(), expiresIn: '5m' },
      ),
    };
  }

  private async createAuthenticatedSession(
    loginContext: AgencyLoginContext,
    client: LoginRequestContext,
  ) {
    const { security, workspaceUser } = loginContext;
    const refreshToken = randomBytes(48).toString('hex');
    const refreshTokenHash = this.hashToken(refreshToken);

    await this.sessionsRepo.update(
      {
        tenantId: security.tenantId,
        userId: security.userId,
        status: 'current',
      },
      { status: 'active' },
    );

    const session = await this.sessionsRepo.save(
      this.sessionsRepo.create({
        tenantId: security.tenantId,
        userId: security.userId,
        sessionTokenHash: refreshTokenHash,
        title: 'Sessao atual',
        browser: client.deviceName,
        userAgent: client.userAgent,
        ipAddress: client.ipAddress,
        deviceFingerprint: client.deviceFingerprint,
        deviceName: client.deviceName,
        location: client.location ?? client.ipAddress,
        lastSeen: new Date().toISOString(),
        status: 'current',
        expiresAt: this.getRefreshExpirationDate(),
        revokedAt: null,
      }),
    );

    const payload = this.buildTokenPayload(security, workspaceUser, session.id);

    if (security.loginAlertsEnabled) {
      await this.sendNewLoginAlert(security, client);
    }

    return {
      accessToken: await this.signAccessToken(payload),
      refreshToken,
      user: await this.buildUserResponse(payload),
      securityContext: {
        isTrustedDevice: false,
        isNewDevice: Boolean(client.deviceFingerprint),
        isSuspiciousLogin: false,
      },
    };
  }

  private buildTokenPayload(
    security: AgencyUserSecuritySettingsEntity,
    workspaceUser: AgencyWorkspaceUserEntity,
    sessionId: string,
  ): AuthTokenPayload {
    return {
      sub: security.userId,
      tenantId: security.tenantId,
      workspaceId: workspaceUser.workspaceId,
      role: workspaceUser.role,
      sessionId,
      email: security.currentEmail,
    };
  }

  private async buildUserResponse(payload: AuthTokenPayload) {
    const workspaceUser = await this.workspaceUsersRepo.findOne({
      where: {
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        userId: payload.sub,
      },
    });
    const permissions = workspaceUser
      ? await this.permissionsRepo.find({
          where: {
            tenantId: payload.tenantId,
            workspaceId: payload.workspaceId,
            workspaceUserId: workspaceUser.id,
          },
          order: { appKey: 'ASC' },
        })
      : [];

    return {
      id: payload.sub,
      name: workspaceUser?.name ?? payload.email,
      email: workspaceUser?.email ?? payload.email,
      role: workspaceUser?.role ?? payload.role,
      tenantId: payload.tenantId,
      workspaceId: payload.workspaceId,
      allowedApps: permissions
        .filter((permission) => permission.access !== 'blocked')
        .map((permission) => ({
          appKey: permission.appKey,
          access: permission.access,
        })),
    };
  }

  private async verifyTwoFactorToken(token: string) {
    try {
      const payload =
        await this.jwtService.verifyAsync<AgencyTwoFactorTokenPayload>(token, {
          secret: this.getTwoFactorTokenSecret(),
        });

      if (payload.type !== 'agency-2fa') {
        throw new UnauthorizedException('Invalid 2FA token');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid 2FA token');
    }
  }

  private async verifyEmailTwoFactorCode(
    payload: AgencyTwoFactorTokenPayload,
    code: string,
  ) {
    const codeHash = this.hashToken(code.trim());
    const record = await this.emailTwoFactorRepo.findOne({
      where: {
        tenantId: payload.tenantId,
        userId: payload.sub,
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
    payload: AgencyTwoFactorTokenPayload,
    code: string,
  ) {
    const security = await this.securityRepo.findOne({
      where: { tenantId: payload.tenantId, userId: payload.sub },
    });
    const secret = this.cryptoService.decrypt(
      security?.twoFactorSecretEncrypted,
    );

    if (!secret || !verify({ token: code.trim(), secret })) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
  }

  private async sendEmailTwoFactorCode(
    security: AgencyUserSecuritySettingsEntity,
    purpose: 'login' | 'setup',
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
      intro: `Use este codigo para concluir seu acesso ao ${this.getProductName()}.`,
      secondaryText: `<strong>Codigo:</strong> ${code}`,
      footerText:
        'Este codigo expira em 5 minutos. Se voce nao solicitou este acesso, ignore este e-mail.',
    });

    await this.emailService.sendEmail({
      to: security.currentEmail,
      subject: `Codigo de verificacao do ${this.getProductName()}`,
      html,
      text,
    });
  }

  private async sendPasswordResetEmail(
    security: AgencyUserSecuritySettingsEntity,
  ) {
    const token = randomBytes(32).toString('hex');

    await this.passwordResetRepo.save(
      this.passwordResetRepo.create({
        tenantId: security.tenantId,
        userId: security.userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      }),
    );

    const resetUrl = `${this.getFrontendUrl()}/reset-password?token=${token}`;

    const { html, text } = renderTransactionalEmail({
      title: 'Recuperacao de senha',
      intro: 'Recebemos uma solicitacao para redefinir sua senha.',
      buttonLabel: 'Redefinir senha',
      buttonUrl: resetUrl,
    });

    await this.emailService.sendEmail({
      to: security.currentEmail,
      subject: `Recuperacao de senha do ${this.getProductName()}`,
      html,
      text,
    });
  }

  private async sendNewLoginAlert(
    security: AgencyUserSecuritySettingsEntity,
    client: LoginRequestContext,
  ) {
    const { html, text } = renderTransactionalEmail({
      title: 'Novo login detectado',
      intro: `Detectamos um acesso em ${client.deviceName} usando o IP ${client.ipAddress}.`,
      buttonLabel: `Abrir ${this.getProductName()}`,
      buttonUrl: this.getFrontendUrl(),
    });

    await this.emailService.sendEmail({
      to: security.currentEmail,
      subject: `Novo login no ${this.getProductName()}`,
      html,
      text,
    });
  }

  private async signAccessToken(payload: AuthTokenPayload) {
    return this.jwtService.signAsync(payload, {
      secret: this.getAccessTokenSecret(),
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
        '15m') as never,
    });
  }

  private getRefreshExpirationDate() {
    const days =
      this.configService
        .get<string>('JWT_REFRESH_EXPIRES_IN')
        ?.match(/^(\d+)d$/)?.[1] ?? '7';
    const date = new Date();
    date.setDate(date.getDate() + Number(days));
    return date;
  }

  private getFrontendUrl() {
    return (
      this.configService.get<string>('AGENCY_FRONTEND_URL') ??
      'http://localhost:3003'
    );
  }

  private getProductName() {
    return (
      this.configService.get<string>('AGENCY_PRODUCT_NAME') ?? 'Lyra Agency'
    );
  }

  private getAccessTokenSecret() {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    return secret;
  }

  private getTwoFactorTokenSecret() {
    return (
      this.configService.get<string>('JWT_2FA_SECRET') ??
      this.getAccessTokenSecret()
    );
  }

  private hashToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
