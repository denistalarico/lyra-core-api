import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  InboxWebhookLogEntity,
  InboxWebhookProvider,
  InboxWebhookStatus,
} from '../../entities/inbox-webhook-log.entity';

type CreateWebhookLogInput = {
  tenantId?: string | null;
  workspaceId?: string | null;
  channelId?: string | null;
  provider: InboxWebhookProvider;
  eventType: string;
  status?: InboxWebhookStatus;
  externalAccountId?: string | null;
  externalPhoneNumberId?: string | null;
  externalMessageId?: string | null;
  signatureReceived?: boolean;
  messagesProcessed?: number;
  statusesProcessed?: number;
  errorMessage?: string | null;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class WebhookLogService {
  constructor(
    @InjectRepository(InboxWebhookLogEntity)
    private readonly webhookLogsRepository: Repository<InboxWebhookLogEntity>,
  ) {}

  async create(input: CreateWebhookLogInput) {
    return this.webhookLogsRepository.save(
      this.webhookLogsRepository.create({
        tenantId: input.tenantId ?? null,
        workspaceId: input.workspaceId ?? null,
        channelId: input.channelId ?? null,
        provider: input.provider,
        eventType: input.eventType,
        status: input.status ?? 'received',
        externalAccountId: input.externalAccountId ?? null,
        externalPhoneNumberId: input.externalPhoneNumberId ?? null,
        externalMessageId: input.externalMessageId ?? null,
        signatureReceived: input.signatureReceived ?? false,
        messagesProcessed: input.messagesProcessed ?? 0,
        statusesProcessed: input.statusesProcessed ?? 0,
        errorMessage: input.errorMessage ?? null,
        payload: input.payload ?? {},
        metadata: input.metadata ?? {},
      }),
    );
  }
}
