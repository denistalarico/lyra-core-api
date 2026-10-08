import { GoneException, NotFoundException } from '@nestjs/common';
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
import { AddSocialCreativeGenerationContext1798100000000 } from '../../database/migrations/1798100000000-add-social-creative-generation-context';
import { CreateSocialContentReferences1798200000000 } from '../../database/migrations/1798200000000-create-social-content-references';
import { CreateSocialCreativeGenerationReferences1798300000000 } from '../../database/migrations/1798300000000-create-social-creative-generation-references';
import { AddCreativeGenerationCleanupIndexes1798400000000 } from '../../database/migrations/1798400000000-add-creative-generation-cleanup-indexes';
import { AddSocialCreativeGenerationDerivation1798500000000 } from '../../database/migrations/1798500000000-add-social-creative-generation-derivation';
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

class AlwaysOkProvider extends ImageGenerationProvider {
  readonly id = 'scripted';
  image!: Buffer;
  generate(input: { outputCount: number }) {
    return Promise.resolve<ImageGenerationProviderResult>({
      outputs: Array.from({ length: input.outputCount }, () => ({
        body: this.image,
      })),
      usage: {
        model: 'scripted-model',
        metrics: { images: input.outputCount },
        cost: null,
      },
    });
  }
}

/**
 * CS3.6.1 against real PostgreSQL: eligibility, the tombstone → object → row
 * order, storage failure and retry, concurrent sweeps, company scope and the
 * owners that must never lose a binary.
 *
 * Same harness as the CS3.2 spec: a throwaway schema of the guarded `_test`
 * database, real services, in-memory storage. Every test starts without
 * temporary media, because the sweep is global by design.
 */
run('CS3.6.1 temporary generation cleanup (real PostgreSQL)', () => {
  const schema = `cs361_${randomUUID().replace(/-/g, '')}`;
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
  const agency: MediaAssetScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };

  let db: DataSource;
  let image: Buffer;
  const objects = new Map<string, Buffer>();
  const deleteCalls: string[] = [];
  let storageDown = false;
  let mediaUpload: MediaAssetUploadService;
  let generation: CreativeImageGenerationService;
  let provider: AlwaysOkProvider;
  const config = new CreativeGenerationConfigService();
  const brand: CreativeStudioBrandContext = {
    palette: [],
    typography: [],
    guidelines: null,
    assets: [],
    references: [],
  };
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

  const cleanup = () =>
    new CreativeGenerationCleanupWorker(db, mediaUpload, config);
  const later = (days: number) => new Date(Date.now() + days * DAY);

  async function completed(scope: MediaAssetScope, count = 1, extra = {}) {
    const { generationId } = await generation.enqueue(
      scope,
      null,
      { prompt: 'café na mesa', outputCount: count, ...extra },
      randomUUID(),
    );
    const worker = new CreativeImageGenerationWorker(
      db,
      provider,
      mediaUpload,
      config,
      {} as never,
    );
    await worker.processPending();
    const view = await generation.get(scope, generationId);
    expect(view.status).toBe('completed');
    return view;
  }

  async function media(id: string) {
    const [found] = await db.query(
      'SELECT id, storage_path, deleted_at FROM media_assets WHERE id = $1',
      [id],
    );
    return found;
  }

  async function outputRow(id: string) {
    const [found] = await db.query(
      'SELECT * FROM social_creative_generation_outputs WHERE id = $1',
      [id],
    );
    return found;
  }

  async function outputMediaId(outputId: string) {
    return (await outputRow(outputId)).media_asset_id as string;
  }

  /** A generation row in any state, without the worker (raw INSERT). */
  async function rawGeneration(
    scope: MediaAssetScope,
    status: 'queued' | 'processing' | 'failed',
  ) {
    const lifecycle = {
      queued: {},
      processing: { locked_by: 'w', locked_at: new Date(), attempts: 1 },
      failed: { failed_at: new Date(), error_code: 'failed', attempts: 1 },
    }[status];
    const all: Record<string, unknown> = {
      tenant_id: scope.tenantId,
      workspace_id: scope.workspaceId,
      agency_client_id: scope.agencyClientId,
      company_context_id: scope.companyContextId,
      generation_type: 'image',
      status,
      prompt: 'x',
      effective_prompt: 'x',
      output_count: 1,
      aspect_ratio: '1:1',
      quality: 'standard',
      max_attempts: 3,
      ...lifecycle,
    };
    const keys = Object.keys(all);
    const [created] = await db.query(
      `INSERT INTO social_creative_generations (${keys.join(',')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(all),
    );
    return created.id;
  }

  /** A temporary binary the worker stored but never linked to an output. */
  async function orphan(scope: MediaAssetScope, generationId: unknown) {
    return mediaUpload.upload(scope, null, {
      file: { buffer: image, originalname: 'x.png', mimetype: 'image/png' },
      source: CREATIVE_GENERATION_MEDIA_SOURCE,
      metadata: { generationId, outputIndex: 0 },
    });
  }

  const age = (mediaId: string, days: number) =>
    db.query(
      `UPDATE media_assets SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
      [mediaId, days],
    );

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
    // The publication-side owners, reduced to their FK into media_assets
    // (same RESTRICT as production); they shadow `public` via search_path.
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
      getPrivateAsset: async (path: string) => {
        const body = objects.get(path);
        if (!body) throw new NotFoundException('Asset not found.');
        return {
          body: Readable.from([body]),
          contentType: 'image/png',
          cacheControl: 'private, no-store',
        };
      },
      // Yields first, so concurrent sweeps really interleave.
      deleteObject: async (input: { path: string }) => {
        await new Promise((resolve) => setImmediate(resolve));
        deleteCalls.push(input.path);
        if (storageDown)
          throw Object.assign(new Error('connect ECONNREFUSED'), {
            name: 'TimeoutError',
          });
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
    provider = new AlwaysOkProvider();
    provider.image = image;
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
    process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
    process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
    storageDown = false;
    deleteCalls.length = 0;
  });

  afterEach(async () => {
    delete process.env.CREATIVE_GENERATION_CLEANUP_ENABLED;
    delete process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN;
    delete process.env.CREATIVE_GENERATION_TEMP_RETENTION_DAYS;
    delete process.env.CREATIVE_GENERATION_CLEANUP_BATCH_SIZE;
    // Clean slate for the global sweep: no pending work, no temporaries.
    await db.query(
      `UPDATE social_creative_generations
          SET status = 'failed', failed_at = now(), error_code = 'failed',
              locked_at = NULL, locked_by = NULL
        WHERE status IN ('queued', 'processing')`,
    );
    for (const table of [
      'social_publications',
      'social_publication_media',
      'social_destination_creatives',
    ])
      await db.query(`DELETE FROM ${table}`);
    await db.query('DELETE FROM media_assets WHERE source = $1', [
      CREATIVE_GENERATION_MEDIA_SOURCE,
    ]);
  });

  describe('schema', () => {
    it('index migration is re-runnable and reversible: up → up → down → up', async () => {
      const runner = db.createQueryRunner();
      const migration = new AddCreativeGenerationCleanupIndexes1798400000000();
      const indexes = async () =>
        (
          (await runner.query(
            `SELECT indexname FROM pg_indexes
              WHERE schemaname = $1 AND indexname IN (
                'IDX_media_assets_temporary_generation',
                'IDX_social_creative_asset_versions_media',
                'IDX_social_creative_asset_versions_thumbnail_media',
                'IDX_social_publication_media_media',
                'IDX_social_destination_creatives_media')`,
            [schema],
          )) as unknown[]
        ).length;
      try {
        await runner.startTransaction();
        await migration.up(runner);
        expect(await indexes()).toBe(5);
        await migration.down(runner);
        expect(await indexes()).toBe(0);
        await migration.up(runner);
        expect(await indexes()).toBe(5);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  });

  describe('eligibility', () => {
    it('never selects an unpromoted output inside the retention window', async () => {
      const view = await completed(scopeA);
      const result = await cleanup().sweep(later(6));
      expect(result.purged).toBe(0);
      expect(result.eligible).toEqual({ promoted: 0, expired: 0, orphan: 0 });
      expect(view.outputs[0].available).toBe(true);
      expect(
        (await media(await outputMediaId(view.outputs[0].id))).deleted_at,
      ).toBeNull();
    });

    it('honours the configured retention', async () => {
      process.env.CREATIVE_GENERATION_TEMP_RETENTION_DAYS = '30';
      await completed(scopeA);
      expect((await cleanup().sweep(later(8))).purged).toBe(0);
      expect((await cleanup().sweep(later(31))).purged).toBe(1);
    });

    it('expires an unpromoted output after retention: binary and media row go, provenance stays', async () => {
      const view = await completed(scopeA, 2);
      const before = await db.query(
        'SELECT * FROM social_creative_generations WHERE id = $1',
        [view.generationId],
      );
      const mediaIds = await Promise.all(
        view.outputs.map((output) => outputMediaId(output.id)),
      );
      const keys = await Promise.all(
        mediaIds.map(async (id) => (await media(id)).storage_path),
      );

      const result = await cleanup().sweep(later(8));

      expect(result).toMatchObject({
        mode: 'delete',
        eligible: { promoted: 0, expired: 2, orphan: 0 },
        purged: 2,
        failed: 0,
      });
      for (const key of keys) expect(objects.has(key)).toBe(false);
      for (const id of mediaIds) expect(await media(id)).toBeUndefined();
      // Generation untouched; output rows remain, pointing at nothing.
      const after = await db.query(
        'SELECT * FROM social_creative_generations WHERE id = $1',
        [view.generationId],
      );
      expect(after).toEqual(before);
      for (const output of view.outputs) {
        const row = await outputRow(output.id);
        expect(row.media_asset_id).toBeNull();
        expect(row.generation_id).toBe(view.generationId);
      }

      const expired = await generation.get(scopeA, view.generationId);
      expect(expired.status).toBe('completed');
      expect(expired.outputs).toHaveLength(2);
      for (const output of expired.outputs)
        expect(output).toMatchObject({
          available: false,
          contentPath: null,
          retentionClass: 'temporary_generation',
        });
      await expect(
        generation.readOutput(scopeA, view.outputs[0].id),
      ).rejects.toBeInstanceOf(GoneException);
      await expect(
        generation.promoteToNewAsset(scopeA, null, view.outputs[0].id, {}),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('never touches media of queued or processing generations, whatever the timestamps', async () => {
      const queued = await rawGeneration(scopeA, 'queued');
      const processing = await rawGeneration(scopeA, 'processing');
      const a = await orphan(scopeA, queued);
      const b = await orphan(scopeA, processing);
      await age(a.id, 3650);
      await age(b.id, 3650);

      const result = await cleanup().sweep(later(3650));
      expect(result.purged).toBe(0);
      expect((await media(a.id)).deleted_at).toBeNull();
      expect((await media(b.id)).deleted_at).toBeNull();

      // Once terminal, the leftover of the attempt is an expired orphan.
      await db.query(
        `UPDATE social_creative_generations
            SET status = 'failed', failed_at = now(), error_code = 'failed',
                locked_at = NULL, locked_by = NULL
          WHERE id = ANY($1)`,
        [[queued, processing]],
      );
      const swept = await cleanup().sweep();
      expect(swept.eligible.orphan).toBe(2);
      expect(swept.purged).toBe(2);
    });

    it('never selects temporary media whose generation cannot be resolved', async () => {
      const unknown = await orphan(scopeA, randomUUID());
      const malformed = await orphan(scopeA, 'not-a-uuid');
      const missing = await orphan(scopeA, undefined);
      for (const asset of [unknown, malformed, missing])
        await age(asset.id, 400);

      expect((await cleanup().sweep()).purged).toBe(0);
      for (const asset of [unknown, malformed, missing])
        expect((await media(asset.id)).deleted_at).toBeNull();
    });

    it('expires a promoted output on the next sweep; promotion and its replay survive', async () => {
      const view = await completed(scopeA);
      const outputId = view.outputs[0].id;
      const promoted = await generation.promoteToNewAsset(
        scopeA,
        null,
        outputId,
        {},
      );
      const temporary = await media(await outputMediaId(outputId));
      const [version] = await db.query(
        'SELECT media_asset_id FROM social_creative_asset_versions WHERE id = $1',
        [promoted.currentVersionId],
      );
      const durable = await media(version.media_asset_id);

      // No time travel: promotion alone makes it eligible.
      const result = await cleanup().sweep();
      expect(result.eligible).toEqual({ promoted: 1, expired: 0, orphan: 0 });
      expect(result.purged).toBe(1);
      expect(objects.has(temporary.storage_path)).toBe(false);

      // The version's own copy is a different, durable binary — untouched.
      expect((await media(durable.id)).deleted_at).toBeNull();
      expect(objects.has(durable.storage_path)).toBe(true);
      const row = await outputRow(outputId);
      expect(row).toMatchObject({
        media_asset_id: null,
        promotion_kind: 'new_asset',
        promoted_creative_asset_id: promoted.id,
        promoted_version_id: promoted.currentVersionId,
      });
      const after = await generation.get(scopeA, view.generationId);
      expect(after.outputs[0].available).toBe(false);
      expect(after.outputs[0].promotion).toMatchObject({
        kind: 'new_asset',
        creativeAssetId: promoted.id,
        versionId: promoted.currentVersionId,
      });
      // A client retry of the same promotion needs no binary.
      const replay = await generation.promoteToNewAsset(
        scopeA,
        null,
        outputId,
        {},
      );
      expect(replay.id).toBe(promoted.id);
    });

    it('never tombstones a temporary binary held by any durable owner', async () => {
      const outputs = (await completed(scopeA, 3)).outputs;
      const ids = await Promise.all(outputs.map((o) => outputMediaId(o.id)));
      // Impossible through the product (every write path refuses
      // `temporary:`); the sweep must not rely on that alone.
      await db.query(
        'INSERT INTO social_publication_media (media_asset_id) VALUES ($1)',
        [ids[0]],
      );
      await db.query(
        'INSERT INTO social_destination_creatives (media_asset_id) VALUES ($1)',
        [ids[1]],
      );

      const result = await cleanup().sweep(later(8));
      expect(result.purged).toBe(1);
      expect((await media(ids[0])).deleted_at).toBeNull();
      expect((await media(ids[1])).deleted_at).toBeNull();
      expect(objects.has((await media(ids[0])).storage_path)).toBe(true);
      expect(await media(ids[2])).toBeUndefined();
    });
  });

  describe('scope', () => {
    it('cleans each company by its own clock and never across scopes', async () => {
      const a = await completed(scopeA);
      const b = await completed(scopeB);
      const own = await completed(agency);
      const mediaA = await outputMediaId(a.outputs[0].id);
      const mediaB = await outputMediaId(b.outputs[0].id);
      const mediaAgency = await outputMediaId(own.outputs[0].id);
      await age(mediaA, 10);
      await age(mediaAgency, 10);
      // An orphan of Company B claiming Company A's (terminal) generation.
      const forged = await orphan(scopeB, a.generationId);
      await age(forged.id, 10);

      const result = await cleanup().sweep();

      expect(result.purged).toBe(2);
      expect(await media(mediaA)).toBeUndefined();
      expect(await media(mediaAgency)).toBeUndefined();
      expect((await media(mediaB)).deleted_at).toBeNull();
      expect((await media(forged.id)).deleted_at).toBeNull();
      expect(
        (await generation.get(scopeB, b.generationId)).outputs[0].available,
      ).toBe(true);
      // B's binary is still served to B.
      await expect(
        generation.readOutput(scopeB, b.outputs[0].id),
      ).resolves.toBeDefined();
    });
  });

  describe('references', () => {
    it('leaves Planner references, generation references and their media intact', async () => {
      const library = await mediaUpload.upload(scopeA, null, {
        file: { buffer: image, originalname: 'ref.png', mimetype: 'image/png' },
        source: 'planner_reference',
      });
      const plan = await db.getRepository(SocialPlanEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: clientId,
        companyContextId: companyA,
        title: 'Plano',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
      const item = await db.getRepository(SocialContentItemEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: clientId,
        planId: plan.id,
        title: 'Lançamento',
      });
      plannerItems.set(`${companyA}:${item.id}`, {
        ...item,
        currentRevisionId: null,
        destinations: [],
      });
      await db.query(
        `INSERT INTO social_content_references
           (tenant_id, workspace_id, agency_client_id, company_context_id,
            content_item_id, media_asset_id, kind, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,'product',0)`,
        [tenantId, workspaceId, clientId, companyA, item.id, library.id],
      );
      // Default rule: the item's Planner references are sent.
      const view = await completed(scopeA, 1, { contentItemId: item.id });
      expect(view.references).toHaveLength(1);
      const counts = async () =>
        await db.query(
          `SELECT
             (SELECT count(*)::int FROM social_content_references WHERE media_asset_id = $1) AS planner,
             (SELECT count(*)::int FROM social_creative_generation_references WHERE media_asset_id = $1) AS generation`,
          [library.id],
        );
      expect(await counts()).toEqual([{ planner: 1, generation: 1 }]);

      const result = await cleanup().sweep(later(400));

      expect(result.purged).toBe(1);
      expect(await outputMediaId(view.outputs[0].id)).toBeNull();
      expect((await media(library.id)).deleted_at).toBeNull();
      expect(objects.has(library.storagePath)).toBe(true);
      expect(deleteCalls).not.toContain(library.storagePath);
      expect(await counts()).toEqual([{ planner: 1, generation: 1 }]);
      const after = await generation.get(scopeA, view.generationId);
      expect(after.references).toEqual(view.references);
    });
  });

  describe('failure and retry', () => {
    it('is idempotent: a second sweep finds nothing and fails nothing', async () => {
      await completed(scopeA, 2);
      expect((await cleanup().sweep(later(8))).purged).toBe(2);
      const again = await cleanup().sweep(later(8));
      expect(again).toMatchObject({ purged: 0, failed: 0, retried: 0 });
      expect(again.eligible).toEqual({ promoted: 0, expired: 0, orphan: 0 });
    });

    it('converges when the object is already gone', async () => {
      const view = await completed(scopeA);
      const id = await outputMediaId(view.outputs[0].id);
      objects.delete((await media(id)).storage_path);

      expect((await cleanup().sweep(later(8))).purged).toBe(1);
      expect(await media(id)).toBeUndefined();
    });

    it('storage outage: keeps the tombstone (and the key), stops the batch, retries after the lease', async () => {
      const view = await completed(scopeA, 3);
      const ids = await Promise.all(
        view.outputs.map((o) => outputMediaId(o.id)),
      );
      storageDown = true;

      const down = await cleanup().sweep(later(8));
      expect(down).toMatchObject({ purged: 0, failed: 1, deferred: 2 });
      expect(deleteCalls).toHaveLength(1); // no aggressive retry
      for (const id of ids) {
        const row = await media(id);
        expect(row.deleted_at).not.toBeNull(); // hidden, but still knows its key
        expect(objects.has(row.storage_path)).toBe(true);
      }
      // Provenance and the API answer are coherent meanwhile.
      for (const output of view.outputs)
        expect(await outputMediaId(output.id)).not.toBeNull();
      const meanwhile = await generation.get(scopeA, view.generationId);
      expect(meanwhile.outputs.every((o) => !o.available)).toBe(true);
      await expect(
        generation.readOutput(scopeA, view.outputs[0].id),
      ).rejects.toBeInstanceOf(GoneException);

      // Inside the lease nobody re-claims them.
      storageDown = false;
      expect((await cleanup().sweep(later(8))).retried).toBe(0);

      await db.query(
        `UPDATE media_assets SET deleted_at = now() - interval '16 minutes' WHERE id = ANY($1)`,
        [ids],
      );
      const retry = await cleanup().sweep(later(8));
      expect(retry).toMatchObject({ retried: 3, purged: 3, failed: 0 });
      for (const id of ids) expect(await media(id)).toBeUndefined();
      for (const output of view.outputs)
        expect(await outputMediaId(output.id)).toBeNull();
    });

    it('a row delete lost after the object went (crash, DB error) converges on retry', async () => {
      const view = await completed(scopeA);
      const id = await outputMediaId(view.outputs[0].id);
      const row = await media(id);
      // The state such a failure leaves: stale tombstone, object gone.
      await db.query(
        `UPDATE media_assets SET deleted_at = now() - interval '1 hour' WHERE id = $1`,
        [id],
      );
      objects.delete(row.storage_path);
      await expect(
        generation.readOutput(scopeA, view.outputs[0].id),
      ).rejects.toBeInstanceOf(GoneException);

      const result = await cleanup().sweep();
      expect(result).toMatchObject({ retried: 1, purged: 1 });
      expect(await media(id)).toBeUndefined();
    });
  });

  describe('concurrency', () => {
    it('two concurrent workers clean each binary exactly once', async () => {
      process.env.CREATIVE_GENERATION_CLEANUP_BATCH_SIZE = '3';
      const outputs = [
        ...(await completed(scopeA, 4)).outputs,
        ...(await completed(scopeA, 4)).outputs,
      ];
      const ids = await Promise.all(outputs.map((o) => outputMediaId(o.id)));

      const results = (
        await Promise.all([cleanup().run(later(8)), cleanup().run(later(8))])
      ).flat();

      const purged = results.reduce((sum, r) => sum + r.purged, 0);
      const claimed = results.reduce(
        (sum, r) => sum + r.eligible.expired + r.retried,
        0,
      );
      expect(purged).toBe(8);
      expect(claimed).toBe(8);
      expect(new Set(deleteCalls).size).toBe(8);
      expect(deleteCalls).toHaveLength(8);
      for (const id of ids) expect(await media(id)).toBeUndefined();
    });
  });

  describe('modes', () => {
    it('dry run counts by reason and writes nothing', async () => {
      process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'true';
      const expired = await completed(scopeA);
      const promotedView = await completed(scopeA);
      await generation.promoteToNewAsset(
        scopeA,
        null,
        promotedView.outputs[0].id,
        {},
      );
      const failed = await rawGeneration(scopeA, 'failed');
      const leftover = await orphan(scopeA, failed);
      const fresh = await completed(scopeA);
      const ids = [
        await outputMediaId(expired.outputs[0].id),
        await outputMediaId(promotedView.outputs[0].id),
        leftover.id,
        await outputMediaId(fresh.outputs[0].id),
      ];
      await age(ids[0], 10);
      await age(ids[2], 10);
      const snapshot = async () =>
        db.query(
          'SELECT id, deleted_at FROM media_assets WHERE id = ANY($1) ORDER BY id',
          [ids],
        );
      const before = await snapshot();
      const objectsBefore = objects.size;

      const [report] = await cleanup().run();

      expect(report).toMatchObject({
        mode: 'dry_run',
        eligible: { promoted: 1, expired: 1, orphan: 1 },
        purged: 0,
        pendingPurge: 0,
      });
      expect(await snapshot()).toEqual(before);
      expect(objects.size).toBe(objectsBefore);
      expect(deleteCalls).toHaveLength(0);
    });

    it('disabled: does nothing at all', async () => {
      delete process.env.CREATIVE_GENERATION_CLEANUP_ENABLED;
      const view = await completed(scopeA);
      expect(await cleanup().run(later(400))).toEqual([]);
      expect((await cleanup().sweep(later(400))).mode).toBe('disabled');
      expect(
        (await media(await outputMediaId(view.outputs[0].id))).deleted_at,
      ).toBeNull();
    });
  });
});
