import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { InboxMetaOperationEntity } from '../../../entities/inbox-meta-operation.entity';
import type { PilotOutboundAuthorization } from './inbox-pilot-outbound-policy.service';

type Scope = {
  tenantId: string;
  workspaceId: string;
  channelId: string;
  conversationId: string;
  messageId: string | null;
  operation: string;
  idempotencyKey: string;
  recipient: PilotOutboundAuthorization;
};

@Injectable()
export class InboxMetaOperationLedgerService {
  constructor(
    @InjectRepository(InboxMetaOperationEntity, 'agency')
    private readonly repository: Repository<InboxMetaOperationEntity>,
  ) {}

  async reserve(input: Scope): Promise<InboxMetaOperationEntity> {
    const existing = await this.repository.findOneBy({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) return this.assertSameIntent(existing, input);
    const entity = this.repository.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      recipientHash: input.recipient.recipientHash,
      recipientMasked: input.recipient.recipientMasked,
      state: 'reserved',
      attempt: 1,
      costStatus: 'unknown',
      estimatedCostUsd: null,
      externalRefHash: null,
      latencyMs: null,
      errorCategory: null,
      deliveryStatus: null,
      deliveryUpdatedAt: null,
      startedAt: null,
      succeededAt: null,
      failedAt: null,
      replayedAt: null,
      replayCount: 0,
      retainUntil: addDays(new Date(), 90),
    });
    try {
      return await this.repository.save(entity);
    } catch (error) {
      const raced = await this.repository.findOneBy({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
      });
      if (!raced) throw error;
      return this.assertSameIntent(raced, input);
    }
  }

  async started(row: InboxMetaOperationEntity): Promise<void> {
    row.state = 'started';
    row.startedAt = new Date();
    await this.repository.save(row);
  }

  async succeeded(
    row: InboxMetaOperationEntity,
    startedMs: number,
    externalReference?: string | null,
  ): Promise<void> {
    const now = new Date();
    row.state = 'succeeded';
    row.latencyMs = Math.max(0, Date.now() - startedMs);
    row.succeededAt = now;
    row.retainUntil = addDays(now, 90);
    row.externalRefHash = externalReference
      ? createHash('sha256').update(externalReference).digest('hex')
      : null;
    await this.repository.save(row);
  }

  async failed(
    row: InboxMetaOperationEntity,
    startedMs: number,
    error: unknown,
  ): Promise<void> {
    const now = new Date();
    row.state = isTimeout(error) ? 'unknown_outcome' : 'failed';
    row.latencyMs = Math.max(0, Date.now() - startedMs);
    row.errorCategory = sanitizeError(error);
    row.failedAt = now;
    row.retainUntil = addDays(now, row.state === 'unknown_outcome' ? 180 : 90);
    await this.repository.save(row);
  }

  async replay(input: Omit<Scope, 'messageId'>): Promise<void> {
    const row = await this.repository.findOneBy({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
    });
    if (!row) return;
    if (
      row.channelId !== input.channelId ||
      row.conversationId !== input.conversationId ||
      row.recipientHash !== input.recipient.recipientHash
    ) {
      throw new ConflictException('meta_idempotency_intent_conflict');
    }
    if (row.succeededAt) {
      row.state = 'replayed';
      row.replayedAt = new Date();
      row.replayCount += 1;
      await this.repository.save(row);
    }
  }

  async reconcileDelivery(input: {
    tenantId: string;
    workspaceId: string;
    messageId: string;
    status: string;
    occurredAt: Date;
  }): Promise<void> {
    await this.repository.update(
      {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        messageId: input.messageId,
      },
      {
        deliveryStatus: input.status,
        deliveryUpdatedAt: input.occurredAt,
      },
    );
  }

  private assertSameIntent(
    row: InboxMetaOperationEntity,
    input: Pick<
      Scope,
      'channelId' | 'conversationId' | 'messageId' | 'recipient'
    >,
  ): InboxMetaOperationEntity {
    if (
      row.channelId !== input.channelId ||
      row.conversationId !== input.conversationId ||
      (row.messageId !== null &&
        input.messageId !== null &&
        row.messageId !== input.messageId) ||
      row.recipientHash !== input.recipient.recipientHash
    ) {
      throw new ConflictException('meta_idempotency_intent_conflict');
    }
    return row;
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || /timeout/i.test(error.message))
  );
}

function sanitizeError(error: unknown): string {
  if (isTimeout(error)) return 'provider_timeout_unknown_outcome';
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  if (status >= 400 && status < 500) return 'provider_rejected';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_send_failed';
}
