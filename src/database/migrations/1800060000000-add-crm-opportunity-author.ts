import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CA11.1: the opportunity records its immutable author. Until now authorship was derived from
 * the first event's actor; the backfill copies exactly that value, so existing rows keep the
 * owner the client bridge already enforced. Agent/automation creations stay null.
 */
export class AddCrmOpportunityAuthor1800060000000 implements MigrationInterface {
  name = 'AddCrmOpportunityAuthor1800060000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS created_by_user_id uuid NULL',
    );
    await runner.query(`UPDATE crm_opportunities o SET created_by_user_id=f.actor_user_id
      FROM (
        SELECT DISTINCT ON (opportunity_id,tenant_id,workspace_id) opportunity_id,tenant_id,workspace_id,actor_user_id
        FROM crm_opportunity_events
        ORDER BY opportunity_id,tenant_id,workspace_id,created_at,id
      ) f
      WHERE f.opportunity_id=o.id AND f.tenant_id=o.tenant_id AND f.workspace_id=o.workspace_id
        AND o.created_by_user_id IS NULL AND f.actor_user_id IS NOT NULL`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS created_by_user_id',
    );
  }
}
