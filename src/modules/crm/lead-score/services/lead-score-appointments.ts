import type { EntityManager } from 'typeorm';
import type { CrmOpportunityEntity } from '../../entities/crm-opportunity.entity';
import type { LeadScoreAppointmentOutcome } from '../lead-score.types';

/**
 * Which appointments belong to an opportunity.
 *
 * The explicit link (`source_opportunity_id`) wins. Without it, the Agenda only
 * records the contact, so an appointment counts for the contact's opportunities
 * that already existed when it was booked — a meeting from a previous, closed
 * cycle never scores the new one. Deleted appointments are soft-deleted and
 * excluded.
 */
const LINKED_APPOINTMENTS_SQL = `
  SELECT item.status, item.metadata
    FROM scheduled_items item
   WHERE item.tenant_id = $1
     AND item.workspace_id = $2
     AND item.deleted_at IS NULL
     AND item.type IN ('event', 'meeting', 'call')
     AND (
       item.source_opportunity_id = $3
       OR (
         item.source_opportunity_id IS NULL
         AND $4::uuid IS NOT NULL
         AND item.contact_id = $4::uuid
         AND item.created_at >= $5
       )
     )
   ORDER BY COALESCE(item.start_at, item.due_at, item.created_at) DESC
   LIMIT 20`;

/** Mirrors AppointmentsService: metadata wins, then the storage status. */
function appointmentLifecycle(
  status: string,
  metadata: Record<string, unknown> | null,
): string {
  const fromMetadata = metadata?.appointmentStatus;
  if (typeof fromMetadata === 'string' && fromMetadata) return fromMetadata;
  if (status === 'completed') return 'completed';
  if (status === 'canceled') return 'canceled';
  if (status === 'missed') return 'no_show';
  if (status === 'postponed') return 'rescheduled';
  return 'confirmed';
}

/** Outcome of the latest appointment that was not cancelled. */
export async function loadLatestAppointmentOutcome(
  manager: EntityManager,
  opportunity: Pick<
    CrmOpportunityEntity,
    'id' | 'tenantId' | 'workspaceId' | 'contactId' | 'createdAt'
  >,
): Promise<LeadScoreAppointmentOutcome> {
  const rows = await manager.query<
    Array<{ status: string; metadata: Record<string, unknown> | null }>
  >(LINKED_APPOINTMENTS_SQL, [
    opportunity.tenantId,
    opportunity.workspaceId,
    opportunity.id,
    opportunity.contactId ?? null,
    opportunity.createdAt,
  ]);
  for (const row of rows) {
    const lifecycle = appointmentLifecycle(row.status, row.metadata);
    if (lifecycle === 'canceled') continue;
    if (lifecycle === 'confirmed' || lifecycle === 'completed') {
      return 'accepted';
    }
    if (lifecycle === 'no_show') return 'no_show';
    return 'pending';
  }
  return 'none';
}

/** Opportunities whose score an appointment change can move. */
export async function findOpportunityIdsForAppointment(
  manager: EntityManager,
  scope: { tenantId: string; workspaceId: string },
  appointmentId: string,
): Promise<string[]> {
  const rows = await manager.query<Array<{ id: string }>>(
    `SELECT opportunity.id
       FROM scheduled_items item
       JOIN crm_opportunities opportunity
         ON opportunity.tenant_id = item.tenant_id
        AND opportunity.workspace_id = item.workspace_id
        AND opportunity.deleted_at IS NULL
        AND (
          opportunity.id = item.source_opportunity_id
          OR (
            item.source_opportunity_id IS NULL
            AND item.contact_id IS NOT NULL
            AND opportunity.contact_id = item.contact_id
            AND opportunity.created_at <= item.created_at
          )
        )
      WHERE item.id = $1 AND item.tenant_id = $2 AND item.workspace_id = $3`,
    [appointmentId, scope.tenantId, scope.workspaceId],
  );
  return rows.map((row) => row.id);
}
