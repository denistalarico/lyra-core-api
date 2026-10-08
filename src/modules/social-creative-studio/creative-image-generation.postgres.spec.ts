import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
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
import { AddSocialCreativeGenerationContext1798100000000 } from '../../database/migrations/1798100000000-add-social-creative-generation-context';
import { CreateSocialContentReferences1798200000000 } from '../../database/migrations/1798200000000-create-social-content-references';
import { CreateSocialCreativeGenerationReferences1798300000000 } from '../../database/migrations/1798300000000-create-social-creative-generation-references';
import { AddSocialCreativeGenerationDerivation1798500000000 } from '../../database/migrations/1798500000000-add-social-creative-generation-derivation';
import { BrandKitAssetEntity, BrandKitEntity } from '../brand-kit/entities';
import { SocialBrandKitContextPort } from '../brand-kit/services/social-brand-kit-context.port';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  SocialContentItemEntity,
  SocialContentReferenceEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import {
  CREATIVE_IMAGE_MAX_BYTES,
  CreativeAssetService,
} from './creative-asset.service';
import type { CreativeStudioBrandContext } from './creative-brand-context.service';
import { CreativeGenerationConfigService } from './creative-generation-config';
import { CreativeGenerationContextService } from './creative-generation-context';
import { CreativeGenerationReferenceSelector } from './creative-generation-references';
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
  CreativeGenerationReferenceEntity,
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
  /** CS3.3.1: flips the metadata reader to the real reader's 400 for unreadable bytes. */
  let metadataReadable = true;
  const config = new CreativeGenerationConfigService();
  /**
   * CS3.4.1 — the context owners, stubbed at their public contracts: the
   * Brand Kit projection of the scope and the Planner's scoped `getContent`
   * (unknown or other-company ids answer 404, like the real one).
   */
  let brand: CreativeStudioBrandContext = {
    palette: [],
    typography: [],
    guidelines: null,
    assets: [],
    references: [],
  };
  const plannerItems = new Map<string, Record<string, unknown>>();
  const generationContext = new CreativeGenerationContextService(
    { load: async () => brand } as never,
    {
      getContent: async (scope: MediaAssetScope, id: string) => {
        const item = plannerItems.get(`${scope.companyContextId}:${id}`);
        if (!item) throw new NotFoundException();
        return item;
      },
    } as never,
    {
      // CS3.4.2: the item's real `social_content_references` rows, read at
      // their public contract's shape (identities only).
      listContentReferences: async (scope: MediaAssetScope, id: string) => {
        if (!plannerItems.has(`${scope.companyContextId}:${id}`))
          throw new NotFoundException();
        const rows = await db.query(
          `SELECT id, media_asset_id, kind, sort_order
             FROM social_content_references
            WHERE content_item_id = $1 ORDER BY sort_order`,
          [id],
        );
        return rows.map((r) => ({
          referenceId: r.id,
          mediaAssetId: r.media_asset_id,
          kind: r.kind,
          sortOrder: r.sort_order,
        }));
      },
    } as never,
  );
  /** CS3.4.2: the real Brand Kit port over this schema. */
  let brandKitPort: SocialBrandKitContextPort;
  let referenceSelector: CreativeGenerationReferenceSelector;

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
      brandKitPort,
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
          // CS3.4.1: FK target of `content_item_id`, inside the throwaway schema.
          SocialPlanEntity,
          SocialContentItemEntity,
          // CS3.4.2: Brand Kit owner tables (references of source `brand`).
          BrandKitEntity,
          BrandKitAssetEntity,
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
    await new AddSocialCreativeGenerationContext1798100000000().up(runner);
    await new CreateSocialContentReferences1798200000000().up(runner);
    await new CreateSocialCreativeGenerationReferences1798300000000().up(
      runner,
    );
    // CS3.6.2: the entity maps the origin columns.
    await new AddSocialCreativeGenerationDerivation1798500000000().up(runner);
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
          CreativeGenerationReferenceEntity,
          SocialPlanEntity,
          SocialContentItemEntity,
          SocialContentReferenceEntity,
          BrandKitEntity,
          BrandKitAssetEntity,
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
        extract: async () => {
          if (!metadataReadable)
            throw new BadRequestException('Não foi possível ler a imagem.');
          return {
            width: 8,
            height: 8,
            durationSeconds: null,
            codec: 'png',
          };
        },
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
    brandKitPort = new SocialBrandKitContextPort(
      db.getRepository(BrandKitEntity),
      db.getRepository(BrandKitAssetEntity),
      files as unknown as FilesService,
    );
    referenceSelector = new CreativeGenerationReferenceSelector(
      brandKitPort,
      mediaRepository,
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
      generationContext,
      referenceSelector,
      db.getRepository(CreativeGenerationReferenceEntity),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(() => {
    metadataReadable = true;
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
      // CS3.4.2's child table depends on it: peeled off first, put back last.
      const references =
        new CreateSocialCreativeGenerationReferences1798300000000();
      // CS3.6.2's origin FKs point at outputs and versions: peeled off first.
      const derivation =
        new AddSocialCreativeGenerationDerivation1798500000000();
      try {
        await runner.startTransaction();
        await migration.up(runner);
        await derivation.down(runner);
        await references.down(runner);
        await migration.down(runner);
        const tables = (await runner.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = $1 AND table_name LIKE 'social_creative_generation%'`,
          [schema],
        )) as unknown[];
        expect(tables).toHaveLength(0);
        await migration.up(runner);
        await references.up(runner);
        await derivation.up(runner);
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
          effective_prompt: 'x',
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
        // Retryable by the adapter's own classification, reporting usage
        // (the port allows it). Since CS3.3.1, outputs the worker rejects
        // after a successful call are never retried — see below.
        () =>
          Promise.reject(
            new ImageGenerationProviderError('rate_limited', true, {
              usage: {
                model: 'scripted-model',
                metrics: { images: 1 },
                cost: { amount: '0.040000', currency: 'USD' },
              },
            }),
          ),
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
          error_code: 'rate_limited',
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

    describe('paid output retry safety (CS3.3.1)', () => {
      it.each([
        [
          'bytes that are not an image',
          () => Buffer.from('not an image'),
          true,
        ],
        [
          'an output above the size limit',
          () => Buffer.concat([image, Buffer.alloc(CREATIVE_IMAGE_MAX_BYTES)]),
          true,
        ],
        ['bytes whose metadata cannot be read', () => image, false],
      ])(
        '%s: failed after ONE paid call, usage kept, never claimed again',
        async (_label, body, readable) => {
          metadataReadable = readable;
          provider.script.push(() =>
            Promise.resolve({
              outputs: [{ body: body() }],
              usage: {
                model: 'scripted-model',
                metrics: { images: 1, output_tokens: 1_000 },
                cost: null,
              },
            }),
          );
          const { generationId } = await enqueue(scopeA, { prompt: 'x' });

          expect(await worker('w-1').processPending()).toBe(1);
          const failed = await row(generationId);
          expect(failed).toEqual(
            expect.objectContaining({
              status: 'failed',
              attempts: 1,
              error_code: 'invalid_output',
              error_retryable: false,
              locked_by: null,
              provider: 'scripted',
              model: 'scripted-model',
              usage_metrics: { images: 1, output_tokens: 1_000 },
              cost_amount: null,
            }),
          );
          expect(failed.failed_at).not.toBeNull();

          // "Restart": fresh worker instances, even with the row made due,
          // never claim a failed generation again.
          await db.query(
            'UPDATE social_creative_generations SET available_at = now() WHERE id = $1',
            [generationId],
          );
          for (const id of ['w-restart-1', 'w-restart-2'])
            expect(await worker(id).processPending()).toBe(0);
          expect(await row(generationId)).toEqual(
            expect.objectContaining({
              status: 'failed',
              attempts: 1,
              usage_metrics: { images: 1, output_tokens: 1_000 },
            }),
          );
          expect(provider.calls).toHaveLength(1);
          // Nothing half-stored is left behind.
          const [{ count }] = await db.query(
            `SELECT count(*)::int AS count FROM media_assets
              WHERE metadata->>'generationId' = $1`,
            [generationId],
          );
          expect(count).toBe(0);
        },
      );

      it('the distinction holds: a timeout BEFORE any answer is still retried', async () => {
        provider.script.push(
          () =>
            Promise.reject(new ImageGenerationProviderError('timeout', true)),
          () => ok(1),
        );
        const { generationId } = await enqueue(scopeA, { prompt: 'x' });

        await worker('w-1').processPending();
        expect(await row(generationId)).toEqual(
          expect.objectContaining({ status: 'queued', attempts: 1 }),
        );
        await db.query(
          'UPDATE social_creative_generations SET available_at = now() WHERE id = $1',
          [generationId],
        );
        await worker('w-2').processPending();
        expect(await row(generationId)).toEqual(
          expect.objectContaining({ status: 'completed', attempts: 2 }),
        );
        expect(provider.calls).toHaveLength(2);
      });
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
          effective_prompt: 'x',
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
      // The provider receives the composed prompt (CS3.4.1); find the typed text in it.
      const forThisRequest = provider.calls.filter((c) =>
        c.prompt.includes(':\ncafé\n'),
      );
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
        generationContext,
        referenceSelector,
        db.getRepository(CreativeGenerationReferenceEntity),
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

  describe('generation context & provenance (CS3.4.1)', () => {
    async function plannerContent(scope: MediaAssetScope) {
      const plan = await db.getRepository(SocialPlanEntity).save({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        title: 'Plano de outubro',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
      const item = await db.getRepository(SocialContentItemEntity).save({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        planId: plan.id,
        title: 'Blend de inverno',
        brief: 'Café em clima aconchegante',
      });
      // What the Planner's scoped `getContent` answers — for this company only.
      plannerItems.set(`${scope.companyContextId}:${item.id}`, {
        ...item,
        currentRevisionId: null,
        destinations: [],
      });
      return item.id;
    }

    const generationsByKey = async (key: string) =>
      (
        await db.query(
          'SELECT count(*)::int AS n FROM social_creative_generations WHERE idempotency_key = $1',
          [key],
        )
      )[0].n as number;

    afterEach(() => {
      brand = {
        palette: [],
        typography: [],
        guidelines: null,
        assets: [],
        references: [],
      };
    });

    it('migration is re-runnable, reversible and backfills effective_prompt = prompt', async () => {
      const runner = db.createQueryRunner();
      const migration = new AddSocialCreativeGenerationContext1798100000000();
      const columns = async () =>
        (
          (await runner.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'social_creative_generations'
                AND column_name IN ('content_item_id', 'effective_prompt', 'generation_context')`,
            [schema],
          )) as unknown[]
        ).length;
      try {
        await runner.startTransaction();
        await migration.up(runner);
        expect(await columns()).toBe(3);
        await migration.down(runner);
        expect(await columns()).toBe(0);
        // A pre-CS3.4.1 row: the worker sent `prompt` verbatim.
        const [legacy] = await runner.query(
          `INSERT INTO social_creative_generations
             (tenant_id, workspace_id, agency_client_id, company_context_id,
              generation_type, prompt, output_count, aspect_ratio, quality, max_attempts)
           VALUES ($1, $2, $3, $4, 'image', 'pedido antigo', 1, '1:1', 'standard', 3)
           RETURNING id`,
          [tenantId, workspaceId, clientId, companyA],
        );
        await migration.up(runner);
        expect(await columns()).toBe(3);
        const [after] = await runner.query(
          `SELECT effective_prompt, generation_context, content_item_id
             FROM social_creative_generations WHERE id = $1`,
          [legacy.id],
        );
        expect(after).toEqual({
          effective_prompt: 'pedido antigo',
          generation_context: null,
          content_item_id: null,
        });
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('stores user prompt, effective prompt and context record apart; the worker sends the effective prompt', async () => {
      brand = {
        ...brand,
        palette: [{ role: 'primary', hex: '#0B3D2E', label: 'Verde' }],
      };
      const contentItemId = await plannerContent(scopeA);
      provider.calls.length = 0;
      provider.script.push(() => ok(1));

      const { generationId } = await enqueue(scopeA, {
        prompt: 'xícara na mesa',
        contentItemId,
      });
      await worker('w-ctx').processPending();
      const stored = await row(generationId);

      expect(stored.prompt).toBe('xícara na mesa');
      expect(stored.content_item_id).toBe(contentItemId);
      expect(stored.effective_prompt).toContain('xícara na mesa');
      expect(stored.effective_prompt).toContain('Café em clima aconchegante');
      expect(stored.effective_prompt).toContain('#0B3D2E');
      expect(stored.effective_prompt).not.toContain(contentItemId);
      expect(stored.generation_context).toEqual(
        expect.objectContaining({
          version: 'generation-context.v1',
          composer: 'image-prompt.v3',
          content: expect.objectContaining({ revisionId: null }),
          references: expect.objectContaining({ delivery: 'none' }),
        }),
      );
      expect(JSON.stringify(stored.generation_context)).not.toContain(
        'Café em clima',
      );
      expect(provider.calls).toEqual([
        expect.objectContaining({ prompt: stored.effective_prompt }),
      ]);
      expect((await generation.get(scopeA, generationId)).request).toEqual(
        expect.objectContaining({ prompt: 'xícara na mesa', contentItemId }),
      );
    });

    it('Company B cannot generate from a content item of Company A', async () => {
      const contentItemId = await plannerContent(scopeA);
      const key = randomUUID();
      const error = await enqueue(
        scopeB,
        { prompt: 'x', contentItemId },
        key,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(await generationsByKey(key)).toBe(0);
    });

    it('the same key over a changed Brand Kit is a 409, not a replay', async () => {
      const key = randomUUID();
      await enqueue(scopeA, { prompt: 'café' }, key);
      brand = { ...brand, guidelines: 'Sempre fundo claro.' };
      await expect(enqueue(scopeA, { prompt: 'café' }, key)).rejects.toThrow(
        ConflictException,
      );
      expect(await generationsByKey(key)).toBe(1);
    });

    it('the database refuses a Planner link without context and an empty effective prompt', async () => {
      const contentItemId = await plannerContent(scopeA);
      const { generationId } = await enqueue(scopeA, { prompt: 'café' });
      await expect(
        db.query(
          `UPDATE social_creative_generations
              SET content_item_id = $2, generation_context = NULL WHERE id = $1`,
          [generationId, contentItemId],
        ),
      ).rejects.toThrow(/CK_social_creative_generations_context/);
      await expect(
        db.query(
          `UPDATE social_creative_generations SET effective_prompt = '' WHERE id = $1`,
          [generationId],
        ),
      ).rejects.toThrow(/CK_social_creative_generations_context/);
    });

    it('removing the content item keeps the generation and its frozen prompt (FK SET NULL)', async () => {
      const contentItemId = await plannerContent(scopeA);
      const { generationId } = await enqueue(scopeA, {
        prompt: 'café',
        contentItemId,
      });
      const before = await row(generationId);
      await db.query('DELETE FROM social_content_items WHERE id = $1', [
        contentItemId,
      ]);
      const after = await row(generationId);
      expect(after.content_item_id).toBeNull();
      expect(after.effective_prompt).toBe(before.effective_prompt);
      expect(after.generation_context).toEqual(before.generation_context);
    });
  });

  /**
   * CS3.4.2 — reference images, end to end on PostgreSQL: owner rows of both
   * stores, the selector, the frozen child rows and their triggers, the
   * worker's verified read and the bytes the provider receives.
   */
  describe('reference images (CS3.4.2)', () => {
    const sha = (body: Buffer) =>
      createHash('sha256').update(body).digest('hex');
    let jpeg: Buffer;
    let webp: Buffer;

    beforeAll(async () => {
      jpeg = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#aa3300' },
      })
        .jpeg()
        .toBuffer();
      webp = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#0033aa' },
      })
        .webp()
        .toBuffer();
    });

    /** A durable library/Planner image, uploaded through the shared boundary. */
    const durable = (scope: MediaAssetScope, body: Buffer, name = 'ref.png') =>
      mediaUpload.upload(scope, null, {
        file: { buffer: body, originalname: name },
        source: 'planner_reference',
      });

    /** A Brand Kit asset of the scope's kit, bytes in the private store. */
    async function brandAsset(
      scope: MediaAssetScope,
      kind: string,
      body: Buffer,
    ) {
      await db.query(
        `INSERT INTO brand_kits (tenant_id, workspace_id, agency_client_id, company_context_id)
         SELECT $1, $2, $3, $4
          WHERE NOT EXISTS (
            SELECT 1 FROM brand_kits
             WHERE tenant_id = $1 AND workspace_id = $2
               AND agency_client_id IS NOT DISTINCT FROM $3
               AND company_context_id IS NOT DISTINCT FROM $4)`,
        [
          scope.tenantId,
          scope.workspaceId,
          scope.agencyClientId,
          scope.companyContextId,
        ],
      );
      const id = randomUUID();
      const path = `brand-kit/${id}.png`;
      objects.set(path, body);
      await db.query(
        `INSERT INTO brand_kit_assets
           (id, brand_kit_id, tenant_id, workspace_id, agency_client_id, kind, usage,
            storage_path, mime_type, byte_size, original_filename, checksum)
         SELECT $1, kit.id, $2, $3, $4, $6, 'asset', $7, 'image/png', $8, 'logo.png', $9
           FROM brand_kits kit
          WHERE kit.tenant_id = $2 AND kit.workspace_id = $3
            AND kit.agency_client_id IS NOT DISTINCT FROM $4
            AND kit.company_context_id IS NOT DISTINCT FROM $5`,
        [
          id,
          scope.tenantId,
          scope.workspaceId,
          scope.agencyClientId,
          scope.companyContextId,
          kind,
          path,
          body.length,
          sha(body),
        ],
      );
      return id;
    }

    /** A Planner item of the scope with its Visual References, in order. */
    async function itemWith(
      scope: MediaAssetScope,
      refs: Array<{ mediaAssetId: string; kind: string }>,
    ) {
      const plan = await db.getRepository(SocialPlanEntity).save({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        title: 'Plano',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
      const item = await db.getRepository(SocialContentItemEntity).save({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        planId: plan.id,
        title: 'Lançamento',
      });
      plannerItems.set(`${scope.companyContextId}:${item.id}`, {
        ...item,
        currentRevisionId: null,
        destinations: [],
      });
      for (const [sortOrder, ref] of refs.entries())
        await linkPlanner(
          scope,
          item.id,
          ref.mediaAssetId,
          ref.kind,
          sortOrder,
        );
      return item.id;
    }

    const linkPlanner = (
      scope: MediaAssetScope,
      itemId: string,
      mediaAssetId: string,
      kind: string,
      sortOrder: number,
    ) =>
      db.query(
        `INSERT INTO social_content_references
           (tenant_id, workspace_id, agency_client_id, company_context_id,
            content_item_id, media_asset_id, kind, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          scope.tenantId,
          scope.workspaceId,
          scope.agencyClientId,
          scope.companyContextId,
          itemId,
          mediaAssetId,
          kind,
          sortOrder,
        ],
      );

    const frozenRows = (generationId: string) =>
      db.query(
        `SELECT position, source, kind, role, brand_kit_asset_id, media_asset_id,
                mime_type, checksum, dispatch_started_at
           FROM social_creative_generation_references
          WHERE generation_id = $1 ORDER BY position`,
        [generationId],
      );

    async function badRequest(promise: Promise<unknown>) {
      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      return ((error as BadRequestException).getResponse() as { code: string })
        .code;
    }

    it('migration is re-runnable and reversible, and admits the new failure code', async () => {
      const runner = db.createQueryRunner();
      const migration =
        new CreateSocialCreativeGenerationReferences1798300000000();
      const exists = async () =>
        (
          (await runner.query(
            `SELECT 1 FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = 'social_creative_generation_references'`,
            [schema],
          )) as unknown[]
        ).length;
      try {
        await runner.startTransaction();
        await migration.up(runner);
        await migration.down(runner);
        expect(await exists()).toBe(0);
        await migration.up(runner);
        await migration.up(runner);
        expect(await exists()).toBe(1);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
      const { generationId } = await enqueue(scopeA, { prompt: 'x' });
      await db.query(
        `UPDATE social_creative_generations
            SET status = 'failed', failed_at = now(), error_code = 'reference_unavailable'
          WHERE id = $1`,
        [generationId],
      );
      expect((await row(generationId)).error_code).toBe(
        'reference_unavailable',
      );
    });

    it('brand only: an explicit Brand Kit logo is frozen, stamped as sent and delivered as its bytes', async () => {
      const logo = await brandAsset(scopeA, 'logo', image);
      provider.script.push(() => ok(1));
      const { generationId } = await enqueue(scopeA, {
        prompt: 'post com a marca',
        references: [{ source: 'brand', id: logo }],
      });
      await worker('w-ref').processPending();

      expect((await row(generationId)).status).toBe('completed');
      const [call] = provider.calls;
      expect(call.references).toHaveLength(1);
      expect(call.references[0]).toEqual(
        expect.objectContaining({ role: 'logo', mimeType: 'image/png' }),
      );
      expect(call.references[0].body.equals(image)).toBe(true);
      expect(call.prompt).toContain("- Image 1: the brand's logo");
      const [frozen] = await frozenRows(generationId);
      expect(frozen).toEqual(
        expect.objectContaining({
          source: 'brand',
          kind: 'logo',
          brand_kit_asset_id: logo,
          media_asset_id: null,
          checksum: sha(image),
          dispatch_started_at: expect.any(Date),
        }),
      );
      expect((await row(generationId)).generation_context.references).toEqual(
        expect.objectContaining({
          delivery: 'provider_reference_images',
          selected: expect.objectContaining({
            selection: 'explicit',
            count: 1,
            sources: { brand: 1 },
          }),
        }),
      );
      // Provenance through the API: owner ids only.
      const view = await generation.get(scopeA, generationId);
      expect(view.references).toEqual([
        expect.objectContaining({
          position: 0,
          source: 'brand',
          id: logo,
          kind: 'logo',
          dispatchStartedAt: expect.any(String),
        }),
      ]);
      expect(JSON.stringify(view)).not.toContain('brand-kit/');
    });

    it('planner only (default) and brand + planner + operator: distinct sources, exact order, exact bytes', async () => {
      const product = await durable(scopeA, jpeg, 'produto.jpg');
      const packshot = await durable(scopeA, webp, 'embalagem.webp');
      const library = await durable(scopeA, image, 'cozinha.png');
      const logo = await brandAsset(scopeA, 'logo', image);
      const itemId = await itemWith(scopeA, [
        { mediaAssetId: product.id, kind: 'product' },
        { mediaAssetId: packshot.id, kind: 'packaging' },
      ]);

      provider.script.push(
        () => ok(1),
        () => ok(1),
      );
      const byDefault = await enqueue(scopeA, {
        prompt: 'café',
        contentItemId: itemId,
      });
      const explicit = await enqueue(scopeA, {
        prompt: 'café',
        contentItemId: itemId,
        references: [
          { source: 'operator', id: library.id, kind: 'environment' },
          { source: 'planner', id: packshot.id },
          { source: 'brand', id: logo },
        ],
      });
      process.env.CREATIVE_GENERATION_WORKER_CONCURRENCY = '1';
      await worker('w-ref').processPending();
      await worker('w-ref').processPending();

      expect(provider.calls).toHaveLength(2);
      // Two references (default) vs three (explicit) tells the calls apart.
      const sent = (count: number) => {
        const call = provider.calls.find((c) => c.references.length === count);
        if (!call) throw new Error(`no call with ${count} references`);
        return call;
      };
      const first = sent(2);
      expect(first.references.map((r) => r.mimeType)).toEqual([
        'image/jpeg',
        'image/webp',
      ]);
      expect(first.references[0].body.equals(jpeg)).toBe(true);
      expect(first.references[1].body.equals(webp)).toBe(true);
      expect(
        (await frozenRows(byDefault.generationId)).map((r) => r.source),
      ).toEqual(['planner', 'planner']);

      const second = sent(3);
      expect(second.references.map((r) => [r.role, r.mimeType])).toEqual([
        ['context', 'image/png'],
        ['subject', 'image/webp'],
        ['logo', 'image/png'],
      ]);
      expect(second.references[1].body.equals(webp)).toBe(true);
      expect(
        (await frozenRows(explicit.generationId)).map((r) => [
          r.source,
          r.kind,
          r.media_asset_id ?? r.brand_kit_asset_id,
        ]),
      ).toEqual([
        ['operator', 'environment', library.id],
        ['planner', 'packaging', packshot.id],
        ['brand', 'logo', logo],
      ]);
    });

    it("Company B can never use Company A's references — service and database", async () => {
      const mediaA = await durable(scopeA, image);
      const logoA = await brandAsset(scopeA, 'logo', image);
      const itemA = await itemWith(scopeA, [
        { mediaAssetId: mediaA.id, kind: 'product' },
      ]);
      const itemB = await itemWith(scopeB, []);

      for (const references of [
        [{ source: 'brand' as const, id: logoA }],
        [
          {
            source: 'operator' as const,
            id: mediaA.id,
            kind: 'product' as const,
          },
        ],
        [{ source: 'planner' as const, id: mediaA.id }],
      ])
        expect(
          await badRequest(
            enqueue(scopeB, { prompt: 'x', contentItemId: itemB, references }),
          ),
        ).toBe('reference_not_found');
      // A's item is invisible to B altogether.
      expect(
        await badRequest(
          enqueue(scopeB, { prompt: 'x', contentItemId: itemA }),
        ),
      ).toBe('content_item_not_found');

      // Below the service: B's fresh generation pointing at A's binaries.
      const { generationId } = await enqueue(scopeB, { prompt: 'x' });
      for (const [source, column, id] of [
        ['operator', 'media_asset_id', mediaA.id],
        ['brand', 'brand_kit_asset_id', logoA],
      ])
        await expect(
          db.query(
            `INSERT INTO social_creative_generation_references
               (generation_id, position, source, kind, role, ${column}, mime_type, byte_size, checksum)
             VALUES ($1, 0, $2, 'logo', 'logo', $3, 'image/png', $4, $5)`,
            [generationId, source, id, image.length, sha(image)],
          ),
        ).rejects.toThrow(/scope/);
    });

    it('temporary outputs and deleted media are refused as references — service and database', async () => {
      const view = await completedGeneration(scopeA);
      const [{ media_asset_id: temporaryId }] = await db.query(
        'SELECT media_asset_id FROM social_creative_generation_outputs WHERE id = $1',
        [view.outputs[0].id],
      );
      const deleted = await durable(scopeA, image);
      await db.query(
        'UPDATE media_assets SET deleted_at = now() WHERE id = $1',
        [deleted.id],
      );

      for (const id of [temporaryId as string, deleted.id])
        expect(
          await badRequest(
            enqueue(scopeA, {
              prompt: 'x',
              references: [{ source: 'operator', id, kind: 'product' }],
            }),
          ),
        ).toBe('reference_not_found');

      const { generationId } = await enqueue(scopeA, { prompt: 'x' });
      for (const id of [temporaryId as string, deleted.id])
        await expect(
          db.query(
            `INSERT INTO social_creative_generation_references
               (generation_id, position, source, kind, role, media_asset_id, mime_type, byte_size, checksum)
             SELECT $1, 0, 'operator', 'product', 'subject', id, mime_type, byte_size, checksum
               FROM media_assets WHERE id = $2`,
            [generationId, id],
          ),
        ).rejects.toThrow(/durable image/);
    });

    it('frozen: a Planner change after enqueue does not change what the worker sends', async () => {
      const original = await durable(scopeA, jpeg, 'original.jpg');
      const replacement = await durable(scopeA, webp, 'nova.webp');
      const itemId = await itemWith(scopeA, [
        { mediaAssetId: original.id, kind: 'product' },
      ]);
      const { generationId } = await enqueue(scopeA, {
        prompt: 'café',
        contentItemId: itemId,
      });

      // The operator swaps the item's reference before the worker runs.
      await db.query(
        'DELETE FROM social_content_references WHERE content_item_id = $1',
        [itemId],
      );
      await linkPlanner(scopeA, itemId, replacement.id, 'style', 0);

      provider.script.push(() => ok(1));
      await worker('w-ref').processPending();
      expect((await row(generationId)).status).toBe('completed');
      const [call] = provider.calls;
      expect(call.references).toHaveLength(1);
      expect(call.references[0].body.equals(jpeg)).toBe(true);
      expect(call.references[0].role).toBe('subject');
      expect((await frozenRows(generationId))[0].media_asset_id).toBe(
        original.id,
      );
    });

    it('rows are immutable provenance; none can be added after enqueue, or with another checksum or item', async () => {
      const mediaA = await durable(scopeA, image);
      const other = await durable(scopeA, jpeg);
      const itemId = await itemWith(scopeA, [
        { mediaAssetId: mediaA.id, kind: 'product' },
      ]);
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
        contentItemId: itemId,
      });

      for (const sql of [
        `UPDATE social_creative_generation_references SET kind = 'style' WHERE generation_id = $1`,
        `UPDATE social_creative_generation_references SET checksum = repeat('0', 64) WHERE generation_id = $1`,
        `DELETE FROM social_creative_generation_references WHERE generation_id = $1`,
      ])
        await expect(db.query(sql, [generationId])).rejects.toThrow(
          /frozen|provenance/,
        );

      const insertFor = (
        target: string,
        id: string,
        source = 'operator',
        checksum?: string,
      ) =>
        db.query(
          `INSERT INTO social_creative_generation_references
             (generation_id, position, source, kind, role, media_asset_id, mime_type, byte_size, checksum)
           SELECT $1, 5, $3, 'product', 'subject', id, mime_type, byte_size, COALESCE($4, checksum)
             FROM media_assets WHERE id = $2`,
          [target, id, source, checksum ?? null],
        );
      // A fresh generation, but a checksum that is not the media's.
      const fresh = await enqueue(scopeA, {
        prompt: 'y',
        contentItemId: itemId,
        references: [],
      });
      await expect(
        insertFor(fresh.generationId, other.id, 'operator', '0'.repeat(64)),
      ).rejects.toThrow(/durable image/);
      // `planner` must be a reference of the generation's item.
      await expect(
        insertFor(fresh.generationId, other.id, 'planner'),
      ).rejects.toThrow(/content item/);
      // After the claim nothing can be added.
      provider.script.push(() => ok(1));
      await worker('w-ref').processPending();
      await expect(insertFor(generationId, other.id)).rejects.toThrow(
        /frozen at enqueue/,
      );
    });

    it('a pending generation holds its media; once terminal, the media is free and provenance stays', async () => {
      const mediaA = await durable(scopeA, image);
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
        references: [{ source: 'operator', id: mediaA.id, kind: 'product' }],
      });
      for (const sql of [
        'UPDATE media_assets SET deleted_at = now() WHERE id = $1',
        "UPDATE media_assets SET storage_path = 'elsewhere.png' WHERE id = $1",
        `UPDATE media_assets SET checksum = repeat('1', 64) WHERE id = $1`,
        'DELETE FROM media_assets WHERE id = $1',
      ])
        await expect(db.query(sql, [mediaA.id])).rejects.toThrow(
          /pending generation/,
        );

      provider.script.push(() => ok(1));
      await worker('w-ref').processPending();
      expect((await row(generationId)).status).toBe('completed');
      await db.query(
        'UPDATE media_assets SET deleted_at = now() WHERE id = $1',
        [mediaA.id],
      );
      await db.query('DELETE FROM media_assets WHERE id = $1', [mediaA.id]);
      const [kept] = await frozenRows(generationId);
      expect(kept).toEqual(
        expect.objectContaining({
          media_asset_id: mediaA.id,
          checksum: sha(image),
          dispatch_started_at: expect.any(Date),
        }),
      );
    });

    it('dispatch_started_at records an attempt started — not delivery — and keeps the first value across retries', async () => {
      const mediaA = await durable(scopeA, image);
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
        references: [{ source: 'operator', id: mediaA.id, kind: 'product' }],
      });
      // Attempt 1: no response came back (nothing provably received or paid).
      provider.script.push(() =>
        Promise.reject(new ImageGenerationProviderError('timeout', true)),
      );
      await worker('w-dispatch').processPending();
      const afterFirst = await row(generationId);
      expect(afterFirst).toEqual(
        expect.objectContaining({ status: 'queued', usage_metrics: null }),
      );
      const [{ dispatch_started_at: first }] = await frozenRows(generationId);
      expect(first).toEqual(expect.any(Date));

      // Write-once at the database too.
      await expect(
        db.query(
          `UPDATE social_creative_generation_references
              SET dispatch_started_at = now() + interval '1 hour'
            WHERE generation_id = $1`,
          [generationId],
        ),
      ).rejects.toThrow(/frozen at enqueue/);

      // Attempt 2 succeeds; the first start time is kept.
      await db.query(
        'UPDATE social_creative_generations SET available_at = now() WHERE id = $1',
        [generationId],
      );
      provider.script.push(() => ok(1));
      await worker('w-dispatch').processPending();
      expect((await row(generationId)).status).toBe('completed');
      const [{ dispatch_started_at: kept }] = await frozenRows(generationId);
      expect(kept).toEqual(first);
      expect(provider.calls).toHaveLength(2);
    });

    it('a lease lost before the stamp dispatches nothing and stamps nothing', async () => {
      const mediaA = await durable(scopeA, image);
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
        references: [{ source: 'operator', id: mediaA.id, kind: 'product' }],
      });
      const stale = worker('w-stale');
      // Another worker takes the generation over between claim and stamp.
      const original = (stale as unknown as { dataSource: DataSource })
        .dataSource;
      const takeover = Object.create(original) as DataSource;
      takeover.query = (async (sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE social_creative_generation_references'))
          await original.query(
            `UPDATE social_creative_generations SET locked_by = 'w-other' WHERE id = $1`,
            [generationId],
          );
        return original.query(sql, params);
      }) as DataSource['query'];
      (stale as unknown as { dataSource: DataSource }).dataSource = takeover;

      await stale.processPending();
      expect(provider.calls).toHaveLength(0);
      const [{ dispatch_started_at: stamp }] = await frozenRows(generationId);
      expect(stamp).toBeNull();
      expect(await row(generationId)).toEqual(
        expect.objectContaining({ status: 'processing', locked_by: 'w-other' }),
      );
    });

    it('a Brand Kit image deleted before the worker reads it fails the generation — nothing sent, nothing substituted', async () => {
      const logo = await brandAsset(scopeA, 'logo', image);
      const { generationId } = await enqueue(scopeA, {
        prompt: 'x',
        references: [{ source: 'brand', id: logo }],
      });
      // The Brand Kit's own delete: tombstone, object, row.
      await db.query(
        'UPDATE brand_kit_assets SET deleted_at = now() WHERE id = $1',
        [logo],
      );
      await db.query('DELETE FROM brand_kit_assets WHERE id = $1', [logo]);

      await worker('w-ref').processPending();
      expect(provider.calls).toHaveLength(0);
      expect(await row(generationId)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error_code: 'reference_unavailable',
          error_retryable: false,
          // No provider call: nothing used, nothing billed.
          usage_metrics: null,
          cost_amount: null,
        }),
      );
      const [kept] = await frozenRows(generationId);
      expect(kept).toEqual(
        expect.objectContaining({
          brand_kit_asset_id: logo,
          dispatch_started_at: null,
        }),
      );
      expect((await generation.get(scopeA, generationId)).error).toEqual(
        expect.objectContaining({
          code: 'image_generation_reference_unavailable',
          retryable: false,
        }),
      );
    });

    it('same key: same selection replays; another photo or another order is a 409', async () => {
      const a = await durable(scopeA, image);
      const b = await durable(scopeA, jpeg);
      const key = randomUUID();
      const pick = (...ids: string[]) =>
        enqueue(
          scopeA,
          {
            prompt: 'café',
            references: ids.map((id) => ({
              source: 'operator' as const,
              id,
              kind: 'product' as const,
            })),
          },
          key,
        );
      const first = await pick(a.id, b.id);
      expect(await pick(a.id, b.id)).toEqual(first);
      for (const ids of [[a.id], [b.id, a.id]])
        expect(await pick(...ids).catch((e: unknown) => e)).toBeInstanceOf(
          ConflictException,
        );
      expect(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM social_creative_generations WHERE idempotency_key = $1',
            [key],
          )
        )[0].n,
      ).toBe(1);
      expect(await frozenRows(first.generationId)).toHaveLength(2);
    });
  });
});
