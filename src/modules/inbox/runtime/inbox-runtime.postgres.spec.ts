import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import {
  AgentDecisionPromptBuilder,
  AgentDecisionV1Service,
  BusinessModeActionPlanner,
} from './agent-decision-v1.service';
import { AudioTranscriptionWorker } from './audio-transcription.worker';
import { ConversationOwnershipService } from '../services/conversation-ownership.service';
import { InboxAgentRuntimeService } from '../services/inbox-agent-runtime.service';
import { InboxOutboxRelayService } from '../services/inbox-outbox-relay.service';

const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;
const validDecision = {
  schema_version: 1 as const,
  reply: 'Revisar',
  follow_text: null,
  stage_key: null,
  stage_name: null,
  tags: [],
  handoff: false,
  handoff_reason: null,
  agent_summary: 'Resumo',
  service: null,
  urgency: 'normal' as const,
  close_reason: null,
  confidence: 0.9,
  evidence_refs: [],
  proposed_actions: [],
};

run('Inbox Runtime PostgreSQL concurrency', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();

  beforeAll(async () => {
    await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });
  beforeEach(async () => {
    await AgencyDataSource.query(
      `TRUNCATE inbox_domain_outbox, inbox_agent_decisions, inbox_processing_batches, inbox_media_derivatives, inbox_media_assets, inbox_messages, inbox_conversation_events, inbox_conversations RESTART IDENTITY CASCADE`,
    );
  });

  it('allows only one derivative worker to pay for the same transcription', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const assetId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_media_assets (id,tenant_id,workspace_id,conversation_id,message_id,channel_id,kind,provider,external_media_id,mime_type,byte_size,checksum,object_key,status) VALUES ($1,$2,$3,$4,$5,$6,'audio','meta',$7,'audio/ogg',4,'checksum','private/key','available')`,
      [
        assetId,
        tenantId,
        workspaceId,
        conversationId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_media_derivatives (tenant_id,workspace_id,media_asset_id,kind,status,processor_version) VALUES ($1,$2,$3,'transcription','pending','test-v1')`,
      [tenantId, workspaceId, assetId],
    );
    const transcribe = jest.fn().mockResolvedValue({
      outcome: 'content',
      text: 'Olá',
      language: 'pt',
      confidence: 0.9,
      provider: 'fake',
      model: 'fake',
      processorVersion: 'test-v1',
      usage: {},
      startedAt: new Date(),
      completedAt: new Date(),
      latencyMs: 1,
    });
    const files = {
      getPrivateAsset: jest.fn().mockResolvedValue({
        body: Readable.from(Buffer.from('OggS')),
        contentType: 'audio/ogg',
      }),
    };
    const provider = { transcribe };
    const config = {
      workersEnabled: true,
      transcriptionMode: 'mock',
      maxAudioBytes: 1024,
    };
    const first = new AudioTranscriptionWorker(
      AgencyDataSource,
      files as never,
      provider as never,
      config as never,
    );
    const second = new AudioTranscriptionWorker(
      AgencyDataSource,
      files as never,
      provider as never,
      config as never,
    );
    await Promise.all([first.processPending(1), second.processPending(1)]);
    expect(transcribe).toHaveBeenCalledTimes(1);
    const [row] = await AgencyDataSource.query<
      Array<{ status: string; content: string }>
    >(
      `SELECT status,content FROM inbox_media_derivatives WHERE media_asset_id=$1`,
      [assetId],
    );
    expect(row).toMatchObject({ status: 'available', content: 'Olá' });
  });

  it('allows two runtime workers to create only one decision for a batch', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const batchId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_messages (tenant_id,workspace_id,conversation_id,direction,sender_type,content,status,occurred_at) VALUES ($1,$2,$3,'inbound','contact','Quero saber mais','received',now())`,
      [tenantId, workspaceId, conversationId],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at) VALUES ($1,$2,$3,$4,$5,'pending',now()-interval '1 second')`,
      [batchId, tenantId, workspaceId, conversationId, randomUUID()],
    );
    const provider = {
      supportsMultimodal: () => true,
      decide: jest.fn().mockResolvedValue({
        decision: validDecision,
        provider: 'fake',
        model: 'fake',
        usage: {},
        latencyMs: 1,
      }),
    };
    const config = {
      maxImagesPerRun: 3,
      autoReplyEnabled: false,
      autoCrmEnabled: false,
    };
    const make = () =>
      new InboxAgentRuntimeService(
        AgencyDataSource,
        {} as never,
        provider as never,
        config as never,
        new AgentDecisionPromptBuilder(),
        new AgentDecisionV1Service(),
        new BusinessModeActionPlanner(AgencyDataSource),
      );
    await Promise.all([
      make().claimAndProcess('worker-a'),
      make().claimAndProcess('worker-b'),
    ]);
    const [count] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM inbox_agent_decisions WHERE batch_id=$1`,
      [batchId],
    );
    expect(count.count).toBe('1');
    expect(provider.decide).toHaveBeenCalledTimes(1);
  });

  it('repairs invalid structured output at most once and executes no action', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const batchId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_messages (tenant_id,workspace_id,conversation_id,direction,sender_type,content,status,occurred_at) VALUES ($1,$2,$3,'inbound','contact','fixture','received',now())`,
      [tenantId, workspaceId, conversationId],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at) VALUES ($1,$2,$3,$4,$5,'pending',now()-interval '1 second')`,
      [batchId, tenantId, workspaceId, conversationId, randomUUID()],
    );
    const provider = {
      supportsMultimodal: () => true,
      decide: jest.fn().mockResolvedValue({
        decision: { reply: 'invalid' },
        provider: 'fake',
        model: 'fake',
        usage: {},
        latencyMs: 1,
      }),
    };
    const runtime = new InboxAgentRuntimeService(
      AgencyDataSource,
      {} as never,
      provider as never,
      {
        maxImagesPerRun: 3,
        autoReplyEnabled: false,
        autoCrmEnabled: false,
      } as never,
      new AgentDecisionPromptBuilder(),
      new AgentDecisionV1Service(),
      new BusinessModeActionPlanner(AgencyDataSource),
    );
    await runtime.claimAndProcess('repair-worker');
    expect(provider.decide).toHaveBeenCalledTimes(2);
    const [decisionCount] = await AgencyDataSource.query<
      Array<{ count: string }>
    >(
      `SELECT count(*)::text count FROM inbox_agent_decisions WHERE batch_id=$1`,
      [batchId],
    );
    const [batch] = await AgencyDataSource.query<
      Array<{ status: string; error_code: string }>
    >(`SELECT status,error_code FROM inbox_processing_batches WHERE id=$1`, [
      batchId,
    ]);
    expect(decisionCount.count).toBe('0');
    expect(batch).toMatchObject({
      status: 'failed',
      error_code: 'decision_schema_invalid',
    });
  });

  it('serializes simultaneous takeover and invalidates an older decision', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const batchId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at) VALUES ($1,$2,$3,$4,$5,'completed',now())`,
      [batchId, tenantId, workspaceId, conversationId, randomUUID()],
    );
    const decisionId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_agent_decisions (id,tenant_id,workspace_id,conversation_id,batch_id,ownership_version,idempotency_key,correlation_id,status) VALUES ($1,$2,$3,$4,$5,1,$6,$7,'proposed')`,
      [
        decisionId,
        tenantId,
        workspaceId,
        conversationId,
        batchId,
        randomUUID(),
        randomUUID(),
      ],
    );
    const ownership = new ConversationOwnershipService(AgencyDataSource);
    const attempts = await Promise.allSettled([
      ownership.transition(
        { tenantId, workspaceId, userId: randomUUID() },
        conversationId,
        'assume',
      ),
      ownership.transition(
        { tenantId, workspaceId, userId: randomUUID() },
        conversationId,
        'assume',
      ),
    ]);
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );
    const [decision] = await AgencyDataSource.query<Array<{ status: string }>>(
      `SELECT status FROM inbox_agent_decisions WHERE conversation_id=$1`,
      [conversationId],
    );
    expect(decision.status).toBe('invalidated');
    const runtime = new InboxAgentRuntimeService(
      AgencyDataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      runtime.review(
        { tenantId, workspaceId, userId: randomUUID() },
        conversationId,
        decisionId,
        true,
        [],
      ),
    ).rejects.toThrow('Decision is no longer pending review.');
  });

  it('recovers an abandoned outbox lock and two relays publish one logical event', async () => {
    const eventId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_domain_outbox (id,tenant_id,workspace_id,aggregate_type,aggregate_id,event_name,idempotency_key,status,attempts,available_at,locked_at,locked_by) VALUES ($1,$2,$3,'conversation',$4,'leadflow.inbox.conversation.updated',$5,'processing',1,now(),now()-interval '2 minutes','dead-worker')`,
      [eventId, tenantId, workspaceId, randomUUID(), randomUUID()],
    );
    const notify = jest.fn().mockResolvedValue(undefined);
    const make = () =>
      new InboxOutboxRelayService(
        AgencyDataSource,
        { notify } as never,
        { realtimeEnabled: true } as never,
      );
    await Promise.all([make().processPending(1), make().processPending(1)]);
    expect(notify).toHaveBeenCalledTimes(1);
    const [row] = await AgencyDataSource.query<
      Array<{ status: string; attempts: number }>
    >(`SELECT status,attempts FROM inbox_domain_outbox WHERE id=$1`, [eventId]);
    expect(row.status).toBe('published');
  });

  it('rolls back state and outbox atomically and scopes decision queries by workspace', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    await expect(
      AgencyDataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE inbox_conversations SET ownership_reason='should_rollback' WHERE id=$1`,
          [conversationId],
        );
        await manager.query(
          `INSERT INTO inbox_domain_outbox (tenant_id,workspace_id,aggregate_type,aggregate_id,event_name,idempotency_key) VALUES ($1,$2,'conversation',$3,'test',$4)`,
          [tenantId, workspaceId, conversationId, randomUUID()],
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const [conversation] = await AgencyDataSource.query<
      Array<{ ownership_reason: string }>
    >(`SELECT ownership_reason FROM inbox_conversations WHERE id=$1`, [
      conversationId,
    ]);
    const [outbox] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM inbox_domain_outbox`,
    );
    expect(conversation.ownership_reason).toBe('fixture');
    expect(outbox.count).toBe('0');

    const otherWorkspace = randomUUID();
    const batchA = randomUUID();
    const batchB = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at) VALUES ($1,$2,$3,$4,$5,'completed',now()),($6,$2,$7,$4,$8,'completed',now())`,
      [
        batchA,
        tenantId,
        workspaceId,
        conversationId,
        randomUUID(),
        batchB,
        otherWorkspace,
        randomUUID(),
      ],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_agent_decisions (tenant_id,workspace_id,conversation_id,batch_id,ownership_version,idempotency_key,correlation_id,status) VALUES ($1,$2,$3,$4,1,$5,$6,'proposed'),($1,$7,$3,$8,1,$9,$10,'proposed')`,
      [
        tenantId,
        workspaceId,
        conversationId,
        batchA,
        randomUUID(),
        randomUUID(),
        otherWorkspace,
        batchB,
        randomUUID(),
        randomUUID(),
      ],
    );
    const service = new InboxAgentRuntimeService(
      AgencyDataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const rows = await service.list(
      { tenantId, workspaceId, userId: randomUUID() },
      conversationId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].workspaceId).toBe(workspaceId);
  });
});

async function insertConversation(
  tenantId: string,
  workspaceId: string,
  ownershipState: string,
): Promise<string> {
  const id = randomUUID();
  await AgencyDataSource.query(
    `INSERT INTO inbox_conversations (id,tenant_id,workspace_id,status,source,business_mode,ai_enabled,ownership_state,ownership_version,ownership_reason,qualification_status) VALUES ($1,$2,$3,'open','whatsapp','general',$4,$5,1,'fixture','qualified')`,
    [id, tenantId, workspaceId, ownershipState === 'ai_active', ownershipState],
  );
  return id;
}
