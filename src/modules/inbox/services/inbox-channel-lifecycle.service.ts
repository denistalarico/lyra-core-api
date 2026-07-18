import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowAgentChannelBindingEntity } from '../../leadflow-agents/entities/leadflow-agent-channel-binding.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxChannelLifecycleRequestEntity } from '../entities/inbox-channel-lifecycle-request.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { mapInboxChannel } from '../mappers/inbox-channel.mapper';

type Operation = 'pause' | 'resume' | 'disconnect';

@Injectable()
export class InboxChannelLifecycleService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async execute(
    ctx: RequestContext,
    channelId: string,
    operation: Operation,
    idempotencyKey: string | undefined,
    reason?: string,
  ) {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const workspaceId = this.requireWorkspace(ctx);
    const sanitizedReason = reason?.trim().slice(0, 500) || null;

    return this.dataSource.transaction(async (manager) => {
      // Lock before reading the idempotency record. Concurrent requests with
      // the same key then serialize on the channel and the second one observes
      // the record written by the first instead of failing its unique index.
      const channel = await this.findLocked(
        manager,
        ctx,
        workspaceId,
        channelId,
      );
      const prior = await manager
        .getRepository(InboxChannelLifecycleRequestEntity)
        .findOneBy({
          tenantId: ctx.tenantId,
          workspaceId,
          channelId,
          idempotencyKey: key,
        });
      if (prior) {
        return {
          ok: true,
          idempotent: true,
          operation: prior.operation,
          channel: mapInboxChannel(channel),
        };
      }

      const now = new Date();
      if (operation === 'pause') {
        if (
          channel.connectionStatus === 'disconnected' ||
          channel.connectionStatus === 'disconnecting'
        ) {
          throw new BadRequestException(
            'Disconnected channel must be reconnected through its connection flow.',
          );
        }
        channel.connectionStatus = 'suspended';
        channel.status = 'inactive';
        channel.aiEnabled = false;
        channel.suspendedAt = now;
      } else if (operation === 'resume') {
        if (
          channel.connectionStatus === 'disconnected' ||
          channel.connectionStatus === 'disconnecting'
        ) {
          throw new BadRequestException(
            'Disconnected channel must be reconnected through Embedded Signup.',
          );
        }
        if (!channel.accessTokenEncrypted && channel.provider === 'meta') {
          throw new BadRequestException(
            'Disconnected channel must be reconnected through Embedded Signup.',
          );
        }
        channel.connectionStatus = 'connected';
        channel.status = 'active';
        channel.aiEnabled = false;
        channel.suspendedAt = null;
      } else {
        if (channel.connectionStatus === 'disconnected') {
          await this.recordRequest(manager, {
            ctx,
            workspaceId,
            channel,
            operation,
            key,
            reason: sanitizedReason,
          });
          return {
            ok: true,
            idempotent: true,
            operation,
            channel: mapInboxChannel(channel),
          };
        }
        channel.connectionStatus = 'disconnecting';
        channel.status = 'inactive';
        channel.aiEnabled = false;
        await manager.getRepository(InboxChannelEntity).save(channel);

        await manager
          .createQueryBuilder()
          .update(LeadFlowAgentChannelBindingEntity)
          .set({ status: 'disabled' as never })
          .where('tenant_id = :tenantId AND workspace_id = :workspaceId', {
            tenantId: ctx.tenantId,
            workspaceId,
          })
          .andWhere(
            "(external_ref = :channelId OR config->>'channelId' = :channelId)",
            { channelId },
          )
          .execute();
        await manager.query(
          `UPDATE inbox_processing_batches SET status = 'cancelled', error_code = 'channel_disconnected', completed_at = now()
           WHERE tenant_id = $1 AND workspace_id = $2 AND channel_id = $3 AND status IN ('pending','processing')`,
          [ctx.tenantId, workspaceId, channelId],
        );
        await manager.query(
          `UPDATE inbox_agent_decisions d SET status = 'invalidated', error_code = 'channel_disconnected', updated_at = now()
           FROM inbox_processing_batches b
           WHERE d.batch_id = b.id AND b.tenant_id = $1 AND b.workspace_id = $2 AND b.channel_id = $3
             AND d.status = 'proposed'`,
          [ctx.tenantId, workspaceId, channelId],
        );
        await manager.query(
          `UPDATE inbox_conversations
           SET ai_enabled = false,
               ownership_state = CASE WHEN ownership_state = 'ai_active' THEN 'paused' ELSE ownership_state END,
               ownership_version = CASE WHEN ownership_state = 'ai_active' THEN ownership_version + 1 ELSE ownership_version END,
               ownership_reason = CASE WHEN ownership_state = 'ai_active' THEN 'channel_disconnected' ELSE ownership_reason END,
               ownership_changed_at = CASE WHEN ownership_state = 'ai_active' THEN now() ELSE ownership_changed_at END,
               updated_at = now()
           WHERE tenant_id = $1 AND workspace_id = $2 AND channel_id = $3 AND ai_enabled = true`,
          [ctx.tenantId, workspaceId, channelId],
        );

        channel.accessTokenEncrypted = null;
        channel.verifyToken = null;
        channel.webhookSecret = null;
        channel.defaultAgentId = null;
        channel.connectionStatus = 'disconnected';
        channel.disconnectedAt = now;
        channel.disconnectedBy = ctx.userId ?? null;
        channel.disconnectReason = sanitizedReason;
        channel.credentialRemovedAt = now;
      }

      channel.lifecycleVersion = (channel.lifecycleVersion || 0) + 1;
      await manager.getRepository(InboxChannelEntity).save(channel);
      await this.recordRequest(manager, {
        ctx,
        workspaceId,
        channel,
        operation,
        key,
        reason: sanitizedReason,
      });
      const eventNames =
        operation === 'disconnect'
          ? [
              'inbox.channel.disconnect_requested',
              'inbox.channel.pending_work_cancelled',
              'inbox.channel.credential_removed',
              'inbox.channel.disconnected',
            ]
          : [`inbox.channel.${operation === 'resume' ? 'resumed' : 'paused'}`];
      const outbox = manager.getRepository(InboxDomainOutboxEntity);
      for (const eventName of eventNames) {
        await outbox.save(
          outbox.create({
            tenantId: ctx.tenantId,
            workspaceId,
            aggregateType: 'inbox_channel',
            aggregateId: channel.id,
            eventName,
            eventVersion: 1,
            idempotencyKey: `channel:${channel.id}:${operation}:${key}:${eventName}`,
            payload: {
              channelId: channel.id,
              lifecycleVersion: channel.lifecycleVersion,
              credentialRemoved: operation === 'disconnect',
              pendingWorkCancelled: operation === 'disconnect',
            },
            status: 'pending',
            attempts: 0,
            availableAt: now,
          }),
        );
      }

      return {
        ok: true,
        idempotent: false,
        operation,
        channel: mapInboxChannel(channel),
      };
    });
  }

  private async recordRequest(
    manager: EntityManager,
    input: {
      ctx: RequestContext;
      workspaceId: string;
      channel: InboxChannelEntity;
      operation: Operation;
      key: string;
      reason: string | null;
    },
  ) {
    const repository = manager.getRepository(
      InboxChannelLifecycleRequestEntity,
    );
    await repository.save(
      repository.create({
        tenantId: input.ctx.tenantId,
        workspaceId: input.workspaceId,
        channelId: input.channel.id,
        operation: input.operation,
        idempotencyKey: input.key,
        actorUserId: input.ctx.userId ?? null,
        reason: input.reason,
        resultStatus: 'completed',
        lifecycleVersion: input.channel.lifecycleVersion,
      }),
    );
  }

  private async findLocked(
    manager: EntityManager,
    ctx: RequestContext,
    workspaceId: string,
    id: string,
  ) {
    const channel = await manager.getRepository(InboxChannelEntity).findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId },
      lock: { mode: 'pessimistic_write' },
    });
    const clientId = channel?.metadata?.clientId;
    if (
      !channel ||
      (ctx.managedContext?.operatingMode === 'client' &&
        clientId !== ctx.managedContext.clientId)
    ) {
      throw new NotFoundException('Inbox channel not found.');
    }
    return channel;
  }

  private requireWorkspace(ctx: RequestContext) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return ctx.workspaceId;
  }

  private requireIdempotencyKey(value?: string) {
    const key = value?.trim();
    if (!key || key.length > 180 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new BadRequestException(
        'A valid Idempotency-Key header is required.',
      );
    }
    return key;
  }
}
