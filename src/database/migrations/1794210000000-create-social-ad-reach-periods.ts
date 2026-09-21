import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Etapa 2B — the period reach measurement cache.
 *
 * Numbered `1794210000000`, which the campaign plan reserved and which is still
 * free: it sorts after `ExpandBrandKitAssetContext1794200000000` and before
 * Etapa 2A's `1794300000000`. Neither of those touches this table and this one
 * touches neither of theirs, so the two Etapa-2 migrations are independent in
 * both directions and the order between them does not matter.
 *
 * One table, and it is not a fact table. Every other table in the Social read
 * model stores something that happened on a day, from which a period total is a
 * sum. Reach cannot work that way — it is de-duplicated people, and the overlap
 * between two days is known only to Meta — so a row here stores the answer to
 * one question, *what was the reach of this exact range?*, measured by Meta in
 * its own de-duplicating pass. Ranges are never combined and never decomposed.
 */
export class CreateSocialAdReachPeriods1794210000000 implements MigrationInterface {
  name = 'CreateSocialAdReachPeriods1794210000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * A measurement, keyed by what it measured.
     *
     * `period_since` and `period_until` are both NOT NULL and both in the unique
     * key, which is the design stated in the schema: a range identifies the row.
     * There is deliberately no `metric_date` — a row is not about a day — and no
     * `source` or `attribution_setting`, because the measurement asks for one of
     * each and a column whose only value is a constant is a column nobody
     * validates.
     *
     * `reach` is nullable. Meta omits the field for some requests, and a `0`
     * standing for "not reported" would be indistinguishable from an account
     * that genuinely reached nobody. A null row still records that the
     * measurement happened and when, which is what stops a prewarm pass from
     * retrying it on every tick.
     *
     * `entity_level` admits `organic_asset` alongside the four paid levels. Only
     * `account` is written today; the others are in the CHECK because they are in
     * the unique key, and a level arriving later should not need a migration to
     * be storable.
     */
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_ad_reach_periods" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid,
      "connection_id" uuid NOT NULL,
      "provider" varchar(40) NOT NULL,
      "entity_level" varchar(20) NOT NULL,
      "entity_external_id" varchar(180) NOT NULL,
      "period_since" date NOT NULL,
      "period_until" date NOT NULL,
      "account_timezone" varchar(64) NOT NULL,
      "reach" bigint,
      "is_partial" boolean NOT NULL DEFAULT false,
      "measured_at" timestamptz NOT NULL DEFAULT now(),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_social_ad_reach_periods_level" CHECK ("entity_level" IN ('account', 'campaign', 'adset', 'ad', 'organic_asset')),
      CONSTRAINT "CK_social_ad_reach_periods_range" CHECK ("period_since" <= "period_until"),
      CONSTRAINT "CK_social_ad_reach_periods_non_negative" CHECK ("reach" IS NULL OR "reach" >= 0)
    )`);

    /**
     * The ON CONFLICT target, and the index the read uses.
     *
     * The read looks a measurement up by **equality on both endpoints** — never
     * `BETWEEN`, which would match ranges nested inside the requested one and
     * return a smaller period's reach under a larger period's label. This index
     * serves that lookup exactly, and being unique is what makes re-measuring a
     * partial range an update rather than a second row.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_reach_periods_measurement" ON "social_ad_reach_periods" ("tenant_id", "workspace_id", "connection_id", "entity_level", "entity_external_id", "period_since", "period_until")`,
    );

    /**
     * The rows a prewarm pass must re-measure.
     *
     * Partial in both senses, like the facts table's own partial index: it holds
     * only the measurements still moving, so "what is stale?" stays a small scan
     * however many closed ranges have accumulated behind it. Closed ranges are
     * immutable — a late-attributed conversion lands on a day whose audience was
     * already counted — so they never appear here again.
     */
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_ad_reach_periods_partial" ON "social_ad_reach_periods" ("connection_id", "period_until") WHERE "is_partial"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "social_ad_reach_periods"');
  }
}
