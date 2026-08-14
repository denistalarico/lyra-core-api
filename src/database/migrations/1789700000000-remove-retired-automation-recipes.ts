import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the automation instances whose recipes were withdrawn from the
 * catalog (see `RETIRED_AUTOMATION_RECIPE_KEYS`).
 *
 * Seven of the nine were the same automation wearing different names — wait,
 * then send a message — which the canonical follow-up cadence now does in one
 * place. `automatic_handoff` re-declared a handoff the agent already performs
 * through the governed action worker, and `birthday_or_special_date` needed a
 * birth date the platform does not collect.
 *
 * The rows must go, not just the catalog entries: an instance whose recipe no
 * longer resolves is a card the operator can open, cannot configure and cannot
 * delete. Versions and runs are removed by their `ON DELETE CASCADE`, and any
 * timer still armed for one of them is cancelled first so the scheduler does not
 * spend retries on work that has no automation left to authorise it.
 *
 * Not reversible on purpose: a rolled-back deployment would find no recipe to
 * bring the rows back to, so `down` is a no-op rather than a lie.
 */
export class RemoveRetiredAutomationRecipes1789700000000
  implements MigrationInterface
{
  name = 'RemoveRetiredAutomationRecipes1789700000000';

  private readonly retiredKeys = [
    'automatic_handoff',
    'birthday_or_special_date',
    'campaign_followup',
    'cold_lead_reactivation',
    'followup_by_crm_stage',
    'missing_fields_request',
    'pending_documents',
    'post_service_followup',
    'quote_recovery',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE "leadflow_scheduled_timers"
      SET "status" = 'cancelled', "cancelled_at" = now(), "updated_at" = now()
      WHERE "status" = 'scheduled'
        AND "payload" ->> 'automationId' IN (
          SELECT "id"::text FROM "leadflow_automations"
          WHERE "recipe_key" = ANY($1)
        )
      `,
      [this.retiredKeys],
    );

    await queryRunner.query(
      `DELETE FROM "leadflow_automations" WHERE "recipe_key" = ANY($1)`,
      [this.retiredKeys],
    );
  }

  public async down(): Promise<void> {
    // Deliberately empty: the recipes these rows were provisioned from no
    // longer exist, so recreating the instances would produce automations that
    // resolve to nothing — the exact state this migration removes.
  }
}
