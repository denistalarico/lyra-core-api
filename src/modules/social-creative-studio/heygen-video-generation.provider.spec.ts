import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import type { VideoGenerationSubmitInput } from './creative-video-generation.provider';
import { HeyGenVideoGenerationProvider } from './heygen-video-generation.provider';

/**
 * CS4-B — HeyGen v3 adapter against the documented HTTP shapes
 * (developers.heygen.com, audited 2026-10). `fetch` is mocked: ZERO real calls.
 */
const KEY = 'heygen-test-key';
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypmp42'),
  Buffer.alloc(16),
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

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

const ugc: VideoGenerationSubmitInput = {
  kind: 'generate',
  mode: 'ugc_avatar',
  script: 'Oi! Conheça o novo café da casa.',
  avatar: {
    providerAvatarId: 'look_123',
    providerVoiceId: 'voice_9',
    avatarType: 'studio_avatar',
  },
  language: 'pt-BR',
  aspectRatio: '9:16',
  quality: 'high',
  backgroundImage: null,
};
const context = { dispatchKey: 'lyra-video-op-1-1', callbackUrl: null };

describe('HeyGenVideoGenerationProvider (CS4-B contract, v3)', () => {
  let fetchMock: jest.Mock;
  let provider: HeyGenVideoGenerationProvider;

  beforeEach(() => {
    process.env.HEYGEN_API_KEY = KEY;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    provider = new HeyGenVideoGenerationProvider(
      new CreativeVideoGenerationConfigService(),
    );
  });

  afterEach(() => {
    for (const name of [
      'HEYGEN_API_KEY',
      'HEYGEN_WEBHOOK_SECRET',
      'CREATIVE_VIDEO_UGC_ENGINE',
    ])
      delete process.env[name];
    jest.restoreAllMocks();
  });

  const call = (index = 0) => {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return {
      url,
      init,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    };
  };

  describe('submit', () => {
    it('POST /v3/videos type avatar, Avatar IV engine, 9:16, 1080p, Idempotency-Key = dispatch key', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          data: { video_id: 'v_abc', status: 'waiting', output_format: 'mp4' },
        }),
      );
      const submitted = await provider.submit(ugc, context);

      const { url, headers, body, init } = call();
      expect(url).toBe('https://api.heygen.com/v3/videos');
      expect(init.redirect).toBe('error');
      expect(headers['x-api-key']).toBe(KEY);
      expect(headers['Idempotency-Key']).toBe(context.dispatchKey);
      expect(body).toEqual({
        type: 'avatar',
        avatar_id: 'look_123',
        script: ugc.mode === 'ugc_avatar' ? ugc.script : '',
        voice_id: 'voice_9',
        engine: { type: 'avatar_iv' },
        aspect_ratio: '9:16',
        resolution: '1080p',
        output_format: 'mp4',
        title: 'Lyra Reel',
        callback_id: context.dispatchKey,
        voice_settings: { locale: 'pt-BR' },
      });
      expect(submitted).toEqual({
        jobId: 'v_abc',
        model: 'avatar_iv',
        operation: 'avatar_video',
        resolution: '1080p',
        usage: null,
      });
    });

    it('the script is sent exactly as given (never truncated)', async () => {
      const long = `${'Uma frase falada pelo avatar. '.repeat(30)}Fim.`;
      fetchMock.mockResolvedValueOnce(json(200, { data: { video_id: 'v' } }));
      await provider.submit(
        { ...ugc, script: long } as VideoGenerationSubmitInput,
        context,
      );
      expect(call().body.script).toBe(long);
    });

    it('a product background is uploaded to /v3/assets first (idempotent) and referenced by asset_id', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, { data: { asset_id: 'asset_1', url: 'https://x' } }),
        )
        .mockResolvedValueOnce(json(200, { data: { video_id: 'v_bg' } }));
      await provider.submit(
        {
          ...ugc,
          backgroundImage: { mimeType: 'image/jpeg', body: JPEG },
        } as VideoGenerationSubmitInput,
        context,
      );
      expect(call(0).url).toBe('https://api.heygen.com/v3/assets');
      expect(call(0).headers['Idempotency-Key']).toBe(
        `${context.dispatchKey}.background`,
      );
      expect(call(0).init.body).toBeInstanceOf(FormData);
      expect(call(1).body.background).toEqual({
        type: 'image',
        asset_id: 'asset_1',
      });
    });

    it('a WebP background is refused before any call (HeyGen assets take png/jpeg)', async () => {
      await expect(
        provider.submit(
          {
            ...ugc,
            backgroundImage: { mimeType: 'image/webp', body: JPEG },
          } as VideoGenerationSubmitInput,
          context,
        ),
      ).rejects.toMatchObject({ code: 'rejected', dispatch: 'not_sent' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the configured engine is sent (Avatar V)', async () => {
      process.env.CREATIVE_VIDEO_UGC_ENGINE = 'avatar_v';
      fetchMock.mockResolvedValueOnce(json(200, { data: { video_id: 'v' } }));
      const submitted = await provider.submit(ugc, context);
      expect(call().body.engine).toEqual({ type: 'avatar_v' });
      expect(submitted.model).toBe('avatar_v');
    });

    it.each([
      [
        402,
        'insufficient_credit',
        'insufficient_provider_balance',
        false,
        'refused',
      ],
      [429, 'rate_limit_exceeded', 'rate_limited', true, 'refused'],
      [409, 'request_in_progress', 'rate_limited', true, 'unknown'],
      [400, 'content_policy_violation', 'rejected', false, 'refused'],
      [404, 'avatar_not_found', 'avatar_unavailable', false, 'refused'],
      [400, 'avatar_not_usable', 'avatar_unavailable', false, 'refused'],
      [403, 'voice_not_usable', 'avatar_unavailable', false, 'refused'],
      [401, 'unauthorized', 'unavailable', false, 'refused'],
      [502, 'server_error', 'unavailable', true, 'unknown'],
    ])(
      'HTTP %i %s → %s (retryable=%s, dispatch=%s)',
      async (status, code, mapped, retryable, dispatch) => {
        fetchMock.mockResolvedValueOnce(
          json(status, { error: { code, message: 'secret detail' } }),
        );
        const error = await provider.submit(ugc, context).catch((e) => e);
        expect(error).toMatchObject({ code: mapped, retryable, dispatch });
        expect(String(error.message)).not.toContain('secret detail');
      },
    );
  });

  describe('recover = same request, same Idempotency-Key (HeyGen replays for 24 h)', () => {
    it('replays the original answer: found, never a second video', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, { data: { video_id: 'v_original' } }),
      );
      const recovery = await provider.recover(
        ugc,
        context,
        new Date(Date.now() - 60_000),
      );
      expect(recovery).toMatchObject({
        state: 'found',
        submitted: { jobId: 'v_original' },
      });
      expect(call().headers['Idempotency-Key']).toBe(context.dispatchKey);
    });

    it('a definitive refusal is `absent`; in-flight/5xx/outside the window are `unknown`', async () => {
      fetchMock.mockResolvedValueOnce(
        json(400, { error: { code: 'content_policy_violation' } }),
      );
      await expect(provider.recover(ugc, context, new Date())).resolves.toEqual(
        { state: 'absent' },
      );

      fetchMock.mockResolvedValueOnce(
        json(409, { error: { code: 'request_in_progress' } }),
      );
      await expect(provider.recover(ugc, context, new Date())).resolves.toEqual(
        { state: 'unknown' },
      );

      fetchMock.mockResolvedValueOnce(json(503, {}));
      await expect(provider.recover(ugc, context, new Date())).resolves.toEqual(
        { state: 'unknown' },
      );

      fetchMock.mockClear();
      await expect(
        provider.recover(ugc, context, new Date(Date.now() - 25 * 3600_000)),
      ).resolves.toEqual({ state: 'unknown' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('status, result, duration, cost', () => {
    it('pending/processing → pending; completed → real duration as usage; failed → mapped', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, { data: { id: 'v', status: 'pending' } }),
        )
        .mockResolvedValueOnce(
          json(200, { data: { id: 'v', status: 'processing' } }),
        )
        .mockResolvedValueOnce(
          json(200, { data: { id: 'v', status: 'completed', duration: 23.4 } }),
        )
        .mockResolvedValueOnce(
          json(200, {
            data: {
              id: 'v',
              status: 'failed',
              failure_code: 'MODERATION_REJECTED',
              failure_message: 'x',
            },
          }),
        );
      const job = { jobId: 'v', outputRef: null };
      await expect(provider.getStatus(job)).resolves.toEqual({
        state: 'pending',
      });
      await expect(provider.getStatus(job)).resolves.toEqual({
        state: 'pending',
      });
      await expect(provider.getStatus(job)).resolves.toEqual({
        state: 'succeeded',
        outputRef: null,
        durationSeconds: 23.4,
        usage: { metrics: { seconds: 23.4 }, reportedCost: null },
      });
      await expect(provider.getStatus(job)).resolves.toEqual({
        state: 'failed',
        code: 'rejected',
        usage: null,
      });
      expect(call().url).toBe('https://api.heygen.com/v3/videos/v');
    });

    it('result downloads the presigned video and thumbnail without the API key', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, {
            data: {
              status: 'completed',
              video_url: 'https://files.heygen.example/v.mp4?sig=1',
              thumbnail_url: 'https://files.heygen.example/t.jpg',
            },
          }),
        )
        .mockResolvedValueOnce(new Response(MP4, { status: 200 }))
        .mockResolvedValueOnce(new Response(JPEG, { status: 200 }));
      const result = await provider.getResult({ jobId: 'v', outputRef: null });
      expect(result.video.equals(MP4)).toBe(true);
      expect(result.poster?.equals(JPEG)).toBe(true);
      expect(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].headers,
      ).toBeUndefined();
    });

    it('cost = actual seconds × price of the PERSISTED engine and the avatar type', () => {
      process.env.CREATIVE_VIDEO_UGC_ENGINE = 'avatar_v';
      // Submitted on Avatar IV; config changed since: the persisted model wins.
      expect(
        provider.cost(
          ugc,
          { metrics: { seconds: 23.4 }, reportedCost: null },
          'avatar_iv',
        ),
      ).toMatchObject({
        units: '23.400',
        unitKind: 'output_second:avatar_iv:studio_avatar',
        costAmount: '1.560780',
        pricingVersion: 'heygen.payg.2026-10',
        costSource: 'lyra_calculated',
      });
      expect(provider.cost(ugc, null, 'avatar_iv')).toBeNull();
    });
  });

  describe('avatar catalog', () => {
    it('lists PUBLIC looks with cursor pagination, keeping only safe fields', async () => {
      fetchMock
        .mockResolvedValueOnce(
          json(200, {
            data: [
              {
                id: 'look_1',
                name: 'Ana',
                avatar_type: 'studio_avatar',
                gender: 'female',
                preferred_orientation: 'portrait',
                supported_api_engines: ['avatar_iv', 'avatar_iii'],
                default_voice_id: 'voice_1',
                preview_image_url: 'https://files.heygen.example/ana.webp',
              },
            ],
            has_more: true,
            next_token: 'page2',
          }),
        )
        .mockResolvedValueOnce(
          json(200, {
            data: [
              {
                id: 'look_2',
                name: 'Bia',
                avatar_type: 'photo_avatar',
                supported_api_engines: ['avatar_iii'],
                preview_image_url: 'http://insecure/x',
              },
            ],
            has_more: false,
          }),
        );
      const entries = await provider.listAvatars();

      expect(new URL(call(0).url).searchParams.get('ownership')).toBe('public');
      expect(new URL(call(1).url).searchParams.get('token')).toBe('page2');
      expect(entries).toEqual([
        {
          providerAvatarId: 'look_1',
          name: 'Ana',
          avatarType: 'studio_avatar',
          gender: 'female',
          orientation: 'portrait',
          supportedEngines: ['avatar_iv', 'avatar_iii'],
          defaultVoiceId: 'voice_1',
          previewImageUrl: 'https://files.heygen.example/ana.webp',
        },
        expect.objectContaining({
          providerAvatarId: 'look_2',
          previewImageUrl: null,
          defaultVoiceId: null,
        }),
      ]);
      // Usable = configured engine + default voice + a price for (engine, type).
      expect(provider.isAvatarUsable(entries[0])).toBe(true);
      expect(provider.isAvatarUsable(entries[1])).toBe(false);
      expect(
        provider.isAvatarUsable({ ...entries[0], avatarType: 'unknown_type' }),
      ).toBe(false);
    });
  });

  describe('webhook signature', () => {
    const body = Buffer.from(
      JSON.stringify({
        event_type: 'avatar_video.success',
        event_data: { video_id: 'v_abc', url: 'https://x' },
      }),
    );
    const request = (signature: string | undefined, raw = body) => ({
      method: 'POST',
      path: '/x',
      query: '',
      headers: { signature },
      rawBody: raw,
    });

    it('without the endpoint secret, nothing is trusted and no callback URL is wanted', () => {
      expect(provider.callbacksVerifiable).toBe(false);
      expect(provider.parseCallback(request('anything'))).toBeNull();
    });

    it('HMAC-SHA256 over the raw body (hex or base64) → only the video id', () => {
      process.env.HEYGEN_WEBHOOK_SECRET = 'whsec';
      const mac = createHmac('sha256', 'whsec').update(body);
      const hex = mac.digest('hex');
      expect(provider.callbacksVerifiable).toBe(true);
      expect(provider.parseCallback(request(hex))).toEqual({ jobId: 'v_abc' });
      expect(
        provider.parseCallback(
          request(Buffer.from(hex, 'hex').toString('base64')),
        ),
      ).toEqual({ jobId: 'v_abc' });
      expect(
        provider.parseCallback(
          request(hex, Buffer.concat([body, Buffer.from(' ')])),
        ),
      ).toBeNull();
      expect(provider.parseCallback(request('00'))).toBeNull();
    });
  });

  it('diagnostics reads the PAYG wallet balance (internal only)', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: {
          billing_type: 'wallet',
          wallet: { currency: 'usd', remaining_balance: 42.5 },
        },
      }),
    );
    await expect(provider.diagnostics()).resolves.toEqual({
      provider: 'heygen',
      balance: { amount: '42.5', unit: 'USD' },
      concurrency: null,
    });
    expect(call().url).toBe('https://api.heygen.com/v3/users/me');
  });
});
