import type { MigrationInterface, QueryRunner } from 'typeorm';

/** When the verified custom domain first answered over HTTPS (on-demand TLS at the edge). */
export class AddClientAreaDomainTlsStatus1801500000000 implements MigrationInterface {
  name = 'AddClientAreaDomainTlsStatus1801500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_area_settings" ADD COLUMN IF NOT EXISTS "domain_tls_active_at" timestamptz`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_area_settings" DROP COLUMN IF EXISTS "domain_tls_active_at"`,
    );
  }
}
