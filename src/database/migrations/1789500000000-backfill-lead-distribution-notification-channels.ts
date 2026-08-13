import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O canal do aviso de lead distribuído, nas automações já provisionadas.
 *
 * A receita `lead_distribution` passou a declarar `notificationChannels` para
 * avisar quem recebeu o lead. As linhas criadas antes disso não têm a chave, e
 * o campo é obrigatório no schema — sem este backfill, uma automação ativa em
 * produção passaria a aparecer como "configuração incompleta" até alguém abrir
 * a tela e salvar.
 *
 * O preenchimento é aditivo e idempotente: só toca em quem ainda não tem a
 * chave, e grava o mesmo padrão da receita (aviso no sistema).
 */
export class BackfillLeadDistributionNotificationChannels1789500000000
  implements MigrationInterface
{
  name = 'BackfillLeadDistributionNotificationChannels1789500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "leadflow_automations"
      SET "action_config" =
        "action_config" || '{"notificationChannels": ["in_app"]}'::jsonb
      WHERE "recipe_key" = 'lead_distribution'
        AND NOT ("action_config" ? 'notificationChannels')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Só remove o que este backfill poderia ter escrito: uma escolha diferente,
    // feita por um operador depois, não é desta migration para desfazer.
    await queryRunner.query(`
      UPDATE "leadflow_automations"
      SET "action_config" = "action_config" - 'notificationChannels'
      WHERE "recipe_key" = 'lead_distribution'
        AND "action_config" -> 'notificationChannels' = '["in_app"]'::jsonb
    `);
  }
}
