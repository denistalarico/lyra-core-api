import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rewrites the automatic-tagging instances onto `conditions.tagRules`.
 *
 * The recipe used to describe exactly one rule, spread over four keys:
 * `conditions.ruleField`, `ruleOperator` and `ruleValue` said what to look at,
 * and `actions.addTags` said which tags to apply. That shape cannot express
 * what tagging is actually for — "veio do WhatsApp" and "é urgente" deserve
 * different tags — so the rule became one value, carrying its own tags, and the
 * automation carries a list of them.
 *
 * Rewriting the rows is not optional. Configuration validation is fail-closed
 * against the keys the recipe declares, so an instance still holding the old
 * keys would be refused the next time an operator saved it, and its rule would
 * be invisible on a screen that no longer asks those questions. The legacy rule
 * is carried over as the first entry whenever it is complete enough to apply a
 * tag; anything less becomes an empty list, which the lifecycle reports as an
 * unconfigured automation instead of quietly keeping half a rule.
 *
 * `down` restores the single-rule shape from the first rule, which is the only
 * part of a list the old contract could hold.
 */
export class TagRulesForAutomaticTagging1789800000000 implements MigrationInterface {
  name = 'TagRulesForAutomaticTagging1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "leadflow_automations" AS a
      SET
        "condition_config" =
          (a."condition_config" - 'keywords' - 'ruleField' - 'ruleOperator' - 'ruleValue')
          || jsonb_build_object('tagRules', CASE
            WHEN COALESCE(a."condition_config" ->> 'ruleField', '') <> ''
             AND jsonb_array_length(COALESCE(
                   NULLIF(a."action_config" -> 'addTags', '[]'::jsonb),
                   a."crm_policy" -> 'addTags',
                   '[]'::jsonb)) > 0
            THEN jsonb_build_array(jsonb_build_object(
              'field', a."condition_config" ->> 'ruleField',
              'operator', COALESCE(a."condition_config" ->> 'ruleOperator', 'is_present'),
              'value', CASE
                WHEN COALESCE(a."condition_config" ->> 'ruleOperator', 'is_present') = 'is_present'
                THEN 'null'::jsonb
                ELSE COALESCE(a."condition_config" -> 'ruleValue', 'null'::jsonb)
              END,
              'tagIds', COALESCE(
                NULLIF(a."action_config" -> 'addTags', '[]'::jsonb),
                a."crm_policy" -> 'addTags',
                '[]'::jsonb)))
            ELSE '[]'::jsonb
          END),
        "action_config" = a."action_config" - 'addTags',
        "crm_policy" = a."crm_policy" - 'addTags',
        "template_version" = 4,
        "updated_at" = now()
      WHERE a."recipe_key" = 'automatic_tagging'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "leadflow_automations" AS a
      SET
        "condition_config" = (a."condition_config" - 'tagRules') || jsonb_build_object(
          'keywords', '[]'::jsonb,
          'ruleField', COALESCE(a."condition_config" -> 'tagRules' -> 0 ->> 'field', 'source'),
          'ruleOperator', COALESCE(a."condition_config" -> 'tagRules' -> 0 ->> 'operator', 'is_present'),
          'ruleValue', COALESCE(a."condition_config" -> 'tagRules' -> 0 -> 'value', 'null'::jsonb)),
        "action_config" = a."action_config" || jsonb_build_object(
          'addTags', COALESCE(a."condition_config" -> 'tagRules' -> 0 -> 'tagIds', '[]'::jsonb)),
        "crm_policy" = a."crm_policy" || jsonb_build_object('addTags', '[]'::jsonb),
        "template_version" = 3,
        "updated_at" = now()
      WHERE a."recipe_key" = 'automatic_tagging'
    `);
  }
}
