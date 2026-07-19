import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceDefaultAgentBindingInvariant1784510000000 implements MigrationInterface {
  name = 'EnforceDefaultAgentBindingInvariant1784510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM leadflow_agent_channel_bindings
           WHERE status = 'active'
             AND COALESCE(config->>'isDefault', 'false') = 'true'
             AND external_ref IS NOT NULL
           GROUP BY tenant_id, workspace_id, external_ref
          HAVING count(*) > 1
        ) THEN
          RAISE EXCEPTION 'Multiple active default LeadFlow bindings require explicit reconciliation';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_default_binding_per_channel"
      ON "leadflow_agent_channel_bindings"
        ("tenant_id", "workspace_id", "external_ref")
      WHERE "status" = 'active'
        AND COALESCE("config"->>'isDefault', 'false') = 'true'
        AND "external_ref" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_lf_default_binding_per_channel"',
    );
  }
}
