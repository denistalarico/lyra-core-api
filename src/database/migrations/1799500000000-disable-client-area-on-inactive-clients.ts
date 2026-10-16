import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CA5: data repair never restores access on rollback (D-08).
 * Authorized extension: system revocations + company removal audit. Down
 * restores legacy write constraints NOT VALID: historical system events remain
 * append-only and are neither deleted nor falsely attributed to a human. */
export class DisableClientAreaOnInactiveClients1799500000000 implements MigrationInterface {
  name = 'DisableClientAreaOnInactiveClients1799500000000';
  async up(runner: QueryRunner): Promise<void> {
    await this.dropAuditConstraints(runner);
    await runner.query(`ALTER TABLE client_area_member_events
      ADD CONSTRAINT "CK_client_area_member_events_action" CHECK (action IN ('invited','invitation_resent','invitation_revoked','invitation_accepted','invitation_acceptance_blocked','role_changed','membership_revoked','access_removed')),
      ADD CONSTRAINT "CK_client_area_member_events_actor_surface" CHECK (actor_surface IN ('agency','client_area','system')),
      ADD CONSTRAINT "CK_client_area_member_events_actor" CHECK (
        (actor_surface = 'system' AND actor_user_id IS NULL AND action IN ('membership_revoked','invitation_revoked','access_removed')) OR
        (actor_surface <> 'system' AND (actor_user_id IS NOT NULL OR action = 'invitation_acceptance_blocked'))
      )`);
    await runner.query(`UPDATE client_area_company_settings settings SET enabled = false, updated_at = now()
      FROM agency_client_company_contexts company
      JOIN agency_clients client ON client.id = company.agency_client_id AND client.tenant_id = company.tenant_id AND client.workspace_id = company.workspace_id
      JOIN contacts organization ON organization.id = company.company_contact_id AND organization.tenant_id = company.tenant_id AND organization.workspace_id = company.workspace_id
      WHERE settings.company_context_id = company.id AND settings.tenant_id = company.tenant_id AND settings.workspace_id = company.workspace_id
        AND settings.enabled = true
        AND (client.status <> 'active' OR client.archived_at IS NOT NULL OR company.status <> 'active' OR company.archived_at IS NOT NULL OR organization.status <> 'active' OR organization.type <> 'organization')`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await this.dropAuditConstraints(runner);
    await runner.query(`ALTER TABLE client_area_member_events
      ADD CONSTRAINT "CK_client_area_member_events_action" CHECK (action IN ('invited','invitation_resent','invitation_revoked','invitation_accepted','invitation_acceptance_blocked','role_changed','membership_revoked')) NOT VALID,
      ADD CONSTRAINT "CK_client_area_member_events_actor_surface" CHECK (actor_surface IN ('agency','client_area')) NOT VALID,
      ADD CONSTRAINT "CK_client_area_member_events_actor" CHECK (actor_user_id IS NOT NULL OR action = 'invitation_acceptance_blocked') NOT VALID`);
    // Intentionally no reversal of enabled=false or of revocations/history.
  }
  private async dropAuditConstraints(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE client_area_member_events
      DROP CONSTRAINT IF EXISTS "CK_client_area_member_events_action",
      DROP CONSTRAINT IF EXISTS "CK_client_area_member_events_actor_surface",
      DROP CONSTRAINT IF EXISTS "CK_client_area_member_events_actor"`);
  }
}
