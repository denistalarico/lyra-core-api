import { LeadFlowEventValidationService } from './leadflow-event-validation.service';

function buildValidEnvelope(): Record<string, unknown> {
  return {
    eventId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
    eventName: 'leadflow.inbox.conversation.message.received',
    eventVersion: 1,
    occurredAt: '2026-07-09T12:00:00.000Z',
    tenantId: 'b1e0c8f0-1111-4222-8333-444455556666',
    workspaceId: 'c2f1d9a1-2222-4333-9444-555566667777',
    productKey: 'leadflow',
    moduleKey: 'leadflow.inbox',
    source: {
      module: 'inbox',
      entityType: 'conversation',
      entityId: 'd3a2e0b2-3333-4444-a555-666677778888',
    },
    actor: {
      type: 'contact',
      id: 'e4b3f1c3-4444-4555-b666-777788889999',
    },
    correlation: {
      correlationId: 'f5c4a2d4-5555-4666-8777-88889999aaaa',
    },
    context: {
      conversationId: 'd3a2e0b2-3333-4444-a555-666677778888',
      contactId: 'e4b3f1c3-4444-4555-b666-777788889999',
    },
    payload: {
      messageId: 'a6d5b3e5-6666-4777-9888-9999aaaabbbb',
      messageType: 'text',
    },
    metadata: {
      schemaVersion: 1,
      sensitive: true,
    },
  };
}

describe('LeadFlowEventValidationService', () => {
  let service: LeadFlowEventValidationService;

  beforeEach(() => {
    service = new LeadFlowEventValidationService();
  });

  it('accepts a valid envelope', () => {
    const result = service.validate(buildValidEnvelope());

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.eventName).toBe(
      'leadflow.inbox.conversation.message.received',
    );
    expect(result.catalogStatus).toBe('active');
  });

  it('accepts an envelope without the optional actor', () => {
    const envelope = buildValidEnvelope();
    delete envelope.actor;

    expect(service.validate(envelope).valid).toBe(true);
  });

  it('rejects an unknown event name', () => {
    const envelope = buildValidEnvelope();
    envelope.eventName = 'leadflow.inbox.conversation.exploded';

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.catalogStatus).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'unknown_event', field: 'eventName' }),
    );
  });

  it('rejects a productKey other than leadflow', () => {
    const envelope = buildValidEnvelope();
    envelope.productKey = 'agency';

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'invalid_product_key',
        field: 'productKey',
      }),
    );
  });

  it('rejects a moduleKey incompatible with the event', () => {
    const envelope = buildValidEnvelope();
    envelope.moduleKey = 'leadflow.crm';

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'incompatible_module_key',
        field: 'moduleKey',
      }),
    );
  });

  it('rejects an unsupported event version', () => {
    const envelope = buildValidEnvelope();
    envelope.eventVersion = 2;

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_version',
        field: 'eventVersion',
      }),
    );
  });

  it('requires tenantId and workspaceId', () => {
    const envelope = buildValidEnvelope();
    delete envelope.tenantId;
    envelope.workspaceId = '   ';

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'missing_field', field: 'tenantId' }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'invalid_field', field: 'workspaceId' }),
    );
  });

  it('requires the context ids declared by the catalog item', () => {
    const envelope = buildValidEnvelope();
    envelope.context = {
      conversationId: (buildValidEnvelope().context as Record<string, string>)
        .conversationId,
    };

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'missing_required_context',
        field: 'context.contactId',
      }),
    );
  });

  it('requires payload fields declared by the catalog item', () => {
    const envelope = buildValidEnvelope();
    envelope.payload = { messageId: 'a6d5b3e5-6666-4777-9888-9999aaaabbbb' };

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'missing_payload_field',
        field: 'payload.messageType',
      }),
    );
  });

  it('rejects payload fields not declared by the event contract', () => {
    const envelope = buildValidEnvelope();
    envelope.payload = {
      messageId: 'a6d5b3e5-6666-4777-9888-9999aaaabbbb',
      messageType: 'text',
      fullText: 'conteudo completo indevido',
    };

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'unexpected_payload_field',
        field: 'payload.fullText',
      }),
    );
  });

  it('validates payload field types declared by the event contract', () => {
    const envelope = buildValidEnvelope();
    envelope.payload = {
      messageId: 'a6d5b3e5-6666-4777-9888-9999aaaabbbb',
      messageType: 'text',
      hasMedia: 'yes',
    };

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'invalid_field',
        field: 'payload.hasMedia',
      }),
    );
  });

  it('rejects raw prompt, token, secret and raw webhook payload keys', () => {
    const envelope = buildValidEnvelope();
    envelope.payload = {
      messageId: 'a6d5b3e5-6666-4777-9888-9999aaaabbbb',
      messageType: 'text',
      accessToken: 'must-not-enter-contract-validation',
    };
    envelope.metadata = {
      schemaVersion: 1,
      rawPrompt: 'must-not-enter-contract-validation',
    };

    const result = service.validate(envelope);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'forbidden_sensitive_field',
        field: 'payload.accessToken',
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'forbidden_sensitive_field',
        field: 'metadata.rawPrompt',
      }),
    );
  });

  it('collects structured errors for a broken envelope instead of throwing', () => {
    const result = service.validate({
      eventName: 'leadflow.inbox.conversation.created',
      eventVersion: 'one',
      occurredAt: 'not-a-date',
      productKey: 'leadflow',
      moduleKey: 'leadflow.inbox',
      source: { module: 'inbox' },
      correlation: {},
      payload: [],
      metadata: { schemaVersion: 'x' },
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((error) => error.code);
    expect(codes).toContain('missing_field'); // eventId, tenantId, workspaceId
    expect(codes).toContain('invalid_field');
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'occurredAt' }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'source.entityId' }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'correlation.correlationId' }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'payload' }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'metadata.schemaVersion' }),
    );
  });

  it('validates planned events and reports their catalog status', () => {
    const envelope = buildValidEnvelope();
    envelope.eventName = 'leadflow.automations.execution.started';
    envelope.moduleKey = 'leadflow.automations';
    envelope.source = {
      module: 'automations',
      entityType: 'execution',
      entityId: 'd3a2e0b2-3333-4444-a555-666677778888',
    };
    envelope.context = {
      automationId: 'd3a2e0b2-3333-4444-a555-666677778888',
    };
    envelope.payload = { executionId: 'exec-1' };

    const result = service.validate(envelope);

    expect(result.valid).toBe(true);
    expect(result.catalogStatus).toBe('planned');
  });
});
