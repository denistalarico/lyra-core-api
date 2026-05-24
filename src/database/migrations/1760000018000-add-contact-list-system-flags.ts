import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactListSystemFlags1760000018000
  implements MigrationInterface
{
  name = 'AddContactListSystemFlags1760000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      ADD COLUMN IF NOT EXISTS "is_system" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      ADD COLUMN IF NOT EXISTS "is_protected" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      ADD COLUMN IF NOT EXISTS "source_product" varchar(80)
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      ADD COLUMN IF NOT EXISTS "source_context" varchar(120)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_lists_source_product"
      ON "contact_lists" ("workspace_id", "source_product")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_contact_lists_source_product"
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      DROP COLUMN IF EXISTS "source_context"
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      DROP COLUMN IF EXISTS "source_product"
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      DROP COLUMN IF EXISTS "is_protected"
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      DROP COLUMN IF EXISTS "is_system"
    `);
  }
}
