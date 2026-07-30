import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';
import {
  PLATFORM_ROLE_KEYS,
  PlatformRoleKey,
} from '../../modules/permissions/enums/permission.enums';

const PRIVACY_PERMISSIONS = [
  'leadflow.settings.telemetry.view.admin',
  'leadflow.settings.telemetry.manage.owner_only',
] as const;
const PURPOSE_KEY = 'leadflow_product_improvement_v1';
const NOTICE_BODY =
  'Finalidade técnica: permitir que a Lyra use métricas operacionais estruturadas para melhorar a confiabilidade e o desempenho do LeadFlow. A contribuição inclui somente contagens diárias de execuções live concluídas e falhas. Não inclui conteúdo de mensagens, dados de contatos, anexos, prompts, credenciais nem payloads de provedores. Os identificadores do contexto ficam separados dos fatos por pseudônimo aleatório. Resultados de produto só são disponibilizados em grupos com pelo menos 5 contextos. A retenção técnica inicial dos fatos é de 90 dias. Você pode desativar novas coletas e solicitar a exclusão da contribuição pseudonimizada. Este texto técnico requer revisão jurídica antes do rollout de produção.';

export class CreateLeadflowPrivacyTelemetry1788200000000 implements MigrationInterface {
  name = 'CreateLeadflowPrivacyTelemetry1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permissionKey of PRIVACY_PERMISSIONS) {
      const permission = getPermissionDefinition(permissionKey);
      if (!permission) {
        throw new Error(`Missing permission definition: ${permissionKey}`);
      }
      await queryRunner.query(
        `
          INSERT INTO platform_permissions (
            key, product_key, module_key, resource_key, action_key, scope_key,
            risk_level, is_dangerous, is_system
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          ON CONFLICT (key) DO UPDATE SET
            product_key = EXCLUDED.product_key,
            module_key = EXCLUDED.module_key,
            resource_key = EXCLUDED.resource_key,
            action_key = EXCLUDED.action_key,
            scope_key = EXCLUDED.scope_key,
            risk_level = EXCLUDED.risk_level,
            is_dangerous = EXCLUDED.is_dangerous,
            is_system = true,
            updated_at = now()
        `,
        [
          permission.key,
          permission.productKey,
          permission.moduleKey,
          permission.resourceKey,
          permission.actionKey,
          permission.scopeKey,
          permission.riskLevel,
          permission.isDangerous,
        ],
      );
      for (const roleKey of PLATFORM_ROLE_KEYS) {
        if (!DEFAULT_ROLE_PERMISSION_MATRIX[roleKey].includes(permissionKey)) {
          continue;
        }
        await queryRunner.query(
          `
            INSERT INTO platform_role_permissions (
              role_id, permission_key, enabled
            )
            SELECT id, $1, true
            FROM platform_roles
            WHERE tenant_id IS NULL AND key = $2
            ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL
            DO UPDATE SET enabled = true, updated_at = now()
          `,
          [permissionKey, roleKey],
        );
      }
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_telemetry_consent_notices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "purpose_key" varchar(80) NOT NULL,
        "version" integer NOT NULL,
        "locale" varchar(16) NOT NULL DEFAULT 'pt-BR',
        "title" varchar(180) NOT NULL,
        "body" text NOT NULL,
        "content_hash" char(64) NOT NULL,
        "categories" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "retention_days" integer NOT NULL,
        "k_anonymity_threshold" integer NOT NULL DEFAULT 5,
        "legal_review_status" varchar(32) NOT NULL DEFAULT 'pending',
        "status" varchar(24) NOT NULL DEFAULT 'active',
        "effective_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_telemetry_consent_notices" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_telemetry_notice_retention" CHECK (
          "retention_days" BETWEEN 7 AND 365
        ),
        CONSTRAINT "CK_lf_telemetry_notice_k" CHECK (
          "k_anonymity_threshold" >= 5
        ),
        CONSTRAINT "CK_lf_telemetry_notice_legal_review" CHECK (
          "legal_review_status" IN ('pending', 'approved', 'rejected')
        ),
        CONSTRAINT "CK_lf_telemetry_notice_status" CHECK (
          "status" IN ('active', 'retired')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_telemetry_notice_purpose_version_locale"
      ON "leadflow_telemetry_consent_notices" (
        "purpose_key", "version", "locale"
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_telemetry_consents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "context_type" varchar(30) NOT NULL,
        "agency_client_id" uuid,
        "notice_id" uuid,
        "purpose_key" varchar(80) NOT NULL,
        "status" varchar(16) NOT NULL,
        "actor_user_id" uuid,
        "reason_code" varchar(40),
        "notice_version" integer,
        "notice_content_hash" char(64),
        "occurred_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_telemetry_consents" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_telemetry_consent_context" CHECK (
          ("context_type" = 'agency' AND "agency_client_id" IS NULL)
          OR ("context_type" = 'client' AND "agency_client_id" IS NOT NULL)
        ),
        CONSTRAINT "CK_lf_telemetry_consent_status" CHECK (
          "status" IN ('opted_in', 'opted_out', 'erased')
        ),
        CONSTRAINT "FK_lf_telemetry_consent_notice"
          FOREIGN KEY ("notice_id")
          REFERENCES "leadflow_telemetry_consent_notices" ("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_telemetry_consents_scope_time"
      ON "leadflow_telemetry_consents" (
        "tenant_id", "workspace_id", "context_type", "agency_client_id",
        "occurred_at" DESC
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_telemetry_identity_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "context_type" varchar(30) NOT NULL,
        "agency_client_id" uuid,
        "scope_pseudonym" uuid NOT NULL,
        "last_collected_at" timestamptz,
        "opted_out_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_telemetry_identity_links" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lf_telemetry_identity_pseudonym"
          UNIQUE ("scope_pseudonym"),
        CONSTRAINT "CK_lf_telemetry_identity_context" CHECK (
          ("context_type" = 'agency' AND "agency_client_id" IS NULL)
          OR ("context_type" = 'client' AND "agency_client_id" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_telemetry_identity_scope"
      ON "leadflow_telemetry_identity_links" (
        "tenant_id",
        "workspace_id",
        "context_type",
        COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_product_telemetry_daily" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope_pseudonym" uuid NOT NULL,
        "observed_on" date NOT NULL,
        "metric_key" varchar(80) NOT NULL,
        "dimension_key" varchar(80) NOT NULL DEFAULT 'all',
        "metric_value" bigint NOT NULL,
        "sample_size" integer NOT NULL,
        "source_period_from" timestamptz NOT NULL,
        "source_period_to" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_product_telemetry_daily" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_product_telemetry_sample" CHECK (
          "metric_value" >= 0 AND "sample_size" >= 0
        ),
        CONSTRAINT "CK_lf_product_telemetry_period" CHECK (
          "source_period_from" < "source_period_to"
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_product_telemetry_daily_fact"
      ON "leadflow_product_telemetry_daily" (
        "scope_pseudonym", "observed_on", "metric_key", "dimension_key"
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_product_telemetry_daily_aggregate"
      ON "leadflow_product_telemetry_daily" (
        "observed_on", "metric_key", "dimension_key"
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_telemetry_audit_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "context_type" varchar(30) NOT NULL,
        "agency_client_id" uuid,
        "action" varchar(48) NOT NULL,
        "actor_user_id" uuid,
        "notice_version" integer,
        "notice_content_hash" char(64),
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_telemetry_audit_events" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_telemetry_audit_context" CHECK (
          ("context_type" = 'agency' AND "agency_client_id" IS NULL)
          OR ("context_type" = 'client' AND "agency_client_id" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_telemetry_audit_scope_time"
      ON "leadflow_telemetry_audit_events" (
        "tenant_id", "workspace_id", "context_type", "agency_client_id",
        "occurred_at" DESC
      )
    `);

    const contentHash = createHash('sha256').update(NOTICE_BODY).digest('hex');
    await queryRunner.query(
      `
        INSERT INTO leadflow_telemetry_consent_notices (
          purpose_key, version, locale, title, body, content_hash, categories,
          retention_days, k_anonymity_threshold, legal_review_status, status,
          effective_at
        )
        VALUES (
          $1, 1, 'pt-BR', $2, $3, $4, $5::jsonb, 90, 5, 'pending',
          'active', now()
        )
        ON CONFLICT (purpose_key, version, locale) DO NOTHING
      `,
      [
        PURPOSE_KEY,
        'Telemetria agregada para melhoria do LeadFlow',
        NOTICE_BODY,
        contentHash,
        JSON.stringify([
          'automation_live_terminal_runs',
          'automation_live_failed_runs',
        ]),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_telemetry_audit_events"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_product_telemetry_daily"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_telemetry_identity_links"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_telemetry_consents"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_telemetry_consent_notices"',
    );
    for (const permissionKey of PRIVACY_PERMISSIONS) {
      for (const roleKey of Object.values(PlatformRoleKey)) {
        await queryRunner.query(
          `
            DELETE FROM platform_role_permissions
            WHERE permission_key = $1
              AND tenant_id IS NULL
              AND role_id IN (
                SELECT id FROM platform_roles
                WHERE tenant_id IS NULL AND key = $2
              )
          `,
          [permissionKey, roleKey],
        );
      }
      await queryRunner.query(
        'DELETE FROM platform_permissions WHERE key = $1',
        [permissionKey],
      );
    }
  }
}
