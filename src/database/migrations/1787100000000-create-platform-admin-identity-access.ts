import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the administrative authorization boundary to the Agency datasource.
 *
 * `identity_tenant_id` + `user_id` is a logical identity reference by design.
 * It has no foreign key to Agency identity tables so a future central identity
 * migration does not require rewriting the administrative authorization model.
 */
export class CreatePlatformAdminIdentityAccess1787100000000 implements MigrationInterface {
  name = 'CreatePlatformAdminIdentityAccess1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_internal_admins" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "identity_tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "status" varchar(20) NOT NULL,
        "role_key" varchar(40) NOT NULL,
        "two_factor_required" boolean NOT NULL DEFAULT true,
        "locale" varchar(10) NOT NULL DEFAULT 'pt-BR',
        "theme" varchar(20) NOT NULL DEFAULT 'system',
        "timezone" varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
        "last_admin_login_at" timestamptz,
        "created_by" uuid,
        "updated_by" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_internal_admins" PRIMARY KEY ("id"),
        CONSTRAINT "ck_platform_internal_admins_status"
          CHECK ("status" IN ('pending', 'active', 'suspended', 'disabled')),
        CONSTRAINT "ck_platform_internal_admins_role"
          CHECK ("role_key" IN (
            'super_admin',
            'admin',
            'support_admin',
            'billing_admin',
            'operations_admin',
            'read_only'
          ))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_internal_admins_identity"
      ON "platform_internal_admins" ("identity_tenant_id", "user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_internal_admins_status"
      ON "platform_internal_admins" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_admin_audit_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actor_admin_id" uuid,
        "actor_user_id" uuid,
        "action" varchar(120) NOT NULL,
        "target_type" varchar(80),
        "target_id" varchar(160),
        "outcome" varchar(20) NOT NULL,
        "ip_address" varchar(120),
        "user_agent" text,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_admin_audit_events" PRIMARY KEY ("id"),
        CONSTRAINT "ck_platform_admin_audit_events_outcome"
          CHECK ("outcome" IN ('success', 'denied', 'failure'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_audit_actor_created"
      ON "platform_admin_audit_events" ("actor_admin_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_audit_action_created"
      ON "platform_admin_audit_events" ("action", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "platform_admin_audit_events"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_internal_admins"`);
  }
}
