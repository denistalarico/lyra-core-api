import { InboxProviderService } from './inbox-provider.service';

const config = {
  transcriptionMode: 'mock',
  decisionMode: 'mock',
  multimodalEnabled: true,
  transcriptionProcessorVersion: 'test-v1',
  maxImagesPerRun: 3,
};
const budget = {
  reserve: jest.fn().mockResolvedValue({
    id: 'reservation',
    operation: 'transcription',
    reservedCostUsd: 0.02,
  }),
  succeed: jest.fn().mockResolvedValue(0.001),
  fail: jest.fn().mockResolvedValue(undefined),
};

describe('InboxProviderService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  it('transcribes valid synthetic audio without touching the original asset', async () => {
    const provider = new InboxProviderService(config as never, budget as never);
    const result = await provider.transcribe({
      tenantId: 't',
      workspaceId: 'w',
      assetId: 'a',
      mimeType: 'audio/ogg',
      byteSize: 4,
      checksum: 'sum',
      bytes: Buffer.from('OggS'),
      correlationId: 'c',
      idempotencyKey: 'i',
    });
    expect(result).toMatchObject({
      outcome: 'content',
      provider: 'mock',
      processorVersion: 'test-v1',
    });
  });

  it('represents inaudible audio as an empty result instead of invented text', async () => {
    const provider = new InboxProviderService(config as never, budget as never);
    const result = await provider.transcribe({
      tenantId: 't',
      workspaceId: 'w',
      assetId: 'a',
      mimeType: 'audio/ogg',
      byteSize: 9,
      checksum: 'sum',
      bytes: Buffer.from('INAUDIBLE'),
      correlationId: 'c',
      idempotencyKey: 'i',
    });
    expect(result).toMatchObject({ outcome: 'empty', text: '' });
  });

  it('uses images in the same multimodal decision run in mock mode', async () => {
    const provider = new InboxProviderService(config as never, budget as never);
    const result = await provider.decide({
      tenantId: 't',
      workspaceId: 'w',
      correlationId: 'c',
      idempotencyKey: 'i',
      agent: { id: null, versionId: null, snapshot: {} },
      businessMode: 'general',
      workspaceConfig: {},
      contact: { id: null },
      opportunity: null,
      ownership: { state: 'ai_active', version: 1 },
      allowedActions: [],
      systemPolicy: 'policy',
      untrustedData: 'data',
      promptVersion: 'v1',
      promptHash: 'hash',
      images: [
        {
          assetId: 'image',
          evidenceRef: 'image:image',
          mimeType: 'image/png',
          bytes: Buffer.from('png'),
        },
      ],
      repairAttempt: false,
    });
    expect(result.usage.images).toBe(1);
    expect(result.decision).toMatchObject({ schema_version: 1 });
  });

  it('runs the separate vision processor only when fallback is explicit', async () => {
    const disabled = new InboxProviderService(
      {
        ...config,
        multimodalEnabled: false,
        visionFallbackEnabled: false,
      } as never,
      budget as never,
    );
    expect(disabled.supportsMultimodal()).toBe(false);
    await expect(
      disabled.analyzeImage({
        tenantId: 't',
        workspaceId: 'w',
        assetId: 'a',
        mimeType: 'image/png',
        checksum: 'sum',
        bytes: Buffer.from('png'),
        idempotencyKey: 'i',
      }),
    ).rejects.toMatchObject({ code: 'vision_fallback_disabled' });
    const enabled = new InboxProviderService(
      {
        ...config,
        multimodalEnabled: false,
        visionFallbackEnabled: true,
        visionProcessorVersion: 'vision-test-v1',
      } as never,
      budget as never,
    );
    await expect(
      enabled.analyzeImage({
        tenantId: 't',
        workspaceId: 'w',
        assetId: 'a',
        mimeType: 'image/png',
        checksum: 'sum',
        bytes: Buffer.from('png'),
        idempotencyKey: 'i',
      }),
    ).resolves.toMatchObject({
      provider: 'mock',
      processorVersion: 'vision-test-v1',
    });
  });

  it('bounds retryable live-provider failures to the configured attempt count', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 503 }));
    const provider = new InboxProviderService(
      {
        ...config,
        transcriptionMode: 'live',
        transcriptionModel: 'transcription-test',
        endpoint: 'https://provider.invalid/v1',
        apiKey: 'test-only',
        maxAttempts: 2,
        timeoutMs: 1_000,
      } as never,
      budget as never,
    );
    await expect(
      provider.transcribe({
        tenantId: 't',
        workspaceId: 'w',
        assetId: 'a',
        mimeType: 'audio/ogg',
        byteSize: 4,
        checksum: 'sum',
        bytes: Buffer.from('OggS'),
        correlationId: 'c',
        idempotencyKey: 'i',
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('categorizes rate limiting as retryable without exceeding the attempt cap', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 429 }));
    const provider = liveTranscriptionProvider({ maxAttempts: 1 });
    await expect(
      provider.transcribe(transcriptionInput()),
    ).rejects.toMatchObject({
      code: 'provider_rate_limited',
      retryable: true,
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the JSON response format supported by GPT-4o transcription models', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        text: 'Mensagem sintética para o teste supervisionado.',
        language: 'pt',
        duration: 2.5,
      }),
    );
    const provider = liveTranscriptionProvider();

    await expect(
      provider.transcribe({
        ...transcriptionInput(),
        mimeType: 'audio/wav',
        bytes: Buffer.from('RIFF'),
      }),
    ).resolves.toMatchObject({
      outcome: 'content',
      text: 'Mensagem sintética para o teste supervisionado.',
      model: 'gpt-4o-mini-transcribe',
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('response_format')).toBe('json');
    expect(
      ((init.body as FormData).get('file') as unknown as { name: string }).name,
    ).toBe('a.wav');
  });

  it('preserves verbose JSON for Whisper transcription compatibility', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        text: 'Mensagem via Whisper.',
        language: 'pt',
        duration: 1.5,
      }),
    );
    const provider = liveTranscriptionProvider({
      transcriptionModel: 'whisper-1',
    });

    await expect(
      provider.transcribe(transcriptionInput()),
    ).resolves.toMatchObject({
      text: 'Mensagem via Whisper.',
      language: 'pt',
      usage: { audioSeconds: 1.5 },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.body as FormData).get('response_format')).toBe('verbose_json');
  });

  it('categorizes a provider timeout as retryable and persists the failure', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const provider = liveTranscriptionProvider({ maxAttempts: 1 });
    await expect(
      provider.transcribe(transcriptionInput()),
    ).rejects.toMatchObject({
      code: 'provider_timeout',
      retryable: true,
      attempts: 1,
    });
    expect(budget.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'provider_timeout', attempts: 1 }),
    );
  });

  it.each([
    ['gpt-5.6-terra', { reasoning_effort: 'none' }, 'temperature'],
    ['gpt-5.6-luna', { reasoning_effort: 'none' }, 'temperature'],
    ['gpt-4o', { temperature: 0 }, 'reasoning_effort'],
  ] as const)(
    'serializes strict Chat Completions Structured Outputs for %s without leaking the key into the body',
    async (model, generationControls, absentControl) => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(validDecision()) },
            },
          ],
          usage: {
            prompt_tokens: 100,
            prompt_tokens_details: { cached_tokens: 20 },
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      );
      const provider = new InboxProviderService(
        {
          ...config,
          decisionMode: 'live',
          decisionModel: model,
          endpoint: 'https://provider.invalid/v1',
          apiKey: 'test-secret-never-in-body',
          maxAttempts: 1,
          timeoutMs: 1_000,
          imageDetail: 'low',
        } as never,
        budget as never,
      );
      const result = await provider.decide(decisionInput());
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.redirect).toBe('error');
      if (typeof init.body !== 'string') throw new Error('body_missing');
      const serialized = init.body;
      const body = JSON.parse(serialized) as Record<string, unknown>;
      const schema = (
        body.response_format as {
          json_schema: { schema: Record<string, unknown> };
        }
      ).json_schema.schema;
      const actionItems = (
        schema.properties as {
          proposed_actions: { items: Record<string, unknown> };
        }
      ).proposed_actions.items;
      expect(serialized).not.toContain('test-secret-never-in-body');
      expect(body).toMatchObject({ model, ...generationControls });
      expect(body).not.toHaveProperty(absentControl);
      expect(schema).toMatchObject({ additionalProperties: false });
      expect(actionItems).toMatchObject({
        additionalProperties: false,
        required: ['type', 'value'],
      });
      expect(result.usage).toMatchObject({ cachedInputTokens: 20, images: 1 });
    },
  );

  it('categorizes a Structured Outputs refusal without attempting schema repair', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { refusal: 'refused' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    );
    const provider = new InboxProviderService(
      {
        ...config,
        decisionMode: 'live',
        decisionModel: 'gpt-5.6-terra',
        endpoint: 'https://provider.invalid/v1',
        apiKey: 'test-only',
        maxAttempts: 1,
        timeoutMs: 1_000,
        imageDetail: 'low',
      } as never,
      budget as never,
    );
    await expect(provider.decide(decisionInput())).rejects.toMatchObject({
      code: 'provider_refusal',
      retryable: false,
      attempts: 1,
    });
    expect(budget.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refused: true, errorCode: 'provider_refusal' }),
    );
  });

  it('categorizes a content-filter finish as a non-retryable safety rejection', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'content_filter',
            message: { content: '' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      }),
    );
    const provider = liveDecisionProvider();
    await expect(provider.decide(decisionInput())).rejects.toMatchObject({
      code: 'provider_safety_rejected',
      retryable: false,
      attempts: 1,
    });
    expect(budget.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refused: true,
        errorCode: 'provider_safety_rejected',
      }),
    );
  });

  it('blocks a live call before fetch when the durable budget is exhausted', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const exhaustedBudget = {
      ...budget,
      reserve: jest.fn().mockRejectedValue(
        Object.assign(new Error('provider_budget_exhausted'), {
          code: 'provider_budget_exhausted',
          retryable: false,
        }),
      ),
    };
    const provider = new InboxProviderService(
      {
        ...config,
        decisionMode: 'live',
        decisionModel: 'gpt-5.6-terra',
        endpoint: 'https://provider.invalid/v1',
        apiKey: 'test-only',
        maxAttempts: 1,
        timeoutMs: 1_000,
        imageDetail: 'low',
      } as never,
      exhaustedBudget as never,
    );
    await expect(provider.decide(decisionInput())).rejects.toMatchObject({
      code: 'provider_budget_exhausted',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function decisionInput() {
  return {
    tenantId: 't',
    workspaceId: 'w',
    correlationId: 'c',
    idempotencyKey: 'decision-i',
    agent: { id: null, versionId: null, snapshot: {} },
    businessMode: 'general',
    workspaceConfig: {},
    contact: { id: null },
    opportunity: null,
    ownership: { state: 'ai_active', version: 1 },
    allowedActions: [],
    systemPolicy: 'policy',
    untrustedData: 'data',
    promptVersion: 'v1',
    promptHash: 'hash',
    images: [
      {
        assetId: 'image',
        evidenceRef: 'image:image',
        mimeType: 'image/png',
        bytes: Buffer.from('png'),
      },
    ],
    repairAttempt: false,
  };
}

function transcriptionInput() {
  return {
    tenantId: 't',
    workspaceId: 'w',
    assetId: 'a',
    mimeType: 'audio/ogg',
    byteSize: 4,
    checksum: 'sum',
    bytes: Buffer.from('OggS'),
    correlationId: 'c',
    idempotencyKey: 'transcription-i',
  };
}

function liveTranscriptionProvider(overrides: Record<string, unknown> = {}) {
  return new InboxProviderService(
    {
      ...config,
      transcriptionMode: 'live',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      endpoint: 'https://provider.invalid/v1',
      apiKey: 'test-only',
      maxAttempts: 1,
      timeoutMs: 1_000,
      ...overrides,
    } as never,
    budget as never,
  );
}

function liveDecisionProvider() {
  return new InboxProviderService(
    {
      ...config,
      decisionMode: 'live',
      decisionModel: 'gpt-5.6-terra',
      endpoint: 'https://provider.invalid/v1',
      apiKey: 'test-only',
      maxAttempts: 1,
      timeoutMs: 1_000,
      imageDetail: 'low',
    } as never,
    budget as never,
  );
}

function validDecision() {
  return {
    schema_version: 1,
    reply: 'Resposta supervisionada',
    follow_text: null,
    stage_key: null,
    stage_name: null,
    tags: [],
    handoff: false,
    handoff_reason: null,
    agent_summary: 'Resumo',
    service: null,
    urgency: 'normal',
    close_reason: null,
    confidence: 0.9,
    evidence_refs: ['image:image'],
    extracted_facts: [],
    recommended_cta: null,
    proposed_phase: null,
    stage_transition: null,
    proposed_actions: [],
  };
}
