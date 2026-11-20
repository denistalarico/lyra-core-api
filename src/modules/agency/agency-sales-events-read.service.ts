import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AGENCY_SALES_CRM,
  type AgencySalesOpportunitySnapshot,
} from './agency-sales-events.rules';
import {
  AgencySalesOpportunityEventEntity,
  type AgencySalesEventActorType,
  type AgencySalesOpportunityEventType,
} from './entities/agency-sales.entities';

const AGENCY_CONNECTION = 'agency';
const MAX_PAGE = 500;
/** Events younger than this are left for the next page, so a transaction
 * that commits a little late is not skipped by the cursor. */
const SETTLE_SECONDS = 5;

export type AgencySalesEventScope = { tenantId: string; workspaceId: string };
export type AgencySalesEventCursor = { occurredAt: Date; id: string };

export type AgencySalesEventView = {
  id: string;
  crm: typeof AGENCY_SALES_CRM;
  opportunityId: string;
  eventType: AgencySalesOpportunityEventType;
  before: AgencySalesOpportunitySnapshot | null;
  after: AgencySalesOpportunitySnapshot;
  actorType: AgencySalesEventActorType;
  actorUserId: string | null;
  occurredAt: Date;
};

export type AgencySalesStageEntry = {
  eventId: string;
  pipelineId: string;
  stageId: string;
  fromStageId: string | null;
  enteredAt: Date;
};

/**
 * AG-EVT: read side of the Agency CRM history, for AN-CRM, GA-CONV and the
 * intelligence module. No in-process bus: consumers page through here.
 */
@Injectable()
export class AgencySalesEventsReadService {
  constructor(
    @InjectRepository(AgencySalesOpportunityEventEntity, AGENCY_CONNECTION)
    private readonly events: Repository<AgencySalesOpportunityEventEntity>,
  ) {}

  async listSince(
    scope: AgencySalesEventScope,
    cursor: AgencySalesEventCursor | null,
    limit = 200,
  ): Promise<{
    events: AgencySalesEventView[];
    nextCursor: AgencySalesEventCursor | null;
  }> {
    const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_PAGE);
    const query = this.events
      .createQueryBuilder('e')
      .where(
        '"e"."tenant_id" = :tenantId AND "e"."workspace_id" = :workspaceId',
        {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
        },
      )
      .andWhere(
        `"e"."occurred_at" <= now() - interval '${SETTLE_SECONDS} seconds'`,
      );
    if (cursor)
      query.andWhere('("e"."occurred_at", "e"."id") > (:cursorAt, :cursorId)', {
        cursorAt: cursor.occurredAt,
        cursorId: cursor.id,
      });
    const rows = await query
      .orderBy('e.occurredAt', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .limit(take)
      .getMany();
    const last = rows.at(-1);
    return {
      events: rows.map(toView),
      nextCursor: last ? { occurredAt: last.occurredAt, id: last.id } : cursor,
    };
  }

  async stageHistory(
    scope: AgencySalesEventScope,
    opportunityId: string,
  ): Promise<AgencySalesStageEntry[]> {
    const rows = await this.events.find({
      where: [
        { ...scope, opportunityId, eventType: 'opportunity_created' },
        { ...scope, opportunityId, eventType: 'stage_changed' },
      ],
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => {
      const view = toView(row);
      return {
        eventId: view.id,
        pipelineId: view.after.pipelineId,
        stageId: view.after.stageId,
        fromStageId: view.before?.stageId ?? null,
        enteredAt: view.occurredAt,
      };
    });
  }
}

function toView(row: AgencySalesOpportunityEventEntity): AgencySalesEventView {
  return {
    id: row.id,
    crm: AGENCY_SALES_CRM,
    opportunityId: row.opportunityId,
    eventType: row.eventType,
    before: (row.beforeData as AgencySalesOpportunitySnapshot | null) ?? null,
    after: row.afterData as AgencySalesOpportunitySnapshot,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    occurredAt: row.occurredAt,
  };
}
