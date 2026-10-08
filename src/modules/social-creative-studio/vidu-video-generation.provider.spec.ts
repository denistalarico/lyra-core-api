import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import {
  VideoGenerationProviderError,
  type VideoGenerationSubmitInput,
} from './creative-video-generation.provider';
import { ViduVideoGenerationProvider } from './vidu-video-generation.provider';

/**
 * CS4-B — Vidu adapter against the documented HTTP shapes
 * (platform.vidu.com, audited 2026-10). `fetch` is mocked: ZERO real calls.
 */
const KEY = 'vidu-test-key';
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(16),
]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const image: VideoGenerationSubmitInput = {
  kind: 'generate',
  mode: 'generative_reel',
  inputKind: 'image',
  prompt: 'café fumegando, câmera lenta',
  durationSeconds: 8,
  aspectRatio: '9:16',
  quality: 'high',
  audio: true,
  images: [{ mimeType: 'image/png', body: PNG }],
};
const context = { dispatchKey: 'lyra-video-op-1-1', callbackUrl: null };

describe('ViduVideoGenerationProvider (CS4-B contract)', () => {
  let fetchMock: jest.Mock;
  let provider: ViduVideoGenerationProvider;

  beforeEach(() => {
    process.env.VIDU_API_KEY = KEY;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    provider = new ViduVideoGenerationProvider(
      new CreativeVideoGenerationConfigService(),
    );
  });

  afterEach(() => {
    delete process.env.VIDU_API_KEY;
    delete process.env.CREATIVE_VIDEO_VIDU_CREDIT_PRICE_USD;
    jest.restoreAllMocks();
  });

  const call = (index = 0) => {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return {
      url,
      init,
      body: init.body ? JSON.parse(String(init.body)) : null,
      headers: init.headers as Record<string, string>,
    };
  };

  describe('submit', () => {
    it('image → POST /ent/v2/img2video, Token auth, base64 frame, no aspect_ratio, payload marker', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          task_id: 'task-1',
          state: 'created',
          model: 'viduq3-turbo',
          credits: 104,
        }),
      );
      const submitted = await provider.submit(image, {
        ...context,
        callbackUrl:
          'https://api.example.com/api/social/creative-studio/video-provider-callbacks/vidu',
      });

      const { url, init, body, headers } = call();
      expect(url).toBe('https://api.vidu.com/ent/v2/img2video');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(headers.Authorization).toBe(`Token ${KEY}`);
      expect(body).toMatchObject({
        model: 'viduq3-turbo',
        prompt: image.prompt,
        duration: 8,
        resolution: '1080p',
        audio: true,
        off_peak: false,
        payload: context.dispatchKey,
        callback_url:
          'https://api.example.com/api/social/creative-studio/video-provider-callbacks/vidu',
      });
      expect(body.aspect_ratio).toBeUndefined();
      expect(body.images).toEqual([
        `data:image/png;base64,${PNG.toString('base64')}`,
      ]);
      expect(submitted).toEqual({
        jobId: 'task-1',
        model: 'viduq3-turbo',
        operation: 'img2video',
        resolution: '1080p',
        usage: { metrics: { credits: 104 }, reportedCost: null },
      });
    });

    it('reference → /ent/v2/reference2video with aspect_ratio 9:16; text → /ent/v2/text2video without images', async () => {
      fetchMock
        .mockResolvedValueOnce(json(200, { task_id: 'r-1', state: 'created' }))
        .mockResolvedValueOnce(json(200, { task_id: 't-1', state: 'created' }));
      await provider.submit(
        { ...image, inputKind: 'reference', quality: 'standard' },
        context,
      );
      await provider.submit(
        { ...image, inputKind: 'text', images: [] },
        context,
      );

      expect(call(0).url).toBe('https://api.vidu.com/ent/v2/reference2video');
      expect(call(0).body).toMatchObject({
        aspect_ratio: '9:16',
        resolution: '720p',
      });
      expect(call(1).url).toBe('https://api.vidu.com/ent/v2/text2video');
      expect(call(1).body.aspect_ratio).toBe('9:16');
      expect(call(1).body.images).toBeUndefined();
    });

    it('extend → reads the previous task for a fresh URL, then POST /ent/v2/extend on viduq2-turbo', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, {
            id: 'task-1',
            state: 'success',
            credits: 192,
            creations: [
              { id: 'creation-1', url: 'https://cdn.vidu.example/v.mp4' },
            ],
          }),
        )
        .mockResolvedValueOnce(
          json(200, { task_id: 'task-2', state: 'created', credits: 50 }),
        );

      const submitted = await provider.submit(
        {
          kind: 'extend',
          mode: 'generative_reel',
          prompt: 'x'.repeat(5000),
          durationSeconds: 7,
          quality: 'standard',
          previous: { jobId: 'task-1', outputRef: 'creation-1' },
        },
        context,
      );

      expect(call(0).url).toBe(
        'https://api.vidu.com/ent/v2/tasks/task-1/creations',
      );
      expect(call(1).url).toBe('https://api.vidu.com/ent/v2/extend');
      expect(call(1).body).toMatchObject({
        model: 'viduq2-turbo',
        video_creation_id: 'creation-1',
        video_url: 'https://cdn.vidu.example/v.mp4',
        duration: 7,
        resolution: '720p',
        payload: context.dispatchKey,
      });
      // extend's documented prompt limit.
      expect(call(1).body.prompt).toHaveLength(2000);
      expect(submitted).toMatchObject({ jobId: 'task-2', operation: 'extend' });
    });

    it.each([
      [
        402,
        { code: 'CreditInsufficient' },
        'insufficient_provider_balance',
        false,
        'refused',
      ],
      [429, { code: 'QuotaExceeded' }, 'rate_limited', true, 'refused'],
      [
        400,
        { code: 'TaskPromptPolicyViolation' },
        'rejected',
        false,
        'refused',
      ],
      [400, { code: 'ImageFormatInvalid' }, 'rejected', false, 'refused'],
      [401, { code: 'Unauthorized' }, 'unavailable', false, 'refused'],
      [500, { code: 'InternalServiceFailure' }, 'unavailable', true, 'unknown'],
    ])(
      'HTTP %i %j → %s (retryable=%s, dispatch=%s)',
      async (status, body, code, retryable, dispatch) => {
        fetchMock.mockResolvedValueOnce(json(status, body));
        const error = (await provider
          .submit(image, context)
          .catch((e) => e)) as VideoGenerationProviderError;
        expect(error).toBeInstanceOf(VideoGenerationProviderError);
        expect(error).toMatchObject({ code, retryable, dispatch });
        // The provider text never travels in the error.
        expect(error.message).toBe(`video_generation_${code}`);
      },
    );

    it('a timeout after sending is `unknown` (the task may exist); a refused connection is `not_sent`', async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new Error('t'), { name: 'TimeoutError' }),
      );
      const timeout = await provider.submit(image, context).catch((e) => e);
      expect(timeout).toMatchObject({
        code: 'timeout',
        retryable: true,
        dispatch: 'unknown',
      });

      fetchMock.mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );
      const refused = await provider.submit(image, context).catch((e) => e);
      expect(refused).toMatchObject({
        code: 'unavailable',
        dispatch: 'not_sent',
      });
    });

    it('2xx without a task id is `unknown`, never silently accepted', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { state: 'created' }));
      await expect(provider.submit(image, context)).rejects.toMatchObject({
        dispatch: 'unknown',
      });
    });
  });

  describe('status, result, cost', () => {
    it('created/queueing/processing → pending', async () => {
      for (const state of ['created', 'queueing', 'processing'])
        fetchMock.mockResolvedValueOnce(json(200, { id: 't', state }));
      for (let i = 0; i < 3; i += 1)
        await expect(
          provider.getStatus({ jobId: 't', outputRef: null }),
        ).resolves.toEqual({
          state: 'pending',
        });
    });

    it('success → output ref + credits; failed → mapped code', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, {
            id: 't',
            state: 'success',
            credits: 104,
            creations: [
              {
                id: 'c-9',
                url: 'https://cdn/x.mp4',
                cover_url: 'https://cdn/x.jpg',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          json(200, {
            id: 't',
            state: 'failed',
            err_code: 'CreationPolicyViolation',
            credits: 0,
          }),
        );
      await expect(
        provider.getStatus({ jobId: 't', outputRef: null }),
      ).resolves.toEqual({
        state: 'succeeded',
        outputRef: 'c-9',
        durationSeconds: null,
        usage: { metrics: { credits: 104 }, reportedCost: null },
      });
      await expect(
        provider.getStatus({ jobId: 't', outputRef: null }),
      ).resolves.toEqual({
        state: 'failed',
        code: 'rejected',
        usage: { metrics: { credits: 0 }, reportedCost: null },
      });
    });

    it('result downloads video and cover WITHOUT the API key; URLs never leave the adapter', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, {
            id: 't',
            state: 'success',
            creations: [
              {
                id: 'c',
                url: 'https://cdn.vidu.example/x.mp4',
                cover_url: 'https://cdn.vidu.example/x.jpg',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(new Response(MP4, { status: 200 }))
        .mockResolvedValueOnce(new Response(PNG, { status: 200 }));

      const result = await provider.getResult({ jobId: 't', outputRef: 'c' });

      expect(result.video.equals(MP4)).toBe(true);
      expect(result.poster?.equals(PNG)).toBe(true);
      const download = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(download[0]).toBe('https://cdn.vidu.example/x.mp4');
      expect(download[1].headers).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('cdn.vidu.example');
    });

    it('refuses a non-https or private output URL', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          state: 'success',
          creations: [{ url: 'http://169.254.169.254/latest' }],
        }),
      );
      await expect(
        provider.getResult({ jobId: 't', outputRef: null }),
      ).rejects.toMatchObject({
        code: 'invalid_output',
      });
    });

    it('cost = credits × confirmed credit price (snapshot), no credits → no cost', () => {
      expect(
        provider.cost(image, { metrics: { credits: 104 }, reportedCost: null }),
      ).toMatchObject({
        units: '104.000',
        costAmount: '0.520000',
        pricingVersion: 'vidu.credits.2026-10',
      });
      expect(provider.cost(image, null)).toBeNull();
    });
  });

  describe('recover (lost submit)', () => {
    it('finds the task by our payload marker in the created_at window', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          tasks: [
            { id: 'other', payload: 'someone-else' },
            {
              id: 'task-7',
              payload: context.dispatchKey,
              model: 'viduq3-turbo',
              credits: 104,
            },
          ],
        }),
      );
      const since = new Date('2026-10-08T12:00:00Z');
      const recovery = await provider.recover(image, context, since);

      expect(recovery).toMatchObject({
        state: 'found',
        submitted: { jobId: 'task-7', operation: 'img2video' },
      });
      const url = new URL(call().url);
      expect(url.pathname).toBe('/ent/v2/tasks');
      expect(url.searchParams.get('created_at.from')).toBe(
        '2026-10-08T11:59:00.000Z',
      );
    });

    it('`absent` only for a complete listing; anything doubtful is `unknown`', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { tasks: [] }));
      await expect(
        provider.recover(image, context, new Date()),
      ).resolves.toEqual({ state: 'absent' });

      fetchMock.mockResolvedValueOnce(
        json(200, { tasks: [], next_page_token: 'p2' }),
      );
      await expect(
        provider.recover(image, context, new Date()),
      ).resolves.toEqual({ state: 'unknown' });

      fetchMock.mockResolvedValueOnce(json(200, { unexpected: true }));
      await expect(
        provider.recover(image, context, new Date()),
      ).resolves.toEqual({ state: 'unknown' });

      fetchMock.mockResolvedValueOnce(json(503, {}));
      await expect(
        provider.recover(image, context, new Date()),
      ).resolves.toEqual({ state: 'unknown' });

      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(
        provider.recover(image, context, new Date()),
      ).resolves.toEqual({ state: 'unknown' });
    });
  });

  describe('callback signature (HMAC-SHA256 with the API token)', () => {
    const path = '/api/social/creative-studio/video-provider-callbacks/vidu';
    function signed(body: object, date = new Date().toUTCString(), key = KEY) {
      const nonce = '7b0c6e2e-8a7f-4f43-9b1e-2f0a0b5c1d11';
      const signedHeaders = `x-request-nonce:${nonce}\n`;
      const signing = ['POST', path, '', 'vidu', date, signedHeaders].join(
        '\n',
      );
      return {
        method: 'POST',
        path,
        query: '',
        rawBody: Buffer.from(JSON.stringify(body)),
        headers: {
          date,
          'x-request-nonce': nonce,
          'x-hmac-signed-headers': 'x-request-nonce',
          'x-hmac-algorithm': 'hmac-sha256',
          'x-hmac-access-key': 'vidu',
          'x-hmac-signature': createHmac('sha256', key)
            .update(signing)
            .digest('base64'),
        },
      };
    }

    it('valid signature → only the task id is taken', () => {
      expect(
        provider.parseCallback(
          signed({ id: 'task-1', state: 'success', creations: [{ url: 'x' }] }),
        ),
      ).toEqual({ jobId: 'task-1' });
    });

    it('wrong key, stale Date or tampered body → ignored', () => {
      expect(
        provider.parseCallback(signed({ id: 't' }, undefined, 'other-key')),
      ).toBeNull();
      expect(
        provider.parseCallback(
          signed({ id: 't' }, new Date(Date.now() - 10 * 60_000).toUTCString()),
        ),
      ).toBeNull();
      const tampered = signed({ id: 't' });
      expect(
        provider.parseCallback({ ...tampered, path: `${path}/other` }),
      ).toBeNull();
      expect(provider.parseCallback({ ...tampered, headers: {} })).toBeNull();
    });
  });

  it('diagnostics reads the credit balance and concurrency (internal only)', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        remains: [
          {
            type: 'metered',
            credit_remain: 1200,
            concurrency_limit: 5,
            current_concurrency: 2,
          },
          {
            type: 'test',
            credit_remain: 300,
            concurrency_limit: 1,
            current_concurrency: 0,
          },
        ],
      }),
    );
    await expect(provider.diagnostics()).resolves.toEqual({
      provider: 'vidu',
      balance: { amount: '1500', unit: 'vidu_credit' },
      concurrency: { limit: 5, current: 2 },
    });
    expect(call().url).toBe('https://api.vidu.com/ent/v2/credits');
  });
});
