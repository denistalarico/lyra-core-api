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
import { InboxProviderBudgetService } from './inbox-provider-budget.service';
import { InboxGovernedActionWorker } from '../services/inbox-governed-action.worker';

const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;
const validDecision = {
  schema_version: 1 as const,
  reply: 'Revisar',
  follow_text: null,
  follow_text_next_day: null,
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
  extracted_facts: [],
  recommended_cta: null,
  proposed_phase: null,
  stage_transition: null,
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
      `TRUNCATE inbox_governed_actions, inbox_channel_contact_identities,
       inbox_meta_operations, inbox_provider_usage_ledger, inbox_domain_outbox, inbox_agent_decisions,
       inbox_processing_batches, inbox_media_derivatives, inbox_media_assets,
       inbox_messages, inbox_conversation_events, inbox_conversations,
       leadflow_agent_channel_bindings, leadflow_agent_versions, leadflow_agents,
       inbox_channels RESTART IDENTITY CASCADE`,
    );
  });

  it('persists the budget across calls and never reserves the same logical charge twice', async () => {
    const budget = new InboxProviderBudgetService(AgencyDataSource, {
      activationSessionId: 'pg-budget-session',
      budgetUsd: 0.15,
      maxDecisionCalls: 20,
      maxTranscriptionCalls: 10,
      maxVisionCalls: 10,
      maxImageInputs: 10,
      decisionReserveUsd: 0.1,
      transcriptionReserveUsd: 0.02,
      visionReserveUsd: 0.05,
      decisionInputUsdPerMillion: null,
      decisionCachedInputUsdPerMillion: null,
      decisionOutputUsdPerMillion: null,
      transcriptionUsdPerMinute: null,
    } as never);
    const first = await budget.reserve({
      tenantId,
      workspaceId,
      operation: 'decision',
      idempotencyKey: 'same-logical-run',
      provider: 'openai-compatible',
      model: 'gpt-5.6-terra',
      imageCount: 1,
    });
    await budget.succeed(first, {
      model: 'gpt-5.6-terra',
      usage: { inputTokens: 100, outputTokens: 50, images: 1 },
      attempts: 1,
      latencyMs: 10,
    });
    await expect(
      budget.reserve({
        tenantId,
        workspaceId,
        operation: 'decision',
        idempotencyKey: 'same-logical-run',
        provider: 'openai-compatible',
        model: 'gpt-5.6-terra',
        imageCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'provider_idempotency_replayed' });
    await budget.reserve({
      tenantId,
      workspaceId,
      operation: 'decision',
      idempotencyKey: 'second-logical-run',
      provider: 'openai-compatible',
      model: 'gpt-5.6-terra',
      imageCount: 0,
    });
    await expect(
      budget.reserve({
        tenantId,
        workspaceId,
        operation: 'decision',
        idempotencyKey: 'over-budget-run',
        provider: 'openai-compatible',
        model: 'gpt-5.6-terra',
        imageCount: 0,
      }),
    ).rejects.toMatchObject({ code: 'provider_budget_exhausted' });
    const [count] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM inbox_provider_usage_ledger WHERE tenant_id=$1 AND workspace_id=$2`,
      [tenantId, workspaceId],
    );
    expect(count.count).toBe('2');
  });

  it('allows only one derivative worker to pay for the same transcription', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const channelId = await channelIdForConversation(conversationId);
    const assetId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_media_assets (id,tenant_id,workspace_id,conversation_id,message_id,channel_id,kind,provider,external_media_id,mime_type,byte_size,checksum,object_key,status) VALUES ($1,$2,$3,$4,$5,$6,'audio','meta',$7,'audio/ogg',4,'checksum','private/key','available')`,
      [
        assetId,
        tenantId,
        workspaceId,
        conversationId,
        randomUUID(),
        channelId,
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

  it('runs a supervised mock text, transcription and image batch end to end', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const channelId = await channelIdForConversation(conversationId);
    const messageId = randomUUID();
    const audioAssetId = randomUUID();
    const imageAssetId = randomUUID();
    const batchId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_messages
        (id,tenant_id,workspace_id,conversation_id,direction,sender_type,
         content,status,occurred_at)
       VALUES ($1,$2,$3,$4,'inbound','contact','Mensagem sintética','received',now())`,
      [messageId, tenantId, workspaceId, conversationId],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_media_assets
        (id,tenant_id,workspace_id,conversation_id,message_id,channel_id,kind,
         provider,external_media_id,mime_type,byte_size,checksum,object_key,status)
       VALUES
        ($1,$3,$4,$5,$6,$7,'audio','meta',$8,'audio/ogg',4,'audio-sum','private/audio','available'),
        ($2,$3,$4,$5,$6,$7,'image','meta',$9,'image/png',3,'image-sum','private/image','available')`,
      [
        audioAssetId,
        imageAssetId,
        tenantId,
        workspaceId,
        conversationId,
        messageId,
        channelId,
        randomUUID(),
        randomUUID(),
      ],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_media_derivatives
        (tenant_id,workspace_id,media_asset_id,kind,status,processor_version,
         content,outcome,asset_checksum)
       VALUES ($1,$2,$3,'transcription','available','test-v1',
               'Transcrição sintética clara','content','audio-sum')`,
      [tenantId, workspaceId, audioAssetId],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches
        (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at)
       VALUES ($1,$2,$3,$4,$5,'pending',now()-interval '1 second')`,
      [batchId, tenantId, workspaceId, conversationId, channelId],
    );
    const decide = jest.fn().mockResolvedValue({
      decision: {
        ...validDecision,
        evidence_refs: [
          `message:${messageId}`,
          `transcription:${audioAssetId}`,
          `image:${imageAssetId}`,
        ],
      },
      provider: 'mock',
      model: 'mock-decision-v1',
      usage: { inputTokens: 0, outputTokens: 0, images: 1 },
      latencyMs: 1,
    });
    const runtime = new InboxAgentRuntimeService(
      AgencyDataSource,
      {
        getPrivateAsset: jest.fn().mockResolvedValue({
          body: Readable.from(Buffer.from('png')),
        }),
      } as never,
      { supportsMultimodal: () => true, decide } as never,
      {
        maxImagesPerRun: 3,
        maxImageBytes: 1024,
        autoReplyEnabled: false,
        autoCrmEnabled: false,
      } as never,
      new AgentDecisionPromptBuilder(),
      new AgentDecisionV1Service(),
      new BusinessModeActionPlanner(AgencyDataSource),
    );
    await runtime.claimAndProcess('mock-e2e-worker');
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          expect.objectContaining({
            assetId: imageAssetId,
            evidenceRef: `image:${imageAssetId}`,
            mimeType: 'image/png',
          }),
        ],
      }),
    );
    const [decision] = await AgencyDataSource.query<
      Array<{ id: string; status: string; provider: string; model: string }>
    >(
      `SELECT id,status,provider,model FROM inbox_agent_decisions WHERE batch_id=$1`,
      [batchId],
    );
    const [outbox] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM inbox_domain_outbox WHERE aggregate_id=$1`,
      [decision.id],
    );
    expect(decision).toMatchObject({
      status: 'proposed',
      provider: 'mock',
      model: 'mock-decision-v1',
    });
    expect(outbox.count).toBe('1');
  });

  it('recovers an abandoned runtime batch and lets two workers create only one decision', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const channelId = await channelIdForConversation(conversationId);
    const batchId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_messages (tenant_id,workspace_id,conversation_id,direction,sender_type,content,status,occurred_at) VALUES ($1,$2,$3,'inbound','contact','Quero saber mais','received',now())`,
      [tenantId, workspaceId, conversationId],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches
        (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at,claimed_at,claimed_by)
       VALUES ($1,$2,$3,$4,$5,'processing',now()-interval '3 minutes',now()-interval '3 minutes','dead-worker')`,
      [batchId, tenantId, workspaceId, conversationId, channelId],
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
    const channelId = await channelIdForConversation(conversationId);
    const batchId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_messages (tenant_id,workspace_id,conversation_id,direction,sender_type,content,status,occurred_at) VALUES ($1,$2,$3,'inbound','contact','fixture','received',now())`,
      [tenantId, workspaceId, conversationId],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at) VALUES ($1,$2,$3,$4,$5,'pending',now()-interval '1 second')`,
      [batchId, tenantId, workspaceId, conversationId, channelId],
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
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    const opportunityId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_pipelines (id,tenant_id,workspace_id,name) VALUES ($1,$2,$3,'Takeover')`,
      [pipelineId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_stages (id,tenant_id,workspace_id,pipeline_id,name) VALUES ($1,$2,$3,$4,'Open')`,
      [stageId, tenantId, workspaceId, pipelineId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_opportunities
        (id,tenant_id,workspace_id,pipeline_id,stage_id,inbox_conversation_id,title)
       VALUES ($1,$2,$3,$4,$5,$6,'Takeover')`,
      [
        opportunityId,
        tenantId,
        workspaceId,
        pipelineId,
        stageId,
        conversationId,
      ],
    );
    await AgencyDataSource.query(
      `UPDATE inbox_conversations SET opportunity_id=$2 WHERE id=$1`,
      [conversationId, opportunityId],
    );
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
    const [ownershipProjection] = await AgencyDataSource.query<
      Array<{ conversation_owner: string; opportunity_owner: string }>
    >(
      `SELECT conversation.assigned_user_id conversation_owner,
              opportunity.assigned_user_id opportunity_owner
         FROM inbox_conversations conversation
         JOIN crm_opportunities opportunity ON opportunity.id=$2
        WHERE conversation.id=$1`,
      [conversationId, opportunityId],
    );
    expect(ownershipProjection.opportunity_owner).toBe(
      ownershipProjection.conversation_owner,
    );
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

  it('applies a partial approval once and replays a retry without duplicating effects', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const batchId = randomUUID();
    const decisionId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at) VALUES ($1,$2,$3,$4,$5,'completed',now())`,
      [batchId, tenantId, workspaceId, conversationId, randomUUID()],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_agent_decisions
        (id,tenant_id,workspace_id,conversation_id,batch_id,ownership_version,
         idempotency_key,correlation_id,status,action_plan)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,'proposed',$8::jsonb)`,
      [
        decisionId,
        tenantId,
        workspaceId,
        conversationId,
        batchId,
        randomUUID(),
        randomUUID(),
        JSON.stringify([
          {
            key: 'handoff',
            type: 'handoff',
            allowed: true,
            reason: null,
            value: 'operator_requested',
          },
        ]),
      ],
    );
    const runtime = new InboxAgentRuntimeService(
      AgencyDataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const ctx = { tenantId, workspaceId, userId: randomUUID() };
    const [first, replay] = await Promise.all([
      runtime.review(ctx, conversationId, decisionId, true, ['handoff']),
      runtime.review(ctx, conversationId, decisionId, true, ['handoff']),
    ]);
    const results = (
      [first, replay] as Array<{
        status: string;
        auditRef?: string | null;
      }>
    ).sort((left, right) => left.status.localeCompare(right.status));
    expect(results.map((item) => item.status)).toEqual(['applied', 'replayed']);
    expect(results[1].auditRef).toBe(results[0].auditRef);
    const [conversation] = await AgencyDataSource.query<
      Array<{ ownership_state: string; ownership_version: number }>
    >(
      `SELECT ownership_state,ownership_version FROM inbox_conversations WHERE id=$1`,
      [conversationId],
    );
    const [events] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM inbox_domain_outbox WHERE aggregate_id=$1`,
      [decisionId],
    );
    expect(conversation).toMatchObject({
      ownership_state: 'handoff_requested',
      ownership_version: 2,
    });
    expect(events.count).toBe('1');
  });

  it('approves analysis without actions exactly once and produces no effect', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const batchId = randomUUID();
    const decisionId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at)
       VALUES ($1,$2,$3,$4,$5,'completed',now())`,
      [batchId, tenantId, workspaceId, conversationId, randomUUID()],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_agent_decisions
        (id,tenant_id,workspace_id,conversation_id,batch_id,ownership_version,
         idempotency_key,correlation_id,status,action_plan)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,'proposed',$8::jsonb)`,
      [
        decisionId,
        tenantId,
        workspaceId,
        conversationId,
        batchId,
        randomUUID(),
        randomUUID(),
        JSON.stringify([
          { key: 'handoff', type: 'handoff', allowed: true, reason: null },
        ]),
      ],
    );
    const runtime = new InboxAgentRuntimeService(
      AgencyDataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const ctx = { tenantId, workspaceId, userId: randomUUID() };
    await runtime.review(ctx, conversationId, decisionId, true, [], 'analysis');
    await runtime.review(ctx, conversationId, decisionId, true, [], 'analysis');
    const [decision] = await AgencyDataSource.query<
      Array<{
        status: string;
        review_outcome: string;
        reviewed_action_keys: string[];
        applied_actions: unknown[];
      }>
    >(
      `SELECT status,review_outcome,reviewed_action_keys,applied_actions
         FROM inbox_agent_decisions WHERE id=$1`,
      [decisionId],
    );
    const [conversation] = await AgencyDataSource.query<
      Array<{ ownership_state: string; ownership_version: number }>
    >(
      `SELECT ownership_state,ownership_version FROM inbox_conversations WHERE id=$1`,
      [conversationId],
    );
    const [audit] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM inbox_conversation_events
        WHERE conversation_id=$1 AND event_type='agent_decision_reviewed'`,
      [conversationId],
    );
    expect(decision).toMatchObject({
      status: 'approved',
      review_outcome: 'analysis_approved',
      reviewed_action_keys: [],
      applied_actions: [],
    });
    expect(conversation).toMatchObject({
      ownership_state: 'ai_active',
      ownership_version: 1,
    });
    expect(audit.count).toBe('1');
    await expect(
      runtime.review(
        ctx,
        conversationId,
        decisionId,
        true,
        ['handoff'],
        'actions',
      ),
    ).rejects.toThrow('Review retry intent changed.');
  });

  it('returns canonical CRM current values and rejects an approval after the preview becomes stale', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    const opportunityId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_pipelines (id,tenant_id,workspace_id,name) VALUES ($1,$2,$3,'Synthetic')`,
      [pipelineId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_stages (id,tenant_id,workspace_id,pipeline_id,name) VALUES ($1,$2,$3,$4,'Synthetic')`,
      [stageId, tenantId, workspaceId, pipelineId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_opportunities
        (id,tenant_id,workspace_id,pipeline_id,stage_id,inbox_conversation_id,title,business_context)
       VALUES ($1,$2,$3,$4,$5,$6,'Synthetic',$7::jsonb)`,
      [
        opportunityId,
        tenantId,
        workspaceId,
        pipelineId,
        stageId,
        conversationId,
        JSON.stringify({ agentSummary: 'before', service: 'service-a' }),
      ],
    );
    await AgencyDataSource.query(
      `UPDATE inbox_conversations SET opportunity_id=$2 WHERE id=$1`,
      [conversationId, opportunityId],
    );
    const batchId = randomUUID();
    const decisionId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_processing_batches (id,tenant_id,workspace_id,conversation_id,channel_id,status,due_at)
       VALUES ($1,$2,$3,$4,$5,'completed',now())`,
      [batchId, tenantId, workspaceId, conversationId, randomUUID()],
    );
    await AgencyDataSource.query(
      `INSERT INTO inbox_agent_decisions
        (id,tenant_id,workspace_id,conversation_id,batch_id,ownership_version,idempotency_key,correlation_id,status,action_plan)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,'proposed',$8::jsonb)`,
      [
        decisionId,
        tenantId,
        workspaceId,
        conversationId,
        batchId,
        randomUUID(),
        randomUUID(),
        JSON.stringify([
          {
            key: 'summary',
            type: 'set_summary',
            value: 'after',
            allowed: true,
            reason: null,
          },
        ]),
      ],
    );
    const runtime = new InboxAgentRuntimeService(
      AgencyDataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const ctx = { tenantId, workspaceId, userId: randomUUID() };
    const preview = await runtime.previewReview(
      ctx,
      conversationId,
      decisionId,
      ['summary'],
    );
    expect(preview.current).toMatchObject({
      opportunityId,
      pipelineId,
      stageId,
      agentSummary: 'before',
      service: 'service-a',
      tags: [],
    });
    expect(preview.proposed[0]).toMatchObject({
      current: 'before',
      proposed: 'after',
      effectType: 'crm',
      expectedVersion: preview.expectedVersion,
    });
    await AgencyDataSource.query(
      `UPDATE crm_opportunities
          SET business_context=jsonb_set(business_context,'{agentSummary}','"changed"'),
              updated_at=clock_timestamp()
        WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`,
      [opportunityId, tenantId, workspaceId],
    );
    await expect(
      runtime.review(
        ctx,
        conversationId,
        decisionId,
        true,
        ['summary'],
        'actions',
        'stale-review-key',
        preview.expectedVersion,
      ),
    ).rejects.toThrow('Decision preview is stale');
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
        { realtimeGatewayEnabled: true } as never,
      );
    await Promise.all([make().processPending(1), make().processPending(1)]);
    expect(notify).toHaveBeenCalledTimes(1);
    const [row] = await AgencyDataSource.query<
      Array<{ status: string; attempts: number }>
    >(`SELECT status,attempts FROM inbox_domain_outbox WHERE id=$1`, [eventId]);
    expect(row.status).toBe('published');
  });

  it('finalizes realtime-only events as skipped while realtime is disabled', async () => {
    const eventId = randomUUID();
    const otherWorkspace = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_domain_outbox
        (id,tenant_id,workspace_id,aggregate_type,aggregate_id,event_name,
         idempotency_key,status,attempts,available_at)
       VALUES ($1,$2,$3,'conversation',$4,'leadflow.inbox.conversation.updated',
               $5,'pending',0,now()),
              ($6,$2,$7,'conversation',$8,'leadflow.inbox.conversation.updated',
               $9,'pending',0,now())`,
      [
        eventId,
        tenantId,
        workspaceId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        otherWorkspace,
        randomUUID(),
        randomUUID(),
      ],
    );
    const notify = jest.fn();
    const relay = new InboxOutboxRelayService(
      AgencyDataSource,
      { notify } as never,
      { realtimeGatewayEnabled: false } as never,
    );
    await relay.processPending(10);
    expect(notify).not.toHaveBeenCalled();
    const [row] = await AgencyDataSource.query<
      Array<{ status: string; skip_reason: string; retain_until: Date }>
    >(
      'SELECT status,skip_reason,retain_until FROM inbox_domain_outbox WHERE id=$1',
      [eventId],
    );
    expect(row.status).toBe('skipped');
    expect(row.skip_reason).toBe('realtime_disabled');
    expect(row.retain_until).toBeTruthy();

    const inspected = await relay.inspect(tenantId, workspaceId);
    expect(inspected.items).toHaveLength(1);
    expect(inspected.items[0]).not.toHaveProperty('payload');
    const actorUserId = randomUUID();
    await expect(
      relay.reprocess(tenantId, workspaceId, eventId, actorUserId),
    ).resolves.toEqual({ reprocessed: true });
    await expect(
      relay.reprocess(tenantId, workspaceId, inspected.items[0].aggregateId),
    ).resolves.toEqual({ reprocessed: false });
    const [audit] = await AgencyDataSource.query<
      Array<{ actor_user_id: string; metadata: Record<string, unknown> }>
    >(
      `SELECT actor_user_id,metadata FROM platform_permission_audit_events
        WHERE tenant_id=$1 AND workspace_id=$2
          AND action='inbox.outbox.reprocessed' AND resource_id=$3`,
      [tenantId, workspaceId, eventId],
    );
    expect(audit).toEqual({
      actor_user_id: actorUserId,
      metadata: { outcome: 'queued' },
    });
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

  it('converges concurrent governed opportunity actions to one active card', async () => {
    const conversationId = await insertConversation(
      tenantId,
      workspaceId,
      'ai_active',
    );
    const channelId = await channelIdForConversation(conversationId);
    const contactId = randomUUID();
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO contacts
        (id,tenant_id,workspace_id,type,display_name,source,business_mode,
         lifecycle_stage,lifecycle_stages,status)
       VALUES ($1,$2,$3,'person','Synthetic Contact','leadflow_whatsapp',
               'general','lead',ARRAY['lead'],'active')`,
      [contactId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `UPDATE inbox_conversations
          SET contact_id=$1, external_thread_id='+5511000000000'
        WHERE id=$2`,
      [contactId, conversationId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_pipelines
        (id,tenant_id,workspace_id,name,business_mode,is_default,status)
       VALUES ($1,$2,$3,'Synthetic Pipeline','general',true,'active')`,
      [pipelineId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_stages
        (id,tenant_id,workspace_id,pipeline_id,name,type,sort_order)
       VALUES ($1,$2,$3,$4,'Synthetic Initial','open',10)`,
      [stageId, tenantId, workspaceId, pipelineId],
    );
    for (const [index, suffix] of ['a', 'b'].entries()) {
      const batchId = randomUUID();
      const decisionId = randomUUID();
      await AgencyDataSource.query(
        `INSERT INTO inbox_processing_batches
          (id,tenant_id,workspace_id,conversation_id,channel_id,generation,status,due_at)
         VALUES ($1,$2,$3,$4,$5,$6,'completed',now())`,
        [batchId, tenantId, workspaceId, conversationId, channelId, index + 1],
      );
      await AgencyDataSource.query(
        `INSERT INTO inbox_agent_decisions
          (id,tenant_id,workspace_id,conversation_id,batch_id,ownership_version,
           idempotency_key,correlation_id,status)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7,'proposed')`,
        [
          decisionId,
          tenantId,
          workspaceId,
          conversationId,
          batchId,
          `decision-${suffix}`,
          randomUUID(),
        ],
      );
      await AgencyDataSource.query(
        `INSERT INTO inbox_governed_actions
          (tenant_id,workspace_id,conversation_id,decision_id,ownership_version,
           policy_version,action_type,action_key,policy_outcome,reason_code,
           idempotency_key,intent_hash,audit_ref,status)
         VALUES ($1,$2,$3,$4,1,'inbox-autonomy-policy-v1','ensure_opportunity',
                 'opportunity','allowed','opportunity_defaults_resolved',$5,$6,$7,'planned')`,
        [
          tenantId,
          workspaceId,
          conversationId,
          decisionId,
          `opportunity-${suffix}`,
          'a'.repeat(64),
          randomUUID(),
        ],
      );
    }
    const makeWorker = () =>
      new InboxGovernedActionWorker(
        AgencyDataSource,
        {
          autoReplyEnabled: false,
          autoCrmEnabled: true,
          autoHandoffEnabled: false,
        } as never,
        { sendAgentText: jest.fn() } as never,
        { sendAgentText: jest.fn() } as never,
        { sendAgentText: jest.fn() } as never,
        { transition: jest.fn() } as never,
      );
    await Promise.all([
      makeWorker().processOnce('worker-a'),
      makeWorker().processOnce('worker-b'),
    ]);
    const [count] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text count FROM crm_opportunities
        WHERE tenant_id=$1 AND workspace_id=$2 AND inbox_conversation_id=$3
          AND deleted_at IS NULL`,
      [tenantId, workspaceId, conversationId],
    );
    expect(count.count).toBe('1');
  });

  it('creates one canonical WhatsApp contact and makes it visible in the LeadFlow list', async () => {
    const isolatedWorkspace = randomUUID();
    const conversationId = await insertConversation(
      tenantId,
      isolatedWorkspace,
      'ai_active',
    );
    await AgencyDataSource.query(
      `UPDATE inbox_conversations
          SET external_thread_id='+5511999999999', title='Synthetic Profile'
        WHERE id=$1`,
      [conversationId],
    );
    await insertGovernedAction({
      tenantId,
      workspaceId: isolatedWorkspace,
      conversationId,
      actionType: 'ensure_contact',
      actionKey: 'contact',
    });
    const worker = makeGovernedCrmWorker();
    await worker.processOnce('contact-worker');
    await worker.processOnce('contact-worker-retry');

    const [result] = await AgencyDataSource.query<
      Array<{ contacts: string; memberships: string; other_workspace: string }>
    >(
      `SELECT
         (SELECT count(*)::text FROM contacts
           WHERE tenant_id=$1 AND workspace_id=$2 AND source='leadflow_whatsapp') contacts,
         (SELECT count(*)::text
            FROM contact_list_members member
            JOIN contact_lists list ON list.id=member.list_id
            JOIN contacts contact ON contact.id=member.contact_id
           WHERE contact.tenant_id=$1 AND contact.workspace_id=$2
             AND list.name='LeadFlow') memberships,
         (SELECT count(*)::text FROM contacts
           WHERE tenant_id=$1 AND workspace_id<>$2 AND display_name='Synthetic Profile') other_workspace`,
      [tenantId, isolatedWorkspace],
    );
    expect(result).toEqual({
      contacts: '1',
      memberships: '1',
      other_workspace: '0',
    });
  });

  it.each([
    ['archived', false],
    ['lost', false],
    ['open', true],
  ])(
    'creates a new open opportunity when the prior one is %s (softDeleted=%s)',
    async (terminalStatus, softDeleted) => {
      const isolatedWorkspace = randomUUID();
      const conversationId = await insertConversation(
        tenantId,
        isolatedWorkspace,
        'ai_active',
      );
      const contactId = randomUUID();
      const pipelineId = randomUUID();
      const stageId = randomUUID();
      const terminalOpportunityId = randomUUID();
      await AgencyDataSource.query(
        `INSERT INTO contacts
          (id,tenant_id,workspace_id,type,display_name,source,business_mode,
           lifecycle_stage,lifecycle_stages,status)
         VALUES ($1,$2,$3,'person','Returning Contact','leadflow_whatsapp',
                 'general','lead',ARRAY['lead'],'active')`,
        [contactId, tenantId, isolatedWorkspace],
      );
      await AgencyDataSource.query(
        `UPDATE inbox_conversations
            SET contact_id=$1, opportunity_id=$2, external_thread_id='+5511888888888'
          WHERE id=$3`,
        [contactId, terminalOpportunityId, conversationId],
      );
      await AgencyDataSource.query(
        `INSERT INTO crm_pipelines
          (id,tenant_id,workspace_id,name,business_mode,is_default,status)
         VALUES ($1,$2,$3,'Reconversion Pipeline','general',true,'active')`,
        [pipelineId, tenantId, isolatedWorkspace],
      );
      await AgencyDataSource.query(
        `INSERT INTO crm_stages
          (id,tenant_id,workspace_id,pipeline_id,name,type,sort_order)
         VALUES ($1,$2,$3,$4,'Initial','open',10)`,
        [stageId, tenantId, isolatedWorkspace, pipelineId],
      );
      await AgencyDataSource.query(
        `INSERT INTO crm_opportunities
          (id,tenant_id,workspace_id,pipeline_id,stage_id,contact_id,
           inbox_conversation_id,title,status,source,deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Prior conversion',$8,'referral',$9)`,
        [
          terminalOpportunityId,
          tenantId,
          isolatedWorkspace,
          pipelineId,
          stageId,
          contactId,
          conversationId,
          terminalStatus,
          softDeleted ? new Date() : null,
        ],
      );
      await insertGovernedAction({
        tenantId,
        workspaceId: isolatedWorkspace,
        conversationId,
        actionType: 'ensure_opportunity',
        actionKey: 'opportunity',
      });
      const worker = makeGovernedCrmWorker();
      await worker.processOnce('reconversion-worker');
      await worker.processOnce('reconversion-worker-retry');

      const rows = await AgencyDataSource.query<
        Array<{
          id: string;
          status: string;
          source: string;
          operational_status: string | null;
          deleted_at: Date | null;
        }>
      >(
        `SELECT id,status,source,operational_status,deleted_at FROM crm_opportunities
          WHERE tenant_id=$1 AND workspace_id=$2 AND inbox_conversation_id=$3
          ORDER BY created_at`,
        [tenantId, isolatedWorkspace, conversationId],
      );
      expect(rows).toHaveLength(2);
      expect(
        rows.find((row) => row.id === terminalOpportunityId),
      ).toMatchObject({
        status: terminalStatus,
        source: 'referral',
      });
      expect(
        rows.filter((row) => row.status === 'open' && row.deleted_at === null),
      ).toHaveLength(1);
      expect(
        rows.find((row) => row.id !== terminalOpportunityId),
      ).toMatchObject({ source: 'whatsapp', operational_status: 'ai_active' });
      if (terminalStatus === 'lost' && !softDeleted) {
        const current = rows.find((row) => row.id !== terminalOpportunityId)!;
        await AgencyDataSource.query(
          `UPDATE crm_opportunities SET status='lost', lost_at=now() WHERE id=$1`,
          [current.id],
        );
        await insertGovernedAction({
          tenantId,
          workspaceId: isolatedWorkspace,
          conversationId,
          actionType: 'ensure_opportunity',
          actionKey: 'opportunity',
        });
        await worker.processOnce('distinct-reconversion-worker');
        const [count] = await AgencyDataSource.query<Array<{ count: string }>>(
          `SELECT count(*)::text count FROM crm_opportunities
            WHERE tenant_id=$1 AND workspace_id=$2 AND inbox_conversation_id=$3`,
          [tenantId, isolatedWorkspace, conversationId],
        );
        expect(count.count).toBe('3');
      }
    },
  );
});

function makeGovernedCrmWorker() {
  return new InboxGovernedActionWorker(
    AgencyDataSource,
    {
      autoReplyEnabled: false,
      autoCrmEnabled: true,
      autoHandoffEnabled: false,
    } as never,
    { sendAgentText: jest.fn() } as never,
    { sendAgentText: jest.fn() } as never,
    { sendAgentText: jest.fn() } as never,
    { transition: jest.fn() } as never,
  );
}

async function insertGovernedAction(input: {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  actionType: 'ensure_contact' | 'ensure_opportunity';
  actionKey: string;
}) {
  const channelId = await channelIdForConversation(input.conversationId);
  const batchId = randomUUID();
  const decisionId = randomUUID();
  await AgencyDataSource.query(
    `INSERT INTO inbox_processing_batches
      (id,tenant_id,workspace_id,conversation_id,channel_id,generation,status,due_at)
     VALUES ($1,$2,$3,$4,$5,
       (SELECT coalesce(max(generation),0)+1 FROM inbox_processing_batches
         WHERE tenant_id=$2 AND workspace_id=$3 AND conversation_id=$4),
       'completed',now())`,
    [
      batchId,
      input.tenantId,
      input.workspaceId,
      input.conversationId,
      channelId,
    ],
  );
  await AgencyDataSource.query(
    `INSERT INTO inbox_agent_decisions
      (id,tenant_id,workspace_id,conversation_id,batch_id,ownership_version,
       idempotency_key,correlation_id,status)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7,'proposed')`,
    [
      decisionId,
      input.tenantId,
      input.workspaceId,
      input.conversationId,
      batchId,
      `decision:${decisionId}`,
      randomUUID(),
    ],
  );
  await AgencyDataSource.query(
    `INSERT INTO inbox_governed_actions
      (tenant_id,workspace_id,conversation_id,decision_id,ownership_version,
       policy_version,action_type,action_key,policy_outcome,reason_code,
       idempotency_key,intent_hash,audit_ref,status)
     VALUES ($1,$2,$3,$4,1,'inbox-autonomy-policy-v1',$5,$6,'allowed','fixture',
             $7,$8,$9,'planned')`,
    [
      input.tenantId,
      input.workspaceId,
      input.conversationId,
      decisionId,
      input.actionType,
      input.actionKey,
      `action:${decisionId}:${input.actionKey}`,
      'b'.repeat(64),
      randomUUID(),
    ],
  );
}

async function insertConversation(
  tenantId: string,
  workspaceId: string,
  ownershipState: string,
): Promise<string> {
  const id = randomUUID();
  const channelId = randomUUID();
  const agentId = randomUUID();
  const versionId = randomUUID();
  await AgencyDataSource.query(
    `INSERT INTO leadflow_agents
      (id,tenant_id,workspace_id,business_mode_key,type,name,status,is_system,
       is_custom,is_protected,behavior_config,prompt_config,handoff_policy,
       crm_policy,channel_policy,avatar_config,readiness,metadata)
     VALUES ($1,$2,$3,'general','custom','Fixture Agent','active',false,true,
             false,'{}','{}','{}','{}','{}','{}','{}','{}')`,
    [agentId, tenantId, workspaceId],
  );
  await AgencyDataSource.query(
    `INSERT INTO leadflow_agent_versions
      (id,tenant_id,agent_id,version,status,snapshot)
     VALUES ($1,$2,$3,1,'published',$4::jsonb)`,
    [
      versionId,
      tenantId,
      agentId,
      JSON.stringify({
        agentIdentity: { name: 'Fixture Agent' },
        promptPolicy: {},
      }),
    ],
  );
  await AgencyDataSource.query(
    `UPDATE leadflow_agents SET published_version_id=$1 WHERE id=$2`,
    [versionId, agentId],
  );
  await AgencyDataSource.query(
    `INSERT INTO inbox_channels
      (id,tenant_id,workspace_id,name,type,status,connection_status,provider,
       default_agent_id,ai_enabled,settings,metadata)
     VALUES ($1,$2,$3,'Fixture Channel','whatsapp','active','connected','meta',
             $4,true,'{}','{}')`,
    [channelId, tenantId, workspaceId, agentId],
  );
  await AgencyDataSource.query(
    `INSERT INTO leadflow_agent_channel_bindings
      (tenant_id,workspace_id,agent_id,channel_key,provider,external_ref,status,config)
     VALUES ($1,$2,$3,'whatsapp','meta',$4,'active','{}')`,
    [tenantId, workspaceId, agentId, channelId],
  );
  await AgencyDataSource.query(
    `INSERT INTO inbox_conversations
      (id,tenant_id,workspace_id,channel_id,status,source,business_mode,ai_enabled,
       ownership_state,ownership_version,ownership_reason,qualification_status)
     VALUES ($1,$2,$3,$4,'open','whatsapp','general',$5,$6,1,'fixture','qualified')`,
    [
      id,
      tenantId,
      workspaceId,
      channelId,
      ownershipState === 'ai_active',
      ownershipState,
    ],
  );
  return id;
}

async function channelIdForConversation(conversationId: string) {
  const [row] = await AgencyDataSource.query<Array<{ channel_id: string }>>(
    `SELECT channel_id FROM inbox_conversations WHERE id=$1`,
    [conversationId],
  );
  return row.channel_id;
}
