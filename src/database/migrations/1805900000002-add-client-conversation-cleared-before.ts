import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F9 (2026-11-24) — "Limpar canal" só para mim (D-08).
 *
 * Marco por participante: a timeline, os anexos, o unread e a última mensagem
 * do leitor passam a considerar só o que é posterior a ele. Nada é apagado;
 * coluna aditiva e nullable (null = nunca limpou).
 */
export class AddClientConversationClearedBefore1805900000002 implements MigrationInterface {
  name = 'AddClientConversationClearedBefore1805900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_conversation_participants" ADD COLUMN IF NOT EXISTS "cleared_before_at" timestamptz NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_conversation_participants" DROP COLUMN IF EXISTS "cleared_before_at"`,
    );
  }
}
