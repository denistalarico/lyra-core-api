import { ConflictException } from '@nestjs/common';
import {
  InboxAgentRuntimeService,
  factualReplyIsSupported,
  isAppointmentHandoffMode,
  orderContextMessages,
  projectConversationEvidence,
} from './inbox-agent-runtime.service';
import { resolveDefaultPipelineForBusinessMode } from '../runtime/inbox-crm-target-resolver';
import { ConversationOwnershipService } from './conversation-ownership.service';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../../leadflow-agents/enums/room-operational.enums';

describe('InboxAgentRuntimeService safety contracts', () => {
  const serviceWith = (dataSource: unknown, operationsRoomState?: unknown) =>
    new InboxAgentRuntimeService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assert(value: unknown) {
          const item = value as Record<string, unknown>;
          if (!item || item.schema_version !== 1)
            throw new Error('decision_schema_invalid');
        },
      } as never,
      {} as never,
      operationsRoomState as never,
    );

  it('claims due batches with transactional SKIP LOCKED', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const dataSource = {
      transaction: jest.fn(
        (callback: (manager: { query: typeof query }) => unknown) =>
          Promise.resolve(callback({ query })),
      ),
    };
    const service = serviceWith(dataSource);
    await expect(service.claimAndProcess('worker-a')).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
    );
  });

  it('rejects malformed LLM output without applying effects', () => {
    const service = serviceWith({});
    expect(() =>
      service.assertValidProposal({ reply: 'missing fields' }),
    ).toThrow('decision_schema_invalid');
    expect(() =>
      service.assertValidProposal({
        schema_version: 1,
        reply: null,
        follow_text: null,
        stage_name: null,
        tags: [],
        handoff: false,
        handoff_reason: null,
        agent_summary: 'safe',
        service: null,
        urgency: 'normal',
        close_reason: null,
      }),
    ).not.toThrow();
  });

  it('treats failed derivatives as partial while preserving an available original', () => {
    const service = serviceWith({});
    const original = { id: 'media', kind: 'audio', status: 'available' };
    const result = (
      service as unknown as {
        mediaPolicy: (media: unknown[], derivatives: unknown[]) => string;
      }
    ).mediaPolicy([original], [{ mediaAssetId: 'media', status: 'failed' }]);
    expect(result).toBe('partial');
    expect(original.status).toBe('available');
  });

  it('orders equal and out-of-order timestamps deterministically', () => {
    const at = new Date('2026-07-17T12:00:00.000Z');
    const messages = [
      {
        id: 'c',
        occurredAt: new Date(at.getTime() + 1000),
        providerSequence: null,
      },
      { id: 'b', occurredAt: at, providerSequence: '2' },
      { id: 'a', occurredAt: at, providerSequence: '1' },
    ] as never;
    expect(orderContextMessages(messages).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('associates an available transcription with its audio message', () => {
    const occurredAt = new Date('2026-07-21T12:00:00.000Z');
    const projected = projectConversationEvidence(
      [
        {
          id: 'message-1',
          direction: 'inbound',
          senderType: 'contact',
          messageType: 'media',
          content: '[audio]',
          occurredAt,
          providerSequence: '1',
        },
      ] as never,
      [
        {
          id: 'asset-1',
          messageId: 'message-1',
          kind: 'audio',
          status: 'available',
        },
      ] as never,
      [
        {
          mediaAssetId: 'asset-1',
          kind: 'transcription',
          status: 'available',
          outcome: 'content',
          content: 'Quero marcar uma conversa.',
          language: 'pt',
        },
      ] as never,
    );

    expect(projected.transcriptions[0]).toMatchObject({
      messageId: 'message-1',
      messageEvidenceRef: 'message:message-1',
      text: 'Quero marcar uma conversa.',
    });
    expect(projected.messages[0].media[0].transcription).toMatchObject({
      evidenceRef: 'transcription:asset-1',
      outcome: 'content',
    });
  });

  it('detects appointment handoff modes from apps or conversion goals', () => {
    expect(
      isAppointmentHandoffMode({
        recommendedApps: [{ key: 'appointments', recommended: true }],
        conversionGoals: {},
      } as never),
    ).toBe(true);
    expect(
      isAppointmentHandoffMode({
        recommendedApps: [],
        conversionGoals: { primary: 'Agendar diagnóstico' },
      } as never),
    ).toBe(true);
  });

  it('accepts scheduling language without inventing a concrete availability', () => {
    expect(
      factualReplyIsSupported(
        'Posso encaminhar seu pedido de agendamento. Qual período funciona melhor?',
        '{}',
      ),
    ).toBe(true);
    expect(
      factualReplyIsSupported(
        'Temos horário disponível às 14h. Posso confirmar?',
        '{}',
      ),
    ).toBe(false);
  });

  it('uses one general default CRM pipeline only as a canonical fallback', () => {
    const general = { id: 'general', businessMode: 'general' };
    const exact = { id: 'exact', businessMode: 'agency_services' };
    expect(
      resolveDefaultPipelineForBusinessMode([general], 'agency_services'),
    ).toBe(general);
    expect(
      resolveDefaultPipelineForBusinessMode([general, exact], 'agency_services'),
    ).toBe(exact);
    expect(
      resolveDefaultPipelineForBusinessMode(
        [general, { ...general, id: 'other-general' }],
        'agency_services',
      ),
    ).toBeNull();
  });

  it('publishes runtime transitions with retry-safe batch identity', async () => {
    const recordTransition = jest.fn().mockResolvedValue({ kind: 'applied' });
    const service = serviceWith({}, { recordTransition });

    await (
      service as unknown as {
        publishOperationalStatus(
          batch: Record<string, unknown>,
          agentId: string,
          status: RoomAgentOperationalStatus,
          phase: string,
        ): Promise<void>;
      }
    ).publishOperationalStatus(
      {
        id: 'batch-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        attemptCount: 2,
      },
      'agent-1',
      RoomAgentOperationalStatus.HandlingConversation,
      'processing_started',
    );

    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        nextStatus: RoomAgentOperationalStatus.HandlingConversation,
        source: RoomOperationalSource.AgentRuntime,
        sourceEventId: 'inbox-batch:batch-1:attempt:2:processing_started',
        reasonCode: 'inbox_processing_started',
      }),
    );
  });
});

describe('ConversationOwnershipService send gate', () => {
  it('blocks an AI response created before human takeover', async () => {
    const findOneBy = jest.fn().mockResolvedValue({
      ownershipState: 'human_active',
      aiEnabled: false,
      ownershipVersion: 2,
    });
    const service = new ConversationOwnershipService({
      getRepository: () => ({ findOneBy }),
    } as never);
    await expect(
      service.assertAiCanSend({
        tenantId: 't',
        workspaceId: 'w',
        conversationId: 'c',
        ownershipVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({ ownershipVersion: 1 }),
    );
  });
});
