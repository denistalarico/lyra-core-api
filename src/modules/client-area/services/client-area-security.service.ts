import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { AgencyIdentityCredentialsService } from '../../agency/agency-identity-credentials.service';
import {
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
} from '../../agency/entities/agency-auth.entities';
import { assertClientAreaPasswordPolicy } from '../client-area-password.policy';
import type { ClientAreaIdentity } from '../client-area.types';
import type {
  ClientAreaChangePasswordDto,
  ClientAreaConfirmTwoFactorDto,
  ClientAreaPasswordProofDto,
  ClientAreaSetupTwoFactorDto,
} from '../dto/client-area-security.dto';
import { isLiveSession } from './client-area-session.service';

const surface = 'client_area' as const;

/** Identity-only facade: browser input never chooses tenant/user/surface. */
@Injectable()
export class ClientAreaSecurityService {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly credentials: AgencyIdentityCredentialsService,
  ) {}

  private scope(identity: ClientAreaIdentity) {
    return { tenantId: identity.tenantId, userId: identity.userId };
  }

  private async prove(
    identity: ClientAreaIdentity,
    dto: ClientAreaPasswordProofDto,
    requireFactor = true,
  ) {
    const row = await this.db
      .getRepository(AgencyUserSecuritySettingsEntity)
      .findOne({ where: this.scope(identity) });
    if (
      !row ||
      !(await this.credentials.verifyPassword(row, dto.currentPassword))
    )
      throw new UnauthorizedException('Invalid credentials.');
    if (requireFactor && this.credentials.hasTwoFactorEnabled(row))
      await this.credentials.verifyTwoFactorCode(
        this.credentials.getTwoFactorMethod(row),
        this.scope(identity),
        dto.code ?? '',
      );
    return row;
  }

  async get(identity: ClientAreaIdentity) {
    const row = await this.db
      .getRepository(AgencyUserSecuritySettingsEntity)
      .findOne({ where: this.scope(identity) });
    if (!row) throw new UnauthorizedException('Invalid identity.');
    return {
      twoFactorEnabled: this.credentials.hasTwoFactorEnabled(row),
      twoFactorMethod: this.credentials.getTwoFactorMethod(row),
      passwordUpdatedAt: row.passwordUpdatedAt?.toISOString() ?? null,
    };
  }

  async changePassword(
    identity: ClientAreaIdentity,
    dto: ClientAreaChangePasswordDto,
  ) {
    const before = await this.prove(identity, dto);
    const password = assertClientAreaPasswordPolicy({
      password: dto.password,
      confirmation: dto.passwordConfirmation,
      email: before.currentEmail,
    });
    const passwordHash = await this.credentials.hashPassword(password);
    await this.db.transaction(async (manager) => {
      const repo = manager.getRepository(AgencyUserSecuritySettingsEntity);
      const row = await repo.findOne({
        where: this.scope(identity),
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || row.passwordHash !== before.passwordHash)
        throw new UnauthorizedException('Credentials changed. Retry.');
      await repo.update(this.scope(identity), {
        passwordHash,
        passwordUpdatedAt: new Date(),
      });
      await manager.getRepository(AgencyUserSessionEntity).update(
        {
          ...this.scope(identity),
          surface,
          id: Not(identity.sessionId),
          revokedAt: IsNull(),
        },
        { status: 'expired', revokedAt: new Date() },
      );
    });
    return { success: true };
  }

  async sendEmailCode(
    identity: ClientAreaIdentity,
    dto: ClientAreaPasswordProofDto,
  ) {
    const row = await this.prove(identity, dto, false);
    if (
      !this.credentials.hasTwoFactorEnabled(row) ||
      this.credentials.getTwoFactorMethod(row) !== 'email'
    )
      throw new BadRequestException('Email 2FA is not enabled.');
    await this.credentials.sendEmailTwoFactorCode(
      row,
      'login',
      'Area do Cliente',
    );
    return { success: true };
  }

  async setupTwoFactor(
    identity: ClientAreaIdentity,
    dto: ClientAreaSetupTwoFactorDto,
  ) {
    const row = await this.prove(identity, dto);
    return this.credentials.beginTwoFactorSetup(
      row,
      dto.method,
      'Area do Cliente',
    );
  }

  async confirmTwoFactor(
    identity: ClientAreaIdentity,
    dto: ClientAreaConfirmTwoFactorDto,
  ) {
    await this.prove(identity, dto, false);
    await this.credentials.confirmTwoFactorSetup(
      this.scope(identity),
      dto.method,
      dto.code,
    );
    return this.get(identity);
  }

  async disableTwoFactor(
    identity: ClientAreaIdentity,
    dto: ClientAreaPasswordProofDto,
  ) {
    await this.prove(identity, dto);
    await this.db
      .getRepository(AgencyUserSecuritySettingsEntity)
      .update(this.scope(identity), {
        twoFactorEnabled: false,
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
      });
    return this.get(identity);
  }

  async sessions(identity: ClientAreaIdentity) {
    const rows = await this.db.getRepository(AgencyUserSessionEntity).find({
      where: { ...this.scope(identity), surface, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return {
      sessions: rows
        .filter((row) => isLiveSession(row, new Date()))
        .map((row) => ({
          id: row.id,
          current: row.id === identity.sessionId,
          deviceName: row.deviceName,
          location: row.location,
          lastSeen: row.lastSeen,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt?.toISOString() ?? null,
        })),
    };
  }

  async revokeSession(identity: ClientAreaIdentity, id: string) {
    const result = await this.db
      .getRepository(AgencyUserSessionEntity)
      .update(
        { ...this.scope(identity), surface, id, revokedAt: IsNull() },
        { status: 'expired', revokedAt: new Date() },
      );
    if (!result.affected) throw new NotFoundException('Session not found.');
    return { success: true };
  }

  async devices(identity: ClientAreaIdentity) {
    const session = await this.db
      .getRepository(AgencyUserSessionEntity)
      .findOne({
        where: { ...this.scope(identity), id: identity.sessionId, surface },
      });
    const rows = await this.db
      .getRepository(AgencyUserTrustedDeviceEntity)
      .find({
        where: { ...this.scope(identity), surface, revokedAt: IsNull() },
        order: { lastUsedAt: 'DESC', createdAt: 'DESC' },
        take: 100,
      });
    return {
      devices: rows.map((row) => ({
        id: row.id,
        current: Boolean(
          session?.deviceFingerprint &&
          session.deviceFingerprint === row.deviceFingerprint,
        ),
        deviceName: row.deviceName,
        location: row.location,
        trustedAt: row.trustedAt?.toISOString() ?? null,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })),
    };
  }

  async trustCurrentDevice(
    identity: ClientAreaIdentity,
    dto: ClientAreaPasswordProofDto,
  ) {
    await this.prove(identity, dto);
    await this.db.transaction(async (manager) => {
      const session = await manager
        .getRepository(AgencyUserSessionEntity)
        .findOne({
          where: { ...this.scope(identity), id: identity.sessionId, surface },
        });
      if (
        !session ||
        !isLiveSession(session, new Date()) ||
        !session.deviceFingerprint
      )
        throw new BadRequestException('Current device cannot be identified.');
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `client_area_device:${identity.tenantId}:${identity.userId}:${session.deviceFingerprint}`,
      ]);
      const repo = manager.getRepository(AgencyUserTrustedDeviceEntity);
      const where = {
        ...this.scope(identity),
        surface,
        deviceFingerprint: session.deviceFingerprint,
      };
      const existing = await repo.findOne({ where });
      await repo.save(
        repo.create({
          ...existing,
          ...where,
          deviceName: session.deviceName,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
          location: session.location,
          trustedAt: new Date(),
          lastUsedAt: new Date(),
          revokedAt: null,
        }),
      );
    });
    return this.devices(identity);
  }

  async revokeDevice(identity: ClientAreaIdentity, id: string) {
    const result = await this.db
      .getRepository(AgencyUserTrustedDeviceEntity)
      .update(
        { ...this.scope(identity), surface, id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    if (!result.affected) throw new NotFoundException('Device not found.');
    return { success: true };
  }

  async loginHistory(
    identity: ClientAreaIdentity,
    page: number,
    limit: number,
  ) {
    const [rows, total] = await this.db
      .getRepository(AgencyUserLoginEventEntity)
      .findAndCount({
        where: { ...this.scope(identity), surface },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });
    return {
      events: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        deviceName: row.deviceName,
        location: row.location,
        occurredAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }
}
