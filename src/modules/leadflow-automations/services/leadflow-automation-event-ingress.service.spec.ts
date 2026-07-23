import type { DataSource } from 'typeorm';
import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowAutomationEventIngressService } from './leadflow-automation-event-ingress.service';

type Decision = { status: 'delivered' } | { status: 'skipped'; reason: string };

describe('LeadFlowAutomationEventIngressService contract acceptance', () => {
  const service = new LeadFlowAutomationEventIngressService({} as DataSource);
  const accept = (
    service as unknown as {
      accept(delivery: LeadFlowEventDeliveryEntity): Decision;
    }
  ).accept.bind(service);

  const delivery = (
    eventName: string,
    eventVersion = 1,
  ): LeadFlowEventDeliveryEntity =>
    Object.assign(new LeadFlowEventDeliveryEntity(), {
      eventName,
      eventVersion,
    });

  it('acknowledges an active catalog event mapped to an event trigger', () => {
    expect(
      accept(delivery('leadflow.inbox.conversation.message.received')),
    ).toEqual({ status: 'delivered' });
  });

  it('skips a catalog event that no automation trigger consumes', () => {
    expect(accept(delivery('leadflow.crm.opportunity.copied'))).toEqual({
      status: 'skipped',
      reason: 'event_not_mapped_to_automation',
    });
  });

  it('skips unknown and unsupported-version events without retrying', () => {
    expect(accept(delivery('leadflow.unknown.fact.created'))).toEqual({
      status: 'skipped',
      reason: 'event_not_catalogued',
    });
    expect(
      accept(delivery('leadflow.crm.opportunity.stage.changed', 99)),
    ).toEqual({
      status: 'skipped',
      reason: 'event_version_not_supported',
    });
  });
});
