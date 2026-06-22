import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserLoginEvents1760002060000 implements MigrationInterface {
  name = 'CreateUserLoginEvents1760002060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_login_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "event_type" varchar(30) NOT NULL,
        "device_name" varchar(120),
        "user_agent" text,
        "ip_address" varchar(120),
        "location" varchar(120),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_user_login_events_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_user_login_events_tenant_user"
      ON "user_login_events" ("tenant_id", "user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_user_login_events_tenant_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_login_events";`);
  }
}
