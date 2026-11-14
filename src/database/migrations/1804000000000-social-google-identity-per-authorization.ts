import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * G0.4.2-H — independent Google connections per product.
 *
 * The original index allowed one live authorization per context, which forced
 * every product of a context onto a single Google identity. It is replaced by
 * one live authorization per context *and Google identity* (`google_sub`);
 * products stay exclusive per context in the application, under a per-context
 * advisory lock.
 *
 * Non-destructive: the new index is strictly weaker than the old one, so every
 * existing row satisfies it, and no row or token is touched. `down` restores
 * the old index and therefore fails — loudly, rolling back — if a context
 * already holds two live identities; nothing is deleted to make it pass.
 */
export class SocialGoogleIdentityPerAuthorization1804000000000 implements MigrationInterface {
  name = 'SocialGoogleIdentityPerAuthorization1804000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_google_authorizations_live_identity"
         ON "social_google_authorizations" (
           "tenant_id","workspace_id",
           COALESCE("agency_client_id",'00000000-0000-0000-0000-000000000000'::uuid),
           COALESCE("company_context_id",'00000000-0000-0000-0000-000000000000'::uuid),
           "google_sub"
         ) WHERE "status" <> 'revoked'`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_google_authorizations_live_context"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_google_authorizations_live_context"
         ON "social_google_authorizations" (
           "tenant_id","workspace_id",
           COALESCE("agency_client_id",'00000000-0000-0000-0000-000000000000'::uuid),
           COALESCE("company_context_id",'00000000-0000-0000-0000-000000000000'::uuid)
         ) WHERE "status" <> 'revoked'`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_google_authorizations_live_identity"`,
    );
  }
}
