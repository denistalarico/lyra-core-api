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
import { AddCreativeGenerationCleanupIndexes1798400000000 } from '../../database/migrations/1798400000000-add-creative-generation-cleanup-indexes';
import { AddSocialCreativeGenerationDerivation1798500000000 } from '../../database/migrations/1798500000000-add-social-creative-generation-derivation';
import { CreateSocialCreativeVideoGenerations1798600000000 } from '../../database/migrations/1798600000000-create-social-creative-video-generations';
import { BrandKitAssetEntity, BrandKitEntity } from '../brand-kit/entities';
import { SocialBrandKitContextPort } from '../brand-kit/services/social-brand-kit-context.port';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  SocialContentItemEntity,
  SocialContentReferenceEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { CreativeAssetService } from './creative-asset.service';
import type { CreativeStudioBrandContext } from './creative-brand-context.service';
import { CreativeGenerationCleanupWorker } from './creative-generation-cleanup.worker';
import { CreativeGenerationConfigService } from './creative-generation-config';
import { CreativeGenerationContextService } from './creative-generation-context';
import { CreativeGenerationReferenceSelector } from './creative-generation-references';
import {
  ImageGenerationProvider,
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

const DAY = 86_400_000;

/** Records every input; each call answers with the next image of `images`. */
class RecordingProvider extends ImageGenerationProvider {
  readonly id = 'scripted';
  readonly calls: ImageGenerationProviderInput[] = [];
  images: Buffer[] = [];
  generate(input: ImageGenerationProviderInput) {
    this.calls.push(input);
    const body = this.images[(this.calls.length - 1) % this.images.length];
    return Promise.resolve<ImageGenerationProviderResult>({
      outputs: Array.from({ length: input.outputCount }, () => ({ body })),
      usage: {
        model: 'scripted-model',
        metrics: { images: input.outputCount, input_image_tokens: 10 },
        cost: null,
      },
    });
  }
}

const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');

/**
 * CS3.6.2 against real PostgreSQL: regeneration and variations end to end —
 * the derivation migration's CHECK and triggers, the base frozen as Image 1,
 * the exact bytes the provider receives, Company Context, idempotency, and
 * the interaction with the CS3.6.1 cleanup (a base held by a pending
 * variation never expires; afterwards its normal lifecycle resumes).
 *
 * Same harness as the CS3.2/CS3.6.1 specs: a throwaway schema of the guarded
 * `_test` database, real services, in-memory storage, a scripted provider —
 * zero network.
 */
run('CS3.6.2 regeneration & variations (real PostgreSQL)', () => {
  const schema = `cs362_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const scopeA: MediaAssetScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientId,
    companyContextId: companyA,
  };
  const scopeB: MediaAssetScope = { ...scopeA, companyContextId: companyB };

  let db: DataSource;
  let imageA: Buffer;
  let imageB: Buffer;
  let imageC: Buffer;
  const objects = new Map<string, Buffer>();
  let mediaUpload: MediaAssetUploadService;
  let assets: CreativeAssetService;
  let generation: CreativeImageGenerationService;
  let provider: RecordingProvider;
  const config = new CreativeGenerationConfigService();
  let brand: CreativeStudioBrandContext;
  const plannerItems = new Map<string, Record<string, unknown>>();

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

  const worker = () =>
    new CreativeImageGenerationWorker(
      db,
      provider,
      mediaUpload,
      config,
      {} as never,
    );
  const cleanup = () =>
    new CreativeGenerationCleanupWorker(db, mediaUpload, config);
  const later = (days: number) => new Date(Date.now() + days * DAY);
  const key = () => randomUUID();

  async function completed(
    scope: MediaAssetScope,
    extra: Record<string, unknown> = {},
  ) {
    const { generationId } = await generation.enqueue(
      scope,
      null,
      { prompt: 'café na mesa', ...extra },
      key(),
    );
    await worker().processPending();
    const view = await generation.get(scope, generationId);
    expect(view.status).toBe('completed');
    return view;
  }

  async function finish(scope: MediaAssetScope, generationId: string) {
    await worker().processPending();
    return generation.get(scope, generationId);
  }

  const row = async (table: string, id: string) =>
    (await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]))[0];
  const frozenRows = (generationId: string) =>
    db.query(
      `SELECT position, source, kind, role, media_asset_id, checksum
         FROM social_creative_generation_references
        WHERE generation_id = $1 ORDER BY position`,
      [generationId],
    );
  const outputMedia = async (outputId: string) =>
    (await row('social_creative_generation_outputs', outputId))
      .media_asset_id as string | null;

  /** Everything a generation is: row, references, outputs. */
  const snapshot = async (generationId: string) => ({
    generation: await row('social_creative_generations', generationId),
    references: await db.query(
      'SELECT * FROM social_creative_generation_references WHERE generation_id = $1 ORDER BY position',
      [generationId],
    ),
    outputs: await db.query(
      'SELECT * FROM social_creative_generation_outputs WHERE generation_id = $1 ORDER BY output_index',
      [generationId],
    ),
  });

  const durable = (scope: MediaAssetScope, body: Buffer) =>
    mediaUpload.upload(scope, null, {
      file: { buffer: body, originalname: 'ref.png' },
      source: 'planner_reference',
    });

  async function versionOf(scope: MediaAssetScope, body: Buffer) {
    const asset = await assets.upload(scope, null, {
      file: {
        buffer: body,
        originalname: 'criativo.png',
        mimetype: 'image/png',
        size: body.length,
      },
    });
    const [version] = await db.query(
      'SELECT id, media_asset_id FROM social_creative_asset_versions WHERE creative_asset_id = $1',
      [asset.id],
    );
    return {
      assetId: asset.id,
      versionId: version.id as string,
      mediaId: version.media_asset_id as string,
    };
  }

  async function plannerItem(scope: MediaAssetScope) {
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
      title: 'Blend de inverno',
      brief: 'Café em clima aconchegante',
    });
    plannerItems.set(`${scope.companyContextId}:${item.id}`, {
      ...item,
      currentRevisionId: null,
      destinations: [],
    });
    return item.id;
  }

  async function failure(promise: Promise<unknown>) {
    const error = (await promise.catch((e: unknown) => e)) as {
      getStatus?: () => number;
      getResponse?: () => unknown;
    };
    expect(error?.getStatus).toBeDefined();
    const body = error.getResponse?.() as { code?: string } | undefined;
    return { status: error.getStatus?.(), code: body?.code, body };
  }

  beforeAll(async () => {
    const solid = (background: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .png()
        .toBuffer();
    [imageA, imageB, imageC] = await Promise.all([
      solid('#c0ffee'),
      solid('#ff00aa'),
      solid('#123456'),
    ]);

    const bootstrap = new DataSource(
      options(
        [
          MediaAssetEntity,
          CreativeAssetEntity,
          CreativeAssetVersionEntity,
          CreativeFolderEntity,
          SocialPlanEntity,
          SocialContentItemEntity,
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
      `INSERT INTO agency_client_company_contexts VALUES ($1,$3,$4,$5), ($2,$3,$4,$5)`,
      [companyA, companyB, tenantId, workspaceId, clientId],
    );
    for (const table of [
      'social_publications',
      'social_publication_media',
      'social_destination_creatives',
    ])
      await bootstrap.query(`
        CREATE TABLE ${table} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          media_asset_id uuid NOT NULL REFERENCES media_assets (id) ON DELETE RESTRICT
        )`);
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialCreativeGenerations1797900000000().up(runner);
    await new AddSocialCreativeGenerationIdempotency1798000000000().up(runner);
    await new AddSocialCreativeGenerationContext1798100000000().up(runner);
    await new CreateSocialContentReferences1798200000000().up(runner);
    await new CreateSocialCreativeGenerationReferences1798300000000().up(
      runner,
    );
    await new AddCreativeGenerationCleanupIndexes1798400000000().up(runner);
    await new AddSocialCreativeGenerationDerivation1798500000000().up(runner);
    // CS4-B: the cleanup sweeps the Reel family too; production has both.
    await new CreateSocialCreativeVideoGenerations1798600000000().up(runner);
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
      getPrivateAsset: async (path: string) => {
        const body = objects.get(path);
        if (!body) throw new NotFoundException('Asset not found.');
        return {
          body: Readable.from([body]),
          contentType: 'image/png',
          cacheControl: 'private, no-store',
        };
      },
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
    assets = new CreativeAssetService(
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
    const context = new CreativeGenerationContextService(
      { load: async () => brand } as never,
      {
        getContent: async (scope: MediaAssetScope, id: string) => {
          const item = plannerItems.get(`${scope.companyContextId}:${id}`);
          if (!item) throw new NotFoundException();
          return item;
        },
      } as never,
      {
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
    const brandKitPort = new SocialBrandKitContextPort(
      db.getRepository(BrandKitEntity),
      db.getRepository(BrandKitAssetEntity),
      files as unknown as FilesService,
    );
    provider = new RecordingProvider();
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
      context,
      new CreativeGenerationReferenceSelector(brandKitPort, mediaRepository),
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
    provider.calls.length = 0;
    provider.images = [imageA];
    brand = {
      palette: [],
      typography: [],
      guidelines: null,
      assets: [],
      references: [],
    };
  });

  afterEach(async () => {
    delete process.env.CREATIVE_GENERATION_CLEANUP_ENABLED;
    delete process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN;
    await db.query(
      `UPDATE social_creative_generations
          SET status = 'failed', failed_at = now(), error_code = 'failed',
              locked_at = NULL, locked_by = NULL
        WHERE status IN ('queued', 'processing')`,
    );
    // The sweep is global: every test starts without temporaries.
    await db.query('DELETE FROM media_assets WHERE source = $1', [
      CREATIVE_GENERATION_MEDIA_SOURCE,
    ]);
  });

  describe('schema', () => {
    it('is re-runnable and reversible: up → up → down → up', async () => {
      const runner = db.createQueryRunner();
      const migration =
        new AddSocialCreativeGenerationDerivation1798500000000();
      try {
        await runner.startTransaction();
        await migration.up(runner);
        await migration.down(runner);
        const columns = (await runner.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'social_creative_generations'
              AND column_name LIKE 'origin_%'`,
          [schema],
        )) as unknown[];
        expect(columns).toHaveLength(0);
        await migration.up(runner);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('down refuses while a base reference exists (provenance is never narrowed away)', async () => {
      const source = await completed(scopeA);
      await generation.varyOutput(
        scopeA,
        null,
        source.outputs[0].id,
        { prompt: 'mais luz' },
        key(),
      );
      const runner = db.createQueryRunner();
      try {
        await runner.startTransaction();
        await expect(
          new AddSocialCreativeGenerationDerivation1798500000000().down(runner),
        ).rejects.toThrow(/vocabulary/);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('one exact origin of the declared type, same scope, finished, immutable', async () => {
      const source = await completed(scopeA);
      const { versionId } = await versionOf(scopeA, imageB);
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
      const outputId = source.outputs[0].id;
      for (const invalid of [
        { origin_type: 'regeneration' }, // no origin
        { origin_type: 'fresh', origin_generation_id: source.generationId },
        { origin_type: 'variation', origin_generation_id: source.generationId },
        // two origins: "Generation A + Version C"
        {
          origin_type: 'variation',
          origin_output_id: outputId,
          origin_version_id: versionId,
        },
        { origin_type: 'remix', origin_generation_id: source.generationId },
      ])
        await expect(insert(invalid)).rejects.toThrow(/CK_|violates check/);

      // Another company's origin is refused by the database itself.
      for (const foreign of [
        {
          origin_type: 'regeneration',
          origin_generation_id: source.generationId,
        },
        { origin_type: 'variation', origin_output_id: outputId },
        { origin_type: 'variation', origin_version_id: versionId },
      ])
        await expect(
          insert({ ...foreign, company_context_id: companyB }),
        ).rejects.toThrow(/finished entity of the generation scope/);

      // A pending generation is not a regeneration origin.
      const [pending] = await insert({});
      await expect(
        insert({
          origin_type: 'regeneration',
          origin_generation_id: pending.id,
        }),
      ).rejects.toThrow(/finished entity/);

      // A variation without its base never commits (deferred check).
      await expect(
        insert({ origin_type: 'variation', origin_output_id: outputId }),
      ).rejects.toThrow(/must freeze its base/);

      // The origin of an existing row cannot be rewritten.
      const derived = await generation.regenerate(
        scopeA,
        null,
        source.generationId,
        {},
        key(),
      );
      await expect(
        db.query(
          `UPDATE social_creative_generations SET origin_generation_id = $2 WHERE id = $1`,
          [derived.generationId, pending.id],
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.query(
          `UPDATE social_creative_generations SET origin_type = 'fresh', origin_generation_id = NULL WHERE id = $1`,
          [derived.generationId],
        ),
      ).rejects.toThrow(/immutable/);
    });

    it('the base is Image 1, the exact media of the origin, and only for a derived generation', async () => {
      const source = await completed(scopeA);
      const other = await completed(scopeA);
      const baseMedia = (await outputMedia(source.outputs[0].id)) as string;
      const otherMedia = (await outputMedia(other.outputs[0].id)) as string;
      const variation = await generation.varyOutput(
        scopeA,
        null,
        source.outputs[0].id,
        { prompt: 'mais luz' },
        key(),
      );
      const fresh = await generation.enqueue(
        scopeA,
        null,
        { prompt: 'x', references: [] },
        key(),
      );
      const media = await row('media_assets', baseMedia);
      const insert = (
        generationId: string,
        mediaId: string,
        position = 1,
        source = 'base',
      ) =>
        db.query(
          `INSERT INTO social_creative_generation_references
             (generation_id, position, source, kind, role, media_asset_id, mime_type, byte_size, checksum)
           SELECT $1, $3, $4::varchar, CASE WHEN $4::varchar = 'base' THEN 'base' ELSE 'product' END,
                  CASE WHEN $4::varchar = 'base' THEN 'base' ELSE 'subject' END,
                  id, mime_type, byte_size, checksum
             FROM media_assets WHERE id = $2`,
          [generationId, mediaId, position, source],
        );
      // A base anywhere but Image 1, a second base, a base of a fresh
      // generation, another output as base, a temporary as a plain reference.
      await expect(
        insert(variation.generationId, baseMedia, 1),
      ).rejects.toThrow();
      await expect(insert(fresh.generationId, baseMedia, 0)).rejects.toThrow(
        /exact image of the generation origin/,
      );
      await expect(insert(fresh.generationId, otherMedia, 0)).rejects.toThrow(
        /exact image of the generation origin/,
      );
      await expect(
        insert(fresh.generationId, baseMedia, 0, 'operator'),
      ).rejects.toThrow(/only the base image is Image 1|durable image/);
      expect(media.source).toBe(CREATIVE_GENERATION_MEDIA_SOURCE);

      // A variation of output A whose Image 1 is output B's bytes.
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await runner.startTransaction();
        const [wrong] = await runner.query(
          `INSERT INTO social_creative_generations
             (tenant_id, workspace_id, agency_client_id, company_context_id, generation_type,
              prompt, effective_prompt, output_count, aspect_ratio, quality, max_attempts,
              origin_type, origin_output_id)
           VALUES ($1,$2,$3,$4,'image','x','x',1,'1:1','standard',3,'variation',$5)
           RETURNING id`,
          [tenantId, workspaceId, clientId, companyA, source.outputs[0].id],
        );
        await expect(
          runner.query(
            `INSERT INTO social_creative_generation_references
               (generation_id, position, source, kind, role, media_asset_id, mime_type, byte_size, checksum)
             SELECT $1, 0, 'base', 'base', 'base', id, mime_type, byte_size, checksum
               FROM media_assets WHERE id = $2`,
            [wrong.id, otherMedia],
          ),
        ).rejects.toThrow(/exact image of the generation origin/);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  });

  describe('regeneration', () => {
    it('a new generation from the same intent; the origin is byte-for-byte unchanged', async () => {
      const source = await completed(scopeA, {
        prompt: 'xícara fumegante',
        aspectRatio: '4:5',
        quality: 'high',
        outputCount: 2,
      });
      const before = await snapshot(source.generationId);

      const accepted = await generation.regenerate(
        scopeA,
        randomUUID(),
        source.generationId,
        {},
        key(),
      );
      expect(accepted.generationId).not.toBe(source.generationId);
      expect(accepted.status).toBe('queued');
      const view = await finish(scopeA, accepted.generationId);
      expect(view.status).toBe('completed');
      expect(view.request).toEqual({
        prompt: 'xícara fumegante',
        contentItemId: null,
        outputCount: 2,
        aspectRatio: '4:5',
        quality: 'high',
      });
      expect(view.origin).toEqual({
        type: 'regeneration',
        generationId: source.generationId,
        outputId: null,
        creativeAssetId: null,
        versionId: null,
      });
      expect(view.outputs).toHaveLength(2);
      expect(provider.calls.at(-1)).toMatchObject({
        outputCount: 2,
        aspectRatio: '4:5',
        quality: 'high',
        references: [],
      });
      expect(await snapshot(source.generationId)).toEqual(before);
    });

    it('uses the CURRENT Brand Kit (composed again), and legitimate overrides only', async () => {
      const source = await completed(scopeA, { prompt: 'vitrine' });
      brand = {
        ...brand,
        palette: [{ role: 'primary', hex: '#FF6B00', label: null }],
      };
      const accepted = await generation.regenerate(
        scopeA,
        null,
        source.generationId,
        { prompt: 'vitrine noturna', outputCount: 3 },
        key(),
      );
      const created = await row(
        'social_creative_generations',
        accepted.generationId,
      );
      const original = await row(
        'social_creative_generations',
        source.generationId,
      );
      expect(created.prompt).toBe('vitrine noturna');
      expect(created.output_count).toBe(3);
      expect(created.effective_prompt).toContain('#FF6B00');
      expect(original.effective_prompt).not.toContain('#FF6B00');
      expect(created.generation_context.brand).not.toBeNull();
    });

    it('reuses an explicit selection with the same bytes; a vanished one is a 409, never a substitute', async () => {
      const ref = await durable(scopeA, imageB);
      const source = await completed(scopeA, {
        references: [{ source: 'operator', id: ref.id, kind: 'product' }],
      });
      const accepted = await generation.regenerate(
        scopeA,
        null,
        source.generationId,
        {},
        key(),
      );
      expect(await frozenRows(accepted.generationId)).toEqual([
        expect.objectContaining({
          position: 0,
          source: 'operator',
          kind: 'product',
          media_asset_id: ref.id,
          checksum: sha(imageB),
        }),
      ]);
      await worker().processPending();

      // The library image is soft-deleted: no silent drop, no substitute.
      await db.query(
        'UPDATE media_assets SET deleted_at = now() WHERE id = $1',
        [ref.id],
      );
      const gone = await failure(
        generation.regenerate(scopeA, null, source.generationId, {}, key()),
      );
      expect(gone).toMatchObject({
        status: 409,
        code: 'origin_reference_unavailable',
      });
      // An explicit override is the operator's way out.
      await expect(
        generation.regenerate(
          scopeA,
          null,
          source.generationId,
          { references: [] },
          key(),
        ),
      ).resolves.toMatchObject({ status: 'queued' });
    });

    it('a default selection is the default rule again, over the item’s current references', async () => {
      const itemId = await plannerItem(scopeA);
      const first = await durable(scopeA, imageB);
      await db.query(
        `INSERT INTO social_content_references
           (tenant_id, workspace_id, agency_client_id, company_context_id, content_item_id, media_asset_id, kind, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,'product',0)`,
        [tenantId, workspaceId, clientId, companyA, itemId, first.id],
      );
      const source = await completed(scopeA, { contentItemId: itemId });
      const second = await durable(scopeA, imageC);
      await db.query(
        `INSERT INTO social_content_references
           (tenant_id, workspace_id, agency_client_id, company_context_id, content_item_id, media_asset_id, kind, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,'style',1)`,
        [tenantId, workspaceId, clientId, companyA, itemId, second.id],
      );
      const accepted = await generation.regenerate(
        scopeA,
        null,
        source.generationId,
        {},
        key(),
      );
      const view = await generation.get(scopeA, accepted.generationId);
      expect(view.request.contentItemId).toBe(itemId);
      expect(view.references.map((r) => r.id)).toEqual([first.id, second.id]);
    });

    it('keeps the Planner item; one no longer visible is a 409, never a silent standalone', async () => {
      const itemId = await plannerItem(scopeA);
      const source = await completed(scopeA, { contentItemId: itemId });
      plannerItems.delete(`${companyA}:${itemId}`); // archived/soft-deleted
      expect(
        await failure(
          generation.regenerate(scopeA, null, source.generationId, {}, key()),
        ),
      ).toMatchObject({ status: 409, code: 'origin_content_item_unavailable' });
      // Hard delete: the FK erased the link, the context record remembers it.
      await db.query('DELETE FROM social_content_items WHERE id = $1', [
        itemId,
      ]);
      expect(
        await failure(
          generation.regenerate(scopeA, null, source.generationId, {}, key()),
        ),
      ).toMatchObject({ status: 409, code: 'origin_content_item_unavailable' });
    });

    it('only a finished generation can be regenerated; another company sees nothing', async () => {
      const queued = await generation.enqueue(
        scopeA,
        null,
        { prompt: 'x' },
        key(),
      );
      expect(
        await failure(
          generation.regenerate(scopeA, null, queued.generationId, {}, key()),
        ),
      ).toMatchObject({ status: 409, code: 'generation_not_finished' });
      await worker().processPending();
      await expect(
        generation.regenerate(scopeB, null, queued.generationId, {}, key()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a failed generation can be regenerated', async () => {
      const failed = await generation.enqueue(
        scopeA,
        null,
        { prompt: 'x' },
        key(),
      );
      await db.query(
        `UPDATE social_creative_generations
            SET status = 'failed', failed_at = now(), error_code = 'rejected'
          WHERE id = $1`,
        [failed.generationId],
      );
      const accepted = await generation.regenerate(
        scopeA,
        null,
        failed.generationId,
        {},
        key(),
      );
      expect((await finish(scopeA, accepted.generationId)).status).toBe(
        'completed',
      );
    });
  });

  describe('variation of an output', () => {
    it('sends the exact output bytes as Image 1, then the additional references in order', async () => {
      provider.images = [imageA];
      const source = await completed(scopeA, {
        aspectRatio: '9:16',
        quality: 'high',
      });
      const extra = await durable(scopeA, imageB);
      provider.images = [imageC];
      const accepted = await generation.varyOutput(
        scopeA,
        randomUUID(),
        source.outputs[0].id,
        {
          prompt: 'troque o fundo por uma praia',
          references: [{ source: 'operator', id: extra.id, kind: 'style' }],
        },
        key(),
      );
      const baseMedia = await outputMedia(source.outputs[0].id);
      expect(await frozenRows(accepted.generationId)).toEqual([
        {
          position: 0,
          source: 'base',
          kind: 'base',
          role: 'base',
          media_asset_id: baseMedia,
          checksum: sha(imageA),
        },
        expect.objectContaining({
          position: 1,
          source: 'operator',
          kind: 'style',
          media_asset_id: extra.id,
        }),
      ]);

      const view = await finish(scopeA, accepted.generationId);
      expect(view.status).toBe('completed');
      const call = provider.calls.at(-1) as ImageGenerationProviderInput;
      expect(call.references.map((r) => r.role)).toEqual(['base', 'style']);
      expect(call.references[0].body.equals(imageA)).toBe(true);
      expect(call.references[1].body.equals(imageB)).toBe(true);
      // Settings default to the origin's; outputs default to one.
      expect(call).toMatchObject({
        aspectRatio: '9:16',
        quality: 'high',
        outputCount: 1,
      });
      expect(call.prompt).toContain('as a variation of Image 1');
      expect(call.prompt).toContain('REQUESTED CHANGES');
      expect(call.prompt).toContain('troque o fundo por uma praia');
      expect(view.origin).toEqual({
        type: 'variation',
        generationId: source.generationId,
        outputId: source.outputs[0].id,
        creativeAssetId: null,
        versionId: null,
      });
      expect(view.references[0]).toMatchObject({
        source: 'base',
        role: 'base',
      });
      // Derived outputs are ordinary outputs: they promote normally.
      const promoted = await generation.promoteToNewAsset(
        scopeA,
        null,
        view.outputs[0].id,
        {},
      );
      expect(promoted.id).toBeDefined();
      expect(
        (await generation.get(scopeA, accepted.generationId)).outputs[0]
          .promotion?.creativeAssetId,
      ).toBe(promoted.id);
    });

    it('preserves the origin’s Planner item; the base counts toward the six images', async () => {
      const itemId = await plannerItem(scopeA);
      const source = await completed(scopeA, { contentItemId: itemId });
      const refs = await Promise.all(
        Array.from({ length: 6 }, () => durable(scopeA, imageB)),
      );
      const choice = (id: string) => ({
        source: 'operator' as const,
        id,
        kind: 'style' as const,
      });
      expect(
        await failure(
          generation.varyOutput(
            scopeA,
            null,
            source.outputs[0].id,
            { prompt: 'x', references: refs.map((r) => choice(r.id)) },
            key(),
          ),
        ),
      ).toMatchObject({ status: 400, code: 'reference_limit_exceeded' });
      const accepted = await generation.varyOutput(
        scopeA,
        null,
        source.outputs[0].id,
        { prompt: 'x', references: refs.slice(0, 5).map((r) => choice(r.id)) },
        key(),
      );
      const view = await generation.get(scopeA, accepted.generationId);
      expect(view.references).toHaveLength(6);
      expect(view.request.contentItemId).toBe(itemId);
    });

    it('an expired output is a 410; a promoted one names its saved copy but is never swapped for it', async () => {
      const source = await completed(scopeA, { outputCount: 2 });
      const [kept, plain] = source.outputs;
      const asset = await generation.promoteToNewAsset(
        scopeA,
        null,
        kept.id,
        {},
      );
      process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
      process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
      await db.query(
        `UPDATE media_assets SET created_at = now() - interval '30 days' WHERE id = $1`,
        [await outputMedia(plain.id)],
      );
      await cleanup().run();
      expect(await outputMedia(kept.id)).toBeNull();
      expect(await outputMedia(plain.id)).toBeNull();

      const promoted = await failure(
        generation.varyOutput(scopeA, null, kept.id, { prompt: 'x' }, key()),
      );
      expect(promoted).toMatchObject({
        status: 410,
        code: 'variation_base_expired',
        body: expect.objectContaining({
          message:
            'Este resultado expirou e não pode mais ser usado como base.',
          savedCopy: {
            creativeAssetId: asset.id,
            versionId: asset.currentVersionId,
          },
        }),
      });
      expect(
        await failure(
          generation.varyOutput(scopeA, null, plain.id, { prompt: 'x' }, key()),
        ),
      ).toMatchObject({
        status: 410,
        body: expect.objectContaining({ savedCopy: null }),
      });
      expect(provider.calls).toHaveLength(1); // only the source generation
    });

    it('Company B can never vary Company A’s output', async () => {
      const source = await completed(scopeA);
      await expect(
        generation.varyOutput(
          scopeB,
          null,
          source.outputs[0].id,
          { prompt: 'x' },
          key(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a base whose bytes are gone fails before the provider: nothing sent, nothing substituted', async () => {
      const source = await completed(scopeA);
      const accepted = await generation.varyOutput(
        scopeA,
        null,
        source.outputs[0].id,
        { prompt: 'x' },
        key(),
      );
      const media = await row(
        'media_assets',
        (await outputMedia(source.outputs[0].id)) as string,
      );
      objects.delete(media.storage_path);
      const calls = provider.calls.length;
      await worker().processPending();
      const view = await generation.get(scopeA, accepted.generationId);
      expect(view.status).toBe('failed');
      expect(view.error?.code).toBe('image_generation_reference_unavailable');
      expect(provider.calls).toHaveLength(calls);
    });

    it('regenerating a variation keeps the same base bytes; once the base expired it is a 410', async () => {
      const source = await completed(scopeA);
      const variation = await generation.varyOutput(
        scopeA,
        null,
        source.outputs[0].id,
        { prompt: 'mais luz' },
        key(),
      );
      await worker().processPending();
      const again = await generation.regenerate(
        scopeA,
        null,
        variation.generationId,
        {},
        key(),
      );
      const [base] = await frozenRows(again.generationId);
      expect(base).toMatchObject({
        source: 'base',
        media_asset_id: await outputMedia(source.outputs[0].id),
        checksum: sha(imageA),
      });
      const view = await finish(scopeA, again.generationId);
      expect(view.origin).toMatchObject({
        type: 'regeneration',
        generationId: variation.generationId,
      });
      expect(
        (
          provider.calls.at(-1) as ImageGenerationProviderInput
        ).references[0].body.equals(imageA),
      ).toBe(true);

      process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
      process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
      await cleanup().run(later(30));
      expect(await outputMedia(source.outputs[0].id)).toBeNull();
      expect(
        await failure(
          generation.regenerate(
            scopeA,
            null,
            variation.generationId,
            {},
            key(),
          ),
        ),
      ).toMatchObject({ status: 410, code: 'variation_base_expired' });
    });
  });

  describe('variation of a Creative Version', () => {
    it('sends the version’s durable bytes as Image 1, without copying them first', async () => {
      const { assetId, versionId, mediaId } = await versionOf(scopeA, imageB);
      const mediaBefore = (
        await db.query('SELECT count(*)::int AS n FROM media_assets')
      )[0].n;
      const accepted = await generation.varyVersion(
        scopeA,
        null,
        assetId,
        versionId,
        { prompt: 'versão para stories', aspectRatio: '9:16' },
        key(),
      );
      expect(
        (await db.query('SELECT count(*)::int AS n FROM media_assets'))[0].n,
      ).toBe(mediaBefore);
      expect(await frozenRows(accepted.generationId)).toEqual([
        expect.objectContaining({
          position: 0,
          source: 'base',
          media_asset_id: mediaId,
          checksum: sha(imageB),
        }),
      ]);
      const view = await finish(scopeA, accepted.generationId);
      expect(view.status).toBe('completed');
      expect(
        (
          provider.calls.at(-1) as ImageGenerationProviderInput
        ).references[0].body.equals(imageB),
      ).toBe(true);
      expect(view.origin).toEqual({
        type: 'variation',
        generationId: null,
        outputId: null,
        creativeAssetId: assetId,
        versionId,
      });
    });

    it('Company B can never vary Company A’s version; a version of another asset is not found', async () => {
      const a = await versionOf(scopeA, imageB);
      const other = await versionOf(scopeA, imageC);
      await expect(
        generation.varyVersion(
          scopeB,
          null,
          a.assetId,
          a.versionId,
          { prompt: 'x' },
          key(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        generation.varyVersion(
          scopeA,
          null,
          a.assetId,
          other.versionId,
          { prompt: 'x' },
          key(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('the base cannot also be an ordinary reference', async () => {
      const { assetId, versionId, mediaId } = await versionOf(scopeA, imageB);
      expect(
        await failure(
          generation.varyVersion(
            scopeA,
            null,
            assetId,
            versionId,
            {
              prompt: 'x',
              references: [{ source: 'operator', id: mediaId, kind: 'style' }],
            },
            key(),
          ),
        ),
      ).toMatchObject({ status: 400, code: 'reference_duplicated' });
    });
  });

  describe('cleanup interaction (CS3.6.1)', () => {
    beforeEach(() => {
      process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
      process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
    });

    it('a base held by a queued/processing variation never expires; after it ends, the normal lifecycle resumes', async () => {
      const source = await completed(scopeA);
      const baseMedia = (await outputMedia(source.outputs[0].id)) as string;
      const variation = await generation.varyOutput(
        scopeA,
        null,
        source.outputs[0].id,
        { prompt: 'x' },
        key(),
      );
      // Long past retention, but the variation is queued…
      expect((await cleanup().sweep(later(30))).purged).toBe(0);
      expect((await row('media_assets', baseMedia)).deleted_at).toBeNull();
      // …and processing: the database guard refuses a manual tombstone too.
      await db.query(
        `UPDATE social_creative_generations
            SET status = 'processing', locked_by = 'w', locked_at = now(), attempts = 1
          WHERE id = $1`,
        [variation.generationId],
      );
      expect((await cleanup().sweep(later(30))).purged).toBe(0);
      await expect(
        db.query('UPDATE media_assets SET deleted_at = now() WHERE id = $1', [
          baseMedia,
        ]),
      ).rejects.toThrow(/pending generation/);

      // Terminal: the base's own clock (its created_at) decides again — not
      // extended by the variation.
      await db.query(
        `UPDATE social_creative_generations
            SET status = 'completed', completed_at = now(), locked_by = NULL, locked_at = NULL
          WHERE id = $1`,
        [variation.generationId],
      );
      expect((await cleanup().sweep(later(1))).purged).toBe(0);
      await cleanup().run(later(8));
      expect(await outputMedia(source.outputs[0].id)).toBeNull();
      // Provenance survives: the frozen base row keeps id + checksum.
      expect((await frozenRows(variation.generationId))[0]).toMatchObject({
        source: 'base',
        media_asset_id: baseMedia,
        checksum: sha(imageA),
      });
    });

    it('a sweep racing an uncommitted variation skips its base (FOR SHARE vs SKIP LOCKED)', async () => {
      const source = await completed(scopeA);
      const baseMedia = (await outputMedia(source.outputs[0].id)) as string;
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await runner.startTransaction();
        const [generationRow] = await runner.query(
          `INSERT INTO social_creative_generations
             (tenant_id, workspace_id, agency_client_id, company_context_id, generation_type,
              prompt, effective_prompt, output_count, aspect_ratio, quality, max_attempts,
              origin_type, origin_output_id)
           VALUES ($1,$2,$3,$4,'image','x','x',1,'1:1','standard',3,'variation',$5)
           RETURNING id`,
          [tenantId, workspaceId, clientId, companyA, source.outputs[0].id],
        );
        await runner.query(
          `INSERT INTO social_creative_generation_references
             (generation_id, position, source, kind, role, media_asset_id, mime_type, byte_size, checksum)
           SELECT $1, 0, 'base', 'base', 'base', id, mime_type, byte_size, checksum
             FROM media_assets WHERE id = $2`,
          [generationRow.id, baseMedia],
        );
        // Uncommitted: the sweep cannot see the reference, but cannot lock
        // the base either.
        expect((await cleanup().sweep(later(30))).purged).toBe(0);
        await runner.commitTransaction();
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
      // Committed and pending: still held.
      expect((await cleanup().sweep(later(30))).purged).toBe(0);
      expect((await row('media_assets', baseMedia)).deleted_at).toBeNull();
    });

    it('a base tombstoned first makes the variation refuse at enqueue', async () => {
      const source = await completed(scopeA);
      await db.query(
        `UPDATE media_assets SET deleted_at = now() WHERE id = $1`,
        [await outputMedia(source.outputs[0].id)],
      );
      expect(
        await failure(
          generation.varyOutput(
            scopeA,
            null,
            source.outputs[0].id,
            { prompt: 'x' },
            key(),
          ),
        ),
      ).toMatchObject({ status: 410, code: 'variation_base_expired' });
    });
  });

  describe('idempotency and fingerprint (image.v4)', () => {
    it('same key + same variation → same generation; base, prompt, order, reference, kind or settings changed → 409', async () => {
      const source = await completed(scopeA, { outputCount: 2 });
      const [first, second] = source.outputs;
      const p = await durable(scopeA, imageB);
      const q = await durable(scopeA, imageC);
      const ref = (id: string, kind: 'style' | 'product' = 'style') => ({
        source: 'operator' as const,
        id,
        kind,
      });
      const k = key();
      const request = {
        prompt: 'mais luz',
        references: [ref(p.id), ref(q.id)],
      };
      const accepted = await generation.varyOutput(
        scopeA,
        null,
        first.id,
        request,
        k,
      );
      await expect(
        generation.varyOutput(scopeA, null, first.id, { ...request }, k),
      ).resolves.toEqual(accepted);
      const count = async () =>
        (
          await db.query(
            'SELECT count(*)::int AS n FROM social_creative_generations WHERE idempotency_key = $1',
            [k],
          )
        )[0].n;

      for (const changed of [
        () => generation.varyOutput(scopeA, null, second.id, request, k), // base
        () =>
          generation.varyOutput(
            scopeA,
            null,
            first.id,
            { ...request, prompt: 'menos luz' },
            k,
          ),
        () =>
          generation.varyOutput(
            scopeA,
            null,
            first.id,
            { ...request, references: [ref(q.id), ref(p.id)] }, // order
            k,
          ),
        () =>
          generation.varyOutput(
            scopeA,
            null,
            first.id,
            { ...request, references: [ref(p.id)] }, // reference
            k,
          ),
        () =>
          generation.varyOutput(
            scopeA,
            null,
            first.id,
            { ...request, references: [ref(p.id, 'product'), ref(q.id)] }, // kind
            k,
          ),
        () =>
          generation.varyOutput(
            scopeA,
            null,
            first.id,
            { ...request, quality: 'high' }, // settings
            k,
          ),
        // Same key as a regeneration of the same origin, or as a fresh request.
        () => generation.regenerate(scopeA, null, source.generationId, {}, k),
        () => generation.enqueue(scopeA, null, request, k),
      ])
        await expect(changed()).rejects.toBeInstanceOf(ConflictException);
      expect(await count()).toBe(1);
    });

    it('a variation never collides with its origin: the origin’s own key is a 409', async () => {
      const k = key();
      const { generationId } = await generation.enqueue(
        scopeA,
        null,
        { prompt: 'café na mesa' },
        k,
      );
      await worker().processPending();
      await expect(
        generation.regenerate(scopeA, null, generationId, {}, k),
      ).rejects.toBeInstanceOf(ConflictException);
      // A fresh request keeps image.v3: its own replay still works.
      await expect(
        generation.enqueue(scopeA, null, { prompt: 'café na mesa' }, k),
      ).resolves.toMatchObject({ generationId, status: 'completed' });
    });

    it('regenerate replays with the same key; 10 concurrent clicks → 1 generation', async () => {
      const source = await completed(scopeA);
      const k = key();
      const answers = await Promise.all(
        Array.from({ length: 10 }, () =>
          generation.regenerate(scopeA, null, source.generationId, {}, k),
        ),
      );
      expect(new Set(answers.map((a) => a.generationId)).size).toBe(1);
      const [{ n }] = await db.query(
        'SELECT count(*)::int AS n FROM social_creative_generations WHERE idempotency_key = $1',
        [k],
      );
      expect(n).toBe(1);
    });

    it('the provider stays out of a refused request', async () => {
      const source = await completed(scopeA);
      const calls = provider.calls.length;
      await expect(
        generation.varyOutput(
          scopeA,
          null,
          source.outputs[0].id,
          { prompt: '   ' },
          key(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        generation.varyOutput(
          scopeA,
          null,
          source.outputs[0].id,
          { prompt: 'x' },
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await worker().processPending();
      expect(provider.calls).toHaveLength(calls);
      expect(GoneException).toBeDefined();
    });
  });
});
