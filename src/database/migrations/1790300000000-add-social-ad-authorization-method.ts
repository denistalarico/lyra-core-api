import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records how a Social ad connection obtained its credential.
 *
 * A column rather than a metadata key on purpose: this value decides where the
 * credential is read from. `business_login` rows carry an encrypted token in
 * `access_token_encrypted`; `internal_system_user` rows carry none and read a
 * System User token from server configuration instead. Code that resolves a
 * credential must branch on it, and a behavioural branch keyed on
 * unconstrained JSON is one typo away from taking the wrong path silently.
 *
 * The default backfills every existing row with the only method that existed
 * until now, so no data migration is needed and no row can end up claiming the
 * internal method by omission.
 */
export class AddSocialAdAuthorizationMethod1790300000000
  implements MigrationInterface
{
  name = 'AddSocialAdAuthorizationMethod1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_account_connections"
        ADD COLUMN IF NOT EXISTS "authorization_method" varchar(40)
        NOT NULL DEFAULT 'business_login'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_account_connections"
        DROP COLUMN IF EXISTS "authorization_method"
    `);
  }
}
