import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowAgentBindingReconcilerService } from './leadflow-agent-binding-reconciler.service';

const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

run('LeadFlow default binding reconciliation PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const ctx = { tenantId, workspaceId, userId: randomUUID() };
  let service: LeadFlowAgentBindingReconcilerService;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    service = new LeadFlowAgentBindingReconcilerService(AgencyDataSource);
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });
  beforeEach(async () => {
    await AgencyDataSource.query(
      `TRUNCATE inbox_domain_outbox, platform_permission_audit_events,
       leadflow_agent_channel_bindings, leadflow_agent_versions,
       leadflow_agents, inbox_channels RESTART IDENTITY CASCADE`,
    );
  });

  async function insertAgent(targetWorkspace = workspaceId) {
    const agentId = randomUUID();
    const versionId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO leadflow_agents
        (id,tenant_id,workspace_id,business_mode_key,type,name,status,is_system,
         is_custom,is_protected,behavior_config,prompt_config,handoff_policy,
         crm_policy,channel_policy,avatar_config,readiness,metadata)
       VALUES ($1,$2,$3,'general','custom','Agent','active',false,true,false,
               '{}','{}','{}','{}',$4::jsonb,'{}','{}','{}')`,
      [
        agentId,
        tenantId,
        targetWorkspace,
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

  async function insertChannel(
    targetWorkspace = workspaceId,
    status: 'active' | 'inactive' = 'active',
  ) {
    const channelId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_channels
        (id,tenant_id,workspace_id,name,type,status,connection_status,provider,
         ai_enabled,settings,metadata)
       VALUES ($1,$2,$3,'WhatsApp','whatsapp',$4,$5,'meta',false,'{}','{}')`,
      [
        channelId,
        tenantId,
        targetWorkspace,
        status,
        status === 'active' ? 'connected' : 'suspended',
      ],
    );
    return channelId;
  }

  it('reconciles whether the agent or channel was created first without enabling AI', async () => {
    const agentId = await insertAgent();
    const channelId = await insertChannel();
    const [result] = await service.reconcile(ctx, {
      channelId,
      trigger: 'channel_connected',
    });
    expect(result).toMatchObject({
      status: 'active',
      defaultAgentId: agentId,
      aiEnabled: false,
      changed: true,
    });
    const [channel] = await AgencyDataSource.query<
      Array<{ default_agent_id: string; ai_enabled: boolean }>
    >('SELECT default_agent_id,ai_enabled FROM inbox_channels WHERE id=$1', [
      channelId,
    ]);
    expect(channel).toEqual({ default_agent_id: agentId, ai_enabled: false });
  });

  it('keeps a binding pending while the channel is paused', async () => {
    const agentId = await insertAgent();
    const channelId = await insertChannel(workspaceId, 'inactive');
    const [result] = await service.reconcile(ctx, {
      channelId,
      trigger: 'agent_published',
    });
    expect(result).toMatchObject({
      status: 'pending',
      defaultAgentId: agentId,
    });
    const [binding] = await AgencyDataSource.query<Array<{ status: string }>>(
      'SELECT status FROM leadflow_agent_channel_bindings WHERE external_ref=$1',
      [channelId],
    );
    expect(binding.status).toBe('pending');
  });

  it('fails closed with two eligible agents until an explicit default is chosen', async () => {
    const first = await insertAgent();
    await insertAgent();
    const channelId = await insertChannel();
    const [ambiguous] = await service.reconcile(ctx, {
      channelId,
      trigger: 'admin_check',
    });
    expect(ambiguous).toMatchObject({
      status: 'choice_required',
      defaultAgentId: null,
    });
    const [selected] = await service.reconcile(ctx, {
      channelId,
      preferredAgentId: first,
      trigger: 'default_changed',
      requireChoice: true,
    });
    expect(selected).toMatchObject({ status: 'active', defaultAgentId: first });
  });

  it('is idempotent under concurrent reconciliation and remains workspace scoped', async () => {
    const agentId = await insertAgent();
    const channelId = await insertChannel();
    await insertAgent(randomUUID());
    await Promise.all([
      service.reconcile(ctx, { channelId, trigger: 'channel_connected' }),
      service.reconcile(ctx, { channelId, trigger: 'channel_reconnected' }),
    ]);
    const [row] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM leadflow_agent_channel_bindings
        WHERE tenant_id=$1 AND workspace_id=$2 AND external_ref=$3
          AND status='active' AND config->>'isDefault'='true'`,
      [tenantId, workspaceId, channelId],
    );
    expect(row.count).toBe('1');
    const [channel] = await AgencyDataSource.query<
      Array<{ default_agent_id: string }>
    >('SELECT default_agent_id FROM inbox_channels WHERE id=$1', [channelId]);
    expect(channel.default_agent_id).toBe(agentId);
  });

  it('clears the default after the only agent becomes inactive', async () => {
    const agentId = await insertAgent();
    const channelId = await insertChannel();
    await service.reconcile(ctx, { channelId, trigger: 'channel_connected' });
    await AgencyDataSource.query(
      "UPDATE leadflow_agents SET status='paused' WHERE id=$1",
      [agentId],
    );
    const [result] = await service.reconcile(ctx, {
      channelId,
      trigger: 'admin_check',
    });
    expect(result).toMatchObject({ status: 'unbound', defaultAgentId: null });
  });

  it('clears an active default when the user removes the channel', async () => {
    const agentId = await insertAgent();
    const channelId = await insertChannel();
    await service.reconcile(ctx, {
      channelId,
      preferredAgentId: agentId,
      trigger: 'default_changed',
    });

    const [result] = await service.reconcile(ctx, {
      channelId,
      clearDefault: true,
      trigger: 'default_changed',
    });

    expect(result).toMatchObject({
      status: 'unbound',
      defaultAgentId: null,
      changed: true,
    });
  });
});
