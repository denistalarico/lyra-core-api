import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OR4 — the Orion assistant's turn ledger and the Help Center text search.
 *
 * `orion_turns` is the audit row and the budget ledger at once: a turn is
 * inserted as `reserved` before the provider call and the tenant's month is
 * the sum of these rows (D-OR-1). No prompt, answer or tool argument is
 * stored — tokens, cost and tool names only.
 *
 * `help_articles.search_vector` is a STORED generated column (Portuguese
 * configuration, title > summary > body) instead of a column the seed would
 * have to keep in sync: the seed writes through TypeORM `save`, and a
 * generated column can never drift from the row it indexes. Adding it
 * rewrites `help_articles`, which holds a few dozen platform articles.
 *
 * Idempotent (`IF [NOT] EXISTS`): the PostgreSQL specs run `up()` against a
 * test database the runner may already have migrated.
 */
export class CreateOrionTurnsAndHelpSearch1800700000000 implements MigrationInterface {
  name = 'CreateOrionTurnsAndHelpSearch1800700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orion_turns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "user_id" uuid NOT NULL,
        "principal" varchar(16) NOT NULL,
        "surface" varchar(24) NOT NULL,
        "status" varchar(16) NOT NULL,
        "idempotency_key" varchar(80) NOT NULL,
        "provider" varchar(40) NOT NULL,
        "model" varchar(80) NOT NULL,
        "prompt_version" varchar(40) NOT NULL,
        "reserved_cost_usd" numeric(12,6) NOT NULL,
        "estimated_cost_usd" numeric(12,6) NULL,
        "input_tokens" integer NULL,
        "cached_input_tokens" integer NULL,
        "output_tokens" integer NULL,
        "tool_calls" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "rounds" integer NOT NULL DEFAULT 0,
        "attempts" integer NOT NULL DEFAULT 0,
        "latency_ms" integer NULL,
        "error_code" varchar(80) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orion_turns" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_orion_turns_principal"
          CHECK ("principal" IN ('agency','client_area')),
        CONSTRAINT "CHK_orion_turns_surface"
          CHECK ("surface" IN ('operations_room','team_chat','client_chat')),
        CONSTRAINT "CHK_orion_turns_status"
          CHECK ("status" IN ('reserved','succeeded','failed')),
        CONSTRAINT "CHK_orion_turns_company_pair"
          CHECK (("agency_client_id" IS NULL) = ("company_context_id" IS NULL)),
        CONSTRAINT "CHK_orion_turns_costs"
          CHECK ("reserved_cost_usd" >= 0
                 AND ("estimated_cost_usd" IS NULL OR "estimated_cost_usd" >= 0))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_orion_turns_idempotency"
         ON "orion_turns" ("tenant_id", "user_id", "idempotency_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_orion_turns_tenant_created"
         ON "orion_turns" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_orion_turns_user_created"
         ON "orion_turns" ("tenant_id", "user_id", "created_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "help_articles"
        ADD COLUMN IF NOT EXISTS "search_vector" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('portuguese', coalesce("title", '')), 'A') ||
          setweight(to_tsvector('portuguese', coalesce("summary", '')), 'B') ||
          setweight(to_tsvector('portuguese', coalesce("content", '')), 'C')
        ) STORED
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_help_articles_search_vector"
         ON "help_articles" USING GIN ("search_vector")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_help_articles_search_vector"`,
    );
    await queryRunner.query(
      `ALTER TABLE "help_articles" DROP COLUMN IF EXISTS "search_vector"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "orion_turns"`);
  }
}
