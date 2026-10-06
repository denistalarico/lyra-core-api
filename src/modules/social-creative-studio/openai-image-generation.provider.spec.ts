import { Logger } from '@nestjs/common';
import type { CreativeGenerationConfigService } from './creative-generation-config';
import {
  CREATIVE_IMAGE_ASPECT_RATIOS,
  ImageGenerationProviderError,
  type ImageGenerationProviderInput,
} from './creative-image-generation.provider';
import {
  OPENAI_IMAGE_QUALITY,
  OPENAI_IMAGE_SIZE,
  OPENAI_IMAGES_GENERATIONS_URL,
  OpenAIImageGenerationProvider,
} from './openai-image-generation.provider';

const API_KEY = 'sk-proj-THIS-KEY-MUST-NEVER-LEAK';
const PROMPT = 'café da manhã com logo da marca';
const PNG_A = Buffer.concat([
  Buffer.from([0x89]),
  Buffer.from('PNG\r\n\x1a\n', 'latin1'),
  Buffer.alloc(24, 1),
]);
const PNG_B = Buffer.concat([PNG_A.subarray(0, 8), Buffer.alloc(24, 2)]);

function config(
  patch: Partial<Record<keyof CreativeGenerationConfigService, unknown>> = {},
) {
  return {
    openAiApiKey: API_KEY,
    imageModel: 'gpt-image-2.5-flare-2026-09-08',
    imageTimeoutMs: 180_000,
    ...patch,
  } as unknown as CreativeGenerationConfigService;
}

function request(
  patch: Partial<ImageGenerationProviderInput> = {},
): ImageGenerationProviderInput {
  return {
    prompt: PROMPT,
    outputCount: 1,
    aspectRatio: '4:5',
    quality: 'standard',
    references: [],
    ...patch,
  };
}

const USAGE = {
  input_tokens: 50,
  input_tokens_details: { text_tokens: 50, image_tokens: 0 },
  output_tokens: 1_200,
  output_tokens_details: { image_tokens: 1_190, text_tokens: 10 },
  total_tokens: 1_250,
};

function ok(images: Buffer[], extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      created: 1_790_000_000,
      data: images.map((image) => ({
        b64_json: image.toString('base64'),
        // Never part of the result; must not be echoed anywhere.
        revised_prompt: `revised ${PROMPT}`,
      })),
      size: '1024x1280',
      quality: 'medium',
      output_format: 'png',
      usage: USAGE,
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function apiError(
  status: number,
  code: string | null,
  headers: Record<string, string> = {},
) {
  return new Response(
    JSON.stringify({
      error: {
        message: `Incorrect API key provided: ${API_KEY}. Prompt: ${PROMPT}`,
        type: 'invalid_request_error',
        param: null,
        code,
      },
    }),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  );
}

describe('OpenAIImageGenerationProvider (CS3.3)', () => {
  let fetchMock: jest.SpyInstance;
  let logs: string[];

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const)
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          logs.push(String(message));
        });
  });
  afterEach(() => jest.restoreAllMocks());

  async function failure(
    promise: Promise<unknown>,
  ): Promise<ImageGenerationProviderError> {
    const error = await promise.then(
      () => {
        throw new Error('expected a failure');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ImageGenerationProviderError);
    return error as ImageGenerationProviderError;
  }

  describe('request contract', () => {
    it('sends one Images API call with Lyra vocabulary translated — nothing else', async () => {
      fetchMock.mockResolvedValueOnce(ok([PNG_A, PNG_B]));
      const provider = new OpenAIImageGenerationProvider(config());

      await provider.generate(
        request({ outputCount: 2, aspectRatio: '9:16', quality: 'high' }),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(OPENAI_IMAGES_GENERATIONS_URL);
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers).toEqual({
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      });
      // No moderation/background/user/response_format: defaults stay OpenAI's
      // and no internal ids (tenant, company, generation) leave Lyra.
      expect(JSON.parse(init.body as string)).toEqual({
        model: 'gpt-image-2.5-flare-2026-09-08',
        prompt: PROMPT,
        n: 2,
        size: '864x1536',
        quality: 'high',
        output_format: 'png',
      });
    });

    it('uses the configured model, so it can change without touching contracts', async () => {
      fetchMock.mockResolvedValueOnce(ok([PNG_A]));
      const provider = new OpenAIImageGenerationProvider(
        config({ imageModel: 'gpt-image-2.5-sunburst' }),
      );

      const result = await provider.generate(request());

      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).model).toBe(
        'gpt-image-2.5-sunburst',
      );
      expect(result.usage?.model).toBe('gpt-image-2.5-sunburst');
    });

    it.each(CREATIVE_IMAGE_ASPECT_RATIOS)(
      'maps %s to an exact-ratio size inside the documented GPT Image limits',
      (ratio) => {
        const [width, height] = OPENAI_IMAGE_SIZE[ratio].split('x').map(Number);
        const [rw, rh] = ratio.split(':').map(Number);
        expect(width * rh).toBe(height * rw);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(width * height).toBeGreaterThanOrEqual(655_360);
        // Not experimental (> 2560x1440).
        expect(width * height).toBeLessThanOrEqual(2560 * 1440);
        expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(
          3,
        );
      },
    );

    it('maps the sizes and qualities exactly as documented in the sprint record', () => {
      expect(OPENAI_IMAGE_SIZE).toEqual({
        '1:1': '1024x1024',
        '4:5': '1024x1280',
        '9:16': '864x1536',
        '16:9': '1536x864',
      });
      expect(OPENAI_IMAGE_QUALITY).toEqual({
        standard: 'medium',
        high: 'high',
      });
    });

    it('refuses reference images instead of silently dropping them (edits are CS3.4)', async () => {
      const provider = new OpenAIImageGenerationProvider(config());
      const error = await failure(
        provider.generate(
          request({
            references: [
              { role: 'subject', mimeType: 'image/png', body: PNG_A },
            ],
          }),
        ),
      );
      expect([error.code, error.retryable]).toEqual(['failed', false]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['an out-of-contract output count', { outputCount: 5 }],
      ['an unknown aspect ratio', { aspectRatio: '3:2' }],
      ['an unknown quality', { quality: 'max' }],
    ])('refuses %s without calling OpenAI', async (_label, patch) => {
      const provider = new OpenAIImageGenerationProvider(config());
      const error = await failure(
        provider.generate(
          request(patch as Partial<ImageGenerationProviderInput>),
        ),
      );
      expect([error.code, error.retryable]).toEqual(['failed', false]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('returns the decoded bytes of one output and the usage, with no cost', async () => {
      fetchMock.mockResolvedValueOnce(ok([PNG_A]));
      const provider = new OpenAIImageGenerationProvider(config());

      const result = await provider.generate(request());

      expect(result.outputs).toHaveLength(1);
      expect(Buffer.isBuffer(result.outputs[0].body)).toBe(true);
      expect(result.outputs[0].body.equals(PNG_A)).toBe(true);
      // Bytes only: no URL, base64, revised prompt or raw response.
      expect(Object.keys(result.outputs[0])).toEqual(['body']);
      expect(result.usage).toEqual({
        model: 'gpt-image-2.5-flare-2026-09-08',
        metrics: {
          images: 1,
          input_tokens: 50,
          input_text_tokens: 50,
          input_image_tokens: 0,
          output_tokens: 1_200,
          output_image_tokens: 1_190,
          output_text_tokens: 10,
          total_tokens: 1_250,
        },
        cost: null,
      });
    });

    it('returns several outputs from ONE call, in order', async () => {
      fetchMock.mockResolvedValueOnce(ok([PNG_A, PNG_B, PNG_A]));
      const provider = new OpenAIImageGenerationProvider(config());

      const result = await provider.generate(request({ outputCount: 3 }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.outputs.map((o) => o.body)).toEqual([PNG_A, PNG_B, PNG_A]);
      expect(result.usage?.metrics.images).toBe(3);
    });

    it('accepts fewer outputs than requested (the worker decides)', async () => {
      fetchMock.mockResolvedValueOnce(ok([PNG_A]));
      const provider = new OpenAIImageGenerationProvider(config());
      const result = await provider.generate(request({ outputCount: 2 }));
      expect(result.outputs).toHaveLength(1);
    });

    it('keeps only well-formed usage numbers and still records the model without usage', async () => {
      fetchMock.mockResolvedValueOnce(
        ok([PNG_A], {
          usage: { input_tokens: -1, output_tokens: 'x', total_tokens: 9 },
        }),
      );
      const provider = new OpenAIImageGenerationProvider(config());
      const result = await provider.generate(request());
      expect(result.usage?.metrics).toEqual({ images: 1, total_tokens: 9 });

      fetchMock.mockResolvedValueOnce(ok([PNG_A], { usage: undefined }));
      const bare = await provider.generate(request());
      expect(bare.usage).toEqual({
        model: 'gpt-image-2.5-flare-2026-09-08',
        metrics: { images: 1 },
        cost: null,
      });
    });
  });

  describe('errors before a response (nothing returned → retryable)', () => {
    it('turns the timeout signal into a retryable timeout', async () => {
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Rejects with what fetch would: the signal's TimeoutError.
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason as Error),
            );
          }),
      );
      const provider = new OpenAIImageGenerationProvider(
        config({ imageTimeoutMs: 20 }),
      );

      const error = await failure(provider.generate(request()));

      expect([error.code, error.retryable]).toEqual(['timeout', true]);
    });

    it('treats a network failure as retryable unavailability', async () => {
      fetchMock.mockRejectedValueOnce(
        new TypeError(`fetch failed: connect ECONNREFUSED ${API_KEY}`),
      );
      const provider = new OpenAIImageGenerationProvider(config());
      const error = await failure(provider.generate(request()));
      expect([error.code, error.retryable]).toEqual(['unavailable', true]);
    });
  });

  describe('HTTP error mapping', () => {
    it.each([
      ['429 rate limit', 429, 'rate_limit_exceeded', 'rate_limited', true],
      ['429 slow down', 429, 'slow_down', 'rate_limited', true],
      ['429 without a code', 429, null, 'rate_limited', true],
      ['429 quota', 429, 'insufficient_quota', 'unavailable', false],
      [
        '429 credit exhausted',
        429,
        'credit_balance_exhausted',
        'unavailable',
        false,
      ],
      [
        '429 project spend limit',
        429,
        'project_spend_limit_exceeded',
        'unavailable',
        false,
      ],
      ['500', 500, null, 'unavailable', true],
      ['503 overloaded', 503, 'server_is_overloaded', 'unavailable', true],
      ['408', 408, null, 'timeout', true],
      ['401 bad key', 401, 'invalid_api_key', 'unavailable', false],
      [
        '403 region / permission',
        403,
        'unsupported_country_region_territory',
        'unavailable',
        false,
      ],
      ['400 invalid request', 400, 'invalid_value', 'failed', false],
      ['404 unknown model', 404, 'model_not_found', 'failed', false],
      ['400 moderation', 400, 'moderation_blocked', 'rejected', false],
      [
        '400 legacy content policy',
        400,
        'content_policy_violation',
        'rejected',
        false,
      ],
    ])('%s → %s', async (_label, status, code, expected, retryable) => {
      fetchMock.mockResolvedValueOnce(apiError(status, code));
      const provider = new OpenAIImageGenerationProvider(config());

      const error = await failure(provider.generate(request()));

      expect([error.code, error.retryable]).toEqual([expected, retryable]);
      expect(error.usage).toBeNull();
    });

    it('does not call a non-moderation 4xx a content refusal just because of its type', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              type: 'image_generation_user_error',
              code: 'invalid_size',
            },
          }),
          { status: 400 },
        ),
      );
      const provider = new OpenAIImageGenerationProvider(config());
      const error = await failure(provider.generate(request()));
      expect(error.code).toBe('failed');
    });

    it('passes Retry-After to the worker as a hint (seconds or HTTP date) and never sleeps', async () => {
      const provider = new OpenAIImageGenerationProvider(config());

      fetchMock.mockResolvedValueOnce(
        apiError(429, 'rate_limit_exceeded', { 'retry-after': '90' }),
      );
      expect(
        (await failure(provider.generate(request()))).retryAfterSeconds,
      ).toBe(90);

      const date = new Date(Date.now() + 45_000).toUTCString();
      fetchMock.mockResolvedValueOnce(
        apiError(503, 'server_is_overloaded', { 'retry-after': date }),
      );
      const fromDate = (await failure(provider.generate(request())))
        .retryAfterSeconds;
      expect(fromDate).toBeGreaterThanOrEqual(40);
      expect(fromDate).toBeLessThanOrEqual(46);

      fetchMock.mockResolvedValueOnce(
        apiError(429, 'rate_limit_exceeded', { 'retry-after': 'soon' }),
      );
      expect(
        (await failure(provider.generate(request()))).retryAfterSeconds,
      ).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('survives an error body that is not JSON', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('<html>Bad gateway</html>', { status: 502 }),
      );
      const provider = new OpenAIImageGenerationProvider(config());
      const error = await failure(provider.generate(request()));
      expect([error.code, error.retryable]).toEqual(['unavailable', true]);
    });
  });

  describe('malformed success (paid → never retryable)', () => {
    it.each([
      [
        'a body that is not JSON',
        () => new Response('not json', { status: 200 }),
      ],
      [
        'no data',
        () => new Response(JSON.stringify({ usage: USAGE }), { status: 200 }),
      ],
      [
        'empty data',
        () =>
          new Response(JSON.stringify({ data: [], usage: USAGE }), {
            status: 200,
          }),
      ],
      [
        'a URL instead of bytes',
        () =>
          new Response(
            JSON.stringify({
              data: [{ url: 'https://files.openai/x.png' }],
              usage: USAGE,
            }),
            { status: 200 },
          ),
      ],
      [
        'invalid base64',
        () =>
          new Response(
            JSON.stringify({
              data: [{ b64_json: 'not*base64!' }],
              usage: USAGE,
            }),
            { status: 200 },
          ),
      ],
      ['more images than requested', () => ok([PNG_A, PNG_B])],
    ])(
      'refuses %s as non-retryable invalid_output',
      async (_label, response) => {
        fetchMock.mockResolvedValueOnce(response());
        const provider = new OpenAIImageGenerationProvider(config());

        const error = await failure(
          provider.generate(request({ outputCount: 1 })),
        );

        expect([error.code, error.retryable]).toEqual([
          'invalid_output',
          false,
        ]);
      },
    );

    it('carries the paid usage on the error so the attempt is still accounted for', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ b64_json: '' }], usage: USAGE }),
          { status: 200 },
        ),
      );
      const provider = new OpenAIImageGenerationProvider(config());

      const error = await failure(provider.generate(request()));

      expect(error.usage).toEqual(
        expect.objectContaining({
          model: 'gpt-image-2.5-flare-2026-09-08',
          metrics: expect.objectContaining({ output_tokens: 1_200 }),
          cost: null,
        }),
      );
    });

    it('treats a timeout while reading a 2xx body as final, not a re-bill', async () => {
      const response = ok([PNG_A]);
      jest
        .spyOn(response, 'json')
        .mockRejectedValueOnce(
          Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
        );
      fetchMock.mockResolvedValueOnce(response);
      const provider = new OpenAIImageGenerationProvider(config());

      const error = await failure(provider.generate(request()));

      expect([error.code, error.retryable]).toEqual(['timeout', false]);
    });
  });

  describe('sanitization', () => {
    it('never puts the key, prompt, provider message or image data in errors or logs', async () => {
      const provider = new OpenAIImageGenerationProvider(config());
      const errors: unknown[] = [];
      for (const response of [
        apiError(401, 'invalid_api_key'),
        apiError(400, 'moderation_blocked'),
        apiError(429, 'rate_limit_exceeded'),
        new Response(
          JSON.stringify({
            data: [{ b64_json: '%%%', revised_prompt: PROMPT }],
            usage: USAGE,
          }),
          { status: 200 },
        ),
      ]) {
        fetchMock.mockResolvedValueOnce(response);
        errors.push(await failure(provider.generate(request())));
      }
      fetchMock.mockResolvedValueOnce(ok([PNG_A]));
      const result = await provider.generate(request());

      const surface = JSON.stringify([
        errors.map((error) => ({
          ...(error as object),
          message: (error as Error).message,
          stack: (error as Error).stack,
        })),
        result.usage,
        logs,
      ]);
      for (const secret of [
        API_KEY,
        PROMPT,
        'Incorrect API key',
        PNG_A.toString('base64'),
        'revised',
      ])
        expect(surface).not.toContain(secret);
      // But operators can still tell what happened.
      expect(logs.join('\n')).toContain('http_401:invalid_api_key');
      expect(logs.join('\n')).toContain('http_400:moderation_blocked');
    });

    it('drops an error code that does not look like an identifier', async () => {
      fetchMock.mockResolvedValueOnce(apiError(400, `bad ${API_KEY}`));
      const provider = new OpenAIImageGenerationProvider(config());
      await failure(provider.generate(request()));
      expect(logs.join('\n')).not.toContain(API_KEY);
      expect(logs.join('\n')).toContain('reason=http_400 ');
    });
  });
});
