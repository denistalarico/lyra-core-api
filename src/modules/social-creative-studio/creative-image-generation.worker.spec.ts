import { BadRequestException, Logger } from '@nestjs/common';
import type { MediaAssetUploadService } from '../../common/media-assets';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  ImageGenerationProvider,
  ImageGenerationProviderError,
  type ImageGenerationProviderInput,
  type ImageGenerationProviderResult,
} from './creative-image-generation.provider';
import { CreativeImageGenerationWorker } from './creative-image-generation.worker';
import { CREATIVE_IMAGE_MAX_BYTES } from './creative-asset.service';
import { CREATIVE_GENERATION_MEDIA_SOURCE } from './creative-retention';
import { OpenAIImageGenerationProvider } from './openai-image-generation.provider';
import type { CreativeGenerationEntity } from './entities';

const scopeA = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};
const PNG = Buffer.concat([
  Buffer.from([0x89]),
  Buffer.from('PNG\r\n\x1a\n', 'latin1'),
  Buffer.alloc(32, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom', 'latin1'),
  Buffer.alloc(32),
]);
const SECRET = 'sk-live-THIS-MUST-NEVER-LEAK';

class FakeImageProvider extends ImageGenerationProvider {
  readonly id = 'fake';
  readonly calls: ImageGenerationProviderInput[] = [];
  next: () => Promise<ImageGenerationProviderResult> = () =>
    Promise.resolve({ outputs: [{ body: PNG }], usage: null });
  generate(input: ImageGenerationProviderInput) {
    this.calls.push(input);
    return this.next();
  }
}

function claimed(
  patch: Partial<CreativeGenerationEntity> = {},
): CreativeGenerationEntity {
  return {
    id: 'gen-1',
    ...scopeA,
    generationType: 'image',
    status: 'processing',
    prompt: 'café na mesa',
    outputCount: 1,
    aspectRatio: '4:5',
    quality: 'high',
    idempotencyKey: 'key-1',
    requestFingerprint: 'f'.repeat(64),
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date(),
    lockedAt: new Date(),
    lockedBy: 'me',
    errorCode: null,
    errorRetryable: null,
    provider: null,
    model: null,
    usageMetrics: null,
    costAmount: null,
    costCurrency: null,
    requestedById: 'user-a',
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    failedAt: null,
    ...patch,
  };
}

/**
 * The SQL itself is proven against PostgreSQL in
 * `creative-image-generation.postgres.spec.ts`; here the database is a
 * recorder, so each test can see which terminal write was issued with what.
 */
function harness<P extends ImageGenerationProvider = FakeImageProvider>(
  provider: P = new FakeImageProvider() as unknown as P,
  row: CreativeGenerationEntity = claimed(),
) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let claims = ['gen-1'];
  let completeMatches = true;
  const inserted: unknown[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes("SET status = 'processing'")) {
      const id = claims.shift();
      return id ? [[{ id }], 1] : [[], 0];
    }
    if (sql.includes("SET status = 'completed'"))
      return completeMatches ? [[{ id: row.id }], 1] : [[], 0];
    return [[], 0];
  });
  const dataSource = {
    query,
    getRepository: () => ({ findOneBy: jest.fn(async () => row) }),
    transaction: async (body: (manager: unknown) => Promise<unknown>) =>
      body({
        query,
        getRepository: () => ({
          insert: async (rows: unknown[]) => inserted.push(...rows),
        }),
      }),
  };
  let n = 0;
  const mediaUpload = {
    upload: jest.fn(async (_scope, _actor, input) => ({
      id: `media-${++n}`,
      mimeType: input.file.mimetype,
    })),
    removeAfterFailedConsumerOperation: jest.fn().mockResolvedValue(undefined),
  };
  const worker = new CreativeImageGenerationWorker(
    dataSource as never,
    provider,
    mediaUpload as unknown as MediaAssetUploadService,
    new CreativeGenerationConfigService(),
  );
  (worker as unknown as { workerId: string }).workerId = 'me';
  const terminal = (kind: 'completed' | 'fail') =>
    queries.filter((q) =>
      kind === 'completed'
        ? q.sql.includes("SET status = 'completed'")
        : q.sql.includes('SET status = $8::varchar'),
    );
  return {
    worker,
    provider,
    mediaUpload,
    query,
    queries,
    inserted,
    terminal,
    setClaims: (ids: string[]) => (claims = ids),
    loseLease: () => (completeMatches = false),
  };
}

/** `[id, worker, provider, model, metrics, amount, currency, status, delay, code, retryable]` */
function failParams(h: ReturnType<typeof harness>) {
  const [write] = h.terminal('fail');
  expect(write).toBeDefined();
  const p = write.params;
  return {
    status: p[7],
    delay: p[8],
    code: p[9],
    retryable: p[10],
    provider: p[2],
    metrics: p[4],
    amount: p[5],
    currency: p[6],
  };
}

describe('CreativeImageGenerationWorker (CS3.2)', () => {
  afterEach(() => {
    delete process.env.CREATIVE_GENERATION_WORKER_ENABLED;
    delete process.env.CREATIVE_GENERATION_WORKER_CONCURRENCY;
    delete process.env.CREATIVE_GENERATION_TENANT_CONCURRENCY;
  });

  describe('claiming', () => {
    it('settles exhausted leases first, then claims up to the worker concurrency with the tenant cap', async () => {
      process.env.CREATIVE_GENERATION_WORKER_CONCURRENCY = '3';
      process.env.CREATIVE_GENERATION_TENANT_CONCURRENCY = '1';
      const h = harness();
      h.setClaims(['gen-1', 'gen-1']);

      expect(await h.worker.processPending()).toBe(2);

      expect(h.queries[0].sql).toContain('attempts >= max_attempts');
      expect(h.queries[0].sql).toContain("error_code = 'timeout'");
      const claimsSql = h.queries.filter((q) =>
        q.sql.includes("SET status = 'processing'"),
      );
      // Two claimed, the third found nothing and stopped the loop.
      expect(claimsSql).toHaveLength(3);
      expect(claimsSql[0].params).toEqual(['me', 1]);
      expect(claimsSql[0].sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(claimsSql[0].sql).toContain(
        'candidate.attempts < candidate.max_attempts',
      );
    });

    it('does nothing in a process with the worker switched off', async () => {
      process.env.CREATIVE_GENERATION_WORKER_ENABLED = 'false';
      const h = harness();
      await h.worker.tick();
      expect(h.query).not.toHaveBeenCalled();
    });
  });

  describe('execution', () => {
    it('calls the provider with the frozen request, in Lyra vocabulary', async () => {
      const h = harness();
      await h.worker.processPending();
      expect(h.provider.calls).toEqual([
        {
          prompt: 'café na mesa',
          outputCount: 1,
          aspectRatio: '4:5',
          quality: 'high',
          references: [],
        },
      ]);
    });

    it('stores outputs as TEMPORARY media in the generation scope and completes with one output row each', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.resolve({
          outputs: [{ body: PNG }, { body: JPEG }],
          usage: null,
        });
      const h = harness(provider, claimed({ outputCount: 2 }));

      await h.worker.processPending();

      expect(h.mediaUpload.upload).toHaveBeenCalledTimes(2);
      for (const [index, call] of h.mediaUpload.upload.mock.calls.entries()) {
        expect(call[0]).toEqual(scopeA);
        expect(call[1]).toBe('user-a');
        expect(call[2].source).toBe(CREATIVE_GENERATION_MEDIA_SOURCE);
        expect(call[2].metadata).toEqual({
          generationId: 'gen-1',
          outputIndex: index,
        });
      }
      expect(h.mediaUpload.upload.mock.calls[1][2].file.mimetype).toBe(
        'image/jpeg',
      );
      const [complete] = h.terminal('completed');
      expect(complete.sql).toContain(
        "WHERE id = $1 AND status = 'processing' AND locked_by = $2",
      );
      expect(h.inserted).toEqual([
        { generationId: 'gen-1', outputIndex: 0, mediaAssetId: 'media-1' },
        { generationId: 'gen-1', outputIndex: 1, mediaAssetId: 'media-2' },
      ]);
      expect(h.terminal('fail')).toHaveLength(0);
    });

    it('records usage and cost for CS6, summed onto earlier paid attempts', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.resolve({
          outputs: [{ body: PNG }],
          usage: {
            model: 'image-model-1',
            metrics: { images: 1, 'bad key!': 9, negative: -1 },
            cost: { amount: '0.040000', currency: 'USD' },
          },
        });
      const h = harness(
        provider,
        claimed({
          usageMetrics: { images: 1 },
          costAmount: '0.040000',
          costCurrency: 'USD',
        }),
      );

      await h.worker.processPending();

      const [complete] = h.terminal('completed');
      expect(complete.params.slice(2)).toEqual([
        'fake',
        'image-model-1',
        JSON.stringify({ images: 2 }),
        '0.040000',
        'USD',
      ]);
      expect(complete.sql).toContain('COALESCE(cost_amount, 0) + $6::numeric');
    });

    it.each([
      ['a second currency', { amount: '1.00', currency: 'BRL' }],
      ['a malformed amount', { amount: '1e3', currency: 'USD' }],
    ])('does not sum %s into the recorded cost', async (_label, cost) => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.resolve({
          outputs: [{ body: PNG }],
          usage: { model: null, metrics: {}, cost },
        });
      const h = harness(
        provider,
        claimed({ costAmount: '0.040000', costCurrency: 'USD' }),
      );
      jest
        .spyOn(
          (h.worker as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await h.worker.processPending();

      const [complete] = h.terminal('completed');
      expect(complete.params.slice(5)).toEqual([null, null]);
    });

    it('discards its outputs when the lease was lost before completing', async () => {
      const h = harness();
      h.loseLease();

      await h.worker.processPending();

      expect(h.inserted).toEqual([]);
      expect(
        h.mediaUpload.removeAfterFailedConsumerOperation,
      ).toHaveBeenCalledWith(scopeA, 'media-1');
      expect(h.terminal('fail')).toHaveLength(0);
    });
  });

  describe('failure and retry', () => {
    it('returns a retryable failure with attempts left to the queue, with backoff and the code', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.reject(new ImageGenerationProviderError('rate_limited', true));
      const h = harness(provider, claimed({ attempts: 2, maxAttempts: 3 }));

      await h.worker.processPending();

      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'queued',
          delay: 60,
          code: 'rate_limited',
          retryable: true,
        }),
      );
    });

    it('fails a retryable error once attempts are spent — no infinite loop', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.reject(new ImageGenerationProviderError('timeout', true));
      const h = harness(provider, claimed({ attempts: 3, maxAttempts: 3 }));

      await h.worker.processPending();

      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'failed',
          code: 'timeout',
          retryable: true,
        }),
      );
    });

    it('fails a non-retryable error on the first attempt', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.reject(new ImageGenerationProviderError('rejected', false));
      const h = harness(provider, claimed({ attempts: 1, maxAttempts: 3 }));

      await h.worker.processPending();

      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'failed',
          code: 'rejected',
          retryable: false,
        }),
      );
      const [write] = h.terminal('fail');
      expect(write.sql).toContain(
        "WHERE id = $1 AND status = 'processing' AND locked_by = $2",
      );
    });

    it('never records or logs an unexpected provider error, which may carry secrets', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.reject(new Error(`401 invalid key ${SECRET} at https://api`));
      const h = harness(provider);
      const warn = jest
        .spyOn(
          (h.worker as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await h.worker.processPending();

      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'failed',
          code: 'failed',
          retryable: false,
        }),
      );
      expect(JSON.stringify(h.queries)).not.toContain(SECRET);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    });

    it.each([
      ['no outputs', [], 1],
      ['more outputs than requested', [{ body: PNG }, { body: PNG }], 1],
      ['empty bytes', [{ body: Buffer.alloc(0) }], 1],
      ['bytes that are not an image', [{ body: MP4 }], 1],
      [
        'an output above the size limit',
        [
          {
            body: Buffer.concat([PNG, Buffer.alloc(CREATIVE_IMAGE_MAX_BYTES)]),
          },
        ],
        1,
      ],
      ['a non-buffer body', [{ body: 'https://cdn/x.png' }], 1],
      [
        'one bad output among good ones',
        [{ body: PNG }, { body: Buffer.from('<svg/>') }],
        2,
      ],
    ])(
      // CS3.3.1: the provider already returned (and may have billed) — a
      // retry would buy the same unusable answer again.
      'fails %s as FINAL invalid_output after one paid call, storing nothing but keeping usage',
      async (_label, outputs, outputCount) => {
        const provider = new FakeImageProvider();
        provider.next = () =>
          Promise.resolve({
            outputs: outputs as ImageGenerationProviderResult['outputs'],
            usage: {
              model: 'm',
              metrics: { images: 1 },
              cost: { amount: '0.04', currency: 'USD' },
            },
          });
        const h = harness(provider, claimed({ outputCount }));

        await h.worker.processPending();

        expect(h.provider.calls).toHaveLength(1);
        expect(failParams(h)).toEqual(
          expect.objectContaining({
            status: 'failed',
            code: 'invalid_output',
            retryable: false,
            provider: 'fake',
            metrics: JSON.stringify({ images: 1 }),
            amount: '0.04',
            currency: 'USD',
          }),
        );
        expect(h.terminal('fail')[0].params[3]).toBe('m');
        expect(h.mediaUpload.upload).not.toHaveBeenCalled();
      },
    );

    it('fails for good, keeping usage and removing stored outputs, when the upload cannot read a later one', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.resolve({
          outputs: [{ body: PNG }, { body: PNG }],
          usage: { model: 'm', metrics: { output_tokens: 3 }, cost: null },
        });
      const h = harness(provider, claimed({ outputCount: 2 }));
      h.mediaUpload.upload
        .mockResolvedValueOnce({ id: 'media-1' } as never)
        .mockRejectedValueOnce(new BadRequestException('unreadable'));

      await h.worker.processPending();

      expect(h.provider.calls).toHaveLength(1);
      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'failed',
          code: 'invalid_output',
          retryable: false,
          metrics: JSON.stringify({ output_tokens: 3 }),
        }),
      );
      expect(
        h.mediaUpload.removeAfterFailedConsumerOperation,
      ).toHaveBeenCalledWith(scopeA, 'media-1');
      expect(h.inserted).toEqual([]);
    });

    it("uses a provider's Retry-After only as a floor on the worker's own backoff, still capped", async () => {
      const cases: Array<[number | null, number, number]> = [
        // [retryAfter, attempts, expected delay]
        [null, 1, 30],
        [5, 1, 30], // shorter hint: our backoff wins
        [90, 1, 90], // longer hint: respected
        [5_000, 2, 600], // never beyond the cap
      ];
      for (const [retryAfterSeconds, attempts, expected] of cases) {
        const provider = new FakeImageProvider();
        provider.next = () =>
          Promise.reject(
            new ImageGenerationProviderError('rate_limited', true, {
              retryAfterSeconds: retryAfterSeconds ?? undefined,
            }),
          );
        const h = harness(provider, claimed({ attempts, maxAttempts: 3 }));
        await h.worker.processPending();
        expect(failParams(h)).toEqual(
          expect.objectContaining({ status: 'queued', delay: expected }),
        );
      }
    });

    it('records the usage a failing provider reports for a call it already paid', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.reject(
          new ImageGenerationProviderError('invalid_output', false, {
            usage: { model: 'm-1', metrics: { output_tokens: 7 }, cost: null },
          }),
        );
      const h = harness(provider);

      await h.worker.processPending();

      const params = h.terminal('fail')[0].params;
      expect(params[3]).toBe('m-1');
      expect(params[4]).toBe(JSON.stringify({ output_tokens: 7 }));
      expect(failParams(h)).toEqual(
        expect.objectContaining({ status: 'failed', retryable: false }),
      );
    });

    it('still writes the final failure when cleaning up stored outputs fails (no lease-expiry re-bill)', async () => {
      const provider = new FakeImageProvider();
      provider.next = () =>
        Promise.resolve({
          outputs: [{ body: PNG }, { body: PNG }],
          usage: null,
        });
      const h = harness(provider, claimed({ outputCount: 2 }));
      h.mediaUpload.upload
        .mockResolvedValueOnce({ id: 'media-1' } as never)
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));
      h.mediaUpload.removeAfterFailedConsumerOperation.mockRejectedValueOnce(
        new Error(`db down ${SECRET}`),
      );
      const warn = jest
        .spyOn(
          (h.worker as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await h.worker.processPending();

      expect(failParams(h)).toEqual(
        expect.objectContaining({ status: 'failed', retryable: false }),
      );
      expect(
        h.mediaUpload.removeAfterFailedConsumerOperation,
      ).toHaveBeenCalledWith(scopeA, 'media-1');
      expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    });

    it('treats a storage outage after a paid call as a final failure, not a silent re-bill', async () => {
      const h = harness();
      h.mediaUpload.upload.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      jest
        .spyOn(
          (h.worker as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await h.worker.processPending();

      expect(h.provider.calls).toHaveLength(1);
      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'failed',
          code: 'failed',
          retryable: false,
        }),
      );
    });
  });

  /**
   * CS3.3 — the real OpenAI adapter behind the port, with only `fetch`
   * faked: no network, no spend.
   */
  describe('with the OpenAI adapter (fetch faked)', () => {
    const openAiConfig = {
      openAiApiKey: SECRET,
      imageModel: 'gpt-image-2.5-flare-2026-09-08',
      imageTimeoutMs: 180_000,
    } as unknown as CreativeGenerationConfigService;
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

    const json = (status: number, body: unknown, headers = {}) =>
      new Response(JSON.stringify(body), { status, headers });

    it('runs a claimed generation to completed with openai provenance', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          data: [
            { b64_json: PNG.toString('base64') },
            { b64_json: PNG.toString('base64') },
          ],
          usage: {
            input_tokens: 40,
            output_tokens: 2_000,
            total_tokens: 2_040,
          },
        }),
      );
      const h = harness(
        new OpenAIImageGenerationProvider(openAiConfig),
        claimed({ outputCount: 2 }),
      );

      // queued → processing (claim) → completed (guarded terminal write)
      expect(await h.worker.processPending()).toBe(1);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(h.mediaUpload.upload).toHaveBeenCalledTimes(2);
      expect(
        (h.mediaUpload.upload.mock.calls[0][2].file.buffer as Buffer).equals(
          PNG,
        ),
      ).toBe(true);
      const [complete] = h.terminal('completed');
      expect(complete.params.slice(2)).toEqual([
        'openai',
        'gpt-image-2.5-flare-2026-09-08',
        JSON.stringify({
          images: 2,
          input_tokens: 40,
          output_tokens: 2_000,
          total_tokens: 2_040,
        }),
        null,
        null,
      ]);
      expect(h.inserted).toHaveLength(2);
      expect(h.terminal('fail')).toHaveLength(0);
      expect(logs.join('\n')).toMatch(
        /generation=gen-1 attempt=1\/3 provider=openai model=gpt-image-2\.5-flare-2026-09-08 outcome=completed durationMs=\d+/,
      );
    });

    it.each([
      [
        '429',
        json(
          429,
          { error: { code: 'rate_limit_exceeded' } },
          { 'retry-after': '120' },
        ),
        'queued',
        'rate_limited',
        true,
        120,
      ],
      [
        '503',
        json(503, { error: { code: 'server_is_overloaded' } }),
        'queued',
        'unavailable',
        true,
        30,
      ],
      [
        'moderation',
        json(400, { error: { code: 'moderation_blocked' } }),
        'failed',
        'rejected',
        false,
        30,
      ],
      [
        'bad key',
        json(401, { error: { code: 'invalid_api_key' } }),
        'failed',
        'unavailable',
        false,
        30,
      ],
      [
        'invalid request',
        json(400, { error: { code: 'invalid_value' } }),
        'failed',
        'failed',
        false,
        30,
      ],
      [
        'quota',
        json(429, { error: { code: 'insufficient_quota' } }),
        'failed',
        'unavailable',
        false,
        30,
      ],
    ])(
      '%s → %s/%s (retryable=%s)',
      async (_label, response, status, code, retryable, delay) => {
        fetchMock.mockResolvedValueOnce(response);
        const h = harness(new OpenAIImageGenerationProvider(openAiConfig));

        await h.worker.processPending();

        expect(failParams(h)).toEqual(
          expect.objectContaining({ status, code, retryable, delay }),
        );
        expect(h.mediaUpload.upload).not.toHaveBeenCalled();
      },
    );

    it('a 200 with well-formed base64 that is not an image fails for good after ONE call (CS3.3.1)', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          data: [{ b64_json: MP4.toString('base64') }],
          usage: { output_tokens: 1_100 },
        }),
      );
      const h = harness(new OpenAIImageGenerationProvider(openAiConfig));

      await h.worker.processPending();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'failed',
          code: 'invalid_output',
          retryable: false,
          provider: 'openai',
          metrics: JSON.stringify({ images: 1, output_tokens: 1_100 }),
          amount: null,
        }),
      );
      expect(h.mediaUpload.upload).not.toHaveBeenCalled();
    });

    it('retries a timeout through the queue, not inside the adapter', async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }),
      );
      const h = harness(new OpenAIImageGenerationProvider(openAiConfig));

      await h.worker.processPending();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'queued',
          code: 'timeout',
          retryable: true,
        }),
      );
    });

    it('fails a malformed paid answer for good, keeping its usage', async () => {
      fetchMock.mockResolvedValueOnce(
        json(200, {
          data: [{ url: 'https://x/y.png' }],
          usage: { output_tokens: 900 },
        }),
      );
      const h = harness(new OpenAIImageGenerationProvider(openAiConfig));

      await h.worker.processPending();

      expect(failParams(h)).toEqual(
        expect.objectContaining({
          status: 'failed',
          code: 'invalid_output',
          retryable: false,
          provider: 'openai',
          metrics: JSON.stringify({ images: 1, output_tokens: 900 }),
        }),
      );
    });

    it('never lets the key, prompt or provider text reach the database or logs', async () => {
      fetchMock.mockResolvedValueOnce(
        json(401, {
          error: {
            code: 'invalid_api_key',
            message: `Incorrect API key provided: ${SECRET} for café na mesa`,
          },
        }),
      );
      const h = harness(new OpenAIImageGenerationProvider(openAiConfig));

      await h.worker.processPending();

      const surface = JSON.stringify([h.queries, logs]);
      expect(surface).not.toContain(SECRET);
      expect(surface).not.toContain('Incorrect API key');
      expect(JSON.stringify(logs)).not.toContain('café na mesa');
    });
  });
});
