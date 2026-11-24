import type {
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityEventEntity,
  AgencySalesOpportunityEventType,
} from './entities/agency-sales.entities';

/** Same label as `outcome.opportunityTarget` of Forms; LeadFlow is `leadflow_crm`. */
export const AGENCY_SALES_CRM = 'agency_sales' as const;

/**
 * The only fields an event carries: ids, stage, status, value and owner. The
 * contact is only a flag (`hasContact`): the opportunity history shows "contato
 * vinculado" without the event ever carrying who the lead is.
 */
export type AgencySalesOpportunitySnapshot = {
  pipelineId: string;
  stageId: string;
  status: string;
  amountCents: number;
  recurringAmountCents: number;
  currency: string;
  ownerUserId: string | null;
  hasContact: boolean;
};

export function snapshotOf(
  opportunity: Pick<
    AgencySalesOpportunityEntity,
    | 'pipelineId'
    | 'stageId'
    | 'status'
    | 'amountCents'
    | 'recurringAmountCents'
    | 'currency'
    | 'ownerUserId'
    | 'contactId'
  >,
): AgencySalesOpportunitySnapshot {
  return {
    pipelineId: opportunity.pipelineId,
    stageId: opportunity.stageId,
    status: opportunity.status,
    amountCents: Number(opportunity.amountCents),
    recurringAmountCents: Number(opportunity.recurringAmountCents ?? 0),
    currency: opportunity.currency,
    ownerUserId: opportunity.ownerUserId ?? null,
    hasContact: Boolean(opportunity.contactId),
  };
}

/**
 * Events for one change, in order. A status change gives `status_changed`
 * plus the specific one (LeadFlow molde). Staying in the same stage gives no
 * `stage_changed`; title and description never give an event. Linking or
 * unlinking a contact gives `opportunity_updated` (only the flag changes).
 */
export function opportunityEventTypes(
  before: AgencySalesOpportunitySnapshot | null,
  after: AgencySalesOpportunitySnapshot,
): AgencySalesOpportunityEventType[] {
  if (!before) return ['opportunity_created'];
  const types: AgencySalesOpportunityEventType[] = [];
  const stageChanged = before.stageId !== after.stageId;
  if (stageChanged) types.push('stage_changed');
  if (before.status !== after.status) {
    types.push('status_changed');
    if (after.status === 'won') types.push('opportunity_won');
    else if (after.status === 'lost') types.push('opportunity_lost');
    else if (after.status === 'archived') types.push('opportunity_archived');
    else if (after.status === 'open') types.push('opportunity_reopened');
  }
  if (
    before.amountCents !== after.amountCents ||
    // Rows written before these keys existed read as undefined: not a change.
    (before.recurringAmountCents ?? 0) !== (after.recurringAmountCents ?? 0) ||
    before.currency !== after.currency ||
    before.ownerUserId !== after.ownerUserId ||
    (before.hasContact ?? false) !== (after.hasContact ?? false) ||
    (!stageChanged && before.pipelineId !== after.pipelineId)
  )
    types.push('opportunity_updated');
  return types;
}

export function opportunityEventRows(
  context: { tenantId: string; workspaceId: string; userId?: string },
  opportunityId: string,
  before: AgencySalesOpportunitySnapshot | null,
  after: AgencySalesOpportunitySnapshot,
  occurredAt: Date,
): Array<Partial<AgencySalesOpportunityEventEntity>> {
  return opportunityEventTypes(before, after).map((eventType) => ({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    opportunityId,
    eventType,
    beforeData: before,
    afterData: after,
    actorType: context.userId ? 'user' : 'system',
    actorUserId: context.userId ?? null,
    idempotencyKey:
      eventType === 'opportunity_created' ? `${opportunityId}:created` : null,
    occurredAt,
  }));
}
