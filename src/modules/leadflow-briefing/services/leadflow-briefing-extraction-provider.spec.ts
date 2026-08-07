import { LeadFlowBriefingExtractionProvider } from './leadflow-briefing-extraction-provider';

function config(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'live',
    endpoint: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-5.6-luna',
    timeoutMs: 1000,
    maxAttempts: 2,
    maxImagesPerJob: 3,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function chatCompletion(suggestions: unknown[]): Record<string, unknown> {
  return {
    choices: [{ message: { content: JSON.stringify({ suggestions }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

describe('LeadFlowBriefingExtractionProvider', () => {
  const baseInput = {
    tenantId: 't',
    workspaceId: 'w',
    idempotencyKey: 'idem-1',
    fields: [
      { fieldPath: 'identity.publicName', description: 'nome público' },
      { fieldPath: 'identity.summary', description: 'resumo do negócio' },
    ],
    text: 'untrusted document text',
    images: [],
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws without calling the network when the provider is disabled', async () => {
    const provider = new LeadFlowBriefingExtractionProvider(config({ mode: 'disabled' }) as never);
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(provider.extract(baseInput)).rejects.toMatchObject({
      code: 'extraction_provider_disabled',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a deterministic result in mock mode without touching the network', async () => {
    const provider = new LeadFlowBriefingExtractionProvider(config({ mode: 'mock' }) as never);
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await provider.extract(baseInput);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.provider).toBe('mock');
    expect(result.suggestions[0]?.fieldPath).toBe('identity.publicName');
  });

  it('parses a successful live response into normalized suggestions', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        chatCompletion([
          { field_path: 'identity.publicName', value: 'Acme', confidence: 0.9, rationale: 'evidence' },
        ]),
      ),
    );

    const provider = new LeadFlowBriefingExtractionProvider(config() as never);
    const result = await provider.extract(baseInput);

    expect(result.suggestions).toEqual([
      { fieldPath: 'identity.publicName', value: 'Acme', confidence: 0.9, rationale: 'evidence' },
    ]);
    expect(result.attempts).toBe(1);
  });

  it('retries on 5xx and eventually throws after exhausting attempts', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({}, false, 500));

    const provider = new LeadFlowBriefingExtractionProvider(config({ maxAttempts: 2 }) as never);

    await expect(provider.extract(baseInput)).rejects.toMatchObject({
      code: 'extraction_provider_unavailable',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable 4xx rejection', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({}, false, 400));

    const provider = new LeadFlowBriefingExtractionProvider(config({ maxAttempts: 3 }) as never);

    await expect(provider.extract(baseInput)).rejects.toMatchObject({
      code: 'extraction_provider_request_rejected',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on a model refusal without treating it as a valid suggestion set', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        choices: [{ message: { refusal: 'cannot help with that' } }],
      }),
    );

    const provider = new LeadFlowBriefingExtractionProvider(config() as never);

    await expect(provider.extract(baseInput)).rejects.toMatchObject({
      code: 'extraction_refused',
    });
  });

  it('throws on malformed JSON content instead of silently dropping suggestions', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'not json' } }] }),
    );

    const provider = new LeadFlowBriefingExtractionProvider(config() as never);

    await expect(provider.extract(baseInput)).rejects.toMatchObject({
      code: 'extraction_schema_invalid',
    });
  });

  it('surfaces a timeout as a normalized code', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new DOMException('aborted', 'TimeoutError');
    });

    const provider = new LeadFlowBriefingExtractionProvider(config({ maxAttempts: 1 }) as never);

    await expect(provider.extract(baseInput)).rejects.toMatchObject({
      code: 'extraction_provider_timeout',
    });
  });
});
