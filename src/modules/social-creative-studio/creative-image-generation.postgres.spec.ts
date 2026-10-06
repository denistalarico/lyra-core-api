import {
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  MediaAssetEntity,
  MediaAssetResolverService,
  type MediaAssetScope,
  MediaAssetUploadService,
} from '../../common/media-assets';
import type { FilesService } from '../../common/files/files.service';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateSocialCreativeGenerations1797900000000 } from '../../database/migrations/1797900000000-create-social-creative-generations';
import { AddSocialCreativeGenerationIdempotency1798000000000 } from '../../database/migrations/1798000000000-add-social-creative-generation-idempotency';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  ImageGenerationProvider,
  ImageGenerationProviderError,
  type ImageGenerationProviderInput,
  type ImageGenerationProviderResult,
} from './creative-image-generation.provider';
import { CreativeImageGenerationService } from './creative-image-generation.service';
import { CreativeImageGenerationWorker } from './creative-image-generation.worker';
import { CREATIVE_GENERATION_MEDIA_SOURCE } from './creative-retention';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
} from './entities';

const run = describePostgresIntegration();

class ScriptedProvider extends ImageGenerationProvider {
  readonly id = 'scripted';
  readonly calls: ImageGenerationProviderInput[] = [];
  script: Array<() => Promise<ImageGenerationProviderResult>> = [];
  fallback: () => Promise<ImageGenerationProviderResult> = () =>
    Promise.reject(new Error('unscripted'));
  generate(input: ImageGenerationProviderInput) {
    this.calls.push(input);
    return (this.script.shift() ?? this.fallback)();
  }
}

/**
 * CS3.2 against real PostgreSQL: the migration's constraints and trigger, the
 * claim loop under real concurrent connections, the async lifecycle, company
 * isolation, retry persistence and promotion idempotency.
 *
 * Everything lives in a throwaway schema of the guarded `_test` database:
 * every pooled connection starts with `search_path = <schema>, public`, so the
 * worker's raw SQL, the triggers and the repositories all resolve inside it.
 * The schema is dropped at the end; no product table is touched.
 */
run('CS3.2 creative generation jobs (real PostgreSQL)', () => {
  const schema = `cs32_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const companyOther = randomUUID();
  const scopeA: MediaAssetScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientId,
    companyContextId: companyA,
  };
  const scopeB: MediaAssetScope = { ...scopeA, companyContextId: companyB };
  const agency: MediaAssetScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };

  let db: DataSource;
  let image: Buffer;
  const objects = new Map<string, Buffer>();
  let provider: ScriptedProvider;
  let mediaUpload: MediaAssetUploadService;
  let generation: CreativeImageGenerationService;
  const config = new CreativeGenerationConfigService();

  function options(entities: DataSourceOptions['entities'], name: string) {
    const base = getAgencyTypeOrmConfig() as Extract<
      DataSourceOptions,
      { type: 'postgres' }
    >;
    return {
      ...base,
      type: 'postgres' as const,
      name,
      entities,
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      schema,
      extra: { options: `-c search_path=${schema},public`, max: 8 },
    };
  }

  function worker(id: string) {
    const instance = new CreativeImageGenerationWorker(
      db,
      provider,
      mediaUpload,
      config,
    );
    (instance as unknown as { workerId: string }).workerId = id;
    return instance;
  }

  const ok = (count = 1): Promise<ImageGenerationProviderResult> =>
    Promise.resolve({
      outputs: Array.from({ length: count }, () => ({ body: image })),
      usage: {
        model: 'scripted-model',
        metrics: { images: count },
        cost: { amount: '0.040000', currency: 'USD' },
      },
    });

  /** Every call is a distinct intent unless a key is given (CS3.2.1). */
  const enqueue = (
    scope: MediaAssetScope,
    request: Parameters<CreativeImageGenerationService['enqueue']>[2],
    key: string = randomUUID(),
  ) => generation.enqueue(scope, null, request, key);

  async function row(id: string) {
    const [found] = await db.query(
      'SELECT * FROM social_creative_generations WHERE id = $1',
      [id],
    );
    return found;
  }

  async function completedGeneration(scope = scopeA, count = 1) {
    provider.script.push(() => ok(count));
    const { generationId } = await enqueue(scope, {
      prompt: 'café na mesa',
      outputCount: count,
    });
    await worker('w-setup').processPending();
    const view = await generation.get(scope, generationId);
    expect(view.status).toBe('completed');
    return view;
  }

  beforeAll(async () => {
    image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#c0ffee' },
    })
      .png()
      .toBuffer();

    const bootstrap = new DataSource(
      options(
        [
          MediaAssetEntity,
          CreativeAssetEntity,
          CreativeAssetVersionEntity,
          CreativeFolderEntity,
        ],
        `${schema}_bootstrap`,
      ),
    );
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.synchronize();
    await bootstrap.query(`
      CREATE TABLE agency_client_company_contexts (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        agency_client_id uuid NOT NULL,
        UNIQUE (id, tenant_id, workspace_id, agency_client_id)
      )`);
    await bootstrap.query(
      `INSERT INTO agency_client_company_contexts VALUES
         ($1,$4,$5,$6), ($2,$4,$5,$6), ($3,$4,$5,$7)`,
      [
        companyA,
        companyB,
        companyOther,
        tenantId,
        workspaceId,
        clientId,
        otherClientId,
      ],
    );
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialCreativeGenerations1797900000000().up(runner);
    await new AddSocialCreativeGenerationIdempotency1798000000000().up(runner);
    await runner.release();
    await bootstrap.destroy();

    db = new DataSource(
      options(
        [
          MediaAssetEntity,
          CreativeAssetEntity,
          CreativeAssetVersionEntity,
          CreativeFolderEntity,
          CreativeGenerationEntity,
          CreativeGenerationOutputEntity,
          SocialPlanEntity,
          SocialContentItemEntity,
        ],
        schema,
      ),
    );
    await db.initialize();

    const files = {
      uploadPrivateBuffer: async (input: { path: string; body: Buffer }) => {
        objects.set(input.path, input.body);
        return { path: input.path };
      },
      getPrivateAsset: async (path: string) => ({
        body: Readable.from([objects.get(path) ?? Buffer.alloc(0)]),
        contentType: 'image/png',
        cacheControl: 'private, no-store',
      }),
      deleteObject: async (input: { path: string }) => {
        objects.delete(input.path);
      },
    };
    const mediaRepository = db.getRepository(MediaAssetEntity);
    mediaUpload = new MediaAssetUploadService(
      mediaRepository,
      files as unknown as FilesService,
      {
        extract: async () => ({
          width: 8,
          height: 8,
          durationSeconds: null,
          codec: 'png',
        }),
      },
    );
    const assets = new CreativeAssetService(
      db.getRepository(CreativeAssetEntity),
      db.getRepository(CreativeAssetVersionEntity),
      db.getRepository(CreativeFolderEntity),
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialPlanEntity),
      db,
      mediaUpload,
      new MediaAssetResolverService(mediaRepository),
      new CreativeThumbnailService(mediaUpload),
      {} as never,
    );
    provider = new ScriptedProvider();
    generation = new CreativeImageGenerationService(
      provider,
      config,
      db.getRepository(CreativeGenerationEntity),
      db.getRepository(CreativeGenerationOutputEntity),
      mediaRepository,
      db.getRepository(CreativeAssetEntity),
      mediaUpload,
      assets,
      {} as never,
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(() => {
    provider.script = [];
    provider.calls.length = 0;
    provider.fallback = () => Promise.reject(new Error('unscripted'));
  });

  afterEach(async () => {
    delete process.env.CREATIVE_GENERATION_MAX_ATTEMPTS;
    delete process.env.CREATIVE_GENERATION_TENANT_CONCURRENCY;
    delete process.env.CREATIVE_GENERATION_WORKER_CONCURRENCY;
    // Leave no claimable work behind for the next test.
    await db.query(
      `UPDATE social_creative_generations
          SET status = 'failed', failed_at = now(), error_code = 'failed',
              locked_at = NULL, locked_by = NULL
        WHERE status IN ('queued', 'processing')`,
    );
  });

  describe('schema', () => {
    it('is re-runnable and reversible: up → up → down → up', async () => {
      const runner = db.createQueryRunner();
      const migration = new CreateSocialCreativeGenerations1797900000000();
      try {
        await runner.startTransaction();
        await migration.up(runner);
        await migration.down(runner);
        const tables = (await runner.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = $1 AND table_name LIKE 'social_creative_generation%'`,
          [schema],
        )) as unknown[];
        expect(tables).toHaveLength(0);
        await migration.up(runner);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('enforces company scope, request bounds and the lifecycle invariants', async () => {
      const insert = (columns: Record<string, unknown>) => {
        const all = {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          agency_client_id: clientId,
          company_context_id: companyA,
          generation_type: 'image',
          prompt: 'x',
          output_count: 1,
          aspect_ratio: '1:1',
          quality: 'standard',
          max_attempts: 3,
          ...columns,
        };
        const keys = Object.keys(all);
        return db.query(
          `INSERT INTO social_creative_generations (${keys.join(',')})
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
          Object.values(all),
        );
      };

      await expect(insert({})).resolves.toBeDefined();
      await expect(
        insert({ agency_client_id: null, company_context_id: null }),
      ).resolves.toBeDefined();
      for (const invalid of [
        { agency_client_id: null }, // company without client
        { agency_client_id: otherClientId }, // company of another client
        { company_context_id: randomUUID() }, // unknown company
        { generation_type: 'video' },
        { status: 'retrying' },
        { prompt: '' },
        { output_count: 5 },
        { aspect_ratio: '3:2' },
        { attempts: 4 }, // beyond max_attempts
        { status: 'processing' }, // processing without a lease
        { locked_by: 'w', locked_at: new Date() }, // lease while queued
        { status: 'completed' }, // without completed_at
        { status: 'failed', failed_at: new Date() }, // without error code
        { error_code: 'provider said: key sk-123' },
        { cost_amount: '1.00' }, // amount without currency
      ])
        await expect(insert(invalid)).rejects.toThrow();
    });

    it('holds outputs to temporary media of the generation scope and promotion to write-once', async () => {
      const view = await completedGeneration();
      const [output] = await db.query(
        'SELECT * FROM social_creative_generation_outputs WHERE id = $1',
        [view.outputs[0].id],
      );

      const otherMedia = await mediaUpload.upload(scopeB, null, {
        file: { buffer: image, originalname: 'b.png', mimetype: 'image/png' },
        source: CREATIVE_GENERATION_MEDIA_SOURCE,
      });
      const durableA = await mediaUpload.upload(scopeA, null, {
        file: { buffer: image, originalname: 'a.png', mimetype: 'image/png' },
        source: 'creative_studio',
      });
      const addOutput = (mediaAssetId: string) =>
        db.query(
          `INSERT INTO social_creative_generation_outputs
             (generation_id, output_index, media_asset_id) VALUES ($1, 3, $2)`,
          [output.generation_id, mediaAssetId],
        );
      await expect(addOutput(otherMedia.id)).rejects.toThrow(
        'temporary output of the generation scope',
      );
      await expect(addOutput(durableA.id)).rejects.toThrow(
        'temporary output of the generation scope',
      );
      await expect(addOutput(output.media_asset_id)).rejects.toThrow(); // UNIQUE media

      // Promotion target must be a version of an asset of the same scope.
      const assetB = await db.getRepository(CreativeAssetEntity).save({
        ...scopeB,
        name: 'B',
        assetType: 'image',
        sourceType: 'upload',
        status: 'ready',
        folderId: null,
        contentItemId: null,
        currentVersionId: null,
        metadata: {},
        createdById: null,
        archivedAt: null,
      });
      const versionB = await db.getRepository(CreativeAssetVersionEntity).save({
        creativeAssetId: assetB.id,
        versionNumber: 1,
        mediaAssetId: (
          await mediaUpload.upload(scopeB, null, {
            file: { buffer: image, originalname: 'v.png' },
            source: 'creative_studio',
          })
        ).id,
        thumbnailMediaAssetId: null,
        source: 'upload',
        createdById: null,
      });
      await expect(
        db.query(
          `UPDATE social_creative_generation_outputs
              SET promotion_kind = 'new_asset', promoted_creative_asset_id = $2,
                  promoted_version_id = $3, promoted_at = now()
            WHERE id = $1`,
          [output.id, assetB.id, versionB.id],
        ),
      ).rejects.toThrow('asset of the generation scope');

      // Real promotion, then any rewrite of it is refused.
      const promoted = await generation.promoteToNewAsset(
        scopeA,
        null,
        output.id,
        {},
      );
      await expect(
        db.query(
          `UPDATE social_creative_generation_outputs
              SET promotion_kind = 'version' WHERE id = $1`,
          [output.id],
        ),
      ).rejects.toThrow('write-once');
      await expect(
        db.query(
          `UPDATE social_creative_generation_outputs
              SET promotion_kind = NULL, promoted_creative_asset_id = NULL,
                  promoted_version_id = NULL, promoted_at = NULL
            WHERE id = $1`,
          [output.id],
        ),
      ).rejects.toThrow('write-once');
      expect(promoted.id).toBeDefined();

      // Cleanup of the temporary binary keeps the output and its provenance.
      await db.query('DELETE FROM media_assets WHERE id = $1', [
        output.media_asset_id,
      ]);
      const [after] = await db.query(
        'SELECT media_asset_id, promoted_version_id FROM social_creative_generation_outputs WHERE id = $1',
        [output.id],
      );
      expect(after.media_asset_id).toBeNull();
      expect(after.promoted_version_id).toBe(promoted.currentVersionId);
      // The owner learns the binary is gone; another company learns nothing.
      await expect(generation.readOutput(scopeA, output.id)).rejects.toThrow(
        GoneException,
      );
      await expect(generation.readOutput(scopeB, output.id)).rejects.toThrow(
        NotFoundException,
      );
      const reread = await generation.get(scopeA, view.generationId);
      expect(reread.outputs[0]).toEqual(
        expect.objectContaining({ available: false, contentPath: null }),
      );
      expect(reread.outputs[0].promotion).toEqual(
        expect.objectContaining({
          kind: 'new_asset',
          creativeAssetId: promoted.id,
        }),
      );
    });
  });

  describe('async lifecycle', () => {
    it('enqueue records queued in company A; the worker completes it outside the request', async () => {
      provider.script.push(() => ok(2));
      const accepted = await enqueue(scopeA, {
        prompt: 'café',
        outputCount: 2,
        aspectRatio: '4:5',
      });
      expect(accepted.status).toBe('queued');
      expect(provider.calls).toHaveLength(0);
      expect(await row(accepted.generationId)).toEqual(
        expect.objectContaining({
          status: 'queued',
          company_context_id: companyA,
          attempts: 0,
          max_attempts: 3,
        }),
      );
      expect((await generation.get(scopeA, accepted.generationId)).status).toBe(
        'queued',
      );

      expect(await worker('w-1').processPending()).toBe(1);

      const stored = await row(accepted.generationId);
      expect(stored).toEqual(
        expect.objectContaining({
          status: 'completed',
          attempts: 1,
          locked_by: null,
          provider: 'scripted',
          model: 'scripted-model',
          usage_metrics: { images: 2 },
          cost_amount: '0.040000',
          cost_currency: 'USD',
          error_code: null,
        }),
      );
      expect(stored.completed_at).not.toBeNull();
      expect(stored.started_at).not.toBeNull();

      const view = await generation.get(scopeA, accepted.generationId);
      expect(view.outputs.map((o) => [o.outputIndex, o.available])).toEqual([
        [0, true],
        [1, true],
      ]);
      const media = await db.query(
        `SELECT m.source, m.company_context_id
           FROM social_creative_generation_outputs o
           JOIN media_assets m ON m.id = o.media_asset_id
          WHERE o.generation_id = $1`,
        [accepted.generationId],
      );
      expect(media).toEqual([
        {
          source: CREATIVE_GENERATION_MEDIA_SOURCE,
          company_context_id: companyA,
        },
        {
          source: CREATIVE_GENERATION_MEDIA_SOURCE,
          company_context_id: companyA,
        },
      ]);
      // Still invisible to the shared media picker.
      const listed = (await mediaUpload.list(scopeA)).items.map((i) => i.id);
      for (const output of view.outputs)
        expect(listed).not.toContain(output.id);
    });

    it('isolates by company: B cannot read, download or promote A’s generation', async () => {
      const view = await completedGeneration(scopeA);
      const outputId = view.outputs[0].id;

      await expect(generation.get(scopeB, view.generationId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(generation.get(agency, view.generationId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(generation.readOutput(scopeB, outputId)).rejects.toThrow(
        NotFoundException,
      );
      const assetsBefore = await db.getRepository(CreativeAssetEntity).count();
      await expect(
        generation.promoteToNewAsset(scopeB, null, outputId, {}),
      ).rejects.toThrow(NotFoundException);
      expect(await db.getRepository(CreativeAssetEntity).count()).toBe(
        assetsBefore,
      );

      const { file } = await generation.readOutput(scopeA, outputId);
      const chunks: Buffer[] = [];
      for await (const chunk of file.body) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).equals(image)).toBe(true);
    });

    it('persists retries: retryable failure → queued with backoff and kept cost, then completes summing usage', async () => {
      provider.script.push(
        // Paid but unusable: a retryable invalid_output that still cost money.
        () =>
          Promise.resolve({
            outputs: [{ body: Buffer.from('not an image') }],
            usage: {
              model: 'scripted-model',
              metrics: { images: 1 },
              cost: { amount: '0.040000', currency: 'USD' },
            },
          }),
        () => ok(1),
      );
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
      });

      await worker('w-1').processPending();
      const waiting = await row(generationId);
      expect(waiting).toEqual(
        expect.objectContaining({
          status: 'queued',
          attempts: 1,
          error_code: 'invalid_output',
          error_retryable: true,
          locked_by: null,
          cost_amount: '0.040000',
        }),
      );
      expect(
        new Date(waiting.available_at as string).getTime(),
      ).toBeGreaterThan(Date.now() + 20_000);
      // Not yet due: the next cycle claims nothing.
      expect(await worker('w-1').processPending()).toBe(0);

      await db.query(
        'UPDATE social_creative_generations SET available_at = now() WHERE id = $1',
        [generationId],
      );
      await worker('w-2').processPending();
      expect(await row(generationId)).toEqual(
        expect.objectContaining({
          status: 'completed',
          attempts: 2,
          error_code: null,
          usage_metrics: { images: 2 },
          cost_amount: '0.080000',
        }),
      );
    });

    it('fails a non-retryable error at once and a retryable one after max attempts, never looping', async () => {
      provider.script.push(() =>
        Promise.reject(new ImageGenerationProviderError('rejected', false)),
      );
      const rejected = await enqueue(scopeA, { prompt: 'x' });
      await worker('w-1').processPending();
      expect(await row(rejected.generationId)).toEqual(
        expect.objectContaining({
          status: 'failed',
          attempts: 1,
          error_code: 'rejected',
          error_retryable: false,
        }),
      );
      expect(
        (await generation.get(scopeA, rejected.generationId)).error,
      ).toEqual(
        expect.objectContaining({
          code: 'image_generation_rejected',
          retryable: false,
        }),
      );

      process.env.CREATIVE_GENERATION_MAX_ATTEMPTS = '2';
      provider.fallback = () =>
        Promise.reject(new ImageGenerationProviderError('timeout', true));
      const flaky = await enqueue(scopeA, { prompt: 'x' });
      for (let cycle = 0; cycle < 4; cycle += 1) {
        await db.query(
          `UPDATE social_creative_generations SET available_at = now()
            WHERE id = $1 AND status = 'queued'`,
          [flaky.generationId],
        );
        await worker('w-1').processPending();
      }
      expect(await row(flaky.generationId)).toEqual(
        expect.objectContaining({
          status: 'failed',
          attempts: 2,
          error_code: 'timeout',
          error_retryable: true,
        }),
      );
      expect(provider.calls).toHaveLength(3); // 1 rejected + 2 timeouts
    });

    it('recovers a stale lease with attempts left and fails one that has none', async () => {
      const revivable = await enqueue(scopeA, { prompt: 'x' });
      const exhausted = await enqueue(scopeA, { prompt: 'y' });
      await db.query(
        `UPDATE social_creative_generations
            SET status = 'processing', locked_by = 'dead-worker',
                locked_at = now() - interval '11 minutes',
                attempts = CASE WHEN id = $1 THEN 1 ELSE max_attempts END
          WHERE id IN ($1, $2)`,
        [revivable.generationId, exhausted.generationId],
      );
      provider.script.push(() => ok(1));

      await worker('w-1').processPending();

      expect(await row(revivable.generationId)).toEqual(
        expect.objectContaining({ status: 'completed', attempts: 2 }),
      );
      expect(await row(exhausted.generationId)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error_code: 'timeout',
          locked_by: null,
        }),
      );
      expect(provider.calls).toHaveLength(1);
    });

    it('the claim alone never revives a stale lease whose attempts are spent', async () => {
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
      });
      await db.query(
        `UPDATE social_creative_generations
            SET status = 'processing', locked_by = 'dead-worker',
                locked_at = now() - interval '11 minutes', attempts = max_attempts
          WHERE id = $1`,
        [generationId],
      );
      const claimer = worker('w-1') as unknown as {
        claimOne(): Promise<string | null>;
      };

      await expect(claimer.claimOne()).resolves.toBeNull();
      expect(await row(generationId)).toEqual(
        expect.objectContaining({ locked_by: 'dead-worker' }),
      );
    });

    it('a worker that lost its lease writes nothing and removes its outputs', async () => {
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
      });
      provider.script.push(async () => {
        // Another worker took the generation over while this call ran.
        await db.query(
          `UPDATE social_creative_generations SET locked_by = 'w-other' WHERE id = $1`,
          [generationId],
        );
        return ok(1);
      });
      const before = await db.query(
        `SELECT count(*)::int AS n FROM media_assets WHERE source = $1`,
        [CREATIVE_GENERATION_MEDIA_SOURCE],
      );

      await worker('w-1').processPending();

      expect(await row(generationId)).toEqual(
        expect.objectContaining({ status: 'processing', locked_by: 'w-other' }),
      );
      const outputs = await db.query(
        'SELECT id FROM social_creative_generation_outputs WHERE generation_id = $1',
        [generationId],
      );
      expect(outputs).toHaveLength(0);
      const after = await db.query(
        `SELECT count(*)::int AS n FROM media_assets WHERE source = $1`,
        [CREATIVE_GENERATION_MEDIA_SOURCE],
      );
      expect(after[0].n).toBe(before[0].n);
    });
  });

  describe('concurrency', () => {
    it('two workers on separate connections never run the same generation twice', async () => {
      process.env.CREATIVE_GENERATION_WORKER_CONCURRENCY = '8';
      process.env.CREATIVE_GENERATION_TENANT_CONCURRENCY = '20';
      provider.fallback = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return ok(1);
      };
      const ids = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          enqueue(scopeA, { prompt: `p${i}` }).then((a) => a.generationId),
        ),
      );

      const claimed = await Promise.all([
        worker('w-a').processPending(),
        worker('w-b').processPending(),
      ]);

      expect(claimed[0] + claimed[1]).toBe(6);
      expect(provider.calls).toHaveLength(6);
      expect(new Set(provider.calls.map((c) => c.prompt)).size).toBe(6);
      for (const id of ids)
        expect(await row(id)).toEqual(
          expect.objectContaining({ status: 'completed', attempts: 1 }),
        );
    });

    it('caps the generations of one tenant in processing', async () => {
      process.env.CREATIVE_GENERATION_WORKER_CONCURRENCY = '3';
      process.env.CREATIVE_GENERATION_TENANT_CONCURRENCY = '1';
      provider.fallback = () => ok(1);
      for (let i = 0; i < 3; i += 1) await enqueue(scopeA, { prompt: `p${i}` });

      expect(await worker('w-a').processPending()).toBe(1);
    });

    it('promotes an output once under concurrent double clicks; repeats answer with the same asset', async () => {
      const view = await completedGeneration();
      const outputId = view.outputs[0].id;
      const count = async (table: string) =>
        (await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
      const assetsBefore = await count('social_creative_assets');
      const durableBefore = (
        await db.query(
          `SELECT count(*)::int AS n FROM media_assets WHERE source <> $1`,
          [CREATIVE_GENERATION_MEDIA_SOURCE],
        )
      )[0].n;

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          generation.promoteToNewAsset(scopeA, null, outputId, {
            name: 'Post café',
          }),
        ),
      );
      const again = await generation.promoteToNewAsset(
        scopeA,
        null,
        outputId,
        {},
      );

      expect(new Set([...results, again].map((a) => a.id)).size).toBe(1);
      expect(await count('social_creative_assets')).toBe(assetsBefore + 1);
      // One original + one thumbnail survive; losers' binaries were compensated.
      const durableAfter = (
        await db.query(
          `SELECT count(*)::int AS n FROM media_assets WHERE source <> $1`,
          [CREATIVE_GENERATION_MEDIA_SOURCE],
        )
      )[0].n;
      expect(durableAfter).toBe(durableBefore + 2);

      const asset = results[0];
      expect(asset).toEqual(
        expect.objectContaining({
          sourceType: 'generated',
          companyContextId: companyA,
        }),
      );
      // Provenance: version ← output ← generation, and the version's media is
      // a durable copy in A, never the temporary candidate.
      const [provenance] = await db.query(
        `SELECT g.id AS generation_id, o.promotion_kind, m.source,
                m.company_context_id, o.media_asset_id <> v.media_asset_id AS copied
           FROM social_creative_asset_versions v
           JOIN social_creative_generation_outputs o ON o.promoted_version_id = v.id
           JOIN social_creative_generations g ON g.id = o.generation_id
           JOIN media_assets m ON m.id = v.media_asset_id
          WHERE v.id = $1`,
        [asset.currentVersionId],
      );
      expect(provenance).toEqual({
        generation_id: view.generationId,
        promotion_kind: 'new_asset',
        source: 'creative_studio',
        company_context_id: companyA,
        copied: true,
      });

      // A different intent on the same output is refused.
      await expect(
        generation.promoteToVersion(scopeA, null, outputId, {
          assetId: asset.id,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('promotes into a new version once under concurrency', async () => {
      const first = await completedGeneration();
      const base = await generation.promoteToNewAsset(
        scopeA,
        null,
        first.outputs[0].id,
        {},
      );
      const second = await completedGeneration();
      const outputId = second.outputs[0].id;

      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          generation.promoteToVersion(scopeA, null, outputId, {
            assetId: base.id,
          }),
        ),
      );

      expect(new Set(results.map((v) => v.id)).size).toBe(1);
      expect(results[0].versionNumber).toBe(2);
      const versions = await db
        .getRepository(CreativeAssetVersionEntity)
        .countBy({ creativeAssetId: base.id });
      expect(versions).toBe(2);
      const [output] = await db.query(
        'SELECT promotion_kind, promoted_version_id FROM social_creative_generation_outputs WHERE id = $1',
        [outputId],
      );
      expect(output).toEqual({
        promotion_kind: 'version',
        promoted_version_id: results[0].id,
      });
    });
  });

  describe('request idempotency (CS3.2.1)', () => {
    const generationsWithKey = async (key: string) =>
      (
        await db.query(
          'SELECT count(*)::int AS n FROM social_creative_generations WHERE idempotency_key = $1',
          [key],
        )
      )[0].n as number;

    it('migration is re-runnable and reversible: up → up → down → up', async () => {
      const runner = db.createQueryRunner();
      const migration =
        new AddSocialCreativeGenerationIdempotency1798000000000();
      const columns = async () =>
        (
          (await runner.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'social_creative_generations'
                AND column_name IN ('idempotency_key', 'request_fingerprint')`,
            [schema],
          )) as unknown[]
        ).length;
      try {
        await runner.startTransaction();
        await migration.up(runner);
        expect(await columns()).toBe(2);
        await migration.down(runner);
        expect(await columns()).toBe(0);
        await migration.up(runner);
        expect(await columns()).toBe(2);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('the database alone refuses a duplicate key in the same scope, agency mode included', async () => {
      const fingerprint = 'a'.repeat(64);
      const insert = (columns: Record<string, unknown>) => {
        const all = {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          agency_client_id: null,
          company_context_id: null,
          generation_type: 'image',
          prompt: 'x',
          output_count: 1,
          aspect_ratio: '1:1',
          quality: 'standard',
          max_attempts: 3,
          idempotency_key: 'raw-key',
          request_fingerprint: fingerprint,
          ...columns,
        };
        const keys = Object.keys(all);
        return db.query(
          `INSERT INTO social_creative_generations (${keys.join(',')})
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
          Object.values(all),
        );
      };

      await insert({});
      // NULL client/company must collide too (COALESCE in the index).
      await expect(insert({})).rejects.toThrow(
        'UQ_social_creative_generations_idempotency',
      );
      // Other scopes: free to reuse the string.
      await insert({
        agency_client_id: clientId,
        company_context_id: companyA,
      });
      await insert({
        agency_client_id: clientId,
        company_context_id: companyB,
      });
      await insert({ tenant_id: randomUUID() });
      await insert({ workspace_id: randomUUID() });
      await expect(
        insert({ agency_client_id: clientId, company_context_id: companyA }),
      ).rejects.toThrow('UQ_social_creative_generations_idempotency');
      // Pre-CS3.2.1 rows (no key) never collide.
      await insert({ idempotency_key: null, request_fingerprint: null });
      await insert({ idempotency_key: null, request_fingerprint: null });

      for (const invalid of [
        { idempotency_key: 'k-only', request_fingerprint: null },
        { idempotency_key: null },
        { idempotency_key: 'bad key' },
        { idempotency_key: 'x'.repeat(181) },
        { idempotency_key: 'fp', request_fingerprint: 'Z'.repeat(64) },
      ])
        await expect(insert(invalid)).rejects.toThrow(
          /CK_social_creative_generations_idempotency|value too long/,
        );
    });

    it('same scope, key and request → the same generation; another request → 409', async () => {
      const key = randomUUID();
      const first = await enqueue(
        scopeA,
        { prompt: 'café', outputCount: 2 },
        key,
      );
      const again = await enqueue(
        scopeA,
        { prompt: '  café ', outputCount: 2, aspectRatio: '1:1' },
        key,
      );
      expect(again).toEqual(first);

      for (const different of [
        { prompt: 'chá', outputCount: 2 },
        { prompt: 'café', outputCount: 4 },
        { prompt: 'café', outputCount: 2, quality: 'high' as const },
      ]) {
        const error = await enqueue(scopeA, different, key).catch(
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual(
          expect.objectContaining({ code: 'idempotency_key_conflict' }),
        );
      }
      expect(await generationsWithKey(key)).toBe(1);
      expect(await row(first.generationId)).toEqual(
        expect.objectContaining({ status: 'queued', prompt: 'café' }),
      );
    });

    it('another company, client mode vs agency, or another tenant: independent generations', async () => {
      const key = randomUUID();
      const otherTenant: MediaAssetScope = {
        ...agency,
        tenantId: randomUUID(),
      };
      const results: Awaited<ReturnType<typeof enqueue>>[] = [];
      for (const scope of [scopeA, scopeB, agency, otherTenant])
        results.push(await enqueue(scope, { prompt: 'café' }, key));

      expect(new Set(results.map((r) => r.generationId)).size).toBe(4);
      expect(await generationsWithKey(key)).toBe(4);
      // Each is visible only in its own scope.
      await expect(
        generation.get(scopeB, results[0].generationId),
      ).rejects.toThrow(NotFoundException);
      expect(
        (await generation.get(scopeB, results[1].generationId)).status,
      ).toBe('queued');
    });

    it('10 concurrent requests with one key → 1 generation, 10 identical answers, 1 provider call', async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          enqueue(scopeA, { prompt: 'café', outputCount: 1 }, key),
        ),
      );

      expect(new Set(results.map((r) => r.generationId)).size).toBe(1);
      expect(results.every((r) => r.status === 'queued')).toBe(true);
      expect(await generationsWithKey(key)).toBe(1);

      process.env.CREATIVE_GENERATION_WORKER_CONCURRENCY = '8';
      provider.fallback = () => ok(1);
      await Promise.all([
        worker('w-a').processPending(),
        worker('w-b').processPending(),
      ]);
      const forThisRequest = provider.calls.filter((c) => c.prompt === 'café');
      expect(forThisRequest).toHaveLength(1);
      expect(await row(results[0].generationId)).toEqual(
        expect.objectContaining({ status: 'completed', attempts: 1 }),
      );
    });

    it('concurrent requests with one key but two payloads → 1 generation, the rest 409', async () => {
      const key = randomUUID();
      const settled = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          enqueue(scopeA, { prompt: i % 2 ? 'café' : 'chá' }, key),
        ),
      );

      expect(await generationsWithKey(key)).toBe(1);
      const [stored] = await db.query(
        'SELECT id, prompt FROM social_creative_generations WHERE idempotency_key = $1',
        [key],
      );
      settled.forEach((result, i) => {
        const prompt = i % 2 ? 'café' : 'chá';
        if (prompt === stored.prompt) {
          expect(result).toEqual({
            status: 'fulfilled',
            value: expect.objectContaining({ generationId: stored.id }),
          });
        } else {
          expect(result.status).toBe('rejected');
          expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
            ConflictException,
          );
        }
      });
    });

    it('a failed generation replays as failed: no new row, no reset, no provider call', async () => {
      const key = randomUUID();
      provider.script.push(() =>
        Promise.reject(new ImageGenerationProviderError('rejected', false)),
      );
      const first = await enqueue(scopeA, { prompt: 'café' }, key);
      await worker('w-1').processPending();
      const failed = await row(first.generationId);
      expect(failed).toEqual(
        expect.objectContaining({ status: 'failed', attempts: 1 }),
      );

      const replay = await enqueue(scopeA, { prompt: 'café' }, key);

      expect(replay).toEqual({
        generationId: first.generationId,
        status: 'failed',
        statusPath: first.statusPath,
      });
      expect(await generationsWithKey(key)).toBe(1);
      expect(await row(first.generationId)).toEqual(failed);
      expect(await worker('w-1').processPending()).toBe(0);
      expect(provider.calls).toHaveLength(1);
    });

    it('a completed generation replays as completed, from a fresh service instance (no process memory)', async () => {
      const key = randomUUID();
      provider.script.push(() => ok(1));
      const first = await enqueue(scopeA, { prompt: 'café' }, key);
      await worker('w-1').processPending();
      const completed = await row(first.generationId);
      expect(completed.status).toBe('completed');

      // A "restarted" API: new service, nothing shared but the database.
      const restarted = new CreativeImageGenerationService(
        provider,
        new CreativeGenerationConfigService(),
        db.getRepository(CreativeGenerationEntity),
        db.getRepository(CreativeGenerationOutputEntity),
        db.getRepository(MediaAssetEntity),
        db.getRepository(CreativeAssetEntity),
        mediaUpload,
        {} as never,
        {} as never,
      );
      const replay = await restarted.enqueue(
        scopeA,
        null,
        { prompt: 'café' },
        key,
      );

      expect(replay).toEqual({
        generationId: first.generationId,
        status: 'completed',
        statusPath: first.statusPath,
      });
      expect(await generationsWithKey(key)).toBe(1);
      expect(await row(first.generationId)).toEqual(completed);
      expect(await worker('w-1').processPending()).toBe(0);
      expect(provider.calls).toHaveLength(1);
    });
  });
});
