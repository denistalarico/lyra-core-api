import type { MigrationInterface, QueryRunner } from 'typeorm';

const ACTIVE = `('draft','awaiting_internal_review','awaiting_client','changes_requested')`;

/**
 * CS5 Closeout — approval requests in the tenant's own scope.
 *
 * AP1 bound every request to a Company Context
 * (`CK_social_approval_requests_scope`, both ids NOT NULL). The corrected
 * product decision gives the agency's own content (and a B2B company's own
 * Social) an internal-only approval, so a request may now also live in the
 * own scope `(NULL, NULL)` — never in legacy `(client, NULL)`, and never with
 * a synthetic Company Context.
 *
 * - Company rows are untouched: the composite FK to
 *   `agency_client_company_contexts` still binds them (MATCH SIMPLE skips the
 *   check only when a column is NULL, which now means "own scope").
 * - Own-scope uniqueness of the active request per revision gets its own
 *   partial index: the original index compares NULLs as distinct and would
 *   not serialize two own-scope drafts of the same revision.
 * - Own scope never enters the client stage (stage policy, enforced here too).
 *
 * `down` refuses while own-scope requests exist: dropping them would delete
 * approval history, which is append-only by design.
 */
export class AllowOwnScopeSocialApprovals1798800000000 implements MigrationInterface {
  name = 'AllowOwnScopeSocialApprovals1798800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ALTER COLUMN "agency_client_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ALTER COLUMN "company_context_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ADD CONSTRAINT "CK_social_approval_requests_scope" CHECK (
        ("agency_client_id" IS NULL AND "company_context_id" IS NULL)
        OR ("agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL)
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_own_internal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ADD CONSTRAINT "CK_social_approval_requests_own_internal" CHECK (
        "agency_client_id" IS NOT NULL
        OR ("current_stage" = 'internal' AND "status" <> 'awaiting_client' AND "sent_to_client_at" IS NULL)
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_approval_requests_active_revision_own"
        ON "social_approval_requests" ("tenant_id","workspace_id","subject_type","subject_id","subject_revision_id")
        WHERE "agency_client_id" IS NULL AND "company_context_id" IS NULL AND "status" IN ${ACTIVE}`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "social_approval_requests"
           WHERE "agency_client_id" IS NULL OR "company_context_id" IS NULL
        ) THEN
          RAISE EXCEPTION 'social_approval_requests has own-scope approvals; refusing to drop them';
        END IF;
      END $$`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_approval_requests_active_revision_own"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_own_internal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ADD CONSTRAINT "CK_social_approval_requests_scope" CHECK ("agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ALTER COLUMN "agency_client_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ALTER COLUMN "company_context_id" SET NOT NULL`,
    );
  }
}
