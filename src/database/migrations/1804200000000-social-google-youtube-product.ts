import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * YT1-BE — `youtube` becomes a Google product (D-I1).
 *
 * `social_google_oauth_sessions` and `social_google_product_links` restrict
 * `product` with a CHECK that does not list it. Both are widened; no row is
 * touched. `down` narrows them again and fails (rolling back) if a `youtube`
 * row exists: nothing is deleted to make it pass.
 */
export class SocialGoogleYoutubeProduct1804200000000 implements MigrationInterface {
  name = 'SocialGoogleYoutubeProduct1804200000000';

  private readonly targets = [
    [
      'social_google_oauth_sessions',
      'CHK_social_google_oauth_sessions_product',
    ],
    ['social_google_product_links', 'CHK_social_google_product_links_product'],
  ] as const;

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, constraint] of this.targets) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}"
           CHECK ("product" IN ('ga4','ads','business_profile','youtube'))`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, constraint] of this.targets) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}"
           CHECK ("product" IN ('ga4','ads','business_profile'))`,
      );
    }
  }
}
