import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_INTENTS = [
  'update_offer_price',
  'schedule_discount',
  'add_closure',
  'update_business_hours',
  'capacity_unavailable',
  'capacity_released',
];

/** OR5 — proposals that the confirmation executes through a domain service. */
const OR5_INTENTS = [
  'pause_agent',
  'activate_agent',
  'create_contact',
  'move_opportunity',
  'update_contact_fields',
  'create_appointment',
];

const inList = (values: string[]) =>
  values.map((value) => `'${value}'`).join(',');

/**
 * OR5 — pause an agent for a period (AO-05) and scope the room proposals to
 * the agent that received them (AO-03).
 *
 * - `leadflow_agents.paused_until`: the resume job brings a paused agent
 *   back to `active` once it passes. The partial index is the job's scan.
 * - `leadflow_operations_actions.agent_id`: the agent the proposal was made
 *   to (`NULL` = the Orion or the room itself). `target_type`/`target_id`:
 *   the record the confirmation acts on (resolved server-side), filled with
 *   the created record for `create_*`.
 * - The intent CHECK grows with the six OR5 intents.
 *
 * Additive and idempotent. `down()` restores the previous CHECK as
 * `NOT VALID`, so a rollback does not fail on OR5 rows already written.
 */
export class AddAgentPauseUntilAndActionTargets1800800000000 implements MigrationInterface {
  name = 'AddAgentPauseUntilAndActionTargets1800800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "leadflow_agents" ADD COLUMN IF NOT EXISTS "paused_until" timestamptz`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_agents_paused_until_due"
      ON "leadflow_agents" ("paused_until")
      WHERE "status" = 'paused' AND "paused_until" IS NOT NULL AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_actions"
        ADD COLUMN IF NOT EXISTS "agent_id" uuid,
        ADD COLUMN IF NOT EXISTS "target_type" varchar(40),
        ADD COLUMN IF NOT EXISTS "target_id" uuid
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_lf_operations_actions_agent'
        ) THEN
          ALTER TABLE "leadflow_operations_actions"
            ADD CONSTRAINT "FK_lf_operations_actions_agent"
            FOREIGN KEY ("agent_id") REFERENCES "leadflow_agents"("id") ON DELETE SET NULL;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_ops_actions_agent"
      ON "leadflow_operations_actions" ("agent_id")
      WHERE "agent_id" IS NOT NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "leadflow_operations_actions" DROP CONSTRAINT IF EXISTS "CK_lf_operations_actions_target"`,
    );
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_actions"
        ADD CONSTRAINT "CK_lf_operations_actions_target"
        CHECK ("target_id" IS NULL OR "target_type" IS NOT NULL)
    `);
    await queryRunner.query(
      `ALTER TABLE "leadflow_operations_actions" DROP CONSTRAINT IF EXISTS "CK_lf_operations_actions_intent"`,
    );
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_actions"
        ADD CONSTRAINT "CK_lf_operations_actions_intent"
        CHECK ("intent" IN (${inList([...LEGACY_INTENTS, ...OR5_INTENTS])}))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "leadflow_operations_actions" DROP CONSTRAINT IF EXISTS "CK_lf_operations_actions_intent"`,
    );
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_actions"
        ADD CONSTRAINT "CK_lf_operations_actions_intent"
        CHECK ("intent" IN (${inList(LEGACY_INTENTS)})) NOT VALID
    `);
    await queryRunner.query(
      `ALTER TABLE "leadflow_operations_actions" DROP CONSTRAINT IF EXISTS "CK_lf_operations_actions_target"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_ops_actions_agent"`);
    await queryRunner.query(
      `ALTER TABLE "leadflow_operations_actions" DROP CONSTRAINT IF EXISTS "FK_lf_operations_actions_agent"`,
    );
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_actions"
        DROP COLUMN IF EXISTS "target_id",
        DROP COLUMN IF EXISTS "target_type",
        DROP COLUMN IF EXISTS "agent_id"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agents_paused_until_due"`,
    );
    await queryRunner.query(
      `ALTER TABLE "leadflow_agents" DROP COLUMN IF EXISTS "paused_until"`,
    );
  }
}
