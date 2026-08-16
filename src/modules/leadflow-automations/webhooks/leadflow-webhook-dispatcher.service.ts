import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowAutomationEntity } from '../entities';
import { LeadFlowWebhookDeliveryEntity } from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import type { LeadFlowAutomationWebhookConfig } from '../types/leadflow-automation.types';
import { LeadFlowWebhookGate } from './leadflow-webhook-gate.service';
import {
  buildEnvelope,
  classifyAttempt,
  nextAttemptDelaySeconds,
  signPayload,
} from './leadflow-webhook-payload';
import {
  assertPublicWebhookTarget,
  WebhookTargetError,
} from './leadflow-webhook-target';

export const DEVELOPER_WEBHOOK_RECIPE_KEY = 'developer_webhook';

/** How much of an endpoint's answer is worth keeping to debug with. */
const RESPONSE_EXCERPT_LIMIT = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Posts subscribed events to the endpoints an operator configured.
 *
 * The shape is the one every webhook product converged on, and each part earns
 * its place: a durable row per (endpoint, event) so an at-least-once stream
 * cannot post an order twice; an HMAC over timestamp and body so the receiver
 * can tell our request from anyone else's; retries only where retrying can help;
 * and a delivery log, because a webhook that "does not work" is nearly always a
 * 401 the integrator never saw.
 *
 * Nothing here decides whether sending is allowed at all — {@link
 * LeadFlowWebhookGate} does, and it is closed unless the environment says
 * otherwise.
 */
@Injectable()
export class LeadFlowWebhookDispatcherService {
  private readonly logger = new Logger(LeadFlowWebhookDispatcherService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @InjectRepository(LeadFlowWebhookDeliveryEntity, 'agency')
    private readonly deliveries: Repository<LeadFlowWebhookDeliveryEntity>,
    @InjectRepository(LeadFlowAutomationEntity, 'agency')
    private readonly automations: Repository<LeadFlowAutomationEntity>,
    private readonly gate: LeadFlowWebhookGate,
  ) {}

  /** Endpoints in this workspace subscribed to this event, ready to receive. */
  async subscribers(
    tenantId: string,
    workspaceId: string,
    eventName: string,
  ): Promise<LeadFlowAutomationEntity[]> {
    return this.automations
      .createQueryBuilder('automation')
      .where('automation.tenant_id = :tenantId', { tenantId })
      .andWhere('automation.workspace_id = :workspaceId', { workspaceId })
      .andWhere('automation.recipe_key = :recipeKey', {
        recipeKey: DEVELOPER_WEBHOOK_RECIPE_KEY,
      })
      .andWhere('automation.status = :status', {
        status: LeadFlowAutomationStatus.Active,
      })
      .andWhere('automation.published_version_id IS NOT NULL')
      .andWhere("automation.webhook_config ->> 'enabled' = 'true'")
      .andWhere("automation.webhook_config ->> 'url' IS NOT NULL")
      .andWhere("automation.webhook_config -> 'events' @> :event::jsonb", {
        event: JSON.stringify([eventName]),
      })
      .getMany();
  }

  /**
   * Fans one canonical event out to every endpoint that asked for it.
   *
   * A single endpoint failing must not hold up the others, so each is attempted
   * independently and its outcome recorded on its own row.
   */
  async dispatch(delivery: LeadFlowEventDeliveryEntity): Promise<void> {
    const decision = this.gate.evaluate(
      delivery.tenantId,
      delivery.workspaceId,
    );
    if (!decision.allowed) return;

    const subscribers = await this.subscribers(
      delivery.tenantId,
      delivery.workspaceId,
      delivery.eventName,
    );

    for (const automation of subscribers) {
      const row = await this.claim(automation, delivery);
      // No row means this event already reached this endpoint: the stream is
      // at-least-once, and the unique index is what makes that harmless.
      if (row) await this.attempt(automation, row, delivery);
    }
  }

  /**
   * One sample event, so an integrator can see a request arrive before waiting
   * for something real to happen.
   *
   * It is a genuine delivery, logged like any other: a test that took a shortcut
   * would prove the shortcut works, not the endpoint.
   */
  async dispatchTest(
    automation: LeadFlowAutomationEntity,
    sourceEventId: string,
  ): Promise<string> {
    const source = {
      id: sourceEventId,
      sourceEventId,
      tenantId: automation.tenantId,
      workspaceId: automation.workspaceId,
      eventName: 'leadflow.automations.webhook.test',
      eventVersion: 1,
      aggregateType: 'automation',
      aggregateId: automation.id,
      payload: {
        message: 'Entrega de teste do LeadFlow.',
        automationId: automation.id,
      },
      occurredAt: new Date(),
    } as unknown as LeadFlowEventDeliveryEntity;

    const row = await this.claim(automation, source);
    if (!row) return sourceEventId;
    await this.attempt(automation, row, source);
    return row.id;
  }

  /**
   * Retries the deliveries whose moment has come.
   *
   * Driven by the ingress tick rather than a timer of its own — one loop is
   * easier to reason about than two racing over the same rows.
   */
  async retryDue(limit = 20): Promise<number> {
    const due = await this.deliveries
      .createQueryBuilder('delivery')
      .where('delivery.status = :status', { status: 'retrying' })
      .andWhere('delivery.next_attempt_at IS NOT NULL')
      .andWhere('delivery.next_attempt_at <= now()')
      .orderBy('delivery.next_attempt_at', 'ASC')
      .limit(limit)
      .getMany();

    for (const row of due) {
      if (!this.gate.evaluate(row.tenantId, row.workspaceId).allowed) continue;
      const automation = await this.automations.findOne({
        where: { id: row.automationId },
      });
      if (!automation) continue;
      const source = await this.sourceEvent(row.sourceEventId);
      if (!source) {
        // The event row was pruned before we could finish. Retrying would post
        // an envelope we can no longer reconstruct faithfully.
        await this.deliveries.update(
          { id: row.id },
          {
            status: 'dead_letter',
            errorCode: 'source_event_expired',
            nextAttemptAt: null,
          },
        );
        continue;
      }
      await this.attempt(automation, row, source);
    }
    return due.length;
  }

  private async sourceEvent(
    sourceEventId: string,
  ): Promise<LeadFlowEventDeliveryEntity | null> {
    const rows = await this.dataSource.query<LeadFlowEventDeliveryEntity[]>(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId",
              event_name AS "eventName", event_version AS "eventVersion",
              aggregate_type AS "aggregateType", aggregate_id AS "aggregateId",
              payload, occurred_at AS "occurredAt",
              source_event_id AS "sourceEventId"
         FROM leadflow_event_deliveries
        WHERE source_event_id = $1
        LIMIT 1`,
      [sourceEventId],
    );
    return rows[0] ?? null;
  }

  /** Inserts the delivery row, or returns null when this pair already exists. */
  private async claim(
    automation: LeadFlowAutomationEntity,
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<LeadFlowWebhookDeliveryEntity | null> {
    const config = webhookConfig(automation);
    const inserted = await this.deliveries
      .createQueryBuilder()
      .insert()
      .into(LeadFlowWebhookDeliveryEntity)
      .values({
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
        automationId: automation.id,
        sourceEventId: delivery.sourceEventId,
        eventName: delivery.eventName,
        status: 'pending',
        attempts: 0,
        requestUrl: String(config.url ?? ''),
      })
      .orIgnore()
      .returning('id')
      .execute();

    const id = (inserted.raw as Array<{ id: string }>)[0]?.id;
    return id ? this.deliveries.findOne({ where: { id } }) : null;
  }

  private async attempt(
    automation: LeadFlowAutomationEntity,
    row: LeadFlowWebhookDeliveryEntity,
    source: LeadFlowEventDeliveryEntity,
  ): Promise<void> {
    const config = webhookConfig(automation);
    const attempts = row.attempts + 1;
    const startedAt = Date.now();

    let target: URL;
    try {
      target = await assertPublicWebhookTarget(String(config.url ?? ''));
    } catch (error) {
      // A URL that points inside our own network is not a transient problem,
      // and no amount of retrying makes it a webhook.
      await this.deliveries.update(
        { id: row.id },
        {
          status: 'dead_letter',
          attempts,
          errorCode:
            error instanceof WebhookTargetError
              ? error.reason
              : 'webhook_url_invalid',
          nextAttemptAt: null,
        },
      );
      return;
    }

    const envelope = buildEnvelope({
      deliveryId: row.id,
      eventName: source.eventName,
      eventVersion: source.eventVersion,
      occurredAt: new Date(source.occurredAt),
      tenantId: source.tenantId,
      workspaceId: source.workspaceId,
      aggregateType: source.aggregateType,
      aggregateId: source.aggregateId,
      payload: source.payload ?? {},
      fields: selectedFields(config, source.eventName),
    });
    const body = JSON.stringify(envelope);

    let status: number | null = null;
    let excerpt: string | null = null;
    let errorCode: string | null = null;

    try {
      const response = await fetch(target.toString(), {
        method: String(config.method ?? 'POST'),
        headers: this.headers(config, envelope, body),
        body,
        // An endpoint that answers with a redirect is not the endpoint that was
        // authorised, and following one is how an SSRF check gets bypassed.
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      if (config.expectJsonResponse === true) {
        const text = await response.text();
        excerpt = text.slice(0, RESPONSE_EXCERPT_LIMIT);
      }
    } catch (error) {
      errorCode =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'request_timeout'
          : 'request_failed';
      this.logger.warn(
        `webhook_attempt_failed automation=${automation.id} code=${errorCode}`,
      );
    }

    const retry = config.retryPolicy ?? {};
    const maxRetries = readNumber(retry.maxRetries, 3);
    const backoffSeconds = readNumber(retry.backoffSeconds, 30);
    const outcome = classifyAttempt(status, attempts, maxRetries);
    const now = new Date();

    await this.deliveries.update(
      { id: row.id },
      {
        status:
          outcome === 'delivered'
            ? 'delivered'
            : outcome === 'retry'
              ? 'retrying'
              : 'dead_letter',
        attempts,
        responseStatus: status,
        responseExcerpt: excerpt,
        errorCode: errorCode ?? (status !== null ? null : 'request_failed'),
        durationMs: Date.now() - startedAt,
        deliveredAt: outcome === 'delivered' ? now : null,
        nextAttemptAt:
          outcome === 'retry'
            ? new Date(
                now.getTime() +
                  nextAttemptDelaySeconds(attempts, backoffSeconds) * 1_000,
              )
            : null,
      },
    );
  }

  private headers(
    config: LeadFlowAutomationWebhookConfig,
    envelope: { id: string; event: string },
    body: string,
  ): Record<string, string> {
    const custom = config.headers ?? {};
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Lyra-Webhooks/1.0',
      'X-Lyra-Event': envelope.event,
      'X-Lyra-Delivery': envelope.id,
    };
    for (const [key, value] of Object.entries(custom)) {
      if (typeof value === 'string') headers[key] = value;
    }
    const secret = typeof config.secret === 'string' ? config.secret : '';
    if (secret) {
      headers['X-Lyra-Signature'] = signPayload(
        body,
        secret,
        Math.floor(Date.now() / 1_000),
      );
    }
    return headers;
  }
}

function webhookConfig(
  automation: LeadFlowAutomationEntity,
): LeadFlowAutomationWebhookConfig {
  return automation.webhookConfig ?? {};
}

/** The fields this endpoint asked for on this event; empty means everything. */
function selectedFields(
  config: LeadFlowAutomationWebhookConfig,
  eventName: string,
): string[] {
  const selection = config.payloadFields ?? {};
  const fields = (selection as Record<string, unknown>)[eventName];
  return Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === 'string')
    : [];
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
