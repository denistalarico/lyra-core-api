import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O WhatsApp do usuário, para a notificação de handoff.
 *
 * Até aqui o notificador de handoff usava o telefone do perfil como se fosse
 * WhatsApp. Isso vira explícito: `whatsapp_same_as_phone` (padrão `true`,
 * preservando exatamente o comportamento atual) e, quando desmarcado, um
 * número próprio em `whatsapp_phone`.
 */
export class AddUserProfileWhatsapp1789400000000 implements MigrationInterface {
  name = 'AddUserProfileWhatsapp1789400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "whatsapp_phone" varchar(40)
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "whatsapp_same_as_phone" boolean NOT NULL DEFAULT true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      DROP COLUMN IF EXISTS "whatsapp_same_as_phone"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      DROP COLUMN IF EXISTS "whatsapp_phone"
    `);
  }
}
