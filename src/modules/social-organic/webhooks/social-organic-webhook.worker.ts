import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'node:os';
import type { SocialOrganicWebhookEventEntity } from './entities/social-organic-webhook-event.entity';
import {
  META_ORGANIC_WEBHOOK_HANDLERS,
  resolveHandlerKey,
} from './meta/meta-organic-webhook.handlers';
import {
  type MetaWebhookChange,
  splitMetaWebhookDelivery,
} from './meta/meta-organic-webhook.parser';
import { SocialOrganicInteractionService } from './social-organic-interaction.service';
import { SocialOrganicWebhookService } from './social-organic-webhook.service';

const TICK_MS = 5_000;
const CLAIM_LIMIT = 10;

/** Per-change outcomes, aggregated into one receipt status. */
type ChangeOutcome =
  | { kind: 'processed' }
  | { kind: 'unhandled'; safeErrorCode: string }
  | { kind: 'failed'; safeErrorCode: string };

/**
 * Drains the webhook receipt queue and gives each delivery its meaning.
 *
 * The pipeline is §13's, in order: claim a receipt → split it into changes →
 * resolve each change's scope from its own entry → dispatch to the registered
 * handler → persist the normalized interaction → settle the receipt once.
 *
 * **Partial handling is explicit, never silent (§13).** A delivery can mix a
 * comment we handle with a `story_insights` change we do not, or a resolvable
 * asset with an unknown one. Each change is settled on its own, and the
 * receipt's single status is derived from the aggregate:
 *
 * - any change failed **retryably** → the receipt fails, so the whole delivery
 *   is retried; handlers are idempotent, so replaying the changes that already
 *   succeeded costs a no-op upsert rather than a duplicate.
 * - otherwise, any change processed → `processed`, with a safe code naming what
 *   else was skipped, so "3 of 4 handled" is legible in the row.
 * - nothing processed → `unhandled`, terminal and non-retrying, because an
 *   event nobody has a handler for will never become handleable by waiting.
 *
 * §15 holds throughout: nothing here calls Graph, replies, moderates, notifies,
 * creates a lead or touches LeadFlow. It reads a payload and writes a row.
 */
@Injectable()
export class SocialOrganicWebhookWorker {
  private readonly logger = new Logger(SocialOrganicWebhookWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:organic-webhooks`;
  private running = false;

  constructor(
    private readonly webhooks: SocialOrganicWebhookService,
    private readonly interactions: SocialOrganicInteractionService,
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.webhooks.recoverStale();
      await this.processDue(CLAIM_LIMIT);
    } catch (error) {
      this.logger.error(
        `Organic webhook worker cycle failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  async processDue(limit = CLAIM_LIMIT): Promise<number> {
    const events = await this.webhooks.claim({
      workerId: this.workerId,
      limit,
    });

    for (const event of events) {
      // One bad event must never stop the batch: a throw here would abandon
      // every remaining leased row to the reaper for no reason.
      try {
        await this.processOne(event);
      } catch (error) {
        this.logger.error(
          `Organic webhook event failed: ${JSON.stringify({
            eventId: event.id,
            reason: error instanceof Error ? error.name : 'unknown',
          })}`,
        );
        await this.settleQuietly(event, 'failed', 'worker_error');
      }
    }

    return events.length;
  }

  private async processOne(
    event: SocialOrganicWebhookEventEntity,
  ): Promise<void> {
    const split = splitMetaWebhookDelivery(event.rawPayload);

    // A payload with no `entry` array is not a Meta notification we can read.
    // Terminal, not retryable: the bytes will not improve on a second pass.
    if (split.malformedEnvelope) {
      await this.settleQuietly(event, 'unhandled', 'malformed_payload');
      return;
    }

    const outcomes: ChangeOutcome[] = [];
    let interactionsWritten = 0;

    for (const change of split.changes) {
      const outcome = await this.processChange(event, change);
      outcomes.push(outcome);
      if (outcome.kind === 'processed') interactionsWritten += 1;
    }

    // A structurally broken entry or change yielded nothing; it is recorded so
    // a delivery that was *partly* unreadable cannot look fully handled.
    for (
      let i = 0;
      i < split.malformedEntries + split.malformedChanges;
      i += 1
    ) {
      outcomes.push({ kind: 'unhandled', safeErrorCode: 'malformed_payload' });
    }

    const settlement = this.summarize(outcomes);

    await this.webhooks.settle({
      eventId: event.id,
      lockedBy: this.workerId,
      status: settlement.status,
      safeErrorCode: settlement.safeErrorCode,
    });

    // Ids and safe classifications only — never payload, text or usernames.
    this.logger.log(
      `Organic webhook event settled: ${JSON.stringify({
        eventId: event.id,
        provider: event.provider,
        objectType: event.objectType,
        changes: split.changes.length,
        interactionsWritten,
        status: settlement.status,
        safeErrorCode: settlement.safeErrorCode,
      })}`,
    );
  }

  /**
   * One change: scope it, dispatch it, persist it.
   *
   * Scope is resolved **per change** from that change's own `entry[].id`, which
   * is the correction W1.1 left for this task — a batch spanning two Pages must
   * write each interaction into its own tenant, and a batch is not attributable
   * to whichever entry happened to be first.
   */
  private async processChange(
    event: SocialOrganicWebhookEventEntity,
    change: MetaWebhookChange,
  ): Promise<ChangeOutcome> {
    const handlerKey = resolveHandlerKey(event.objectType, change.field);
    if (!handlerKey) {
      // Includes every messaging field and every unsubscribed object: known to
      // exist, deliberately not ours.
      return { kind: 'unhandled', safeErrorCode: 'no_handler_registered' };
    }

    if (!change.externalAssetId) {
      return { kind: 'unhandled', safeErrorCode: 'missing_external_id' };
    }

    const scope = await this.webhooks.resolveScope({
      provider: event.provider,
      externalAssetId: change.externalAssetId,
    });

    // Unresolvable scope is terminal, not a failure: the Meta console's test
    // event (asset id `0`) lands here by design, and so does a Page that a
    // tenant has since disconnected. Neither becomes handleable by retrying.
    if (
      scope.scopeResolution !== 'resolved' ||
      !scope.tenantId ||
      !scope.workspaceId ||
      !scope.assetId
    ) {
      return {
        kind: 'unhandled',
        safeErrorCode:
          scope.scopeResolution === 'unresolved_ambiguous'
            ? 'ambiguous_asset'
            : 'unknown_asset',
      };
    }

    const result = META_ORGANIC_WEBHOOK_HANDLERS[handlerKey](change);
    if (result.outcome === 'ignored') {
      return { kind: 'unhandled', safeErrorCode: result.safeErrorCode };
    }

    try {
      await this.interactions.record({
        provider: event.provider,
        scope: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          assetId: scope.assetId,
        },
        interaction: result.interaction,
        sourceWebhookEventId: event.id,
      });
    } catch (error) {
      // Retryable: a write failure is usually transient, and the upsert makes
      // a replay safe. The provider's error text is never persisted (§14).
      this.logger.error(
        `Organic interaction write failed: ${JSON.stringify({
          eventId: event.id,
          assetId: scope.assetId,
          surface: result.interaction.surface,
          reason: error instanceof Error ? error.name : 'unknown',
        })}`,
      );
      return { kind: 'failed', safeErrorCode: 'domain_write_failed' };
    }

    return { kind: 'processed' };
  }

  /**
   * Collapse per-change outcomes into the receipt's single status.
   *
   * The ordering matters and is the whole of §13's "do not mask failure":
   * a retryable failure outranks a success, so a delivery is never marked
   * `processed` while part of it still needs to be written.
   */
  private summarize(outcomes: ChangeOutcome[]): {
    status: 'processed' | 'unhandled' | 'failed';
    safeErrorCode: string | null;
  } {
    const failed = outcomes.filter((outcome) => outcome.kind === 'failed');
    const processed = outcomes.filter(
      (outcome) => outcome.kind === 'processed',
    );
    const unhandled = outcomes.filter(
      (outcome) => outcome.kind === 'unhandled',
    );

    if (failed.length > 0) {
      return {
        status: 'failed',
        // The first failure's reason; they are all safe enumerated codes.
        safeErrorCode: (failed[0] as { safeErrorCode: string }).safeErrorCode,
      };
    }

    if (processed.length > 0) {
      return {
        status: 'processed',
        // Naming what was skipped keeps a partial success from reading as a
        // clean one, without losing the changes that did succeed.
        safeErrorCode:
          unhandled.length > 0
            ? `partial:${(unhandled[0] as { safeErrorCode: string }).safeErrorCode}`
            : null,
      };
    }

    if (unhandled.length > 0) {
      return {
        status: 'unhandled',
        safeErrorCode: (unhandled[0] as { safeErrorCode: string })
          .safeErrorCode,
      };
    }

    // A signed delivery with an empty `entry` array: valid, and about nothing.
    return { status: 'unhandled', safeErrorCode: 'no_changes' };
  }

  /** A settle that fails must not abort the batch either. */
  private async settleQuietly(
    event: SocialOrganicWebhookEventEntity,
    status: 'failed' | 'unhandled',
    safeErrorCode: string,
  ): Promise<void> {
    try {
      await this.webhooks.settle({
        eventId: event.id,
        lockedBy: this.workerId,
        status,
        safeErrorCode,
      });
    } catch (error) {
      // The lease reaper will reclaim it; nothing further to do here.
      this.logger.error(
        `Organic webhook settle failed: ${JSON.stringify({
          eventId: event.id,
          reason: error instanceof Error ? error.name : 'unknown',
        })}`,
      );
    }
  }
}
