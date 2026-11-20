import type {
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityEventEntity,
  AgencySalesOpportunityEventType,
} from './entities/agency-sales.entities';

/** Same label as `outcome.opportunityTarget` of Forms; LeadFlow is `leadflow_crm`. */
export const AGENCY_SALES_CRM = 'agency_sales' as const;

/** The only fields an event carries: ids, stage, status, value and owner. */
export type AgencySalesOpportunitySnapshot = {
  pipelineId: string;
  stageId: string;
  status: string;
  amountCents: number;
  currency: string;
  ownerUserId: string | null;
};

export function snapshotOf(
  opportunity: Pick<
    AgencySalesOpportunityEntity,
    | 'pipelineId'
    | 'stageId'
    | 'status'
    | 'amountCents'
    | 'currency'
    | 'ownerUserId'
  >,
): AgencySalesOpportunitySnapshot {
  return {
    pipelineId: opportunity.pipelineId,
    stageId: opportunity.stageId,
    status: opportunity.status,
    amountCents: Number(opportunity.amountCents),
    currency: opportunity.currency,
    ownerUserId: opportunity.ownerUserId ?? null,
  };
}

/**
 * Events for one change, in order. A status change gives `status_changed`
 * plus the specific one (LeadFlow molde). Staying in the same stage gives no
 * `stage_changed`; title, description and contact never give an event.
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
    before.currency !== after.currency ||
    before.ownerUserId !== after.ownerUserId ||
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
