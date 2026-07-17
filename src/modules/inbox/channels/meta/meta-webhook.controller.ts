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
import { WhatsAppMetaAdapter } from './adapters/whatsapp-meta.adapter';
import type { MetaWhatsAppWebhookPayload } from './types/meta-whatsapp-webhook.types';
import { WebhookLogService } from '../services/webhook-log.service';
import { MessageStatusSyncService } from '../services/message-status-sync.service';

@Controller('inbox/channels/meta/webhook')
export class MetaWebhookController {
  constructor(
    private readonly whatsappMetaAdapter: WhatsAppMetaAdapter,
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
    @Body() payload: MetaWhatsAppWebhookPayload,
  ) {
    this.assertValidSignature(signature, request.rawBody);
    const phoneNumberId = this.extractPhoneNumberId(payload);
    const accountId = payload.entry?.[0]?.id ?? null;
    const eventType = this.extractEventType(payload);

    try {
      const normalized = await this.whatsappMetaAdapter.normalize(payload);
      const normalizedStatuses =
        await this.whatsappMetaAdapter.normalizeStatuses(payload);

      const results: Array<{
        conversationId: string;
        messageId: string;
        externalMessageId: string | null | undefined;
      }> = [];

      const statusResults: Array<{
        messageId: string;
        externalMessageId: string;
        status: string;
      }> = [];

      for (const message of normalized.messages) {
        const result = await this.inboundIngestionService.ingest(message);
        results.push({
          conversationId: result.conversation.id,
          messageId: result.message.id,
          externalMessageId: message.externalMessageId,
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

      await this.webhookLogService.create({
        tenantId: normalized.messages[0]?.tenantId ?? null,
        workspaceId: normalized.messages[0]?.workspaceId ?? null,
        channelId: normalized.messages[0]?.channelId ?? null,
        provider: 'meta',
        eventType,
        status: 'processed',
        externalAccountId: accountId,
        externalPhoneNumberId: phoneNumberId,
        externalMessageId: results[0]?.externalMessageId ?? null,
        signatureReceived: Boolean(signature),
        messagesProcessed: results.length,
        statusesProcessed: statusResults.length,
        payload: {},
        metadata: {
          results,
          statusResults,
        },
      });

      return {
        ok: true,
        provider: 'meta',
        signatureReceived: true,
        messagesProcessed: results.length,
        statusesProcessed: statusResults.length,
        results,
        statusResults,
      };
    } catch (error) {
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

  private assertValidSignature(
    signature: string | undefined,
    rawBody?: Buffer,
  ) {
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'Meta webhook signature validation is not configured.',
      );
    }
    if (!signature || !rawBody || !signature.startsWith('sha256=')) {
      throw new UnauthorizedException('Invalid Meta webhook signature.');
    }
    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid Meta webhook signature.');
    }
  }

  private extractPhoneNumberId(payload: MetaWhatsAppWebhookPayload) {
    return (
      payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null
    );
  }

  private extractEventType(payload: MetaWhatsAppWebhookPayload) {
    const value = payload.entry?.[0]?.changes?.[0]?.value;

    if (value?.messages?.length) return 'message';
    if (value?.statuses?.length) return 'status';

    return payload.entry?.[0]?.changes?.[0]?.field ?? 'unknown';
  }
}
