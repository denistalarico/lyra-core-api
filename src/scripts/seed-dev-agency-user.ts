import 'reflect-metadata';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { agencyEntities } from '../config/typeorm.config';
import { AgencyClientAccessEntity } from '../modules/permissions/entities/agency-client-access.entity';
import {
  AgencyUserSecuritySettingsEntity,
} from '../modules/agency/entities/agency-auth.entities';
import {
  AgencyUserPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from '../modules/agency/entities/agency-settings.entities';

const DEV_CORE_DATABASE = 'lyra_core_dev';
const DEV_AGENCY_DATABASE = 'lyra_agency_dev';
const DEFAULT_DEV_EMAIL = 'social-dev@example.test';
const DEFAULT_DEV_PASSWORD = 'admin';

function loadLocalEnvFile() {
  const envPath = resolve(process.cwd(), '.env');

  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [key, ...valueParts] = trimmed.split('=');
    if (!process.env[key]) {
      process.env[key] = valueParts
        .join('=')
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertDevelopmentTarget() {
  const coreDatabase = process.env.DB_NAME;
  const agencyDatabase = process.env.AGENCY_DB_NAME;

  if (
    process.env.NODE_ENV !== 'development' ||
    coreDatabase !== DEV_CORE_DATABASE ||
    agencyDatabase !== DEV_AGENCY_DATABASE
  ) {
    throw new Error(
      'Refusing to seed outside the isolated development databases.',
    );
  }
}

async function run() {
  loadLocalEnvFile();
  assertDevelopmentTarget();

  const sourceEmail = requiredEnv('DEV_AGENCY_SOURCE_USER_EMAIL').toLowerCase();
  const devEmail = (
    process.env.DEV_AGENCY_USER_EMAIL?.trim() || DEFAULT_DEV_EMAIL
  ).toLowerCase();
  const devPassword =
    process.env.DEV_AGENCY_USER_PASSWORD || DEFAULT_DEV_PASSWORD;

  if (sourceEmail === devEmail) {
    throw new Error('DEV_AGENCY_SOURCE_USER_EMAIL must differ from the dev user email.');
  }

  if (!devEmail.endsWith('@example.test')) {
    throw new Error('DEV_AGENCY_USER_EMAIL must use the reserved @example.test domain.');
  }

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.AGENCY_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.AGENCY_DB_PORT ?? process.env.DB_PORT ?? 5433),
    username:
      process.env.AGENCY_DB_USERNAME ?? process.env.DB_USERNAME ?? 'lyra',
    password:
      process.env.AGENCY_DB_PASSWORD ??
      process.env.DB_PASSWORD ??
      'lyra_dev_password',
    database: DEV_AGENCY_DATABASE,
    synchronize: false,
    logging: false,
    entities: agencyEntities,
  });

  await dataSource.initialize();

  try {
    await dataSource.transaction(async (manager) => {
      const workspaceUsers = manager.getRepository(AgencyWorkspaceUserEntity);
      const security = manager.getRepository(AgencyUserSecuritySettingsEntity);
      const permissions = manager.getRepository(
        AgencyWorkspaceUserPermissionEntity,
      );
      const clientAccess = manager.getRepository(AgencyClientAccessEntity);
      const profiles = manager.getRepository(AgencyUserProfileEntity);
      const preferences = manager.getRepository(AgencyUserPreferencesEntity);

      const sourceMemberships = await workspaceUsers.find({
        where: { email: sourceEmail, status: 'active' },
        order: { updatedAt: 'DESC' },
      });

      if (sourceMemberships.length !== 1 || !sourceMemberships[0].userId) {
        throw new Error(
          'DEV_AGENCY_SOURCE_USER_EMAIL must identify exactly one active Agency workspace user.',
        );
      }

      const source = sourceMemberships[0];
      const existingMembership = await workspaceUsers.findOne({
        where: {
          tenantId: source.tenantId,
          workspaceId: source.workspaceId,
          email: devEmail,
        },
      });
      const existingSecurity = await security.findOne({
        where: { currentEmail: devEmail },
        order: { updatedAt: 'DESC' },
      });
      const devUserId =
        existingMembership?.userId ?? existingSecurity?.userId ?? randomUUID();

      if (!devUserId) {
        throw new Error('The existing dev user has no identity.');
      }

      if (
        existingMembership?.userId &&
        existingSecurity?.userId &&
        existingMembership.userId !== existingSecurity.userId
      ) {
        throw new Error('The existing dev identity is inconsistent.');
      }

      const passwordHash = await argon2.hash(devPassword);

      await security.save(
        security.create({
          id: existingSecurity?.id,
          tenantId: source.tenantId,
          userId: devUserId,
          currentEmail: devEmail,
          passwordHash,
          passwordUpdatedAt: new Date(),
          twoFactorEnabled: false,
          twoFactorMethod: 'authenticator',
          twoFactorSecretEncrypted: null,
          twoFactorPendingSecretEncrypted: null,
          loginAlertsEnabled: false,
          trustedDevicesEnabled: false,
        }),
      );

      const devMembership = await workspaceUsers.save(
        workspaceUsers.create({
          id: existingMembership?.id,
          tenantId: source.tenantId,
          workspaceId: source.workspaceId,
          userId: devUserId,
          name: 'Social Dev',
          email: devEmail,
          role: 'owner',
          status: 'active',
          lastAccess: '',
        }),
      );

      await permissions.delete({ workspaceUserId: devMembership.id });
      const sourcePermissions = await permissions.find({
        where: { workspaceUserId: source.id },
      });
      const appKeys = new Set([
        ...sourcePermissions.map((permission) => permission.appKey),
        'social',
      ]);
      if (appKeys.size > 0) {
        await permissions.save(
          [...appKeys].map((appKey) =>
            permissions.create({
              tenantId: source.tenantId,
              workspaceId: source.workspaceId,
              workspaceUserId: devMembership.id,
              appKey,
              access: 'full',
            }),
          ),
        );
      }

      const sourceClientAccess = await clientAccess.find({
        where: {
          tenantId: source.tenantId,
          workspaceId: source.workspaceId,
          userId: source.userId,
        },
      });
      await clientAccess.delete({
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        userId: devUserId,
      });
      if (sourceClientAccess.length > 0) {
        await clientAccess.save(
          sourceClientAccess.map((access) =>
            clientAccess.create({
              tenantId: source.tenantId,
              workspaceId: source.workspaceId,
              clientId: access.clientId,
              managedTenantId: access.managedTenantId,
              userId: devUserId,
              roleKey: access.roleKey,
              accessLevel: access.accessLevel,
              createdById: devUserId,
            }),
          ),
        );
      }

      const existingProfile = await profiles.findOne({
        where: { tenantId: source.tenantId, userId: devUserId },
      });
      await profiles.save(
        profiles.create({
          id: existingProfile?.id,
          tenantId: source.tenantId,
          userId: devUserId,
          displayName: 'Social Dev',
          email: devEmail,
          phone: null,
          whatsappPhone: null,
          whatsappSameAsPhone: true,
          jobTitle: 'Desenvolvimento',
          avatarUrl: null,
          avatarPath: null,
        }),
      );

      const existingPreferences = await preferences.findOne({
        where: { tenantId: source.tenantId, userId: devUserId },
      });
      await preferences.save(
        preferences.create({
          id: existingPreferences?.id,
          tenantId: source.tenantId,
          userId: devUserId,
          themePreference: 'system',
          locale: 'pt-BR',
          timezone: 'America/Sao_Paulo',
          dateFormat: 'dd/MM/yyyy',
          timeFormat: '24h',
          sidebarCollapsed: false,
        }),
      );
    });

    console.log(`Development Agency owner ready: ${devEmail}`);
    console.log('2FA is disabled and all permissions are granted. The password was not printed.');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error('Development Agency user seed failed:', error.message);
  process.exit(1);
});
