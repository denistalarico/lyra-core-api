import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { InboundMessageIngestionService } from '../services/inbound-message-ingestion.service';
import { InstagramMetaAdapter } from './adapters/instagram-meta.adapter';
import { MessengerMetaAdapter } from './adapters/messenger-meta.adapter';
import { WhatsAppMetaAdapter } from './adapters/whatsapp-meta.adapter';
import type { MetaInstagramWebhookPayload } from './types/meta-instagram-webhook.types';
import type { MetaMessengerWebhookPayload } from './types/meta-messenger-webhook.types';
import type { MetaWhatsAppWebhookPayload } from './types/meta-whatsapp-webhook.types';
import type { NormalizedMessageStatusWatermarkUpdate } from '../types/normalized-message-status-update';
import type { NormalizedInboundMessage } from '../types/normalized-inbound-message';
import { WebhookLogService } from '../services/webhook-log.service';
import { MessageStatusSyncService } from '../services/message-status-sync.service';
import { MetaChannelUnavailableError } from './services/meta-channel-resolver.service';

type MetaWebhookPayload =
  | MetaWhatsAppWebhookPayload
  | MetaInstagramWebhookPayload
  | MetaMessengerWebhookPayload;
type MetaWebhookWorkload = 'whatsapp' | 'instagram' | 'messenger' | 'unknown';
type SupportedMetaWebhookWorkload = Exclude<MetaWebhookWorkload, 'unknown'>;

@Controller('inbox/channels/meta/webhook')
export class MetaWebhookController {
  constructor(
    private readonly whatsappMetaAdapter: WhatsAppMetaAdapter,
    private readonly instagramMetaAdapter: InstagramMetaAdapter,
    private readonly messengerMetaAdapter: MessengerMetaAdapter,
    private readonly inboundIngestionService: InboundMessageIngestionService,
    private readonly webhookLogService: WebhookLogService,
    private readonly messageStatusSyncService: MessageStatusSyncService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ) {
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'Meta webhook verification is not configured.',
      );
    }

    if (mode === 'subscribe' && verifyToken === expectedToken && challenge) {
      return challenge;
    }

    throw new BadRequestException('Invalid Meta webhook verification request.');
  }

  @Post()
  @HttpCode(200)
  async receiveWebhook(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Body()
    payload: MetaWebhookPayload,
  ) {
    const workload = this.identifyWorkload(payload);
    this.assertValidSignature(signature, request.rawBody, workload);
    const { phoneNumberId, accountId, eventType } = this.extractWebhookContext(
      workload,
      payload,
    );

    if (workload === 'unknown') {
      await this.webhookLogService.create({
        provider: 'meta',
        eventType,
        status: 'ignored',
        externalAccountId: accountId,
        externalPhoneNumberId: null,
        signatureReceived: Boolean(signature),
        payload: {},
        metadata: { reason: 'unsupported_meta_payload' },
      });
      return { ok: true, ignored: true, reason: 'unsupported_meta_payload' };
    }

    try {
      const {
        normalized,
        normalizedStatuses,
        normalizedReactions,
        normalizedEchoes,
      } = await this.normalizeSupportedWorkload(workload, payload);

      const results: Array<{
        conversationId: string;
        messageId: string;
        externalMessageId: string | null | undefined;
      }> = [];
      const echoResults: Array<{
        conversationId: string;
        messageId: string;
        externalMessageId: string | null | undefined;
        deduplicated: boolean;
      }> = [];

      const statusResults: Array<{
        messageId: string;
        externalMessageId: string;
        status: string;
      }> = [];
      const reactionResults: Array<{
        messageId: string;
        externalMessageId: string;
        action: string;
      }> = [];
      const statusWatermarkResults: Array<{
        conversationId: string;
        status: string;
        updatedMessageIds: string[];
      }> = [];

      for (const message of normalized.messages) {
        const result = await this.inboundIngestionService.ingest(message);
        results.push({
          conversationId: result.conversation.id,
          messageId: result.message.id,
          externalMessageId: message.externalMessageId,
        });
      }
      for (const echo of normalizedEchoes.messages) {
        // No conversation for the thread yet: an echo carries no
        // qualification signal, so ingestEcho() returns null rather than
        // fabricating one — silently skip it.
        const result = await this.inboundIngestionService.ingestEcho(echo);
        if (!result) continue;
        echoResults.push({
          conversationId: result.conversation.id,
          messageId: result.message.id,
          externalMessageId: echo.externalMessageId,
          deduplicated: result.deduplicated,
        });
      }
      for (const statusUpdate of normalizedStatuses.statuses) {
        const updatedMessage =
          await this.messageStatusSyncService.applyStatusUpdate(statusUpdate);

        statusResults.push({
          messageId: updatedMessage.id,
          externalMessageId: statusUpdate.externalMessageId,
          status: statusUpdate.status,
        });
      }
      for (const reactionUpdate of normalizedReactions.reactions) {
        const updatedMessage =
          await this.messageStatusSyncService.applyReaction(reactionUpdate);
        reactionResults.push({
          messageId: updatedMessage.id,
          externalMessageId: reactionUpdate.externalMessageId,
          action: reactionUpdate.action,
        });
      }
      for (const watermarkUpdate of normalizedStatuses.statusWatermarks) {
        const result =
          await this.messageStatusSyncService.applyStatusWatermark(
            watermarkUpdate,
          );
        statusWatermarkResults.push({
          conversationId: result.conversationId,
          status: watermarkUpdate.status,
          updatedMessageIds: result.updatedMessageIds,
        });
      }

      const normalizedScope =
        normalized.messages[0] ??
        normalizedEchoes.messages[0] ??
        normalizedStatuses.statuses[0] ??
        normalizedReactions.reactions[0] ??
        normalizedStatuses.statusWatermarks[0];
      const metadata: Record<string, unknown> = {
        workload,
        results,
        echoResults,
        statusResults,
        reactionResults,
        statusWatermarkResults,
      };
      await this.webhookLogService.create({
        tenantId: normalizedScope?.tenantId ?? null,
        workspaceId: normalizedScope?.workspaceId ?? null,
        channelId: normalizedScope?.channelId ?? null,
        provider: 'meta',
        eventType,
        status: 'processed',
        externalAccountId: accountId,
        externalPhoneNumberId: phoneNumberId,
        externalMessageId:
          results[0]?.externalMessageId ?? echoResults[0]?.externalMessageId ?? null,
        signatureReceived: Boolean(signature),
        messagesProcessed: results.length + echoResults.length,
        statusesProcessed: statusResults.length + statusWatermarkResults.length,
        payload: {},
        metadata,
      });

      return {
        ok: true,
        provider: 'meta',
        signatureReceived: true,
        messagesProcessed: results.length,
        echoesProcessed: echoResults.length,
        statusesProcessed: statusResults.length + statusWatermarkResults.length,
        reactionsProcessed: reactionResults.length,
        results,
        echoResults,
        statusResults,
        reactionResults,
        statusWatermarkResults,
      };
    } catch (error) {
      if (error instanceof MetaChannelUnavailableError) {
        const metadata: Record<string, unknown> = {
          workload,
          connectionStatus: error.channel.connectionStatus,
        };
        await this.webhookLogService.create({
          tenantId: error.channel.tenantId,
          workspaceId: error.channel.workspaceId,
          channelId: error.channel.id,
          provider: 'meta',
          eventType,
          status: 'ignored',
          externalAccountId: accountId,
          externalPhoneNumberId: phoneNumberId,
          signatureReceived: Boolean(signature),
          errorMessage: error.code,
          payload: {},
          metadata,
        });
        return { ok: true, ignored: true, reason: error.code };
      }
      await this.webhookLogService.create({
        provider: 'meta',
        eventType,
        status: 'failed',
        externalAccountId: accountId,
        externalPhoneNumberId: phoneNumberId,
        signatureReceived: Boolean(signature),
        errorMessage:
          error instanceof Error ? error.message : 'Unknown webhook error',
        payload: {},
      });

      throw error;
    }
  }

  private identifyWorkload(payload: MetaWebhookPayload): MetaWebhookWorkload {
    if (payload.object === 'whatsapp_business_account') return 'whatsapp';
    if (payload.object === 'instagram') return 'instagram';
    if (payload.object === 'page') return 'messenger';
    return 'unknown';
  }

  private assertValidSignature(
    signature: string | undefined,
    rawBody?: Buffer,
    workload: MetaWebhookWorkload = 'unknown',
  ) {
    const secrets = this.getWebhookSigningSecrets(workload);
    if (secrets.length === 0) {
      throw new ServiceUnavailableException(
        'Meta webhook signature validation is not configured.',
      );
    }
    if (!signature || !rawBody || !signature.startsWith('sha256=')) {
      throw new UnauthorizedException('Invalid Meta webhook signature.');
    }
    const receivedBuffer = Buffer.from(signature);
    const valid = secrets.some((secret) => {
      const expected = `sha256=${createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex')}`;
      const expectedBuffer = Buffer.from(expected);

      return (
        receivedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(receivedBuffer, expectedBuffer)
      );
    });

    if (!valid) {
      throw new UnauthorizedException('Invalid Meta webhook signature.');
    }
  }

  private getWebhookSigningSecrets(workload: MetaWebhookWorkload) {
    const metaSecret = process.env.META_APP_SECRET?.trim();
    const instagramSecret =
      process.env.META_INSTAGRAM_APP_SECRET?.trim() || metaSecret;

    switch (workload) {
      case 'whatsapp':
        return metaSecret ? [metaSecret] : [];
      case 'instagram':
        return instagramSecret ? [instagramSecret] : [];
      case 'messenger':
        return metaSecret ? [metaSecret] : [];
      case 'unknown':
        return [
          ...new Set([metaSecret, instagramSecret].filter(Boolean)),
        ] as string[];
    }
  }

  private extractWebhookContext(
    workload: MetaWebhookWorkload,
    payload: MetaWebhookPayload,
  ) {
    switch (workload) {
      case 'whatsapp': {
        const whatsappPayload = payload as MetaWhatsAppWebhookPayload;
        return {
          phoneNumberId: this.extractPhoneNumberId(whatsappPayload),
          accountId: whatsappPayload.entry?.[0]?.id ?? null,
          eventType: this.extractWhatsAppEventType(whatsappPayload),
        };
      }
      case 'instagram': {
        const instagramPayload = payload as MetaInstagramWebhookPayload;
        return {
          phoneNumberId: null,
          accountId: this.extractInstagramAccountId(instagramPayload),
          eventType: this.extractInstagramEventType(instagramPayload),
        };
      }
      case 'messenger': {
        const messengerPayload = payload as MetaMessengerWebhookPayload;
        return {
          phoneNumberId: null,
          accountId: messengerPayload.entry?.[0]?.id ?? null,
          eventType: this.extractMessengerEventType(messengerPayload),
        };
      }
      case 'unknown':
        return {
          phoneNumberId: null,
          accountId: payload.entry?.[0]?.id ?? null,
          eventType: 'unknown',
        };
    }
  }

  private async normalizeSupportedWorkload(
    workload: SupportedMetaWebhookWorkload,
    payload: MetaWebhookPayload,
  ) {
    switch (workload) {
      case 'whatsapp': {
        const whatsappPayload = payload as MetaWhatsAppWebhookPayload;
        return {
          normalized: await this.whatsappMetaAdapter.normalize(whatsappPayload),
          normalizedStatuses: {
            ...(await this.whatsappMetaAdapter.normalizeStatuses(
              whatsappPayload,
            )),
            statusWatermarks: [] as NormalizedMessageStatusWatermarkUpdate[],
          },
          normalizedReactions:
            await this.whatsappMetaAdapter.normalizeReactions(
              whatsappPayload,
            ),
          normalizedEchoes: { messages: [] as NormalizedInboundMessage[] },
        };
      }
      case 'instagram': {
        const instagramPayload = payload as MetaInstagramWebhookPayload;
        return {
          normalized:
            await this.instagramMetaAdapter.normalize(instagramPayload),
          normalizedStatuses: {
            ...(await this.instagramMetaAdapter.normalizeStatuses(
              instagramPayload,
            )),
            statusWatermarks: [] as NormalizedMessageStatusWatermarkUpdate[],
          },
          normalizedReactions:
            await this.instagramMetaAdapter.normalizeReactions(
              instagramPayload,
            ),
          normalizedEchoes: { messages: [] as NormalizedInboundMessage[] },
        };
      }
      case 'messenger': {
        const messengerPayload = payload as MetaMessengerWebhookPayload;
        return {
          normalized:
            await this.messengerMetaAdapter.normalize(messengerPayload),
          normalizedStatuses:
            await this.messengerMetaAdapter.normalizeStatuses(
              messengerPayload,
            ),
          normalizedReactions:
            await this.messengerMetaAdapter.normalizeReactions(
              messengerPayload,
            ),
          normalizedEchoes:
            await this.messengerMetaAdapter.normalizeEchoes(messengerPayload),
        };
      }
    }
  }

  private extractPhoneNumberId(payload: MetaWhatsAppWebhookPayload) {
    return (
      payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null
    );
  }

  private extractWhatsAppEventType(payload: MetaWhatsAppWebhookPayload) {
    const value = payload.entry?.[0]?.changes?.[0]?.value;

    if (value?.messages?.length) return 'message';
    if (value?.statuses?.length) return 'status';

    return payload.entry?.[0]?.changes?.[0]?.field ?? 'unknown';
  }

  private extractInstagramAccountId(payload: MetaInstagramWebhookPayload) {
    return (
      payload.entry?.[0]?.id ??
      payload.entry?.[0]?.messaging?.[0]?.recipient?.id ??
      null
    );
  }

  private extractInstagramEventType(payload: MetaInstagramWebhookPayload) {
    const events =
      payload.entry?.flatMap((entry) => entry.messaging ?? []) ?? [];
    if (events.some((event) => event.message)) return 'message';
    if (events.some((event) => event.reaction)) return 'message_reaction';
    if (events.some((event) => event.read)) return 'message_read';
    return 'unknown';
  }

  private extractMessengerEventType(payload: MetaMessengerWebhookPayload) {
    const events =
      payload.entry?.flatMap((entry) => entry?.messaging ?? []) ?? [];
    return events.some((event) => event.message) ? 'message' : 'unknown';
  }
}
