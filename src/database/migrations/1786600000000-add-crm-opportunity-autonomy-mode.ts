import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D3 (LeadFlow Fase 1A): per-opportunity autonomy mode.
 *
 * `automatic` (default) means automations/agents may act on the card;
 * `manual` means a human is driving it and non-human stage moves are refused.
 * Additive and backward-safe: Agency Sales queries are unaffected and existing
 * rows default to `automatic` (coherent with the existing `follow_mode` default).
 */
export class AddCrmOpportunityAutonomyMode1786600000000
  implements MigrationInterface
{
  name = 'AddCrmOpportunityAutonomyMode1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      ADD COLUMN IF NOT EXISTS "autonomy_mode" varchar(16) NOT NULL DEFAULT 'automatic'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      DROP COLUMN IF EXISTS "autonomy_mode"
    `);
  }
}
