import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { InboxChannelEntity } from '../../inbox/entities/inbox-channel.entity';
import {
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentEntity,
} from '../entities';
import { LeadFlowAgentChannelStatus } from '../enums/leadflow-agent-channel-status.enum';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';

export type BindingReconcileTrigger =
  | 'agent_published'
  | 'agent_activated'
  | 'channel_connected'
  | 'channel_reconnected'
  | 'channel_resumed'
  | 'default_changed'
  | 'admin_check';

export type BindingReconcileResult = {
  channelId: string;
  status: 'active' | 'pending' | 'unbound' | 'choice_required';
  defaultAgentId: string | null;
  aiEnabled: boolean;
  changed: boolean;
};

@Injectable()
export class LeadFlowAgentBindingReconcilerService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async reconcile(
    ctx: RequestContext,
    input: {
      channelId?: string;
      preferredAgentId?: string;
      trigger: BindingReconcileTrigger;
      requireChoice?: boolean;
    },
  ): Promise<BindingReconcileResult[]> {
    if (!ctx.workspaceId) throw new NotFoundException('Workspace not found.');

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`leadflow-default-binding:${ctx.tenantId}:${ctx.workspaceId}`],
      );
      const channels = await manager.getRepository(InboxChannelEntity).find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId!,
          ...(input.channelId ? { id: input.channelId } : {}),
        },
        order: { createdAt: 'ASC' },
      });
      if (input.channelId && channels.length === 0) {
        throw new NotFoundException('Inbox channel not found.');
      }

      const results: BindingReconcileResult[] = [];
      for (const channel of channels) {
        results.push(await this.reconcileChannel(manager, ctx, channel, input));
      }
      return results;
    });
  }

  private async reconcileChannel(
    manager: EntityManager,
    ctx: RequestContext,
    channel: InboxChannelEntity,
    input: {
      preferredAgentId?: string;
      trigger: BindingReconcileTrigger;
      requireChoice?: boolean;
    },
  ): Promise<BindingReconcileResult> {
    const agents = await manager.getRepository(LeadFlowAgentEntity).find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId!,
        status: LeadFlowAgentStatus.Active,
      },
      order: { createdAt: 'ASC' },
    });
    const eligible = agents.filter(
      (agent) =>
        Boolean(agent.publishedVersionId) &&
        this.supportsChannel(agent, channel.type),
    );
    let selected: LeadFlowAgentEntity | null = null;

    if (input.preferredAgentId) {
      selected =
        eligible.find((agent) => agent.id === input.preferredAgentId) ?? null;
      if (!selected) {
        throw new ConflictException(
          'Selected default agent is not active, published and eligible for this channel.',
        );
      }
    } else if (channel.defaultAgentId) {
      selected =
        eligible.find((agent) => agent.id === channel.defaultAgentId) ?? null;
    }

    if (!selected && eligible.length === 1) selected = eligible[0];
    if (!selected && eligible.length > 1) {
      if (input.requireChoice) {
        throw new ConflictException(
          'Multiple agents are eligible. Choose the default agent explicitly.',
        );
      }
      return this.failClosed(manager, ctx, channel, input.trigger);
    }

    if (!selected) {
      return this.clearDefault(manager, ctx, channel, input.trigger, 'unbound');
    }

    const active =
      channel.status === 'active' && channel.connectionStatus === 'connected';
    const bindings = manager.getRepository(LeadFlowAgentChannelBindingEntity);
    const existingForChannel = await bindings
      .createQueryBuilder('binding')
      .where('binding.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('binding.workspaceId = :workspaceId', {
        workspaceId: ctx.workspaceId,
      })
      .andWhere(
        "(binding.externalRef = :channelId OR binding.config->>'channelId' = :channelId)",
        { channelId: channel.id },
      )
      .getMany();
    let binding = await bindings.findOneBy({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId!,
      agentId: selected.id,
      channelKey: channel.type,
    });
    const desiredStatus = active
      ? LeadFlowAgentChannelStatus.Active
      : LeadFlowAgentChannelStatus.Pending;
    const priorAgentId = channel.defaultAgentId;
    const priorStatus = binding?.status ?? null;

    for (const other of existingForChannel) {
      if (other.id === binding?.id) continue;
      if (
        other.status !== LeadFlowAgentChannelStatus.Disabled ||
        other.config?.isDefault === true
      ) {
        other.status = LeadFlowAgentChannelStatus.Disabled;
        other.config = {
          ...other.config,
          isDefault: false,
          channelId: channel.id,
        };
        await bindings.save(other);
      }
    }

    if (!binding) {
      binding = bindings.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId!,
        agentId: selected.id,
        channelKey: channel.type,
        provider: channel.provider ?? channel.type,
        externalRef: channel.id,
        status: desiredStatus,
        config: {},
      });
    }
    binding.provider = channel.provider ?? channel.type;
    binding.externalRef = channel.id;
    binding.status = desiredStatus;
    binding.config = {
      ...binding.config,
      channelId: channel.id,
      isDefault: true,
      reconciledBy: input.trigger,
    };
    await bindings.save(binding);
    channel.defaultAgentId = selected.id;
    await manager.getRepository(InboxChannelEntity).save(channel);

    const changed =
      priorAgentId !== selected.id || priorStatus !== desiredStatus;
    if (changed) {
      await this.audit(
        manager,
        ctx,
        channel,
        selected.id,
        input.trigger,
        desiredStatus,
      );
    }
    return {
      channelId: channel.id,
      status: active ? 'active' : 'pending',
      defaultAgentId: selected.id,
      aiEnabled: channel.aiEnabled,
      changed,
    };
  }

  private async failClosed(
    manager: EntityManager,
    ctx: RequestContext,
    channel: InboxChannelEntity,
    trigger: BindingReconcileTrigger,
  ) {
    return this.clearDefault(manager, ctx, channel, trigger, 'choice_required');
  }

  private async clearDefault(
    manager: EntityManager,
    ctx: RequestContext,
    channel: InboxChannelEntity,
    trigger: BindingReconcileTrigger,
    status: 'unbound' | 'choice_required',
  ): Promise<BindingReconcileResult> {
    const priorAgentId = channel.defaultAgentId;
    const result = await manager
      .createQueryBuilder()
      .update(LeadFlowAgentChannelBindingEntity)
      .set({ status: LeadFlowAgentChannelStatus.Disabled })
      .where('tenant_id = :tenantId AND workspace_id = :workspaceId', {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      })
      .andWhere(
        "(external_ref = :channelId OR config->>'channelId' = :channelId)",
        {
          channelId: channel.id,
        },
      )
      .andWhere("COALESCE(config->>'isDefault', 'false') = 'true'")
      .execute();
    channel.defaultAgentId = null;
    await manager.getRepository(InboxChannelEntity).save(channel);
    const changed = priorAgentId !== null || (result.affected ?? 0) > 0;
    if (changed) {
      await this.audit(manager, ctx, channel, null, trigger, status);
    }
    return {
      channelId: channel.id,
      status,
      defaultAgentId: null,
      aiEnabled: channel.aiEnabled,
      changed,
    };
  }

  private supportsChannel(agent: LeadFlowAgentEntity, channelType: string) {
    const allowed = Array.isArray(agent.channelPolicy?.allowedChannels)
      ? agent.channelPolicy.allowedChannels
      : [];
    return allowed.includes(channelType);
  }

  private async audit(
    manager: EntityManager,
    ctx: RequestContext,
    channel: InboxChannelEntity,
    agentId: string | null,
    trigger: BindingReconcileTrigger,
    outcome: string,
  ) {
    await manager.query(
      `INSERT INTO platform_permission_audit_events
        (tenant_id, workspace_id, actor_user_id, action, resource_type,
         resource_id, risk_level, metadata)
       VALUES ($1, $2, $3, 'leadflow.default_binding.reconciled',
               'inbox_channel', $4, 'high', $5::jsonb)`,
      [
        ctx.tenantId,
        ctx.workspaceId,
        ctx.userId ?? null,
        channel.id,
        JSON.stringify({ trigger, outcome, agentId }),
      ],
    );
    await manager.query(
      `INSERT INTO inbox_domain_outbox
        (tenant_id, workspace_id, aggregate_type, aggregate_id, event_name,
         idempotency_key, payload)
       VALUES ($1, $2, 'inbox_channel', $3,
               'leadflow.agent.default_binding.reconciled', $4, $5::jsonb)
       ON CONFLICT (tenant_id, workspace_id, idempotency_key) DO NOTHING`,
      [
        ctx.tenantId,
        ctx.workspaceId,
        channel.id,
        `binding:${channel.id}:v${channel.lifecycleVersion}:${agentId ?? 'none'}:${outcome}`,
        JSON.stringify({ channelId: channel.id, agentId, trigger, outcome }),
      ],
    );
  }
}
