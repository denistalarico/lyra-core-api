import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactLifecycleStagesArray1782171244936
  implements MigrationInterface
{
  name = 'AddContactLifecycleStagesArray1782171244936';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contacts"
      ADD COLUMN IF NOT EXISTS "lifecycle_stages" text[] NOT NULL DEFAULT '{}';
    `);

    await queryRunner.query(`
      UPDATE "contacts"
      SET "lifecycle_stages" = ARRAY["lifecycle_stage"]
      WHERE "lifecycle_stages" = '{}';
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contacts_lifecycle_stages"
      ON "contacts" USING GIN ("lifecycle_stages");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_contacts_lifecycle_stages";`);
    await queryRunner.query(
      `ALTER TABLE "contacts" DROP COLUMN IF EXISTS "lifecycle_stages";`,
    );
  }
}
