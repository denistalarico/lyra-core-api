import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciles columns that have always been part of TeamConfigOption but were
 * omitted from the migration that originally created team_config_options.
 *
 * The statements are additive and intentionally preserve existing values.
 */
export class ReconcileAgencyTeamConfigOptionsSchema1760002031500 implements MigrationInterface {
  name = 'ReconcileAgencyTeamConfigOptionsSchema1760002031500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "team_config_options"
      ADD COLUMN IF NOT EXISTS "description" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "team_config_options"
      ADD COLUMN IF NOT EXISTS "color" character varying(24) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "team_config_options"
      ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(): Promise<void> {
    await Promise.reject(
      new Error(
        'Automatic rollback is unsafe: the reconciled columns may predate this migration and contain data.',
      ),
    );
  }
}
