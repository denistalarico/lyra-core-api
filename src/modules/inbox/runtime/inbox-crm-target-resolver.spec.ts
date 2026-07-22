import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../../crm/entities/crm-stage.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { resolveRoutedCrmTarget } from './inbox-crm-target-resolver';

describe('resolveRoutedCrmTarget', () => {
  const input = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    channelId: 'channel-a',
    businessMode: 'clinic',
  };
  const channel = {
    id: 'channel-a',
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    status: 'active',
    connectionStatus: 'connected',
    aiEnabled: true,
    defaultPipelineId: 'pipeline-a',
    metadata: { clientId: 'client-a' },
  } as unknown as InboxChannelEntity;
  const pipeline = {
    id: 'pipeline-a',
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    status: 'active',
    businessMode: 'clinic',
    metadata: { clientId: 'client-a' },
  } as unknown as CrmPipelineEntity;
  const initialStage = {
    id: 'stage-a',
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    pipelineId: pipeline.id,
    type: 'open',
    isInitialStage: true,
    isWonStage: false,
    isLostStage: false,
  } as unknown as CrmStageEntity;

  function managerWith(overrides?: {
    channel?: InboxChannelEntity | null;
    pipeline?: CrmPipelineEntity | null;
    stages?: CrmStageEntity[];
  }) {
    const channelFindOne = jest
      .fn()
      .mockResolvedValue(
        overrides?.channel === undefined ? channel : overrides.channel,
      );
    const pipelineFindOne = jest
      .fn()
      .mockResolvedValue(
        overrides?.pipeline === undefined ? pipeline : overrides.pipeline,
      );
    const stageFind = jest
      .fn()
      .mockResolvedValue(overrides?.stages ?? [initialStage]);
    const getRepository = jest.fn((entity) => {
      if (entity === InboxChannelEntity) return { findOne: channelFindOne };
      if (entity === CrmPipelineEntity) return { findOne: pipelineFindOne };
      if (entity === CrmStageEntity) return { find: stageFind };
      throw new Error('unexpected_repository');
    });
    return {
      manager: { getRepository } as never,
      channelFindOne,
      pipelineFindOne,
      stageFind,
    };
  }

  it('resolves the explicit channel pipeline and its unique initial stage', async () => {
    const { manager } = managerWith();
    await expect(resolveRoutedCrmTarget(manager, input)).resolves.toEqual({
      ok: true,
      channel,
      pipeline,
      initialStage,
    });
  });

  it('fails closed without a channel route and never searches default pipelines', async () => {
    const { manager, pipelineFindOne, stageFind } = managerWith({
      channel: { ...channel, defaultPipelineId: null },
    });
    await expect(resolveRoutedCrmTarget(manager, input)).resolves.toEqual({
      ok: false,
      errorCode: 'channel_pipeline_unconfigured',
    });
    expect(pipelineFindOne).not.toHaveBeenCalled();
    expect(stageFind).not.toHaveBeenCalled();
  });

  it('rejects cross-client routing even inside the same tenant and workspace', async () => {
    const { manager, stageFind } = managerWith({
      pipeline: { ...pipeline, metadata: { clientId: 'client-b' } },
    });
    await expect(resolveRoutedCrmTarget(manager, input)).resolves.toEqual({
      ok: false,
      errorCode: 'pipeline_context_mismatch',
    });
    expect(stageFind).not.toHaveBeenCalled();
  });

  it('rejects an incompatible business mode and a missing initial stage', async () => {
    const incompatible = managerWith({
      pipeline: { ...pipeline, businessMode: 'restaurant' },
    });
    await expect(
      resolveRoutedCrmTarget(incompatible.manager, input),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'pipeline_business_mode_mismatch',
    });

    const missing = managerWith({ stages: [] });
    await expect(
      resolveRoutedCrmTarget(missing.manager, input),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'initial_stage_missing_or_ambiguous',
    });
  });

  it('rechecks channel operational eligibility when the worker applies the action', async () => {
    const { manager, pipelineFindOne } = managerWith({
      channel: { ...channel, connectionStatus: 'disconnected' },
    });
    await expect(resolveRoutedCrmTarget(manager, input)).resolves.toEqual({
      ok: false,
      errorCode: 'channel_unavailable',
    });
    expect(pipelineFindOne).not.toHaveBeenCalled();
  });
});
