import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencySettingsCore1760001000000 implements MigrationInterface {
  name = 'CreateAgencySettingsCore1760001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "theme_preference" varchar(20) NOT NULL DEFAULT 'system',
        "locale" varchar(10) NOT NULL DEFAULT 'pt-BR',
        "timezone" varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
        "date_format" varchar(20) NOT NULL DEFAULT 'dd/MM/yyyy',
        "time_format" varchar(10) NOT NULL DEFAULT '24h',
        "sidebar_collapsed" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_user_preferences_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_user_preferences_tenant_user" UNIQUE ("tenant_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_profile" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "display_name" varchar(120) NOT NULL DEFAULT '',
        "email" varchar(160) NOT NULL DEFAULT '',
        "phone" varchar(40),
        "job_title" varchar(80),
        "avatar_url" text,
        "avatar_path" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_user_profile_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_user_profile_tenant_user" UNIQUE ("tenant_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_company_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "legal_name" varchar(120) NOT NULL DEFAULT '',
        "trade_name" varchar(80) NOT NULL DEFAULT '',
        "workspace_name" varchar(80) NOT NULL DEFAULT '',
        "tax_id_type" varchar(20) NOT NULL DEFAULT 'CNPJ',
        "tax_id" varchar(40) NOT NULL DEFAULT '',
        "website" varchar(255),
        "support_email" varchar(160),
        "billing_email" varchar(160),
        "phone" varchar(40),
        "country" varchar(80) NOT NULL DEFAULT 'BR',
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "default_locale" varchar(10) NOT NULL DEFAULT 'pt-BR',
        "timezone" varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
        "address_line" varchar(255),
        "industry" varchar(80),
        "company_size" varchar(40),
        "avatar_url" text,
        "avatar_path" varchar(255),
        "logo_url" text,
        "logo_path" varchar(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_company_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_company_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_notification_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "quiet_hours_enabled" boolean NOT NULL DEFAULT true,
        "quiet_hours" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "history_limit" int NOT NULL DEFAULT 10,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_notification_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_notification_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "preferences" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_user_notification_preferences_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_user_notification_preferences_tenant_user" UNIQUE ("tenant_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_security_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "login_alerts_enabled" boolean NOT NULL DEFAULT true,
        "trusted_devices_enabled" boolean NOT NULL DEFAULT true,
        "two_factor_required" boolean NOT NULL DEFAULT false,
        "password_min_length" int NOT NULL DEFAULT 8,
        "email_domain" varchar(120) NOT NULL DEFAULT 'lyrasuite.com',
        "email_templates" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_security_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_security_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_apps_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "apps" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_apps_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_apps_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_email_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL DEFAULT 'smtp_imap',
        "from_name" varchar(120) NOT NULL DEFAULT '',
        "from_email" varchar(160),
        "reply_to_email" varchar(160),
        "smtp_host" varchar(160),
        "smtp_port" int,
        "smtp_secure" boolean NOT NULL DEFAULT true,
        "smtp_user" varchar(160),
        "smtp_password_encrypted" text,
        "imap_host" varchar(160),
        "imap_port" int,
        "imap_secure" boolean NOT NULL DEFAULT true,
        "imap_user" varchar(160),
        "imap_password_encrypted" text,
        "status" varchar(30) NOT NULL DEFAULT 'not_configured',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_email_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_email_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_finance_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "country" varchar(80) NOT NULL DEFAULT 'BR',
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_finance_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_finance_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_subscription_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "plan_key" varchar(40) NOT NULL DEFAULT 'agency_starter',
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_subscription_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_subscription_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_advanced_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "developer_mode" boolean NOT NULL DEFAULT false,
        "api_access_enabled" boolean NOT NULL DEFAULT false,
        "webhooks_enabled" boolean NOT NULL DEFAULT false,
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_advanced_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_advanced_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_integrations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "item_id" varchar(80) NOT NULL,
        "category" varchar(30) NOT NULL DEFAULT 'integration',
        "status" varchar(30) NOT NULL DEFAULT 'available',
        "is_installed" boolean NOT NULL DEFAULT false,
        "is_pinned" boolean NOT NULL DEFAULT false,
        "sidebar_order" int,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_integrations_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_integrations_workspace_item" UNIQUE ("workspace_id", "item_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "user_id" uuid,
        "name" varchar(120) NOT NULL,
        "email" varchar(160) NOT NULL,
        "role" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL,
        "last_access" varchar(120) NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_users_workspace_email" UNIQUE ("workspace_id", "email")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_user_permissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "workspace_user_id" uuid NOT NULL,
        "app_key" varchar(40) NOT NULL,
        "access" varchar(20) NOT NULL DEFAULT 'blocked',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_user_permissions_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_user_permissions_user_app" UNIQUE ("workspace_user_id", "app_key")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_security_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "current_email" varchar(160) NOT NULL DEFAULT '',
        "password_hash" text,
        "password_updated_at" timestamptz,
        "two_factor_enabled" boolean NOT NULL DEFAULT false,
        "two_factor_method" varchar(20) NOT NULL DEFAULT 'authenticator',
        "two_factor_secret_encrypted" text,
        "two_factor_pending_secret_encrypted" text,
        "login_alerts_enabled" boolean NOT NULL DEFAULT true,
        "trusted_devices_enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_user_security_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_user_security_settings_tenant_user" UNIQUE ("tenant_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "session_token_hash" text,
        "title" varchar(120) NOT NULL,
        "browser" varchar(120) NOT NULL,
        "user_agent" text,
        "ip_address" varchar(120),
        "device_fingerprint" varchar(64),
        "device_name" varchar(120),
        "location" varchar(120) NOT NULL DEFAULT '',
        "last_seen" varchar(120) NOT NULL DEFAULT '',
        "status" varchar(20) NOT NULL,
        "revoked_at" timestamptz,
        "expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_user_sessions_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_trusted_devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "device_fingerprint" varchar(64),
        "device_name" varchar(120),
        "user_agent" text,
        "ip_address" varchar(120),
        "location" varchar(120),
        "trusted_at" timestamptz,
        "last_used_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_user_trusted_devices_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "password_resets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_password_resets_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_email_2fa_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "code_hash" text NOT NULL,
        "purpose" varchar(20) NOT NULL DEFAULT 'login',
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "attempts" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_auth_email_2fa_codes_id" PRIMARY KEY ("id")
      );
    `);

    await this.createIndexes(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_auth_email_2fa_codes_tenant_user_purpose";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_password_resets_tenant_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_password_resets_token_hash";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_user_trusted_devices_tenant_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_user_sessions_tenant_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_user_security_settings_tenant_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_user_permissions_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_users_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_integrations_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_advanced_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_subscription_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_finance_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_email_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_apps_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_security_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_user_notification_preferences_tenant_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_notification_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_company_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_user_profile_tenant_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_user_preferences_tenant_user";`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "auth_email_2fa_codes";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "password_resets";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_trusted_devices";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sessions";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_security_settings";`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_user_permissions";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_users";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_integrations";`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_advanced_settings";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_subscription_settings";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_finance_settings";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_email_settings";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_apps_settings";`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_security_settings";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user_notification_preferences";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_notification_settings";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_company_settings";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_profile";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_preferences";`);
  }

  private async createIndexes(queryRunner: QueryRunner) {
    const indexes = [
      [
        'idx_agency_user_preferences_tenant_user',
        'user_preferences',
        'tenant_id, user_id',
      ],
      [
        'idx_agency_user_profile_tenant_user',
        'user_profile',
        'tenant_id, user_id',
      ],
      [
        'idx_agency_workspace_company_tenant_workspace',
        'workspace_company_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_notification_tenant_workspace',
        'workspace_notification_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_user_notification_preferences_tenant_user',
        'user_notification_preferences',
        'tenant_id, user_id',
      ],
      [
        'idx_agency_workspace_security_tenant_workspace',
        'workspace_security_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_apps_tenant_workspace',
        'workspace_apps_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_finance_tenant_workspace',
        'workspace_finance_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_email_tenant_workspace',
        'workspace_email_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_subscription_tenant_workspace',
        'workspace_subscription_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_advanced_tenant_workspace',
        'workspace_advanced_settings',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_integrations_tenant_workspace',
        'workspace_integrations',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_users_tenant_workspace',
        'workspace_users',
        'tenant_id, workspace_id',
      ],
      [
        'idx_agency_workspace_user_permissions_user',
        'workspace_user_permissions',
        'workspace_user_id',
      ],
      [
        'idx_agency_user_security_settings_tenant_user',
        'user_security_settings',
        'tenant_id, user_id',
      ],
      [
        'idx_agency_user_sessions_tenant_user',
        'user_sessions',
        'tenant_id, user_id',
      ],
      [
        'idx_agency_user_trusted_devices_tenant_user',
        'user_trusted_devices',
        'tenant_id, user_id',
      ],
      [
        'idx_agency_password_resets_token_hash',
        'password_resets',
        'token_hash',
      ],
      [
        'idx_agency_password_resets_tenant_user',
        'password_resets',
        'tenant_id, user_id',
      ],
      [
        'idx_agency_auth_email_2fa_codes_tenant_user_purpose',
        'auth_email_2fa_codes',
        'tenant_id, user_id, purpose',
      ],
    ];

    for (const [name, table, columns] of indexes) {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "${name}"
        ON "${table}" (${columns});
      `);
    }
  }
}
