import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientAreaAuthService } from './services/client-area-auth.service';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AddSurfaceToTrustedDevices1800200000000 } from '../../database/migrations/1800200000000-add-surface-to-trusted-devices';
import { AgencyIdentityCredentialsService } from '../agency/agency-identity-credentials.service';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
} from '../agency/entities/agency-auth.entities';
import type { AgencyWorkspaceEmailSettingsEntity } from '../agency/entities/agency-settings.entities';
import type { EmailService } from '../email/email.service';
import type { Repository } from 'typeorm';
import { ClientAreaSecurityService } from './services/client-area-security.service';

jest.mock('otplib', () => ({
  generateSecret: () => 'SECRET',
  generateURI: () => 'otpauth://totp/Client?secret=SECRET',
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '123456' }),
  ),
}));

describePostgresIntegration()('CA14 security (lyra_agency_test only)', () => {
  let admin: DataSource,
    db: DataSource,
    service: ClientAreaSecurityService,
    credentials: AgencyIdentityCredentialsService;
  const schema = `ca14_${randomUUID().replaceAll('-', '')}`;
  const identity = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    email: 'client@example.test',
  };
  const other = { ...identity, userId: randomUUID(), sessionId: randomUUID() };
  const migration = new AddSurfaceToTrustedDevices1800200000000();
  beforeAll(async () => {
    if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
      throw new Error('CA14 requires lyra_agency_test');
    const config = getAgencyTypeOrmConfig();
    admin = await new DataSource({
      ...config,
      entities: [],
      migrations: [],
      migrationsRun: false,
      synchronize: false,
    } as DataSourceOptions).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      ...config,
      schema,
      entities: [
        AgencyUserSecuritySettingsEntity,
        AgencyUserSessionEntity,
        AgencyUserTrustedDeviceEntity,
        AgencyUserLoginEventEntity,
        AgencyEmailTwoFactorCodeEntity,
      ],
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    } as DataSourceOptions).initialize();
    await db.synchronize();
    credentials = new AgencyIdentityCredentialsService(
      db.getRepository(AgencyUserSecuritySettingsEntity),
      db.getRepository(AgencyEmailTwoFactorCodeEntity),
      db.getRepository(AgencyUserLoginEventEntity),
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<AgencyWorkspaceEmailSettingsEntity>,
      {
        sendEmail: jest.fn().mockResolvedValue(undefined),
      } as unknown as EmailService,
      new SettingsCryptoService(),
    );
    service = new ClientAreaSecurityService(db, credentials);
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  beforeEach(async () => {
    for (const entity of [
      AgencyUserSessionEntity,
      AgencyUserTrustedDeviceEntity,
      AgencyEmailTwoFactorCodeEntity,
      AgencyUserLoginEventEntity,
      AgencyUserSecuritySettingsEntity,
    ])
      await db.getRepository(entity).clear();
    await db.getRepository(AgencyUserSecuritySettingsEntity).save({
      tenantId: identity.tenantId,
      userId: identity.userId,
      currentEmail: identity.email,
      passwordHash: await credentials.hashPassword('old-password-valid'),
    });
  });
  const session = (
    id: string,
    userId = identity.userId,
    surface: 'agency' | 'client_area' = 'client_area',
  ) => ({
    id,
    tenantId: identity.tenantId,
    userId,
    surface,
    title: 'Session',
    browser: 'Browser',
    status: 'active' as const,
    deviceFingerprint: 'browser',
    expiresAt: new Date(Date.now() + 60000),
  });

  it('migration defaults legacy rows to agency and down never promotes client devices', async () => {
    const q = db.createQueryRunner();
    await q.connect();
    try {
      await q.query('ALTER TABLE user_trusted_devices DROP COLUMN surface');
      await q.query(
        'INSERT INTO user_trusted_devices(tenant_id,user_id) VALUES ($1,$2)',
        [identity.tenantId, identity.userId],
      );
      await migration.up(q);
      expect(await q.query('SELECT surface FROM user_trusted_devices')).toEqual(
        [{ surface: 'agency' }],
      );
      await expect(
        q.query(
          "INSERT INTO user_trusted_devices(tenant_id,user_id,surface) VALUES ($1,$2,'foreign')",
          [identity.tenantId, identity.userId],
        ),
      ).rejects.toThrow();
      await q.query(
        "INSERT INTO user_trusted_devices(tenant_id,user_id,surface) VALUES ($1,$2,'client_area')",
        [identity.tenantId, identity.userId],
      );
      await migration.down(q);
      expect(
        await q.query('SELECT count(*)::int AS n FROM user_trusted_devices'),
      ).toEqual([{ n: 1 }]);
      await migration.up(q);
    } finally {
      await q.release();
    }
  });

  it('password proof, policy and change preserve current, Agency and foreign sessions', async () => {
    const otherClient = randomUUID(),
      agency = randomUUID();
    await db
      .getRepository(AgencyUserSessionEntity)
      .save([
        session(identity.sessionId),
        session(otherClient),
        session(agency, identity.userId, 'agency'),
        session(other.sessionId, other.userId),
      ]);
    await expect(
      service.changePassword(identity, {
        currentPassword: 'wrong',
        password: 'new-password-valid',
        passwordConfirmation: 'new-password-valid',
      }),
    ).rejects.toThrow('Invalid credentials');
    await expect(
      service.changePassword(identity, {
        currentPassword: 'old-password-valid',
        password: 'short',
        passwordConfirmation: 'short',
      }),
    ).rejects.toThrow();
    await service.changePassword(identity, {
      currentPassword: 'old-password-valid',
      password: 'new-password-valid',
      passwordConfirmation: 'new-password-valid',
    });
    const rows = await db.getRepository(AgencyUserSessionEntity).find();
    expect(rows.filter((row) => row.revokedAt).map((row) => row.id)).toEqual([
      otherClient,
    ]);
    const row = await db
      .getRepository(AgencyUserSecuritySettingsEntity)
      .findOneByOrFail({ userId: identity.userId });
    expect(await credentials.verifyPassword(row, 'new-password-valid')).toBe(
      true,
    );
  });

  it('foreign identities and Agency sessions cannot be listed or revoked', async () => {
    const agency = randomUUID();
    await db
      .getRepository(AgencyUserSessionEntity)
      .save([
        session(identity.sessionId),
        session(agency, identity.userId, 'agency'),
        session(other.sessionId, other.userId),
      ]);
    expect(
      (await service.sessions(identity)).sessions.map((row) => row.id),
    ).toEqual([identity.sessionId]);
    await expect(
      service.revokeSession(identity, other.sessionId),
    ).rejects.toThrow('Session not found');
    await expect(service.revokeSession(identity, agency)).rejects.toThrow(
      'Session not found',
    );
    await service.revokeSession(identity, identity.sessionId);
    expect((await service.sessions(identity)).sessions).toEqual([]);
  });

  it('trusted devices are separate by identity and surface, including the same fingerprint', async () => {
    await db
      .getRepository(AgencyUserSessionEntity)
      .save(session(identity.sessionId));
    const agency = await db.getRepository(AgencyUserTrustedDeviceEntity).save({
      tenantId: identity.tenantId,
      userId: identity.userId,
      surface: 'agency',
      deviceFingerprint: 'browser',
    });
    const foreign = await db.getRepository(AgencyUserTrustedDeviceEntity).save({
      tenantId: identity.tenantId,
      userId: other.userId,
      surface: 'client_area',
      deviceFingerprint: 'browser',
    });
    const result = await service.trustCurrentDevice(identity, {
      currentPassword: 'old-password-valid',
    });
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].id).not.toBe(agency.id);
    await expect(service.revokeDevice(identity, agency.id)).rejects.toThrow(
      'Device not found',
    );
    await expect(service.revokeDevice(identity, foreign.id)).rejects.toThrow(
      'Device not found',
    );
    await service.revokeDevice(identity, result.devices[0].id);
    expect((await service.devices(identity)).devices).toEqual([]);
  });

  it('a verified Client Area login updates only Client Area trusted-device activity', async () => {
    const oldDate = new Date('2020-01-01T00:00:00Z');
    const repo = db.getRepository(AgencyUserTrustedDeviceEntity);
    const device = await repo.save({
      tenantId: identity.tenantId,
      userId: identity.userId,
      surface: 'client_area',
      deviceFingerprint: 'browser',
      trustedAt: oldDate,
      lastUsedAt: oldDate,
    });
    const agency = await repo.save({
      tenantId: identity.tenantId,
      userId: identity.userId,
      surface: 'agency',
      deviceFingerprint: 'browser',
      trustedAt: oldDate,
      lastUsedAt: oldDate,
    });
    const security = await db
      .getRepository(AgencyUserSecuritySettingsEntity)
      .findOneByOrFail({ userId: identity.userId });
    const auth = new ClientAreaAuthService(
      db.getRepository(AgencyUserSecuritySettingsEntity),
      db.getRepository(AgencyUserSessionEntity),
      {} as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      credentials,
      {} as never,
      new JwtService(),
      new ConfigService({
        CLIENT_AREA_ENABLED: 'true',
        JWT_CLIENT_AREA_ACCESS_SECRET:
          'ca14-trusted-login-012345678901234567890123',
      }),
      {} as never,
      repo,
    );
    await auth.createAuthenticatedSession(security, {
      deviceFingerprint: 'browser',
      deviceName: 'Browser',
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      acceptLanguage: 'pt-BR',
      location: null,
    });
    expect(
      (await repo.findOneByOrFail({ id: device.id })).lastUsedAt!.getTime(),
    ).toBeGreaterThan(oldDate.getTime());
    expect((await repo.findOneByOrFail({ id: agency.id })).lastUsedAt).toEqual(
      oldDate,
    );
  });

  it('awaits authenticator verification, rejects wrong code and consumes pending setup once', async () => {
    await service.setupTwoFactor(identity, {
      currentPassword: 'old-password-valid',
      method: 'authenticator',
    });
    await expect(
      service.confirmTwoFactor(identity, {
        currentPassword: 'old-password-valid',
        method: 'authenticator',
        code: '000000',
      }),
    ).rejects.toThrow('Invalid 2FA code');
    expect((await service.get(identity)).twoFactorEnabled).toBe(false);
    await service.confirmTwoFactor(identity, {
      currentPassword: 'old-password-valid',
      method: 'authenticator',
      code: '123456',
    });
    expect((await service.get(identity)).twoFactorEnabled).toBe(true);
    await expect(
      service.confirmTwoFactor(identity, {
        currentPassword: 'old-password-valid',
        method: 'authenticator',
        code: '123456',
      }),
    ).rejects.toThrow();
    await expect(
      service.disableTwoFactor(identity, {
        currentPassword: 'old-password-valid',
        code: '000000',
      }),
    ).rejects.toThrow();
    await service.disableTwoFactor(identity, {
      currentPassword: 'old-password-valid',
      code: '123456',
    });
    expect((await service.get(identity)).twoFactorEnabled).toBe(false);
  });

  it('sends a fresh email proof only after password verification and consumes it for security actions', async () => {
    await expect(
      service.sendEmailCode(identity, {
        currentPassword: 'old-password-valid',
      }),
    ).rejects.toThrow('Email 2FA is not enabled.');
    await db
      .getRepository(AgencyUserSecuritySettingsEntity)
      .update(
        { userId: identity.userId },
        { twoFactorEnabled: true, twoFactorMethod: 'email' },
      );
    await expect(
      service.sendEmailCode(identity, {
        currentPassword: 'wrong',
      }),
    ).rejects.toThrow('Invalid credentials.');
    const codes = db.getRepository(AgencyEmailTwoFactorCodeEntity);
    expect(await codes.count()).toBe(0);
    await service.sendEmailCode(identity, {
      currentPassword: 'old-password-valid',
    });
    const code = await codes.findOneByOrFail({ userId: identity.userId });
    expect(code.purpose).toBe('login');
    expect(code.codeHash).toMatch(/^[a-f0-9]{64}$/);
    await codes.update(code.id, { codeHash: credentials.hashToken('123456') });
    await service.disableTwoFactor(identity, {
      currentPassword: 'old-password-valid',
      code: '123456',
    });
    expect((await service.get(identity)).twoFactorEnabled).toBe(false);
    expect(
      (await codes.findOneByOrFail({ id: code.id })).usedAt,
    ).not.toBeNull();
  });

  it('email setup rejects invalid, expired and replayed codes', async () => {
    await service.setupTwoFactor(identity, {
      currentPassword: 'old-password-valid',
      method: 'email',
    });
    const repo = db.getRepository(AgencyEmailTwoFactorCodeEntity);
    const row = await repo.findOneByOrFail({ userId: identity.userId });
    await repo.update(row.id, { codeHash: credentials.hashToken('123456') });
    await expect(
      service.confirmTwoFactor(identity, {
        currentPassword: 'old-password-valid',
        method: 'email',
        code: '000000',
      }),
    ).rejects.toThrow();
    await repo.update(row.id, { expiresAt: new Date(Date.now() - 1000) });
    await expect(
      service.confirmTwoFactor(identity, {
        currentPassword: 'old-password-valid',
        method: 'email',
        code: '123456',
      }),
    ).rejects.toThrow();
    await repo.update(row.id, { expiresAt: new Date(Date.now() + 60000) });
    await service.confirmTwoFactor(identity, {
      currentPassword: 'old-password-valid',
      method: 'email',
      code: '123456',
    });
    await expect(
      service.confirmTwoFactor(identity, {
        currentPassword: 'old-password-valid',
        method: 'email',
        code: '123456',
      }),
    ).rejects.toThrow();
  });
});
