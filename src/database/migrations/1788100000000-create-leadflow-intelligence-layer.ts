import type { MigrationInterface, QueryRunner } from 'typeorm';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';
import {
  PLATFORM_ROLE_KEYS,
  PlatformRoleKey,
} from '../../modules/permissions/enums/permission.enums';

const RECOMMENDATIONS_MANAGE_PERMISSION =
  'leadflow.analytics.recommendations.manage.admin';

export class CreateLeadflowIntelligenceLayer1788100000000 implements MigrationInterface {
  name = 'CreateLeadflowIntelligenceLayer1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permission = getPermissionDefinition(
      RECOMMENDATIONS_MANAGE_PERMISSION,
    );
    if (!permission) {
      throw new Error(
        `Missing permission definition: ${RECOMMENDATIONS_MANAGE_PERMISSION}`,
      );
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
      if (
        !DEFAULT_ROLE_PERMISSION_MATRIX[roleKey].includes(
          RECOMMENDATIONS_MANAGE_PERMISSION,
        )
      ) {
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
        [RECOMMENDATIONS_MANAGE_PERMISSION, roleKey],
      );
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_intelligence_recommendations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "context_type" varchar(30) NOT NULL,
        "agency_client_id" uuid,
        "business_mode_key" varchar(80) NOT NULL,
        "generation_key" varchar(240) NOT NULL,
        "kind" varchar(80) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "target_type" varchar(40) NOT NULL,
        "target_id" uuid NOT NULL,
        "target_label" varchar(180) NOT NULL,
        "title" varchar(180) NOT NULL,
        "rationale" text NOT NULL,
        "period_from" timestamptz NOT NULL,
        "period_to" timestamptz NOT NULL,
        "segment" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "confidence" real NOT NULL,
        "expected_impact" jsonb NOT NULL,
        "current_config" jsonb NOT NULL,
        "proposed_config" jsonb NOT NULL,
        "baseline" jsonb NOT NULL,
        "snoozed_until" timestamptz,
        "applied_at" timestamptz,
        "measurement_due_at" timestamptz,
        "rolled_back_at" timestamptz,
        "applied_version_id" uuid,
        "rollback_version_id" uuid,
        "latest_result_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_intelligence_recommendations" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_intelligence_recommendation_status" CHECK (
          "status" IN ('pending', 'snoozed', 'applied', 'rejected', 'rolled_back')
        ),
        CONSTRAINT "CK_lf_intelligence_confidence" CHECK (
          "confidence" >= 0 AND "confidence" <= 1
        ),
        CONSTRAINT "CK_lf_intelligence_period" CHECK (
          "period_from" <= "period_to"
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_intelligence_recommendations_scope_status"
      ON "leadflow_intelligence_recommendations"
        ("tenant_id", "workspace_id", "context_type", "agency_client_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_intelligence_recommendations_target"
      ON "leadflow_intelligence_recommendations"
        ("tenant_id", "workspace_id", "target_type", "target_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_intelligence_recommendations_generation"
      ON "leadflow_intelligence_recommendations" (
        "tenant_id",
        "workspace_id",
        "context_type",
        COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "generation_key"
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_intelligence_decisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "recommendation_id" uuid NOT NULL,
        "action" varchar(24) NOT NULL,
        "reason" text,
        "snoozed_until" timestamptz,
        "actor_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_intelligence_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_intelligence_decision_action" CHECK (
          "action" IN ('approve', 'reject', 'snooze', 'rollback')
        ),
        CONSTRAINT "FK_lf_intelligence_decision_recommendation"
          FOREIGN KEY ("recommendation_id")
          REFERENCES "leadflow_intelligence_recommendations" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_intelligence_decisions_recommendation_created"
      ON "leadflow_intelligence_decisions"
        ("recommendation_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_intelligence_config_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "recommendation_id" uuid NOT NULL,
        "target_type" varchar(40) NOT NULL,
        "target_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'applied',
        "previous_config" jsonb NOT NULL,
        "config" jsonb NOT NULL,
        "rollback_of_version_id" uuid,
        "applied_by_id" uuid,
        "applied_at" timestamptz NOT NULL,
        "rolled_back_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_intelligence_config_versions" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_intelligence_config_version_status" CHECK (
          "status" IN ('applied', 'rolled_back')
        ),
        CONSTRAINT "FK_lf_intelligence_version_recommendation"
          FOREIGN KEY ("recommendation_id")
          REFERENCES "leadflow_intelligence_recommendations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_lf_intelligence_version_rollback"
          FOREIGN KEY ("rollback_of_version_id")
          REFERENCES "leadflow_intelligence_config_versions" ("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_intelligence_config_versions_target_version"
      ON "leadflow_intelligence_config_versions"
        ("tenant_id", "workspace_id", "target_type", "target_id", "version")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_intelligence_config_versions_recommendation"
      ON "leadflow_intelligence_config_versions" ("recommendation_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_intelligence_results" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "recommendation_id" uuid NOT NULL,
        "config_version_id" uuid NOT NULL,
        "status" varchar(30) NOT NULL,
        "period_from" timestamptz NOT NULL,
        "period_to" timestamptz NOT NULL,
        "baseline" jsonb NOT NULL,
        "observed" jsonb NOT NULL,
        "delta" jsonb NOT NULL,
        "conclusion" text NOT NULL,
        "measured_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_intelligence_results" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_intelligence_result_status" CHECK (
          "status" IN ('improved', 'no_change', 'regressed', 'insufficient_window')
        ),
        CONSTRAINT "CK_lf_intelligence_result_period" CHECK (
          "period_from" <= "period_to"
        ),
        CONSTRAINT "FK_lf_intelligence_result_recommendation"
          FOREIGN KEY ("recommendation_id")
          REFERENCES "leadflow_intelligence_recommendations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_lf_intelligence_result_version"
          FOREIGN KEY ("config_version_id")
          REFERENCES "leadflow_intelligence_config_versions" ("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_intelligence_results_recommendation_measured"
      ON "leadflow_intelligence_results"
        ("recommendation_id", "measured_at" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_intelligence_recommendations"
      ADD CONSTRAINT "FK_lf_intelligence_recommendation_applied_version"
      FOREIGN KEY ("applied_version_id")
      REFERENCES "leadflow_intelligence_config_versions" ("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_intelligence_recommendations"
      ADD CONSTRAINT "FK_lf_intelligence_recommendation_rollback_version"
      FOREIGN KEY ("rollback_version_id")
      REFERENCES "leadflow_intelligence_config_versions" ("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_intelligence_recommendations"
      ADD CONSTRAINT "FK_lf_intelligence_recommendation_latest_result"
      FOREIGN KEY ("latest_result_id")
      REFERENCES "leadflow_intelligence_results" ("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_intelligence_recommendations"
      DROP CONSTRAINT IF EXISTS "FK_lf_intelligence_recommendation_latest_result"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_intelligence_recommendations"
      DROP CONSTRAINT IF EXISTS "FK_lf_intelligence_recommendation_rollback_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_intelligence_recommendations"
      DROP CONSTRAINT IF EXISTS "FK_lf_intelligence_recommendation_applied_version"
    `);
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_intelligence_results"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_intelligence_decisions"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_intelligence_config_versions"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_intelligence_recommendations"',
    );
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
        [RECOMMENDATIONS_MANAGE_PERMISSION, roleKey],
      );
    }
    await queryRunner.query('DELETE FROM platform_permissions WHERE key = $1', [
      RECOMMENDATIONS_MANAGE_PERMISSION,
    ]);
  }
}
