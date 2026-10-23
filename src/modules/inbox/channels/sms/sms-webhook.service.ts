import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboundMessageIngestionService } from '../services/inbound-message-ingestion.service';
import { MessageStatusSyncService } from '../services/message-status-sync.service';
import { WebhookLogService } from '../services/webhook-log.service';
import {
  SmsWebhookRejectedError,
  type SmsProviderKey,
  type SmsWebhookEnvelope,
  type SmsWebhookHeaders,
} from './sms-provider.adapter';
import { SmsProviderRegistry } from './sms-provider.registry';
import { SmsOutboundService } from './sms-outbound.service';

/** What a carrier HELP gets when the channel has no text of its own. */
export function defaultSmsHelpText(channelName: string) {
  return `${channelName}: responda a esta mensagem para falar com a nossa equipe. Para não receber mais mensagens, envie STOP.`;
}

export type SmsWebhookOutcome = {
  ok: true;
  status: 'processed' | 'ignored' | 'duplicate';
  reason?: string;
};

/**
 * One public URL for every tenant (§3.5): the channel is found by the business
 * number (inbound) or by the message we sent (status), and only then is the
 * body verified with *that* channel's public key. Until verification passes
 * nothing is persisted — a forged body leaves no row behind (401).
 *
 * Telnyx retries a non-2xx three times and then uses the failover URL, which
 * lands here too. Every effect below is idempotent: inbound by provider
 * message id, status by rank, and the whole event by `data.id`.
 */
@Injectable()
export class SmsWebhookService {
  private readonly logger = new Logger(SmsWebhookService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly providers: SmsProviderRegistry,
    private readonly ingestion: InboundMessageIngestionService,
    private readonly statusSync: MessageStatusSyncService,
    private readonly webhookLogs: WebhookLogService,
    private readonly outbound: SmsOutboundService,
  ) {}

  async handle(input: {
    provider: SmsProviderKey;
    headers: SmsWebhookHeaders;
    rawBody: Buffer | undefined;
    failover: boolean;
  }): Promise<SmsWebhookOutcome> {
    if (!input.rawBody?.length) {
      throw new SmsWebhookRejectedError('payload_missing');
    }
    const adapter = this.providers.get(input.provider);
    const envelope = adapter.parseWebhook(input.rawBody);
    const channel = await this.resolveChannel(input.provider, envelope);
    if (!channel) {
      // Not ours, or not connected: there is no key to verify with, so it is
      // treated exactly like a bad signature. Nothing about it is stored.
      this.logger.warn(
        `SMS webhook without a channel: provider=${input.provider} event=${envelope.eventType}`,
      );
      throw new SmsWebhookRejectedError('channel_not_found');
    }
    adapter.verifyWebhook(input.headers, input.rawBody, channel);

    const logBase = {
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      provider: input.provider,
      eventType: envelope.eventType.slice(0, 80),
      externalPhoneNumberId: channel.externalPhoneNumberId,
      externalMessageId: envelope.externalMessageId,
      signatureReceived: true,
      payload: {},
    } as const;

    if (
      await this.alreadyProcessed(channel, input.provider, envelope.eventId)
    ) {
      return { ok: true, status: 'duplicate' };
    }
    if (
      channel.status !== 'active' ||
      channel.connectionStatus !== 'connected'
    ) {
      await this.webhookLogs.create({
        ...logBase,
        status: 'ignored',
        errorMessage: 'channel_unavailable',
        metadata: { eventId: envelope.eventId, failover: input.failover },
      });
      return { ok: true, status: 'ignored', reason: 'channel_unavailable' };
    }

    try {
      const metadata: Record<string, unknown> = {
        eventId: envelope.eventId,
        failover: input.failover,
      };
      let messagesProcessed = 0;
      let statusesProcessed = 0;
      let status: 'processed' | 'ignored' = 'processed';

      const inbound = adapter.normalizeInbound(envelope, channel);
      const statusUpdate = inbound
        ? null
        : adapter.normalizeStatus(envelope, channel);
      if (inbound) {
        const result = await this.ingestion.ingest(inbound);
        messagesProcessed = 1;
        metadata.conversationId = result.conversation.id;
        metadata.messageId = result.message.id;
        metadata.deduplicated = result.deduplicated;
        if ('smsKeyword' in result && result.smsKeyword) {
          metadata.smsKeyword = result.smsKeyword;
        }
        if (
          !result.deduplicated &&
          'smsKeyword' in result &&
          result.smsKeyword === 'help'
        ) {
          metadata.helpReply = await this.answerHelp(
            channel,
            result.conversation,
            result.message.id,
          );
        }
      } else if (statusUpdate) {
        try {
          const updated = await this.statusSync.applyStatusUpdate(statusUpdate);
          statusesProcessed = 1;
          metadata.messageId = updated.id;
          metadata.status = statusUpdate.status;
        } catch (error) {
          // A message sent from the Telnyx portal, not through the Inbox.
          if (!(error instanceof NotFoundException)) throw error;
          status = 'ignored';
          metadata.reason = 'message_not_found';
        }
      } else {
        status = 'ignored';
        metadata.reason = 'unsupported_event';
      }

      await this.webhookLogs.create({
        ...logBase,
        status,
        messagesProcessed,
        statusesProcessed,
        metadata,
      });
      return { ok: true, status };
    } catch (error) {
      await this.webhookLogs.create({
        ...logBase,
        status: 'failed',
        errorMessage: safeErrorCode(error),
        metadata: { eventId: envelope.eventId, failover: input.failover },
      });
      // 5xx: Telnyx retries, then tries the failover URL.
      throw error;
    }
  }

  /** HELP is answered even after STOP; its failure is logged, never dropped. */
  private async answerHelp(
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
    inboundMessageId: string,
  ): Promise<Record<string, unknown>> {
    const configured =
      typeof channel.metadata?.helpText === 'string'
        ? channel.metadata.helpText.trim()
        : '';
    try {
      const sent = await this.outbound.sendKeywordReply({
        channel,
        conversation,
        inboundMessageId,
        text: configured || defaultSmsHelpText(channel.name),
      });
      return { status: 'sent', messageId: sent.message.id };
    } catch (error) {
      this.logger.warn(
        `SMS HELP reply failed: channel=${channel.id} code=${safeErrorCode(error)}`,
      );
      return { status: 'failed', errorCode: safeErrorCode(error) };
    }
  }

  private async resolveChannel(
    provider: SmsProviderKey,
    envelope: SmsWebhookEnvelope,
  ): Promise<InboxChannelEntity | null> {
    const repository = this.dataSource.getRepository(InboxChannelEntity);
    const base = {
      type: 'sms' as const,
      provider,
      deletedAt: IsNull(),
      connectionStatus: Not('disconnected' as const),
    };
    if (envelope.direction === 'outbound' && envelope.externalMessageId) {
      const [row] = await this.dataSource.query<Array<{ channel_id: string }>>(
        `SELECT message.channel_id
           FROM inbox_messages message
           JOIN inbox_channels channel ON channel.id = message.channel_id
          WHERE message.external_message_id = $1
            AND message.direction = 'outbound'
            AND channel.type = 'sms' AND channel.provider = $2
          LIMIT 1`,
        [envelope.externalMessageId, provider],
      );
      if (row) {
        const channel = await repository.findOne({
          where: { id: row.channel_id, ...base },
        });
        if (channel) return channel;
      }
    }
    if (!envelope.businessNumber) return null;
    return repository.findOne({
      where: { ...base, externalPhoneNumberId: envelope.businessNumber },
    });
  }

  private async alreadyProcessed(
    channel: InboxChannelEntity,
    provider: SmsProviderKey,
    eventId: string,
  ) {
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM inbox_webhook_logs
        WHERE channel_id = $1 AND provider = $2
          AND status IN ('processed','ignored')
          AND metadata->>'eventId' = $3
        LIMIT 1`,
      [channel.id, provider, eventId],
    );
    return rows.length > 0;
  }
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,80}$/.test(message)
    ? message
    : error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name)
      ? error.name
      : 'sms_webhook_failed';
}
