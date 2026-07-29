import { Injectable, OnModuleInit } from '@nestjs/common';
import { LeadFlowCsatService } from '../../leadflow-analytics/services/leadflow-csat.service';
import {
  ScheduledTimerConsumerRegistry,
  type ScheduledTimerConsumer,
  type TimerFireEnvelope,
} from '../scheduler';

export const LEADFLOW_CSAT_EXPIRY_TIMER_CONSUMER =
  'leadflow.automations.csat-expiry' as const;

@Injectable()
export class LeadFlowCsatExpiryTimerConsumer
  implements ScheduledTimerConsumer, OnModuleInit
{
  readonly consumerKey = LEADFLOW_CSAT_EXPIRY_TIMER_CONSUMER;

  constructor(
    private readonly registry: ScheduledTimerConsumerRegistry,
    private readonly csat: LeadFlowCsatService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handleTimer(envelope: TimerFireEnvelope): Promise<void> {
    const responseId = stringField(envelope.payload.responseId);
    if (!responseId) throw new Error('csat_expiry_payload_invalid');
    await this.csat.expire(
      envelope.tenantId,
      envelope.workspaceId,
      responseId,
      new Date(envelope.firedAt),
    );
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
