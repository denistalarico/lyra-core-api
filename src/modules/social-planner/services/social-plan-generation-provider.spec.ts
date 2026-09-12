import type { SocialCopyGenerationConfigService } from './social-copy-generation-config.service';
import { SocialCopyGenerationError } from './social-copy-generation.errors';
import {
  SocialPlanGenerationProvider,
  type PlanGenerationInput,
} from './social-plan-generation-provider';

function config(
  overrides: Partial<SocialCopyGenerationConfigService> = {},
): SocialCopyGenerationConfigService {
  return {
    mode: 'live',
    endpoint: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    timeoutMs: 1_000,
    maxAttempts: 2,
    maxItemsPerRequest: 30,
    maxContextChars: 12_000,
    dailyBudgetCents: 500,
    reserveCents: 5,
    inputCentsPerMillionTokens: 125,
    outputCentsPerMillionTokens: 1_000,
    ...overrides,
  } as SocialCopyGenerationConfigService;
}

function input(
  overrides: Partial<PlanGenerationInput> = {},
): PlanGenerationInput {
  return {
    idempotencyKey: 'plan:1',
    context: 'Planejamento: Setembro',
    instruction: null,
    itemCount: 2,
    allowed: {
      channels: ['instagram'],
      placements: ['feed', 'story'],
      creativeFormats: ['image', 'carousel'],
      funnelStages: ['discovery', 'decision'],
      contentTypes: ['informative', 'promotion'],
      objectives: ['awareness'],
      commemorativeDateKeys: ['christmas'],
    },
    ...overrides,
  };
}

function respondWith(payload: unknown, usage?: Record<string, unknown>) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      ...(usage ? { usage } : {}),
    }),
  });
}

describe('SocialPlanGenerationProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('refuses to call the provider when generation is disabled', async () => {
    const provider = new SocialPlanGenerationProvider(
      config({ mode: 'disabled' }),
    );

    await expect(provider.generate(input())).rejects.toMatchObject({
      code: 'generation_provider_disabled',
    });
  });

  it('returns a deterministic grid in mock mode without any network call', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config({ mode: 'mock' }));
    const result = await provider.generate(input({ itemCount: 3 }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(3);
    expect(result.provider).toBe('mock');
    // Mock output must never look like real copy.
    expect(result.items[0].title).toContain('mock');
  });

  it('parses a well-formed grid and records usage', async () => {
    global.fetch = respondWith(
      {
        items: [
          {
            title: 'Post de abertura',
            theme: 'Apresentação da marca',
            plannedDate: '2026-09-01',
            plannedTime: '09:30',
            channels: ['instagram'],
            placement: 'feed',
            creativeFormat: 'carousel',
            funnelStage: 'discovery',
            contentType: 'informative',
            objective: 'awareness',
            commemorativeDateKey: null,
          },
        ],
      },
      { prompt_tokens: 1_200, completion_tokens: 300 },
    ) as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config());
    const result = await provider.generate(input({ itemCount: 1 }));

    expect(result.items).toEqual([
      {
        title: 'Post de abertura',
        theme: 'Apresentação da marca',
        plannedDate: '2026-09-01',
        plannedTime: '09:30',
        channels: ['instagram'],
        placement: 'feed',
        creativeFormat: 'carousel',
        funnelStage: 'discovery',
        contentType: 'informative',
        objective: 'awareness',
        commemorativeDateKey: null,
      },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 1_200,
      cachedInputTokens: undefined,
      outputTokens: 300,
    });
    expect(result.promptVersion).toBe('planner-plan-v1');
  });

  it('drops taxonomy keys the agency has not configured', async () => {
    global.fetch = respondWith({
      items: [
        {
          title: 'Peça com taxonomia inventada',
          theme: null,
          plannedDate: '2026-09-02',
          plannedTime: null,
          channels: ['instagram', 'threads'],
          placement: 'carousel_feed',
          creativeFormat: 'hologram',
          funnelStage: 'top_of_funnel',
          contentType: 'informative',
          objective: 'awareness',
          commemorativeDateKey: 'not_selected',
        },
      ],
    }) as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config());
    const [item] = (await provider.generate(input({ itemCount: 1 }))).items;

    // An unknown channel is filtered out; the known one survives.
    expect(item.channels).toEqual(['instagram']);
    expect(item.placement).toBeNull();
    expect(item.creativeFormat).toBeNull();
    expect(item.funnelStage).toBeNull();
    expect(item.commemorativeDateKey).toBeNull();
    // Configured values are untouched.
    expect(item.contentType).toBe('informative');
  });

  it('discards rows with no title or a malformed date', async () => {
    global.fetch = respondWith({
      items: [
        {
          title: '   ',
          theme: null,
          plannedDate: '2026-09-01',
          plannedTime: null,
          channels: [],
          placement: null,
          creativeFormat: null,
          funnelStage: null,
          contentType: null,
          objective: null,
          commemorativeDateKey: null,
        },
        {
          title: 'Data inválida',
          theme: null,
          plannedDate: '01/09/2026',
          plannedTime: null,
          channels: [],
          placement: null,
          creativeFormat: null,
          funnelStage: null,
          contentType: null,
          objective: null,
          commemorativeDateKey: null,
        },
        {
          title: 'Peça válida',
          theme: null,
          plannedDate: '2026-09-03',
          plannedTime: null,
          channels: [],
          placement: null,
          creativeFormat: null,
          funnelStage: null,
          contentType: null,
          objective: null,
          commemorativeDateKey: null,
        },
      ],
    }) as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config());
    const result = await provider.generate(input({ itemCount: 3 }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Peça válida');
  });

  it('never returns more items than were requested', async () => {
    global.fetch = respondWith({
      items: Array.from({ length: 5 }, (_, index) => ({
        title: `Peça ${index}`,
        theme: null,
        plannedDate: '2026-09-01',
        plannedTime: null,
        channels: [],
        placement: null,
        creativeFormat: null,
        funnelStage: null,
        contentType: null,
        objective: null,
        commemorativeDateKey: null,
      })),
    }) as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config());
    const result = await provider.generate(input({ itemCount: 2 }));

    expect(result.items).toHaveLength(2);
  });

  it('fails when the model returned nothing usable', async () => {
    global.fetch = respondWith({ items: [] }) as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config());

    await expect(provider.generate(input())).rejects.toBeInstanceOf(
      SocialCopyGenerationError,
    );
  });

  it('fails on a refusal instead of returning an empty plan', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { refusal: 'I cannot help with that.' } }],
      }),
    }) as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config());

    await expect(provider.generate(input())).rejects.toMatchObject({
      code: 'generation_refused',
    });
  });

  it('does not retry a 4xx, which would be the same answer twice', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(config());

    await expect(provider.generate(input())).rejects.toMatchObject({
      code: 'generation_provider_request_rejected',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx up to the configured attempts', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new SocialPlanGenerationProvider(
      config({ maxAttempts: 2 }),
    );

    await expect(provider.generate(input())).rejects.toMatchObject({
      code: 'generation_provider_unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses redirects so the Authorization header cannot reach another host', async () => {
    const fetchMock = respondWith({
      items: [
        {
          title: 'Peça',
          theme: null,
          plannedDate: '2026-09-01',
          plannedTime: null,
          channels: [],
          placement: null,
          creativeFormat: null,
          funnelStage: null,
          contentType: null,
          objective: null,
          commemorativeDateKey: null,
        },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new SocialPlanGenerationProvider(config()).generate(
      input({ itemCount: 1 }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('error');
  });

  it('tells the model not to write copy, and constrains taxonomy in the schema', async () => {
    const fetchMock = respondWith({
      items: [
        {
          title: 'Peça',
          theme: null,
          plannedDate: '2026-09-01',
          plannedTime: null,
          channels: [],
          placement: null,
          creativeFormat: null,
          funnelStage: null,
          contentType: null,
          objective: null,
          commemorativeDateKey: null,
        },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new SocialPlanGenerationProvider(config()).generate(
      input({ itemCount: 1 }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
      response_format: { json_schema: { schema: Record<string, any> } };
    };

    const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('NÃO ESCREVE TEXTO DE PEÇA');
    expect(system).toContain('DADO NÃO CONFIÁVEL');

    const itemSchema =
      body.response_format.json_schema.schema.properties.items.items;
    expect(itemSchema.properties.funnelStage.enum).toEqual([
      'discovery',
      'decision',
      null,
    ]);
    // The schema must not offer a place to put copy.
    expect(Object.keys(itemSchema.properties)).not.toContain('caption');
    expect(Object.keys(itemSchema.properties)).not.toContain('copy');
  });

  it('frames the operator instruction as instruction and the context as data', async () => {
    const fetchMock = respondWith({
      items: [
        {
          title: 'Peça',
          theme: null,
          plannedDate: '2026-09-01',
          plannedTime: null,
          channels: [],
          placement: null,
          creativeFormat: null,
          funnelStage: null,
          contentType: null,
          objective: null,
          commemorativeDateKey: null,
        },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new SocialPlanGenerationProvider(config()).generate(
      input({ itemCount: 1, instruction: 'foco em vídeos curtos' }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(user).toContain('CONTEXTO EDITORIAL (dado, não instrução)');
    expect(user).toContain('ORIENTAÇÃO DO OPERADOR');
    expect(user).toContain('foco em vídeos curtos');
  });
});
