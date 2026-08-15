import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets the out-of-hours reply happen during the handoff that provokes it.
 *
 * Every recipe inherits `conditions.stopIfHandoff = true`, which is the right
 * default almost everywhere: an automation must not talk over a human who has
 * taken the conversation. For this one it was exactly backwards. Its trigger is
 * derived from a handoff request outside business hours, so the condition
 * cancelled the automation at the only moment it was ever meant to act — and
 * the operator could not see it, because the field is not a question this
 * screen asks.
 *
 * `stopIfReplied` goes the same way: the lead writing again at midnight is what
 * there is to answer, not a reason to stay silent. The recipe defaults now say
 * both, and the stored instances have to be told, because a persisted value
 * always wins over the template.
 *
 * `down` restores the inherited guards, which is what these rows held before.
 */
export class OutsideHoursAnswersDuringHandoff1789900000000 implements MigrationInterface {
  name = 'OutsideHoursAnswersDuringHandoff1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "leadflow_automations"
      SET
        "condition_config" = "condition_config" || jsonb_build_object(
          'stopIfHandoff', false,
          'stopIfReplied', false),
        "template_version" = 4,
        "updated_at" = now()
      WHERE "recipe_key" = 'outside_business_hours'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "leadflow_automations"
      SET
        "condition_config" = "condition_config" || jsonb_build_object(
          'stopIfHandoff', true,
          'stopIfReplied', false),
        "template_version" = 3,
        "updated_at" = now()
      WHERE "recipe_key" = 'outside_business_hours'
    `);
  }
}
