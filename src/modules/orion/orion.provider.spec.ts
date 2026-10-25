import type { OrionConfigService } from './orion-config.service';
import { OrionProviderError } from './orion.errors';
import { OrionProvider } from './orion.provider';

const config = (overrides: Partial<OrionConfigService> = {}) =>
  ({
    mode: 'live',
    endpoint: 'https://provider.example/v1',
    apiKey: 'secret-key',
    model: 'gpt-5.6-terra',
    timeoutMs: 1_000,
    maxAttempts: 2,
    ...overrides,
  }) as OrionConfigService;

const input = (allowTools = true) => ({
  messages: [{ role: 'user' as const, content: 'como estão as vendas?' }],
  tools: [],
  allowTools,
  idempotencyKey: 'turn:1',
});

const ok = (
  message: Record<string, unknown>,
  usage?: Record<string, unknown>,
) =>
  new Response(JSON.stringify({ choices: [{ message }], usage }), {
    status: 200,
  });

describe('OrionProvider', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('refuses when disabled and never calls a provider in mock mode', async () => {
    await expect(
      new OrionProvider(config({ mode: 'disabled' })).complete(input()),
    ).rejects.toMatchObject({ code: 'orion_provider_disabled' });

    const mock = new OrionProvider(config({ mode: 'mock' }));
    const first = await mock.complete(input());
    expect(first.toolCalls[0]).toMatchObject({ name: 'search_help' });
    const theme = await mock.complete({
      ...input(),
      messages: [{ role: 'user', content: 'muda para o tema escuro' }],
    });
    expect(JSON.parse(theme.toolCalls[0].arguments)).toEqual({
      action: 'set_theme',
      value: 'dark',
    });
    const final = await mock.complete({
      ...input(),
      messages: [
        ...input().messages,
        { role: 'tool', tool_call_id: 'x', content: '{}' },
      ],
    });
    expect(final.content).toContain('modo mock');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends tools, the idempotency key and no redirects; parses tool calls and usage', async () => {
    fetchMock.mockResolvedValueOnce(
      ok(
        {
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'list_agents', arguments: '{}' },
            },
          ],
        },
        {
          prompt_tokens: 1200,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 1000 },
        },
      ),
    );
    const result = await new OrionProvider(config()).complete(input());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://provider.example/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'turn:1',
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'gpt-5.6-terra',
      tool_choice: 'auto',
    });
    expect(result.toolCalls).toEqual([
      { id: 'call-1', name: 'list_agents', arguments: '{}' },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 1000,
      outputTokens: 30,
    });
  });

  it('forces text on the last round', async () => {
    fetchMock.mockResolvedValueOnce(ok({ content: 'Tudo certo.' }));
    const result = await new OrionProvider(config()).complete(input(false));
    expect(
      JSON.parse(
        ((fetchMock.mock.calls as unknown[][])[0][1] as RequestInit)
          .body as string,
      ),
    ).toMatchObject({ tool_choice: 'none' });
    expect(result).toMatchObject({ content: 'Tudo certo.', toolCalls: [] });
  });

  it('retries 429/5xx, not other 4xx, and maps timeouts', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok({ content: 'Oi' }));
    await expect(
      new OrionProvider(config()).complete(input()),
    ).resolves.toMatchObject({
      attempts: 2,
    });

    fetchMock.mockReset().mockResolvedValue(new Response('', { status: 400 }));
    await expect(new OrionProvider(config()).complete(input())).rejects.toEqual(
      new OrionProviderError('orion_provider_request_rejected', 1),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock
      .mockReset()
      .mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(
      new OrionProvider(config()).complete(input()),
    ).rejects.toMatchObject({ code: 'orion_provider_timeout', attempts: 2 });
  });

  it('rejects an empty or malformed answer', async () => {
    fetchMock.mockResolvedValueOnce(ok({ content: '   ' }));
    await expect(
      new OrionProvider(config()).complete(input()),
    ).rejects.toMatchObject({ code: 'orion_response_invalid' });
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(
      new OrionProvider(config()).complete(input()),
    ).rejects.toMatchObject({ code: 'orion_response_invalid' });
  });
});
