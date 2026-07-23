import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS } from '../../leadflow-events/catalog/leadflow-event.catalog';
import { LeadFlowAutomationEntity } from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';

const AGENCY_CONNECTION = 'agency';

/**
 * Resolves which automations a delivered event concerns.
 *
 * The mapping event → trigger lives in the event catalog and is the same table
 * the ingress uses to decide whether a delivery is relevant at all. Reading it
 * here rather than duplicating the knowledge means a trigger cannot become
 * matchable without also being declared in the published contract.
 */
@Injectable()
export class LeadFlowAutomationTriggerMatcherService {
  constructor(
    @InjectRepository(LeadFlowAutomationEntity, AGENCY_CONNECTION)
    private readonly automationsRepository: Repository<LeadFlowAutomationEntity>,
  ) {}

  /** Trigger keys published as `mapped` for this event name. */
  triggersForEvent(eventName: string): string[] {
    return LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS.filter(
      (mapping) =>
        mapping.status === 'mapped' && mapping.eventName === eventName,
    ).map((mapping) => mapping.trigger);
  }

  /**
   * Automations in the event's own tenant/workspace whose configured trigger
   * matches, and which the operator has not left as a draft.
   *
   * Scope comes from the delivery, never from the payload: an event carries the
   * tenant and workspace it was produced in, so a crafted payload cannot reach
   * another workspace's automations.
   */
  async findMatching(
    tenantId: string,
    workspaceId: string,
    eventName: string,
  ): Promise<LeadFlowAutomationEntity[]> {
    const triggers = this.triggersForEvent(eventName);
    if (triggers.length === 0) {
      return [];
    }

    const candidates = await this.automationsRepository.find({
      where: {
        tenantId,
        workspaceId,
        status: In([
          LeadFlowAutomationStatus.Active,
          LeadFlowAutomationStatus.Paused,
        ]),
      },
      order: { createdAt: 'ASC' },
    });

    // `triggerConfig.type` is jsonb, so the filter happens in memory rather than
    // as a fragile SQL cast. The candidate set is bounded by workspace.
    return candidates.filter((automation) =>
      triggers.includes(automation.triggerConfig?.type as string),
    );
  }
}
