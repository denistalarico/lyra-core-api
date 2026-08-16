import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowAutomationEntity } from '../entities';
import { LeadFlowWebhookDeliveryEntity } from '../entities';
import {
  DEVELOPER_WEBHOOK_RECIPE_KEY,
  LeadFlowWebhookDispatcherService,
} from './leadflow-webhook-dispatcher.service';
import { LeadFlowWebhookGate } from './leadflow-webhook-gate.service';

export interface LeadFlowWebhookDeliveryView {
  id: string;
  eventName: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseExcerpt: string | null;
  errorCode: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface LeadFlowWebhookDeliveriesResponse {
  /** Whether this environment is allowed to send at all. */
  dispatchEnabled: boolean;
  items: LeadFlowWebhookDeliveryView[];
}

export interface LeadFlowWebhookTestResponse {
  sent: boolean;
  reason?: string;
  deliveryId?: string;
}

/**
 * What the webhook screens read and trigger.
 *
 * Kept apart from the dispatcher so the delivery path has no notion of HTTP
 * context or permissions, and the screens have no way to reach into it.
 */
@Injectable()
export class LeadFlowWebhookAdminService {
  constructor(
    @InjectRepository(LeadFlowWebhookDeliveryEntity, 'agency')
    private readonly deliveries: Repository<LeadFlowWebhookDeliveryEntity>,
    @InjectRepository(LeadFlowAutomationEntity, 'agency')
    private readonly automations: Repository<LeadFlowAutomationEntity>,
    private readonly dispatcher: LeadFlowWebhookDispatcherService,
    private readonly gate: LeadFlowWebhookGate,
  ) {}

  async list(
    ctx: RequestContext,
    automationId: string,
    limit = 25,
  ): Promise<LeadFlowWebhookDeliveriesResponse> {
    await this.requireWebhook(ctx, automationId);
    const rows = await this.deliveries.find({
      where: { tenantId: ctx.tenantId, automationId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    return {
      dispatchEnabled: this.gate.isEnabled(),
      items: rows.map((row) => ({
        id: row.id,
        eventName: row.eventName,
        status: row.status,
        attempts: row.attempts,
        responseStatus: row.responseStatus,
        responseExcerpt: row.responseExcerpt,
        errorCode: row.errorCode,
        durationMs: row.durationMs,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Sends one sample event to the endpoint.
   *
   * Through the same gate as a real delivery, deliberately: a test that ignored
   * the kill switch would be a side door out of the platform, and the switch
   * would mean nothing.
   */
  async test(
    ctx: RequestContext,
    automationId: string,
  ): Promise<LeadFlowWebhookTestResponse> {
    const automation = await this.requireWebhook(ctx, automationId);
    const decision = this.gate.evaluate(
      automation.tenantId,
      automation.workspaceId,
    );
    if (!decision.allowed) {
      return { sent: false, reason: decision.reason };
    }
    if (!automation.webhookConfig?.url) {
      throw new BadRequestException('Configure a URL antes de testar.');
    }

    const deliveryId = await this.dispatcher.dispatchTest(
      automation,
      randomUUID(),
    );
    return { sent: true, deliveryId };
  }

  private async requireWebhook(
    ctx: RequestContext,
    automationId: string,
  ): Promise<LeadFlowAutomationEntity> {
    const automation = await this.automations.findOne({
      where: { id: automationId, tenantId: ctx.tenantId },
    });
    if (!automation || automation.recipeKey !== DEVELOPER_WEBHOOK_RECIPE_KEY) {
      throw new NotFoundException('Webhook não encontrado.');
    }
    return automation;
  }
}
