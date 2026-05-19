import 'reflect-metadata';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { DataSource, Repository } from 'typeorm';
import { agencyEntities } from '../config/typeorm.config';
import { AgencyUserSecuritySettingsEntity } from '../modules/agency/entities/agency-auth.entities';
import {
  AgencyUserPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from '../modules/agency/entities/agency-settings.entities';

const AGENCY_APP_KEYS = [
  'dashboard',
  'messages',
  'projects',
  'tasks',
  'calendar',
  'clients',
  'sales',
  'finance',
  'profitability',
  'settings',
] as const;

function loadLocalEnvFile() {
  const envPath = resolve(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts
      .join('=')
      .trim()
      .replace(/^['"]|['"]$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to seed the Agency owner.`);
  }

  return value;
}

async function upsertOwnerPermission(
  permissionsRepo: Repository<AgencyWorkspaceUserPermissionEntity>,
  tenantId: string,
  workspaceId: string,
  workspaceUserId: string,
) {
  for (const appKey of AGENCY_APP_KEYS) {
    const existing = await permissionsRepo.findOne({
      where: { workspaceUserId, appKey },
    });

    await permissionsRepo.save(
      permissionsRepo.create({
        id: existing?.id,
        tenantId,
        workspaceId,
        workspaceUserId,
        appKey,
        access: 'full',
      }),
    );
  }
}

async function run() {
  loadLocalEnvFile();

  const ownerName = process.env.AGENCY_OWNER_NAME?.trim() || 'Agency Owner';
  const ownerEmail = requireEnv('AGENCY_OWNER_EMAIL').toLowerCase();
  const ownerPassword = requireEnv('AGENCY_OWNER_PASSWORD');
  const workspaceName =
    process.env.AGENCY_OWNER_WORKSPACE_NAME?.trim() || 'Talarico Labs';

  const agencyDataSource = new DataSource({
    type: 'postgres',
    host: process.env.AGENCY_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.AGENCY_DB_PORT ?? process.env.DB_PORT ?? 5433),
    username:
      process.env.AGENCY_DB_USERNAME ?? process.env.DB_USERNAME ?? 'lyra',
    password:
      process.env.AGENCY_DB_PASSWORD ??
      process.env.DB_PASSWORD ??
      'lyra_dev_password',
    database: process.env.AGENCY_DB_NAME ?? 'lyra_agency',
    synchronize: false,
    logging: false,
    entities: agencyEntities,
  });

  await agencyDataSource.initialize();

  try {
    const securityRepo = agencyDataSource.getRepository(
      AgencyUserSecuritySettingsEntity,
    );
    const workspaceUsersRepo = agencyDataSource.getRepository(
      AgencyWorkspaceUserEntity,
    );
    const profileRepo = agencyDataSource.getRepository(AgencyUserProfileEntity);
    const preferencesRepo = agencyDataSource.getRepository(
      AgencyUserPreferencesEntity,
    );
    const companyRepo = agencyDataSource.getRepository(
      AgencyWorkspaceCompanySettingsEntity,
    );
    const permissionsRepo = agencyDataSource.getRepository(
      AgencyWorkspaceUserPermissionEntity,
    );

    const existingSecurity = await securityRepo.findOne({
      where: { currentEmail: ownerEmail },
      order: { updatedAt: 'DESC' },
    });
    const existingWorkspaceUser = await workspaceUsersRepo.findOne({
      where: { email: ownerEmail },
      order: { updatedAt: 'DESC' },
    });

    const tenantId =
      existingWorkspaceUser?.tenantId ??
      existingSecurity?.tenantId ??
      randomUUID();
    const workspaceId = existingWorkspaceUser?.workspaceId ?? randomUUID();
    const userId =
      existingWorkspaceUser?.userId ?? existingSecurity?.userId ?? randomUUID();

    const passwordHash = await argon2.hash(ownerPassword);

    await securityRepo.save(
      securityRepo.create({
        id: existingSecurity?.id,
        tenantId,
        userId,
        currentEmail: ownerEmail,
        passwordHash,
        passwordUpdatedAt: new Date(),
        twoFactorEnabled: existingSecurity?.twoFactorEnabled ?? false,
        twoFactorMethod: existingSecurity?.twoFactorMethod ?? 'authenticator',
        twoFactorSecretEncrypted:
          existingSecurity?.twoFactorSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted:
          existingSecurity?.twoFactorPendingSecretEncrypted ?? null,
        loginAlertsEnabled: existingSecurity?.loginAlertsEnabled ?? true,
        trustedDevicesEnabled: existingSecurity?.trustedDevicesEnabled ?? true,
      }),
    );

    const workspaceUser = await workspaceUsersRepo.save(
      workspaceUsersRepo.create({
        id: existingWorkspaceUser?.id,
        tenantId,
        workspaceId,
        userId,
        name: ownerName,
        email: ownerEmail,
        role: 'owner',
        status: 'active',
        lastAccess: existingWorkspaceUser?.lastAccess ?? '',
      }),
    );

    const existingProfile = await profileRepo.findOne({
      where: { tenantId, userId },
    });

    await profileRepo.save(
      profileRepo.create({
        id: existingProfile?.id,
        tenantId,
        userId,
        displayName: ownerName,
        email: ownerEmail,
        phone: existingProfile?.phone ?? null,
        jobTitle: existingProfile?.jobTitle ?? 'Owner',
        avatarUrl: existingProfile?.avatarUrl ?? null,
        avatarPath: existingProfile?.avatarPath ?? null,
      }),
    );

    const existingPreferences = await preferencesRepo.findOne({
      where: { tenantId, userId },
    });

    await preferencesRepo.save(
      preferencesRepo.create({
        id: existingPreferences?.id,
        tenantId,
        userId,
        themePreference: existingPreferences?.themePreference ?? 'system',
        locale: existingPreferences?.locale ?? 'pt-BR',
        timezone: existingPreferences?.timezone ?? 'America/Sao_Paulo',
        dateFormat: existingPreferences?.dateFormat ?? 'dd/MM/yyyy',
        timeFormat: existingPreferences?.timeFormat ?? '24h',
        sidebarCollapsed: existingPreferences?.sidebarCollapsed ?? false,
      }),
    );

    const existingCompany = await companyRepo.findOne({
      where: { tenantId, workspaceId },
    });

    await companyRepo.save(
      companyRepo.create({
        id: existingCompany?.id,
        tenantId,
        workspaceId,
        legalName: existingCompany?.legalName ?? workspaceName,
        tradeName: existingCompany?.tradeName ?? workspaceName,
        workspaceName,
        taxIdType: existingCompany?.taxIdType ?? 'CNPJ',
        taxId: existingCompany?.taxId ?? '',
        country: existingCompany?.country ?? 'BR',
        currency: existingCompany?.currency ?? 'BRL',
        defaultLocale: existingCompany?.defaultLocale ?? 'pt-BR',
        timezone: existingCompany?.timezone ?? 'America/Sao_Paulo',
        metadata: existingCompany?.metadata ?? {},
      }),
    );

    await upsertOwnerPermission(
      permissionsRepo,
      tenantId,
      workspaceId,
      workspaceUser.id,
    );

    console.log('Agency owner seed completed.');
    console.log(`Owner email: ${ownerEmail}`);
    console.log(`Workspace: ${workspaceName}`);
    console.log('Password was not printed.');
  } finally {
    await agencyDataSource.destroy();
  }
}

run().catch((error) => {
  console.error('Agency owner seed failed:', error.message);
  process.exit(1);
});
