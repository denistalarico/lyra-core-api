import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { AgencyContactsService } from '../../agency/agency-contacts.service';
import { CrmService } from '../../crm/crm.service';
import { LeadFlowAgendaService } from '../../leadflow-agenda/leadflow-agenda.service';
import type { LeadFlowOperationsActionEntity } from '../entities';
import {
  contactFields,
  readDate,
  readString,
  readUuid,
} from './leadflow-operations-action-domain';
import { LeadFlowAgentService } from './leadflow-agent.service';

export type LeadFlowActionExecution = {
  /** The record acted on; the created one for `create_*`. */
  targetId: string | null;
  /** What the card shows after confirming (no IDs, no contact data). */
  result: Record<string, unknown>;
};

/**
 * OR5 — runs a confirmed proposal through the domain service of the
 * equivalent route, with the confirmer's `RequestContext`: the service
 * resolves the tenant/company from it (`resolveCompanyAwareScope`), so the
 * proposal payload never widens the scope. The permission was asserted by
 * `LeadFlowOperationsActionAccessService` just before; the payload IDs were
 * resolved under the proposer's scope and are re-checked by the service.
 */
@Injectable()
export class LeadFlowOperationsActionExecutorService {
  constructor(
    private readonly agents: LeadFlowAgentService,
    private readonly crm: CrmService,
    private readonly contacts: AgencyContactsService,
    private readonly agenda: LeadFlowAgendaService,
  ) {}

  async execute(
    ctx: RequestContext,
    action: LeadFlowOperationsActionEntity,
  ): Promise<LeadFlowActionExecution> {
    const payload = action.payload;
    switch (action.intent) {
      case 'pause_agent': {
        const agent = await this.agents.pauseUntil(
          ctx,
          action.targetId as string,
          action.effectiveUntil,
        );
        return {
          targetId: agent.id,
          result: { status: agent.status, pausedUntil: agent.pausedUntil },
        };
      }
      case 'activate_agent': {
        const agent = await this.agents.activate(
          ctx,
          action.targetId as string,
        );
        return { targetId: agent.id, result: { status: agent.status } };
      }
      case 'create_contact': {
        const created = (await this.contacts.createLeadFlowContact(ctx, {
          type: 'person',
          displayName: readString(payload.displayName) as string,
          email: readString(payload.email) ?? undefined,
          phone: readString(payload.phone) ?? undefined,
        })) as { id?: string; contact?: { id?: string } };
        return {
          targetId: readUuid(created?.id ?? created?.contact?.id),
          result: { created: true },
        };
      }
      case 'move_opportunity': {
        const moved = await this.crm.patchOpportunityStage(
          ctx,
          action.targetId as string,
          // A person's move, through the published transition graph (no
          // manual override: the card keeps its autonomy mode).
          {
            stageId: readUuid(payload.stageId) as string,
            reasonCode: 'manual_stage_move',
          },
          { idempotencyKey: `leadflow-ops-action:${action.id}` },
        );
        return { targetId: moved.id, result: { moved: true } };
      }
      case 'update_contact_fields': {
        await this.contacts.patchContact(
          ctx,
          action.targetId as string,
          contactFields(payload.fields),
        );
        return { targetId: action.targetId, result: { updated: true } };
      }
      case 'create_appointment': {
        const startAt = readDate(payload.startAt);
        const endAt = readDate(payload.endAt);
        const created = (await this.agenda.createAppointment(ctx, {
          type: readString(payload.type) ?? 'meeting',
          title: readString(payload.title) as string,
          startAt: startAt?.toISOString(),
          endAt: endAt?.toISOString(),
          timezone: action.timezone ?? undefined,
          contactId: readUuid(payload.contactId) ?? undefined,
          sourceChannel: 'manual',
        })) as { id?: string };
        return { targetId: readUuid(created?.id), result: { created: true } };
      }
      default:
        throw new Error(`Intent ${action.intent} has no domain execution.`);
    }
  }
}
