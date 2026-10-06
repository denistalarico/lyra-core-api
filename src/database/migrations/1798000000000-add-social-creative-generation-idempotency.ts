import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS3.2.1 — request idempotency for `POST /social/creative-studio/generations/images`.
 *
 * A double click, an HTTP retry or a client replay must create at most one
 * generation — and, once a paid provider is connected (CS3.3), at most one
 * charge. The client sends an `Idempotency-Key`; the server stores it with a
 * fingerprint of the normalized request:
 *
 *   idempotency_key       the client's opaque key, as sent (same rule as Inbox)
 *   request_fingerprint   sha256 hex of the normalized business request
 *
 * The UNIQUE index is the final barrier under concurrency: the key is unique
 * per full four-part scope and operation (`generation_type`). The scope parts
 * that may be NULL (agency mode) are COALESCEd to the nil UUID, the platform's
 * pattern for nullable scope in unique indexes — a plain UNIQUE would treat
 * two agency-mode NULLs as distinct and let the duplicate in.
 *
 * Both columns are nullable only for generations created before CS3.2.1
 * (dev/staging; 1797900000000 had not reached production). The API always
 * writes them; the CHECK keeps them together.
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class AddSocialCreativeGenerationIdempotency1798000000000 implements MigrationInterface {
  name = 'AddSocialCreativeGenerationIdempotency1798000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(180),
        ADD COLUMN IF NOT EXISTS "request_fingerprint" char(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_idempotency",
        ADD CONSTRAINT "CK_social_creative_generations_idempotency"
          CHECK (
            ("idempotency_key" IS NULL) = ("request_fingerprint" IS NULL)
            AND (
              "idempotency_key" IS NULL
              OR "idempotency_key" ~ '^[A-Za-z0-9._:-]{1,180}$'
            )
            AND (
              "request_fingerprint" IS NULL
              OR "request_fingerprint" ~ '^[0-9a-f]{64}$'
            )
          )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_creative_generations_idempotency"
        ON "social_creative_generations" (
          "tenant_id",
          "workspace_id",
          COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE("company_context_id", '00000000-0000-0000-0000-000000000000'::uuid),
          "generation_type",
          "idempotency_key"
        )
        WHERE "idempotency_key" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_creative_generations_idempotency"',
    );
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_idempotency",
        DROP COLUMN IF EXISTS "request_fingerprint",
        DROP COLUMN IF EXISTS "idempotency_key"
    `);
  }
}
