import { ContractAiAssistConfigService } from './contract-ai-assist-config.service';
import {
  ContractAiAssistProvider,
  contractAiAssistSchema,
  contractAiAssistProviderUsage,
} from './contract-ai-assist.provider';
import {
  ContractAiAssistProviderError,
  type ContractAiAssistOutput,
} from './contract-ai-assist.types';

const output: ContractAiAssistOutput = {
  replacements: [
    { originalText: 'ACME', variable: 'client.name', confidence: 'high' },
  ],
  headings: [],
  suggestions: {
    name: null,
    description: null,
    category: null,
    defaultSignatureMode: null,
    jurisdictionRegion: null,
    countryCode: null,
    locale: null,
  },
  reviewNotes: [],
};
const input = {
  sourceText: 'ACME',
  targetType: 'client' as const,
  categoryOptions: [{ value: 'category-id', label: 'Serviços' }],
};

describe('ContractAiAssistProvider', () => {
  const originalEnv = process.env;
  const fetchMock = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();
  beforeEach(() => {
    process.env = {
      CONTRACT_AI_ASSIST_PROVIDER_MODE: 'live',
      CONTRACT_AI_ASSIST_PROVIDER_API_KEY: 'test-only',
      CONTRACT_AI_ASSIST_TIMEOUT_MS: '1000',
    };
    fetchMock.mockReset();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  });
  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });
  const provider = () =>
    new ContractAiAssistProvider(new ContractAiAssistConfigService());
  const respond = (
    content: unknown = output,
    extras: Record<string, unknown> = {},
  ) =>
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(content) },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 30 },
          },
          ...extras,
        }),
        { status: 200 },
      ),
    );

  it('mock preserves text for deterministic processing and never calls the network or records paid work', async () => {
    process.env.CONTRACT_AI_ASSIST_PROVIDER_MODE = 'mock';
    const result = await provider().generate(input, 'run-id');
    expect(result.paid).toBe(false);
    expect(result.output.replacements).toEqual([]);
    expect(result.output.reviewNotes[0].message).toContain('mock');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disabled never calls the network', async () => {
    process.env.CONTRACT_AI_ASSIST_PROVIDER_MODE = 'disabled';
    await expect(provider().generate(input, 'run-id')).rejects.toMatchObject({
      reason: 'disabled',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses strict allowlists, untrusted-data framing, redirect protection and reported usage', async () => {
    respond();
    const result = await provider().generate(input, 'run-id');
    expect(result.usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 30,
      outputTokens: 20,
    });
    expect(result.paid).toBe(true);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(request?.redirect).toBe('error');
    expect(request?.headers).toMatchObject({ 'Idempotency-Key': 'run-id' });
    const serialized = typeof request?.body === 'string' ? request.body : '';
    expect(serialized).toContain('DADOS NÃO CONFIÁVEIS');
    expect(serialized).toContain('"strict":true');
    expect(serialized).not.toContain('"bodyHtml"');
    const schema = contractAiAssistSchema(input.categoryOptions);
    expect(
      schema.schema.properties.replacements.items.properties.variable.enum,
    ).toContain('client.name');
    expect(
      schema.schema.properties.suggestions.properties.category.enum,
    ).toEqual(['category-id', null]);
  });

  it.each([
    {
      ...output,
      replacements: [
        { originalText: 'ACME', variable: 'client.name', confidence: ['high'] },
      ],
    },
    {
      ...output,
      reviewNotes: [{ kind: ['ambiguous'], message: 'Check', excerpt: null }],
    },
    {
      ...output,
      replacements: [
        { originalText: 'ACME', variable: 'invented', confidence: 'high' },
      ],
    },
    { ...output, suggestions: { ...output.suggestions, category: 'invented' } },
    { ...output, bodyHtml: 'rewritten contract' },
    {
      ...output,
      suggestions: { ...output.suggestions, countryCode: 'Brazil' },
    },
  ])('rejects invalid paid output and preserves its usage', async (invalid) => {
    respond(invalid);
    await expect(provider().generate(input, 'run-id')).rejects.toMatchObject({
      message: 'contract_ai_provider_failed',
      paid: true,
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['refusal', 'length', 'invalid-json'])(
    'preserves paid usage on %s',
    async (kind) => {
      respond(output, {
        choices: [
          {
            finish_reason: kind === 'length' ? 'length' : 'stop',
            message:
              kind === 'refusal' ? { refusal: 'No' } : { content: '{broken' },
          },
        ],
      });
      await expect(provider().generate(input, 'run-id')).rejects.toMatchObject({
        paid: true,
        usage: { cachedInputTokens: 30 },
      });
    },
  );

  it('does not retry rejected requests or expose provider response text', async () => {
    fetchMock.mockResolvedValue(
      new Response('sensitive provider detail', { status: 401 }),
    );
    await expect(provider().generate(input, 'run-id')).rejects.toMatchObject({
      reason: 'request_rejected',
      paid: false,
      message: 'contract_ai_provider_failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds retries on rate limit and server errors', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    await expect(provider().generate(input, 'run-id')).rejects.toMatchObject({
      reason: 'rate_limited',
      paid: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    respond();
    expect((await provider().generate(input, 'run-id')).paid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps network failures to a safe error', async () => {
    fetchMock.mockRejectedValue(new Error('secret'));
    await expect(provider().generate(input, 'run-id')).rejects.toBeInstanceOf(
      ContractAiAssistProviderError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

it('does not invent zero token counts for missing or invalid usage', () => {
  expect(contractAiAssistProviderUsage({})).toEqual({
    inputTokens: undefined,
    cachedInputTokens: undefined,
    outputTokens: undefined,
  });
  expect(
    contractAiAssistProviderUsage({
      usage: { prompt_tokens: -1, completion_tokens: 1.5 },
    }).inputTokens,
  ).toBeUndefined();
  expect(
    contractAiAssistProviderUsage({
      usage: {
        prompt_tokens: 10,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    }).cachedInputTokens,
  ).toBeUndefined();
});
