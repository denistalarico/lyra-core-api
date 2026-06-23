import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactCompanyLinks1782171304936 implements MigrationInterface {
  name = 'AddContactCompanyLinks1782171304936';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_company_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "person_contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "company_contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_company_links_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_company_links_person_company" UNIQUE ("person_contact_id", "company_contact_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_company_links_tenant_workspace"
      ON "contact_company_links" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_company_links_person"
      ON "contact_company_links" ("person_contact_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_company_links_company"
      ON "contact_company_links" ("company_contact_id");
    `);

    await queryRunner.query(`
      INSERT INTO "contact_company_links" ("tenant_id", "workspace_id", "person_contact_id", "company_contact_id")
      SELECT "tenant_id", "workspace_id", "id", "company_contact_id"
      FROM "contacts"
      WHERE "company_contact_id" IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_company_links";`);
  }
}
