import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks a dashboard as the fixed screen for one channel.
 *
 * The Analytics tab strip used to hold two different kinds of thing: saved
 * dashboards on the left, and a channel *filter* on the right that narrowed
 * whichever dashboard was open. Operators read both rows as tabs and expected
 * the channel ones to be screens of their own. They now are — one editable
 * dashboard per channel, seeded like "Visão Geral".
 *
 * ## Why a column and not a convention
 *
 * The alternative was to recognise these rows by name, or by "exactly one
 * channel and not default". Both are guesses about data an operator can change:
 * a dashboard they create and happen to call "Facebook", or any single-channel
 * dashboard they build by hand, would be silently promoted into a fixed screen
 * — renamed against their wishes, and undeletable. `channel_key` is set by the
 * seeder and by nothing else, so the distinction survives whatever anyone does
 * to the name.
 *
 * ## Why the unique index is partial
 *
 * One channel screen per scope, and `NULL` for every ordinary dashboard.
 * Postgres treats NULLs as distinct in a unique index, so without the WHERE
 * clause the constraint would be satisfied by any number of ordinary rows while
 * still doing its job for the seeded ones — which is what is wanted, but only
 * by accident. Saying it explicitly is what makes the intent readable, and it
 * keeps the index off the rows that will never be looked up through it.
 */
export class AddSocialDashboardChannelKey1795500000000
  implements MigrationInterface
{
  name = 'AddSocialDashboardChannelKey1795500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_analytics_dashboards"
         ADD COLUMN IF NOT EXISTS "channel_key" varchar(32)`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_analytics_dashboards_channel_company"
         ON "social_analytics_dashboards" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "channel_key")
         WHERE "channel_key" IS NOT NULL AND "agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_analytics_dashboards_channel_agency"
         ON "social_analytics_dashboards" ("tenant_id", "workspace_id", "channel_key")
         WHERE "channel_key" IS NOT NULL AND "agency_client_id" IS NULL AND "company_context_id" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_analytics_dashboards_channel_agency"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_analytics_dashboards_channel_company"',
    );
    await queryRunner.query(
      `ALTER TABLE "social_analytics_dashboards" DROP COLUMN IF EXISTS "channel_key"`,
    );
  }
}
