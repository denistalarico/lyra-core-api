import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyTeamConfigOptions1760002031000 implements MigrationInterface {
  name = 'CreateAgencyTeamConfigOptions1760002031000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "team_config_options" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "type" varchar(80) NOT NULL,
        "name" varchar(160) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'active',
        "created_by_id" uuid NULL,
        "updated_by_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_team_config_options_unique_name"
      ON "team_config_options" ("tenant_id", "workspace_id", "type", "name")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_team_config_options_context_type"
      ON "team_config_options" ("tenant_id", "workspace_id", "type", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_config_options_context_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_config_options_unique_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "team_config_options"`);
  }
}
