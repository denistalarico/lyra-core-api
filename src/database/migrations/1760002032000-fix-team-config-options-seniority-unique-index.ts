import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixTeamConfigOptionsSeniorityUniqueIndex1760002032000 implements MigrationInterface {
  name = 'FixTeamConfigOptionsSeniorityUniqueIndex1760002032000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the blanket unique index that prevents same-name levels across skill categories
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_team_config_options_unique_name"
    `);

    // Re-create uniqueness for all non-seniority types (original behaviour)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_team_config_options_unique_name"
      ON "team_config_options" ("tenant_id", "workspace_id", "type", "name")
      WHERE "type" <> 'seniority'
    `);

    // For seniority, uniqueness is scoped per skillCategory stored in metadata
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_team_config_options_seniority_unique"
      ON "team_config_options" ("tenant_id", "workspace_id", "type", ("metadata"->>'skillCategory'), "name")
      WHERE "type" = 'seniority'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_config_options_seniority_unique"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_config_options_unique_name"`);

    // Restore the original blanket unique index
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_team_config_options_unique_name"
      ON "team_config_options" ("tenant_id", "workspace_id", "type", "name")
    `);
  }
}
