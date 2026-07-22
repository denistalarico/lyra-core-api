import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which recipe contract version an automation instance was provisioned
 * from.
 *
 * Without it the catalog cannot evolve safely: bumping a recipe's defaults would
 * either silently change the behaviour of already-published configurations or
 * force the catalog to stay frozen. Storing the provisioned version lets the API
 * surface "a newer version of this recipe exists" and leave the upgrade as an
 * explicit operator decision.
 *
 * Additive and backfilled with 1, which is the only version that has ever
 * existed — no existing row changes meaning.
 */
export class AddLeadflowAutomationTemplateVersion1785000000000 implements MigrationInterface {
  name = 'AddLeadflowAutomationTemplateVersion1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_automations"
      ADD COLUMN IF NOT EXISTS "template_version" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_automations_template_version"
      ON "leadflow_automations" ("recipe_key", "template_version")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_lf_automations_template_version"
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_automations"
      DROP COLUMN IF EXISTS "template_version"
    `);
  }
}
