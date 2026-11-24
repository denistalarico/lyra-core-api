import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assinatura de e-mail por usuário (2026-11-24). HTML já sanitizado no
 * salvamento; o compositor do CRM a insere no corpo e quem envia pode editar.
 */
export class AddUserProfileEmailSignature1805900000000 implements MigrationInterface {
  name = 'AddUserProfileEmailSignature1805900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_profile" ADD COLUMN IF NOT EXISTS "email_signature_html" text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_profile" DROP COLUMN IF EXISTS "email_signature_html"`,
    );
  }
}
