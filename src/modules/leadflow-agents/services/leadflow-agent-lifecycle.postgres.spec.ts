import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import {
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentEntity,
  LeadFlowAgentVersionEntity,
} from '../entities';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentBindingReconcilerService } from './leadflow-agent-binding-reconciler.service';
import { LeadFlowAgentPresetService } from './leadflow-agent-preset.service';
import { LeadFlowAgentService } from './leadflow-agent.service';

const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

run('LeadFlow agent archive/soft-delete lifecycle PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const ctx = { tenantId, workspaceId, userId: randomUUID() };
  let service: LeadFlowAgentService;
  let settingsId: string;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    service = new LeadFlowAgentService(
      AgencyDataSource.getRepository(LeadFlowAgentEntity),
      AgencyDataSource.getRepository(LeadFlowAgentVersionEntity),
      AgencyDataSource.getRepository(LeadFlowAgentChannelBindingEntity),
      AgencyDataSource.getRepository(LeadFlowClientSettingsEntity),
      AgencyDataSource.getRepository(InboxConversationEntity),
      new LeadFlowAgentPresetService(),
      {} as never,
      {} as never,
      new LeadFlowAgentBindingReconcilerService(AgencyDataSource),
      { recordTransition: async () => undefined } as never,
    );

    const settings = await AgencyDataSource.getRepository(
      LeadFlowClientSettingsEntity,
    ).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({
      id: settingsId,
    });
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  beforeEach(async () => {
    await AgencyDataSource.query(
      `TRUNCATE inbox_domain_outbox, platform_permission_audit_events,
       inbox_conversations, leadflow_agent_channel_bindings,
       leadflow_agent_versions, leadflow_agents, inbox_channels
       RESTART IDENTITY CASCADE`,
    );
  });

  async function insertAgent(
    overrides: { status?: string; isProtected?: boolean } = {},
  ) {
    const agentId = randomUUID();
    const versionId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO leadflow_agents
        (id,tenant_id,workspace_id,settings_id,business_mode_key,type,name,status,
         is_system,is_custom,is_protected,behavior_config,prompt_config,
         handoff_policy,crm_policy,channel_policy,avatar_config,readiness,metadata)
       VALUES ($1,$2,$3,$4,'agency_services','custom','Agent',$5,false,true,$6,
               '{}','{}','{}','{}',$7::jsonb,'{}','{}','{}')`,
      [
        agentId,
        tenantId,
        workspaceId,
        settingsId,
        overrides.status ?? LeadFlowAgentStatus.Active,
        overrides.isProtected ?? false,
        JSON.stringify({
          allowedChannels: ['whatsapp'],
          defaultChannel: 'whatsapp',
        }),
      ],
    );
    await AgencyDataSource.query(
      `INSERT INTO leadflow_agent_versions
        (id,tenant_id,agent_id,version,status,snapshot)
       VALUES ($1,$2,$3,1,'published','{}')`,
      [versionId, tenantId, agentId],
    );
    await AgencyDataSource.query(
      'UPDATE leadflow_agents SET published_version_id=$1 WHERE id=$2',
      [versionId, agentId],
    );
    return agentId;
  }

  async function insertChannel() {
    const channelId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_channels
        (id,tenant_id,workspace_id,name,type,status,connection_status,provider,
         ai_enabled,settings,metadata)
       VALUES ($1,$2,$3,'WhatsApp','whatsapp','active','connected','meta',false,'{}','{}')`,
      [channelId, tenantId, workspaceId],
    );
    return channelId;
  }

  it('archiving releases the agent as a channel default and preserves version/binding history', async () => {
    const agentId = await insertAgent();
    const channelId = await insertChannel();
    const reconciler = new LeadFlowAgentBindingReconcilerService(
      AgencyDataSource,
    );
    await reconciler.reconcile(ctx, {
      channelId,
      trigger: 'channel_connected',
    });

    const [beforeChannel] = await AgencyDataSource.query<
      Array<{ default_agent_id: string }>
    >('SELECT default_agent_id FROM inbox_channels WHERE id=$1', [channelId]);
    expect(beforeChannel.default_agent_id).toBe(agentId);

    const result = await service.archive(ctx, agentId);
    expect(result.status).toBe(LeadFlowAgentStatus.Archived);

    const [afterChannel] = await AgencyDataSource.query<
      Array<{ default_agent_id: string | null }>
    >('SELECT default_agent_id FROM inbox_channels WHERE id=$1', [channelId]);
    expect(afterChannel.default_agent_id).toBeNull();

    const [{ count: versionCount }] = await AgencyDataSource.query<
      Array<{ count: string }>
    >(
      'SELECT count(*)::text count FROM leadflow_agent_versions WHERE agent_id=$1',
      [agentId],
    );
    const [{ count: bindingCount }] = await AgencyDataSource.query<
      Array<{ count: string }>
    >(
      'SELECT count(*)::text count FROM leadflow_agent_channel_bindings WHERE agent_id=$1',
      [agentId],
    );
    expect(versionCount).toBe('1');
    expect(bindingCount).toBe('1');
  });

  it('rejects activating an archived agent until it is unarchived', async () => {
    const agentId = await insertAgent();
    await service.archive(ctx, agentId);

    await expect(service.activate(ctx, agentId)).rejects.toThrow(
      BadRequestException,
    );

    const unarchived = await service.unarchive(ctx, agentId);
    expect(unarchived.status).toBe(LeadFlowAgentStatus.Draft);
  });

  it('rejects deletion while a live conversation is assigned, then succeeds once resolved, keeping history intact', async () => {
    const agentId = await insertAgent();

    const conversation = await AgencyDataSource.getRepository(
      InboxConversationEntity,
    ).save({
      tenantId,
      workspaceId,
      assignedAgentId: agentId,
      status: 'open',
    });

    await expect(service.softDelete(ctx, agentId)).rejects.toThrow(
      ConflictException,
    );

    await AgencyDataSource.getRepository(InboxConversationEntity).update(
      { id: conversation.id },
      { status: 'closed' },
    );

    const deleted = await service.softDelete(ctx, agentId);
    expect(deleted.deletedAt).not.toBeNull();

    const [row] = await AgencyDataSource.query<
      Array<{ deleted_at: Date | null; deleted_by_id: string | null }>
    >('SELECT deleted_at, deleted_by_id FROM leadflow_agents WHERE id=$1', [
      agentId,
    ]);
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_by_id).toBe(ctx.userId);

    const list = await service.list(ctx);
    expect(list.items.some((item) => item.id === agentId)).toBe(false);

    const [{ count: versionCount }] = await AgencyDataSource.query<
      Array<{ count: string }>
    >(
      'SELECT count(*)::text count FROM leadflow_agent_versions WHERE agent_id=$1',
      [agentId],
    );
    expect(versionCount).toBe('1');
  });

  it('never allows archiving a protected agent', async () => {
    const agentId = await insertAgent({ isProtected: true });

    await expect(service.archive(ctx, agentId)).rejects.toThrow(
      BadRequestException,
    );

    const [row] = await AgencyDataSource.query<Array<{ status: string }>>(
      'SELECT status FROM leadflow_agents WHERE id=$1',
      [agentId],
    );
    expect(row.status).toBe(LeadFlowAgentStatus.Active);
  });
});
