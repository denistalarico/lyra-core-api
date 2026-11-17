import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialCalendarContainers1802500000000 implements MigrationInterface {
  name = 'AddSocialCalendarContainers1802500000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE social_plans ADD COLUMN calendar_container boolean NOT NULL DEFAULT false`);
    // Existing calendar-only posts leave their editorial plans without changing those plans or their approvals.
    await queryRunner.query(`
      WITH mapping AS MATERIALIZED (
        SELECT p.*, gen_random_uuid() AS container_id FROM social_plans p
        WHERE EXISTS (SELECT 1 FROM social_content_items i WHERE i.plan_id = p.id AND i.calendar_only = true)
      ), inserted AS (
        INSERT INTO social_plans (id, tenant_id, workspace_id, agency_client_id, company_context_id, title, period_start, period_end, status, calendar_container, deleted_at)
        SELECT container_id, tenant_id, workspace_id, agency_client_id, company_context_id, 'Publicações avulsas', period_start, period_end, 'draft', true, deleted_at FROM mapping
        RETURNING id
      )
      UPDATE social_content_items i SET plan_id = m.container_id
      FROM mapping m JOIN inserted n ON n.id = m.container_id
      WHERE i.plan_id = m.id AND i.calendar_only = true
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse rollback once standalone posts exist: exposing their containers as plans would change the editorial view.
    await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM social_plans WHERE calendar_container) THEN RAISE EXCEPTION 'Calendar containers exist; migrate their content before rollback'; END IF; END $$`);
    await queryRunner.query(`ALTER TABLE social_plans DROP COLUMN calendar_container`);
  }
}
