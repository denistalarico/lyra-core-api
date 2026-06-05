import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKnowledgeVaultNotesEncryptionFields1760002043000
  implements MigrationInterface
{
  name = "AddKnowledgeVaultNotesEncryptionFields1760002043000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_knowledge_vault_items"
      ADD COLUMN IF NOT EXISTS "encrypted_notes_iv" character varying(64)
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_knowledge_vault_items"
      ADD COLUMN IF NOT EXISTS "encrypted_notes_auth_tag" character varying(64)
    `);

    await queryRunner.query(`
      UPDATE "agency_knowledge_vault_items"
      SET
        "encrypted_notes" = NULL,
        "encrypted_notes_iv" = NULL,
        "encrypted_notes_auth_tag" = NULL
      WHERE "encrypted_notes" IS NOT NULL
        AND (
          "encrypted_notes_iv" IS NULL
          OR "encrypted_notes_auth_tag" IS NULL
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_knowledge_vault_items"
      DROP COLUMN IF EXISTS "encrypted_notes_auth_tag"
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_knowledge_vault_items"
      DROP COLUMN IF EXISTS "encrypted_notes_iv"
    `);
  }
}
