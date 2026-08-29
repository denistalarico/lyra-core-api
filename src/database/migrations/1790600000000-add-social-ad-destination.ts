import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records where a paid-media ad set actually sends people.
 *
 * Columns rather than `metadata` keys because this is a grouping dimension:
 * "spend and leads by destination" scans an account and groups on it, and a
 * jsonb extraction can neither be indexed nor typed the way a varchar can.
 *
 * Three columns, because they answer three different questions:
 *
 * - `destination_type` is Lyra's canonical value (`whatsapp`,
 *   `instagram_direct`, `messenger`, `messaging_multi`, `website`…), shared
 *   across providers so a future Google Ads adapter groups into the same set.
 * - `destination_raw` is Meta's own string, kept verbatim. The mapping between
 *   the two is the part most likely to be incomplete — Meta ships new
 *   destinations without notice — and keeping the original means a corrected
 *   mapping can be re-derived from stored rows instead of by re-syncing every
 *   account.
 * - `destination_observed_at` says when the provider last stated it, which is
 *   the honest boundary of what a current-state mirror can claim: an ad set
 *   repointed in Ads Manager rewrites its row, so a reader must be able to see
 *   that a classification was observed *after* the period it is applied to.
 *
 * All three are nullable with no default, and nothing is backfilled. Every
 * existing row stays NULL until a sync observes a real value from the provider:
 * a default would assert a destination Meta never stated, and deriving one from
 * a campaign name or an optimization goal would be a guess written into a
 * column that later reads as measurement. `optimization_goal = CONVERSATIONS`
 * in particular covers WhatsApp, Messenger, Instagram Direct and multi-app ad
 * sets simultaneously, so it cannot stand in for any of them.
 *
 * No index. The candidate query groups by destination over an account's ad sets
 * — hundreds of rows, not millions — and the existing scope index already
 * narrows to tenant, workspace and level before the grouping happens. An index
 * added here without a plan that uses it would be write cost for nothing.
 */
export class AddSocialAdDestination1790600000000 implements MigrationInterface {
  name = 'AddSocialAdDestination1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_entities"
        ADD COLUMN IF NOT EXISTS "destination_type" varchar(40),
        ADD COLUMN IF NOT EXISTS "destination_raw" varchar(60),
        ADD COLUMN IF NOT EXISTS "destination_observed_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_entities"
        DROP COLUMN IF EXISTS "destination_type",
        DROP COLUMN IF EXISTS "destination_raw",
        DROP COLUMN IF EXISTS "destination_observed_at"
    `);
  }
}
