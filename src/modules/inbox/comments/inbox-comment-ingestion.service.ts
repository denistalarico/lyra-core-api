import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  extractMetaCommentChanges,
  normalizeMetaCommentChange,
  type MetaCommentChange,
} from '../channels/meta/adapters/meta-comment.normalizer';
import {
  MetaChannelResolverService,
  MetaChannelUnavailableError,
} from '../channels/meta/services/meta-channel-resolver.service';
import type { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { WebhookLogService } from '../channels/services/webhook-log.service';
import { InboxCommentAgentService } from './inbox-comment-agent.service';
import { errorCodeOf, InboxCommentService } from './inbox-comment.service';

type CommentResult = {
  commentId: string | null;
  externalCommentId: string | null;
  outcome: string;
  agent?: string;
};

/** True when a Meta body carries `entry[].changes[]` (comments, feed…). */
export function hasMetaChanges(payload: unknown): boolean {
  return extractMetaCommentChanges(payload).length > 0;
}

/** True when a Meta body carries `entry[].messaging[]` events. */
export function hasMetaMessaging(payload: unknown): boolean {
  const entries =
    payload && typeof payload === 'object'
      ? (payload as { entry?: unknown }).entry
      : null;
  return (
    Array.isArray(entries) &&
    entries.some(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        Array.isArray((entry as { messaging?: unknown }).messaging) &&
        ((entry as { messaging: unknown[] }).messaging.length ?? 0) > 0,
    )
  );
}

/**
 * The `changes[]` branch of the Inbox Meta webhook (IX3 item 1).
 *
 * Page `feed` comments resolve to the Messenger channel of that Page, and
 * Instagram `comments` to the Instagram channel of that account. Everything is
 * recorded in `inbox_webhook_logs` with `event_type: 'comment'`; the rest of
 * the feed (reactions, posts…) is ignored with a safe code; an unknown account
 * is `unresolved_channel`. Payload text is never logged.
 */
@Injectable()
export class InboxCommentIngestionService {
  private readonly logger = new Logger(InboxCommentIngestionService.name);

  constructor(
    private readonly resolver: MetaChannelResolverService,
    private readonly comments: InboxCommentService,
    private readonly agent: InboxCommentAgentService,
    private readonly webhookLog: WebhookLogService,
  ) {}

  async processWebhook(input: {
    workload: 'instagram' | 'messenger';
    payload: unknown;
    signatureReceived: boolean;
  }) {
    const changes = extractMetaCommentChanges(input.payload);
    const results: CommentResult[] = [];
    const ignored: Record<string, number> = {};
    let scope: InboxChannelEntity | null = null;
    const ignore = (reason: string) => {
      ignored[reason] = (ignored[reason] ?? 0) + 1;
    };

    try {
      for (const change of changes) {
        const normalized = normalizeMetaCommentChange(change);
        if (normalized.outcome === 'ignored') {
          ignore(normalized.reason);
          continue;
        }
        const channel = await this.resolveChannel(change, ignore);
        if (!channel) continue;
        scope ??= channel;
        const { comment, created } = await this.comments.ingest(
          channel,
          normalized.comment,
        );
        if (!comment) {
          ignore('comment_unknown_for_lifecycle');
          continue;
        }
        const result: CommentResult = {
          commentId: comment.id,
          externalCommentId: comment.externalCommentId,
          outcome: created ? 'created' : 'updated',
        };
        if (created && comment.direction === 'inbound') {
          try {
            const planned = await this.agent.consider(comment);
            result.agent = planned.planned ? 'planned' : planned.reasonCode;
          } catch (error) {
            // The comment is stored; only the agent's plan failed. Recorded
            // on the log row and in the service log, never swallowed.
            result.agent = 'agent_plan_failed';
            this.logger.warn({
              event: 'comment_agent_plan_failed',
              commentId: comment.id,
              errorCode: errorCodeOf(error),
            });
          }
        }
        results.push(result);
      }
    } catch (error) {
      await this.webhookLog.create({
        tenantId: scope?.tenantId ?? null,
        workspaceId: scope?.workspaceId ?? null,
        channelId: scope?.id ?? null,
        provider: 'meta',
        eventType: 'comment',
        status: 'failed',
        externalAccountId: changes[0]?.accountExternalId ?? null,
        externalPhoneNumberId: null,
        signatureReceived: input.signatureReceived,
        errorMessage: errorCodeOf(error),
        payload: {},
        metadata: { workload: input.workload, results, ignored },
      });
      throw error;
    }

    await this.webhookLog.create({
      tenantId: scope?.tenantId ?? null,
      workspaceId: scope?.workspaceId ?? null,
      channelId: scope?.id ?? null,
      provider: 'meta',
      eventType: 'comment',
      status: results.length ? 'processed' : 'ignored',
      externalAccountId: changes[0]?.accountExternalId ?? null,
      externalPhoneNumberId: null,
      externalMessageId: results[0]?.externalCommentId ?? null,
      signatureReceived: input.signatureReceived,
      messagesProcessed: 0,
      statusesProcessed: 0,
      payload: {},
      metadata: { workload: input.workload, results, ignored },
    });
    return {
      ok: true,
      provider: 'meta',
      commentsProcessed: results.length,
      commentResults: results,
      ignored,
    };
  }

  private async resolveChannel(
    change: MetaCommentChange,
    ignore: (reason: string) => void,
  ): Promise<InboxChannelEntity | null> {
    const accountId = change.accountExternalId;
    if (!accountId) {
      ignore('malformed_payload');
      return null;
    }
    try {
      return change.object === 'page'
        ? await this.resolver.findFacebookMessengerChannelByPageId(accountId)
        : await this.resolver.findInstagramChannelByAccountId(accountId);
    } catch (error) {
      if (error instanceof MetaChannelUnavailableError) {
        ignore('channel_unavailable');
        return null;
      }
      if (error instanceof NotFoundException) {
        ignore('unresolved_channel');
        return null;
      }
      if (error instanceof ConflictException) {
        ignore('ambiguous_channel');
        return null;
      }
      throw error;
    }
  }
}
