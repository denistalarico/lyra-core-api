import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactListParent1760000017000 implements MigrationInterface {
  name = 'AddContactListParent1760000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      ADD COLUMN IF NOT EXISTS "parent_list_id" uuid;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_contact_lists_parent'
        ) THEN
          ALTER TABLE "contact_lists"
          ADD CONSTRAINT "fk_contact_lists_parent"
          FOREIGN KEY ("parent_list_id")
          REFERENCES "contact_lists"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_lists_parent"
      ON "contact_lists" ("parent_list_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_contact_lists_parent";`);
    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      DROP CONSTRAINT IF EXISTS "fk_contact_lists_parent";
    `);
    await queryRunner.query(`
      ALTER TABLE "contact_lists"
      DROP COLUMN IF EXISTS "parent_list_id";
    `);
  }
}
