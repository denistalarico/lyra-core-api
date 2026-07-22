import { EntityManager, IsNull } from 'typeorm';
import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../../crm/entities/crm-stage.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';

export type InboxCrmRoutingErrorCode =
  | 'channel_unavailable'
  | 'channel_pipeline_unconfigured'
  | 'pipeline_unavailable'
  | 'pipeline_context_mismatch'
  | 'pipeline_business_mode_mismatch'
  | 'initial_stage_missing_or_ambiguous';

export type InboxCrmRoutingResult =
  | {
      ok: true;
      channel: InboxChannelEntity;
      pipeline: CrmPipelineEntity;
      initialStage: CrmStageEntity;
    }
  | { ok: false; errorCode: InboxCrmRoutingErrorCode };

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolves the automatic CRM target from the canonical channel binding.
 * There is deliberately no default-pipeline or sort-order fallback here.
 */
export async function resolveRoutedCrmTarget(
  manager: EntityManager,
  input: {
    tenantId: string;
    workspaceId: string;
    channelId: string | null;
    businessMode: string;
  },
): Promise<InboxCrmRoutingResult> {
  if (!input.channelId) return { ok: false, errorCode: 'channel_unavailable' };

  const channel = await manager.getRepository(InboxChannelEntity).findOne({
    where: {
      id: input.channelId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      deletedAt: IsNull(),
    },
  });
  if (
    !channel ||
    channel.status !== 'active' ||
    channel.connectionStatus !== 'connected' ||
    !channel.aiEnabled
  ) {
    return { ok: false, errorCode: 'channel_unavailable' };
  }
  if (!channel.defaultPipelineId) {
    return { ok: false, errorCode: 'channel_pipeline_unconfigured' };
  }

  const pipeline = await manager.getRepository(CrmPipelineEntity).findOne({
    where: {
      id: channel.defaultPipelineId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      status: 'active',
      deletedAt: IsNull(),
    },
  });
  if (!pipeline) return { ok: false, errorCode: 'pipeline_unavailable' };

  const channelClientId = metadataString(channel.metadata, 'clientId');
  const pipelineClientId = metadataString(pipeline.metadata, 'clientId');
  if (channelClientId !== pipelineClientId) {
    return { ok: false, errorCode: 'pipeline_context_mismatch' };
  }
  if (
    pipeline.businessMode !== 'general' &&
    pipeline.businessMode !== input.businessMode
  ) {
    return { ok: false, errorCode: 'pipeline_business_mode_mismatch' };
  }

  const initialStages = await manager.getRepository(CrmStageEntity).find({
    where: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      pipelineId: pipeline.id,
      isInitialStage: true,
      type: 'open',
      isWonStage: false,
      isLostStage: false,
      deletedAt: IsNull(),
    },
    take: 2,
  });
  if (initialStages.length !== 1) {
    return {
      ok: false,
      errorCode: 'initial_stage_missing_or_ambiguous',
    };
  }

  return {
    ok: true,
    channel,
    pipeline,
    initialStage: initialStages[0],
  };
}
