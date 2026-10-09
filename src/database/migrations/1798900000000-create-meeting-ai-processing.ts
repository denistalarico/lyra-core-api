import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMeetingAiProcessing1798900000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE agency_meeting_ai_settings (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL, config jsonb NOT NULL DEFAULT '{"enabled":false,"expenseAccountId":null,"costCenterId":null,"maxCostUsd":2,"maxCaptureMinutes":90,"retentionDays":30}',
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, workspace_id)
    )`);
    await runner.query(`ALTER TABLE agency_meeting_ai_summaries
      ADD COLUMN execution jsonb, ADD COLUMN agreements jsonb, ADD COLUMN open_questions jsonb,
      ADD COLUMN lease_token uuid, ADD COLUMN lease_expires_at timestamptz, ADD COLUMN next_attempt_at timestamptz`);
    await runner.query(`CREATE UNIQUE INDEX agency_meeting_ai_execution_unique ON agency_meeting_ai_summaries
      (tenant_id, workspace_id, meeting_room_id) WHERE execution IS NOT NULL`);
    await runner.query(`CREATE INDEX agency_meeting_ai_worker_due ON agency_meeting_ai_summaries
      (next_attempt_at, lease_expires_at) WHERE execution IS NOT NULL AND (status = 'processing' OR (status = 'failed' AND execution->>'captureStopPending' = 'true'))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX agency_meeting_ai_worker_due');
    await runner.query('DROP INDEX agency_meeting_ai_execution_unique');
    await runner.query(`ALTER TABLE agency_meeting_ai_summaries DROP COLUMN execution, DROP COLUMN agreements,
      DROP COLUMN open_questions, DROP COLUMN lease_token, DROP COLUMN lease_expires_at, DROP COLUMN next_attempt_at`);
    await runner.query('DROP TABLE agency_meeting_ai_settings');
  }
}
