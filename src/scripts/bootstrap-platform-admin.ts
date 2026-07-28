import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { agencyEntities } from '../config/typeorm.config';
import { AgencyAdminIdentityAdapter } from '../modules/admin/adapters/agency-admin-identity.adapter';
import {
  AdminBootstrapService,
  PlatformAdminBootstrapError,
} from '../modules/admin/services/admin-bootstrap.service';
import {
  type PlatformAdminRoleKey,
  isPlatformAdminRoleKey,
} from '../modules/admin/types/admin-access.types';
import { AgencyUserSecuritySettingsEntity } from '../modules/agency/entities/agency-auth.entities';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../modules/agency/entities/agency-settings.entities';

type PlatformAdminBootstrapOptions = {
  email: string;
  requestedRole: PlatformAdminRoleKey;
  allowRoleChange: boolean;
};

function loadLocalEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

function parseOptions(env: NodeJS.ProcessEnv): PlatformAdminBootstrapOptions {
  const email = env.PLATFORM_ADMIN_EMAIL?.trim();
  if (!email) {
    throw new PlatformAdminBootstrapError('platform_admin_email_required');
  }

  const requestedRole = env.PLATFORM_ADMIN_ROLE?.trim() || 'super_admin';
  if (!isPlatformAdminRoleKey(requestedRole)) {
    throw new Error('platform_admin_role_invalid');
  }

  const roleChangeFlag = env.PLATFORM_ADMIN_ALLOW_ROLE_CHANGE?.trim();
  if (
    roleChangeFlag !== undefined &&
    roleChangeFlag !== 'true' &&
    roleChangeFlag !== 'false'
  ) {
    throw new Error('platform_admin_allow_role_change_invalid');
  }

  return {
    email,
    requestedRole,
    allowRoleChange: roleChangeFlag === 'true',
  };
}

function createAgencyDataSource(): DataSource {
  return new DataSource({
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
}

async function main(): Promise<void> {
  loadLocalEnvFile();
  const options = parseOptions(process.env);
  const agencyDataSource = createAgencyDataSource();

  try {
    await agencyDataSource.initialize();
    const identityGateway = new AgencyAdminIdentityAdapter(
      agencyDataSource.getRepository(AgencyUserSecuritySettingsEntity),
      agencyDataSource.getRepository(AgencyWorkspaceUserEntity),
      agencyDataSource.getRepository(AgencyUserProfileEntity),
    );
    const service = new AdminBootstrapService(
      agencyDataSource,
      identityGateway,
    );
    const result = await service.bootstrap(options);

    console.log('Platform admin bootstrap completed.');
    console.log(`Result: ${result.result}`);
    console.log(`Role: ${result.roleKey}`);
    console.log(`Status: ${result.status}`);
    console.log('Two-factor required: yes');
    console.log(
      `Identity 2FA currently enabled: ${
        result.identityTwoFactorEnabled ? 'yes' : 'no'
      }`,
    );
    console.log(`Email: ${result.maskedEmail}`);
    if (result.roleChangeDenied) {
      console.log(
        'Role downgrade was not applied. Set PLATFORM_ADMIN_ALLOW_ROLE_CHANGE=true to allow it.',
      );
    }
    if (!result.identityTwoFactorEnabled) {
      console.log(
        'Action required: configure identity two-factor before Admin login.',
      );
    }
  } finally {
    if (agencyDataSource.isInitialized) {
      await agencyDataSource.destroy();
    }
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof PlatformAdminBootstrapError
      ? error.code
      : error instanceof Error && /^[a-z0-9_]{3,100}$/.test(error.message)
        ? error.message
        : 'platform_admin_bootstrap_failed';
  console.error('Platform admin bootstrap failed.');
  console.error(`Error: ${code}`);
  process.exitCode = 1;
});
