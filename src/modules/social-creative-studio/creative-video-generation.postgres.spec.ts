import {
  BadRequestException,
  ConflictException,
  GoneException,
  Logger,
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
import { AddSocialCreativeGenerationContext1798100000000 } from '../../database/migrations/1798100000000-add-social-creative-generation-context';
import { CreateSocialContentReferences1798200000000 } from '../../database/migrations/1798200000000-create-social-content-references';
import { CreateSocialCreativeGenerationReferences1798300000000 } from '../../database/migrations/1798300000000-create-social-creative-generation-references';
import { AddCreativeGenerationCleanupIndexes1798400000000 } from '../../database/migrations/1798400000000-add-creative-generation-cleanup-indexes';
import { AddSocialCreativeGenerationDerivation1798500000000 } from '../../database/migrations/1798500000000-add-social-creative-generation-derivation';
import { CreateSocialCreativeVideoGenerations1798600000000 } from '../../database/migrations/1798600000000-create-social-creative-video-generations';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { BrandKitAssetEntity, BrandKitEntity } from '../brand-kit/entities';
import { SocialBrandKitContextPort } from '../brand-kit/services/social-brand-kit-context.port';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeGenerationCleanupWorker } from './creative-generation-cleanup.worker';
import { CreativeGenerationConfigService } from './creative-generation-config';
import { CreativeGenerationContextService } from './creative-generation-context';
import { CreativeGenerationReferenceSelector } from './creative-generation-references';
import { CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE } from './creative-retention';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import { CreativeVideoCallbackService } from './creative-video-callback.service';
import { CreativeVideoProviderRegistry } from './creative-video-generation.binding';
import { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import {
  type CreativeVideoMode,
  type ProviderVideoRecovery,
  type ProviderVideoResult,
  type ProviderVideoStatus,
  type ProviderVideoSubmitted,
  VideoGenerationProvider,
  VideoGenerationProviderError,
  type VideoGenerationSubmitContext,
  type VideoGenerationSubmitInput,
  type VideoGenerationUsage,
  type VideoProviderCapabilities,
} from './creative-video-generation.provider';
import {
  type CreativeVideoGenerationRequest,
  CreativeVideoGenerationService,
} from './creative-video-generation.service';
import { CreativeVideoGenerationWorker } from './creative-video-generation.worker';
import {
  heygenCostSnapshot,
  viduCostSnapshot,
  viduPricing,
} from './creative-video-pricing';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
  CreativeGenerationReferenceEntity,
  CreativeVideoAvatarEntity,
  CreativeVideoGenerationEntity,
  CreativeVideoOperationEntity,
  CreativeVideoReferenceEntity,
} from './entities';

const run = describePostgresIntegration();

const VIDU_LIKE: VideoProviderCapabilities = {
  nativeMaxSeconds: 16,
  nativeMinSeconds: 3,
  extension: { minSeconds: 1, maxSeconds: 7 },
  extensionSourceMaxSeconds: 60,
  maxReferenceImages: 6,
  audio: true,
};

/** Fake ISO-BMFF header: sniffed as video/mp4 (metadata is stubbed). */
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(64, 1),
]);

type Submitter = (
  input: VideoGenerationSubmitInput,
  context: VideoGenerationSubmitContext,
) => Promise<ProviderVideoSubmitted>;

/** Scripted provider: records every call; ZERO network. */
class ScriptedVideoProvider extends VideoGenerationProvider {
  readonly pricingVersion = 'test.v1';
  submits: {
    input: VideoGenerationSubmitInput;
    context: VideoGenerationSubmitContext;
  }[] = [];
  submitScript: Submitter[] = [];
  recoverScript: ProviderVideoRecovery[] = [];
  recovers = 0;
  statusScript: ProviderVideoStatus[] = [];
  statusCalls: string[] = [];
  resultScript: (() => Promise<ProviderVideoResult>)[] = [];
  poster: Buffer | null = null;

  constructor(
    readonly id: string,
    readonly mode: CreativeVideoMode,
  ) {
    super();
  }

  override capabilities() {
    return this.mode === 'generative_reel' ? VIDU_LIKE : null;
  }

  submit(
    input: VideoGenerationSubmitInput,
    context: VideoGenerationSubmitContext,
  ) {
    this.submits.push({ input, context });
    const next = this.submitScript.shift();
    if (next) return next(input, context);
    return Promise.resolve(this.accepted(input));
  }

  accepted(input: VideoGenerationSubmitInput): ProviderVideoSubmitted {
    return {
      jobId: `job-${randomUUID()}`,
      model:
        this.mode === 'ugc_avatar'
          ? 'avatar_iv'
          : input.kind === 'extend'
            ? 'q2'
            : 'q3',
      operation: input.kind === 'extend' ? 'extend' : 'generate',
      resolution: '720p',
      usage: null,
    };
  }

  recover() {
    this.recovers += 1;
    return Promise.resolve(
      this.recoverScript.shift() ?? { state: 'unknown' as const },
    );
  }

  getStatus(job: { jobId: string }) {
    this.statusCalls.push(job.jobId);
    return Promise.resolve(
      this.statusScript.shift() ?? {
        state: 'succeeded' as const,
        outputRef: `out-${job.jobId}`,
        durationSeconds: null,
        usage: { metrics: { credits: 100 }, reportedCost: null },
      },
    );
  }

  getResult() {
    const next = this.resultScript.shift();
    return next ? next() : Promise.resolve({ video: MP4, poster: this.poster });
  }

  cost(
    input: VideoGenerationSubmitInput,
    usage: VideoGenerationUsage | null,
    model: string,
  ) {
    if (input.mode === 'ugc_avatar') {
      const seconds = usage?.metrics.seconds;
      return seconds === undefined
        ? null
        : heygenCostSnapshot(seconds, model, input.avatar.avatarType);
    }
    const credits = usage?.metrics.credits;
    return credits === undefined
      ? null
      : viduCostSnapshot(credits, viduPricing(null));
  }

  override parseCallback(request: { rawBody: Buffer | undefined }) {
    const jobId = request.rawBody?.toString('utf8');
    return jobId ? { jobId } : null;
  }
}

/**
 * CS4-B against real PostgreSQL: the migration's constraints and triggers,
 * the step loop under real connections, the operation/cost ledger, paid
 * retry safety, idempotency, Company Context isolation, promotion into the
 * Studio and lifecycle cleanup. Throwaway schema in the guarded `_test`
 * database; dropped at the end.
 */
run('CS4-B creative video generation (real PostgreSQL)', () => {
  const schema = `cs4b_${randomUUID().replace(/-/g, '')}`;
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
  let poster: Buffer;
  let image: Buffer;
  const objects = new Map<string, Buffer>();
  let mediaUpload: MediaAssetUploadService;
  let service: CreativeVideoGenerationService;
  let registry: CreativeVideoProviderRegistry;
  let generative: ScriptedVideoProvider;
  let ugc: ScriptedVideoProvider;
  let brandKitPort: SocialBrandKitContextPort;
  let enabled = true;
  let avatarId: string;
  /** What the stubbed metadata reader answers. */
  let videoDuration = 8;
  let imageSize = { width: 720, height: 1280 };
  const plannerItems = new Map<string, Record<string, unknown>>();
  const plannerReflections: unknown[] = [];
  const generationConfig = new CreativeGenerationConfigService();
  const config = new CreativeVideoGenerationConfigService();

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
      extra: { options: `-c search_path=${schema},public`, max: 10 },
    };
  }

  function worker(id = 'w-1') {
    const instance = new CreativeVideoGenerationWorker(
      db,
      registry,
      mediaUpload,
      generationConfig,
      config,
      brandKitPort,
    );
    (instance as unknown as { workerId: string }).workerId = id;
    return instance;
  }

  /** Makes every pending generation due, then runs worker cycles until idle. */
  async function drive(maxCycles = 25, id = 'w-1') {
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      await db.query(
        `UPDATE social_creative_video_generations SET available_at = now()
          WHERE status IN ('queued', 'processing')`,
      );
      if ((await worker(id).processPending()) === 0) return;
    }
  }

  const enqueue = (
    scope: MediaAssetScope,
    request: CreativeVideoGenerationRequest,
    key: string = randomUUID(),
  ) => service.enqueue(scope, null, request, key);

  async function generationRow(id: string) {
    const [row] = await db.query(
      'SELECT * FROM social_creative_video_generations WHERE id = $1',
      [id],
    );
    return row;
  }

  async function operationRows(id: string) {
    return db.query(
      'SELECT * FROM social_creative_video_generation_operations WHERE generation_id = $1 ORDER BY sequence',
      [id],
    );
  }

  async function durableImage(scope: MediaAssetScope, body = image) {
    return mediaUpload.upload(scope, null, {
      file: { buffer: body, originalname: 'ref.png', mimetype: 'image/png' },
      source: 'upload',
    });
  }

  async function plannerItem(scope: MediaAssetScope, script: string | null) {
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
    plannerItems.set(`${scope.companyContextId}:${item.id}`, {
      ...item,
      script,
      currentRevisionId: null,
      destinations: [],
    });
    return item;
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    image = await sharp({
      create: { width: 9, height: 16, channels: 3, background: '#c0ffee' },
    })
      .png()
      .toBuffer();
    poster = await sharp({
      create: { width: 9, height: 16, channels: 3, background: '#123456' },
    })
      .jpeg()
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
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
        agency_client_id uuid NOT NULL,
        UNIQUE (id, tenant_id, workspace_id, agency_client_id))`);
    await bootstrap.query(
      'INSERT INTO agency_client_company_contexts VALUES ($1,$3,$4,$5), ($2,$3,$4,$5)',
      [companyA, companyB, tenantId, workspaceId, clientId],
    );
    // Publication-side owners the cleanup checks, reduced to their media FK.
    for (const table of [
      'social_publications',
      'social_publication_media',
      'social_destination_creatives',
    ])
      await bootstrap.query(`
        CREATE TABLE ${table} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          media_asset_id uuid NOT NULL REFERENCES media_assets (id) ON DELETE RESTRICT)`);
    const runner = bootstrap.createQueryRunner();
    // Image family (the cleanup worker sweeps both).
    await new CreateSocialCreativeGenerations1797900000000().up(runner);
    await new AddSocialCreativeGenerationIdempotency1798000000000().up(runner);
    await new AddSocialCreativeGenerationContext1798100000000().up(runner);
    await new CreateSocialContentReferences1798200000000().up(runner);
    await new CreateSocialCreativeGenerationReferences1798300000000().up(
      runner,
    );
    await new AddCreativeGenerationCleanupIndexes1798400000000().up(runner);
    await new AddSocialCreativeGenerationDerivation1798500000000().up(runner);
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
          CreativeVideoGenerationEntity,
          CreativeVideoOperationEntity,
          CreativeVideoReferenceEntity,
          CreativeVideoAvatarEntity,
          SocialPlanEntity,
          SocialContentItemEntity,
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
        contentType: 'application/octet-stream',
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
        extract: async ({ mimeType }: { mimeType: string }) =>
          mimeType.startsWith('video/')
            ? {
                width: 720,
                height: 1280,
                durationSeconds: videoDuration,
                codec: 'avc1',
              }
            : { ...imageSize, durationSeconds: null, codec: 'png' },
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
      {
        reflectCreativeStatus: async (_scope: unknown, input: unknown) =>
          void plannerReflections.push(input),
      } as never,
    );
    brandKitPort = new SocialBrandKitContextPort(
      db.getRepository(BrandKitEntity),
      db.getRepository(BrandKitAssetEntity),
      files as unknown as FilesService,
    );
    const planner = {
      getContent: async (scope: MediaAssetScope, id: string) => {
        const item = plannerItems.get(`${scope.companyContextId}:${id}`);
        if (!item) throw new NotFoundException();
        return item;
      },
    };
    const context = new CreativeGenerationContextService(
      {
        load: async () => ({
          palette: [],
          typography: [],
          guidelines: null,
          assets: [],
          references: [],
        }),
      } as never,
      planner as never,
      {
        listContentReferences: async (scope: MediaAssetScope, id: string) => {
          if (!plannerItems.has(`${scope.companyContextId}:${id}`))
            throw new NotFoundException();
          return [];
        },
      } as never,
    );

    generative = new ScriptedVideoProvider('vidu-test', 'generative_reel');
    ugc = new ScriptedVideoProvider('heygen-test', 'ugc_avatar');
    for (const provider of [generative, ugc])
      Object.defineProperty(provider, 'enabled', { get: () => enabled });
    registry = new CreativeVideoProviderRegistry(
      new Map<CreativeVideoMode, VideoGenerationProvider>([
        ['generative_reel', generative],
        ['ugc_avatar', ugc],
      ]),
      new Map<string, VideoGenerationProvider>([
        [generative.id, generative],
        [ugc.id, ugc],
      ]),
    );
    service = new CreativeVideoGenerationService(
      registry,
      config,
      db.getRepository(CreativeVideoGenerationEntity),
      db.getRepository(CreativeVideoOperationEntity),
      db.getRepository(CreativeVideoReferenceEntity),
      db.getRepository(CreativeVideoAvatarEntity),
      mediaRepository,
      db.getRepository(CreativeAssetEntity),
      mediaUpload,
      assets,
      {} as never,
      context,
      new CreativeGenerationReferenceSelector(brandKitPort, mediaRepository),
      planner as never,
    );

    const avatar = await db.getRepository(CreativeVideoAvatarEntity).save({
      provider: 'heygen-test',
      providerAvatarId: 'look_ana',
      name: 'Ana',
      avatarType: 'studio_avatar',
      supportedEngines: ['avatar_iv'],
      providerVoiceId: 'voice_ana',
      previewImageUrl: null,
      available: true,
    });
    avatarId = avatar.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(() => {
    enabled = true;
    videoDuration = 8;
    imageSize = { width: 720, height: 1280 };
    for (const provider of [generative, ugc]) {
      provider.submits = [];
      provider.submitScript = [];
      provider.recoverScript = [];
      provider.recovers = 0;
      provider.statusScript = [];
      provider.statusCalls = [];
      provider.resultScript = [];
      provider.poster = null;
    }
  });

  afterEach(async () => {
    for (const name of [
      'CREATIVE_VIDEO_PROVIDER_CONCURRENCY',
      'CREATIVE_VIDEO_MAX_STEP_RETRIES',
      'CREATIVE_GENERATION_CLEANUP_ENABLED',
      'CREATIVE_GENERATION_CLEANUP_DRY_RUN',
    ])
      delete process.env[name];
    // Leave nothing claimable or holding a provider slot.
    await db.query(
      `UPDATE social_creative_video_generations
          SET status = 'failed', failed_at = now(), error_code = 'provider_failed',
              locked_at = NULL, locked_by = NULL
        WHERE status IN ('queued', 'processing')`,
    );
    await db.query(
      `UPDATE social_creative_video_generation_operations
          SET status = 'failed', failed_at = now(), error_code = 'provider_failed'
        WHERE status IN ('pending', 'submitting', 'submitted')`,
    );
  });

  // ── schema ──────────────────────────────────────────────────────────────

  describe('migration', () => {
    it('is re-runnable and reversible: up → up → down → up', async () => {
      const runner = db.createQueryRunner();
      const migration = new CreateSocialCreativeVideoGenerations1798600000000();
      try {
        await runner.startTransaction();
        await migration.up(runner);
        await migration.down(runner);
        const [gone] = await runner.query(
          `SELECT to_regclass('social_creative_video_generations') AS t,
                  to_regclass('social_creative_video_generation_operations') AS o`,
        );
        expect(gone).toEqual({ t: null, o: null });
        await migration.up(runner);
        await migration.up(runner);
        const [back] = await runner.query(
          `SELECT to_regclass('social_creative_video_generations') AS t`,
        );
        expect(back.t).not.toBeNull();
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  });

  // ── lifecycle ───────────────────────────────────────────────────────────

  describe('generative Reel', () => {
    it('8 s from a vertical start frame: one operation, job id persisted, cost snapshot, temporary MP4', async () => {
      const frame = await durableImage(scopeA);
      generative.poster = poster;
      // Synthetic: the creation response reports 104 credits, the finished
      // task 96 (official Q3 turbo 720p: 12 cr/s × 8 s). The ledger must end
      // with what the provider reports as consumed by the finished task.
      generative.submitScript.push(async (input) => ({
        ...generative.accepted(input),
        jobId: 'job-eight',
        usage: { metrics: { credits: 104 }, reportedCost: null },
      }));
      generative.statusScript.push(
        { state: 'pending' },
        {
          state: 'succeeded',
          outputRef: 'c-8',
          durationSeconds: null,
          usage: { metrics: { credits: 96 }, reportedCost: null },
        },
      );

      const accepted = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'café fumegando',
        durationSeconds: 8,
        startFrame: { source: 'operator', id: frame.id, kind: 'product' },
      });
      expect(accepted).toMatchObject({ status: 'queued' });
      const queued = await generationRow(accepted.generationId);
      expect(queued).toMatchObject({
        provider: 'vidu-test',
        input_kind: 'image',
        aspect_ratio: '9:16',
      });
      expect(queued.effective_prompt).toContain('café fumegando');
      expect(await operationRows(accepted.generationId)).toHaveLength(1);

      // Step 1: submit. The job id is on the operation right away.
      await drive(1);
      const [submitted] = await operationRows(accepted.generationId);
      expect(submitted).toMatchObject({
        status: 'submitted',
        provider_job_id: 'job-eight',
        cost_amount: '0.520000',
        cost_source: 'lyra_calculated',
        pricing_version: 'vidu.credits.2026-10',
      });
      expect((await generationRow(accepted.generationId)).provider_job_id).toBe(
        'job-eight',
      );
      const sent = generative.submits[0].input;
      expect(sent).toMatchObject({
        kind: 'generate',
        inputKind: 'image',
        durationSeconds: 8,
      });
      expect(
        sent.kind === 'generate' &&
          sent.mode === 'generative_reel' &&
          sent.images[0].body.equals(image),
      ).toBe(true);

      await drive();
      const done = await generationRow(accepted.generationId);
      expect(done).toMatchObject({
        status: 'completed',
        duration_actual_seconds: '8.000',
        has_audio: false,
        // The final status credits replace the creation response's on the ledger.
        cost_amount: '0.480000',
        cost_currency: 'USD',
      });
      const [operation] = await operationRows(accepted.generationId);
      expect(operation).toMatchObject({
        status: 'succeeded',
        billed_units: '96.000',
        provider_output_ref: 'c-8',
      });

      const view = await service.get(scopeA, accepted.generationId);
      expect(view).toMatchObject({
        status: 'completed',
        progress: { steps: 1, completedSteps: 1 },
        output: {
          available: true,
          mimeType: 'video/mp4',
          durationSeconds: 8,
          hasAudio: false,
        },
      });
      expect(view.output?.posterPath).toBe(
        `/social/creative-studio/video-generations/${accepted.generationId}/poster`,
      );
      // No provider, model, job id, credits or cost in the public view.
      const json = JSON.stringify(view);
      for (const secret of [
        'vidu-test',
        'job-eight',
        'credits',
        '0.48',
        'q3',
        'pricing',
      ])
        expect(json).not.toContain(secret);
      const media = await db
        .getRepository(MediaAssetEntity)
        .findOneByOrFail({ id: done.output_media_asset_id });
      expect(media.source).toBe(CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE);
      const content = await service.readContent(scopeA, accepted.generationId);
      expect(content.asset.mimeType).toBe('video/mp4');
    });

    it('30 s = 16 s + 7 s + 7 s native extensions; one generation, three paid operations, exact total', async () => {
      videoDuration = 30;
      // Official table (docs/overview/pricing, 2026-10-08), 720p standard:
      //   Q3 turbo 16 s       = 12 cr/s × 16             = 192
      //   Q2 turbo extend +7s = 15 + 5 cr/s × 7 (added)  =  50
      // Fixtures only: the code never computes credits, it records the
      // provider-reported `credits` of each finished task.
      const credits = [192, 50, 50];
      generative.statusScript.push(
        ...credits.map((value, index) => ({
          state: 'succeeded' as const,
          outputRef: `c-${index}`,
          durationSeconds: null,
          usage: { metrics: { credits: value }, reportedCost: null },
        })),
      );

      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'tour pelo café',
        durationSeconds: 30,
      });
      await drive();

      const operations = await operationRows(generationId);
      expect(
        operations.map((op: { kind: string; duration_seconds: number }) => [
          op.kind,
          op.duration_seconds,
        ]),
      ).toEqual([
        ['generate', 16],
        ['extend', 7],
        ['extend', 7],
      ]);
      expect(
        operations.map((op: { cost_amount: string }) => op.cost_amount),
      ).toEqual(['0.960000', '0.250000', '0.250000']);
      // Each extension continues the PREVIOUS operation's own job/output.
      const extends_ = generative.submits
        .map((call) => call.input)
        .filter((input) => input.kind === 'extend');
      expect(
        extends_.map((input) => input.kind === 'extend' && input.previous),
      ).toEqual([
        { jobId: operations[0].provider_job_id, outputRef: 'c-0' },
        { jobId: operations[1].provider_job_id, outputRef: 'c-1' },
      ]);
      // A fresh dispatch key per operation.
      expect(
        new Set(generative.submits.map((call) => call.context.dispatchKey))
          .size,
      ).toBe(3);
      expect(await generationRow(generationId)).toMatchObject({
        status: 'completed',
        cost_amount: '1.460000',
        duration_actual_seconds: '30.000',
      });
      const view = await service.get(scopeA, generationId);
      expect(view.progress).toEqual({ steps: 3, completedSteps: 3 });
    });

    it('refuses what cannot be done natively: audio over 16 s, a non-vertical start frame, brand start frame', async () => {
      await expect(
        enqueue(scopeA, {
          mode: 'generative_reel',
          prompt: 'x',
          durationSeconds: 20,
          audio: true,
        }),
      ).rejects.toMatchObject({
        response: { code: 'video_audio_unavailable_for_duration' },
      });
      imageSize = { width: 1080, height: 1080 };
      const square = await durableImage(scopeA);
      await expect(
        enqueue(scopeA, {
          mode: 'generative_reel',
          prompt: 'x',
          startFrame: { source: 'operator', id: square.id, kind: 'product' },
        }),
      ).rejects.toMatchObject({
        response: { code: 'video_start_frame_not_vertical' },
      });
      await expect(
        enqueue(scopeA, {
          mode: 'generative_reel',
          prompt: 'x',
          startFrame: { source: 'brand', id: randomUUID() },
        }),
      ).rejects.toMatchObject({
        response: { code: 'video_start_frame_unsupported' },
      });
      await expect(
        enqueue(scopeA, {
          mode: 'generative_reel',
          prompt: 'x',
          script: 'falar',
        }),
      ).rejects.toMatchObject({
        response: { code: 'video_field_not_allowed' },
      });
      expect(generative.submits).toHaveLength(0);
    });
  });

  describe('UGC avatar', () => {
    it('routes to the UGC provider; actual duration and per-second cost recorded after generation', async () => {
      videoDuration = 23.4;
      ugc.statusScript.push({
        state: 'succeeded',
        outputRef: null,
        durationSeconds: 23.4,
        usage: { metrics: { seconds: 23.4 }, reportedCost: null },
      });
      const { generationId } = await enqueue(scopeA, {
        mode: 'ugc_avatar',
        script: 'Oi! Conheça o novo café da casa.',
        avatarId,
        language: 'pt-BR',
        durationSeconds: 15,
      });
      await drive();

      expect(await generationRow(generationId)).toMatchObject({
        provider: 'heygen-test',
        status: 'completed',
        duration_requested_seconds: 15,
        duration_actual_seconds: '23.400',
        has_audio: true,
        // CS4 Closeout official table (heygen.payg.2026-10): Avatar IV studio
        // look = 0.0805 USD/s → 23.4 s × 0.0805 = 1.8837, unrounded.
        cost_amount: '1.883700',
      });
      const [operation] = await operationRows(generationId);
      expect(operation).toMatchObject({
        provider_model: 'avatar_iv',
        unit_kind: 'output_second:avatar_iv:studio_avatar',
        billed_units: '23.400',
        pricing_version: 'heygen.payg.2026-10',
      });
      // Provider ids resolved from Lyra's catalog only inside the worker.
      expect(ugc.submits[0].input).toMatchObject({
        script: 'Oi! Conheça o novo café da casa.',
        avatar: { providerAvatarId: 'look_ana', providerVoiceId: 'voice_ana' },
        language: 'pt-BR',
      });
      expect(generative.submits).toHaveLength(0);
    });

    it('takes the Planner item script verbatim; an edited script under the same key is a 409', async () => {
      const item = await plannerItem(
        scopeA,
        'Roteiro do Planner, palavra por palavra.',
      );
      const key = randomUUID();
      const first = await enqueue(
        scopeA,
        { mode: 'ugc_avatar', contentItemId: item.id, avatarId },
        key,
      );
      expect(await generationRow(first.generationId)).toMatchObject({
        script: 'Roteiro do Planner, palavra por palavra.',
        script_source: 'planner',
        content_item_id: item.id,
      });
      await expect(
        enqueue(
          scopeA,
          { mode: 'ugc_avatar', contentItemId: item.id, avatarId },
          key,
        ),
      ).resolves.toMatchObject({ generationId: first.generationId });
      plannerItems.set(`${companyA}:${item.id}`, {
        ...plannerItems.get(`${companyA}:${item.id}`),
        script: 'Roteiro editado depois.',
      });
      await expect(
        enqueue(
          scopeA,
          { mode: 'ugc_avatar', contentItemId: item.id, avatarId },
          key,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      // Too long is refused, never truncated.
      await expect(
        enqueue(scopeA, {
          mode: 'ugc_avatar',
          script: 'a'.repeat(901),
          avatarId,
        }),
      ).rejects.toMatchObject({ response: { code: 'video_script_too_long' } });
    });

    it('an unknown or unavailable avatar is refused', async () => {
      await expect(
        enqueue(scopeA, {
          mode: 'ugc_avatar',
          script: 'oi',
          avatarId: randomUUID(),
        }),
      ).rejects.toMatchObject({ response: { code: 'video_avatar_not_found' } });
    });
  });

  // ── paid retry safety ───────────────────────────────────────────────────

  describe('retry safety (a job created is never bought twice)', () => {
    it('answer lost → stays `submitting` → recovery adopts the existing job; one submit only', async () => {
      generative.submitScript.push(() =>
        Promise.reject(
          new VideoGenerationProviderError('timeout', true, 'unknown'),
        ),
      );
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive(1);
      const [lost] = await operationRows(generationId);
      expect(lost).toMatchObject({
        status: 'submitting',
        provider_job_id: null,
        submit_attempts: 1,
      });
      expect(lost.dispatch_started_at).not.toBeNull();

      generative.recoverScript.push({
        state: 'found',
        submitted: {
          jobId: 'job-found',
          model: 'q3',
          operation: 'generate',
          resolution: '720p',
          usage: null,
        },
      });
      await drive();
      expect(generative.submits).toHaveLength(1);
      expect(generative.recovers).toBe(1);
      const [operation] = await operationRows(generationId);
      expect(operation).toMatchObject({
        status: 'succeeded',
        provider_job_id: 'job-found',
      });
      expect((await generationRow(generationId)).status).toBe('completed');
    });

    it('recovery that cannot prove anything gives up as `timeout` — never resubmits', async () => {
      process.env.CREATIVE_VIDEO_MAX_STEP_RETRIES = '2';
      generative.submitScript.push(() =>
        Promise.reject(
          new VideoGenerationProviderError('unavailable', true, 'unknown'),
        ),
      );
      const { generationId } = await service.enqueue(
        scopeA,
        null,
        { mode: 'generative_reel', prompt: 'x', durationSeconds: 5 },
        randomUUID(),
      );
      // max_step_retries is frozen at enqueue.
      expect((await generationRow(generationId)).max_step_retries).toBe(2);
      await drive();
      expect(generative.submits).toHaveLength(1);
      expect(generative.recovers).toBeGreaterThanOrEqual(1);
      expect(await generationRow(generationId)).toMatchObject({
        status: 'failed',
        error_code: 'timeout',
      });
    });

    it('proven absent → submits again with a NEW dispatch key', async () => {
      generative.submitScript.push(() =>
        Promise.reject(
          new VideoGenerationProviderError('timeout', true, 'unknown'),
        ),
      );
      generative.recoverScript.push({ state: 'absent' });
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive();
      expect(generative.submits).toHaveLength(2);
      expect(generative.submits[0].context.dispatchKey).not.toBe(
        generative.submits[1].context.dispatchKey,
      );
      expect((await generationRow(generationId)).status).toBe('completed');
    });

    it('a refused, retryable submit created nothing: back to pending and retried', async () => {
      generative.submitScript.push(() =>
        Promise.reject(
          new VideoGenerationProviderError('rate_limited', true, 'refused'),
        ),
      );
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive(1);
      expect((await operationRows(generationId))[0]).toMatchObject({
        status: 'pending',
        submit_attempts: 1,
      });
      expect((await generationRow(generationId)).transient_failures).toBe(1);
      await drive();
      expect(generative.submits).toHaveLength(2);
      expect((await generationRow(generationId)).status).toBe('completed');
    });

    it('the job id is persisted even when the worker lost its lease mid-call', async () => {
      generative.submitScript.push(async (input) => {
        // Another worker took the generation over while we waited.
        await db.query(
          `UPDATE social_creative_video_generations SET locked_by = 'w-other' WHERE status = 'processing'`,
        );
        return { ...generative.accepted(input), jobId: 'job-kept' };
      });
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive(1);
      expect((await operationRows(generationId))[0]).toMatchObject({
        status: 'submitted',
        provider_job_id: 'job-kept',
      });
    });

    it('provider_job_id is write-once and unique per provider (database)', async () => {
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive(1);
      const [operation] = await operationRows(generationId);
      await expect(
        db.query(
          `UPDATE social_creative_video_generation_operations SET provider_job_id = 'other' WHERE id = $1`,
          [operation.id],
        ),
      ).rejects.toThrow(/write-once/);
      await expect(
        db.query(
          `UPDATE social_creative_video_generations SET provider_job_id = 'other' WHERE id = $1`,
          [generationId],
        ),
      ).rejects.toThrow(/write-once/);
      const second = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'y',
        durationSeconds: 5,
      });
      const [other] = await operationRows(second.generationId);
      await expect(
        db.query(
          `UPDATE social_creative_video_generation_operations
              SET status = 'submitted', provider_job_id = $2, accepted_at = now(),
                  dispatch_key = 'k', dispatch_started_at = now()
            WHERE id = $1`,
          [other.id, operation.provider_job_id],
        ),
      ).rejects.toThrow(/UQ_social_creative_video_operations_job|duplicate/);
    });

    it('a terminal operation (and its cost snapshot) is immutable', async () => {
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive();
      const [operation] = await operationRows(generationId);
      expect(operation.status).toBe('succeeded');
      await expect(
        db.query(
          `UPDATE social_creative_video_generation_operations SET cost_amount = 0 WHERE id = $1`,
          [operation.id],
        ),
      ).rejects.toThrow(/immutable/);
    });

    it('two workers never submit the same operation twice', async () => {
      await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          enqueue(scopeA, {
            mode: 'generative_reel',
            prompt: `p${index}`,
            durationSeconds: 5,
          }),
        ),
      );
      await Promise.all([
        worker('w-a').processPending(),
        worker('w-b').processPending(),
        worker('w-c').processPending(),
      ]);
      const perOperation = new Map<string, number>();
      for (const call of generative.submits)
        perOperation.set(
          call.context.dispatchKey,
          (perOperation.get(call.context.dispatchKey) ?? 0) + 1,
        );
      expect(generative.submits.length).toBeGreaterThan(0);
      expect([...perOperation.values()].every((count) => count === 1)).toBe(
        true,
      );
    });

    it('tenant fairness: one worker starts at most CREATIVE_VIDEO_TENANT_CONCURRENCY generations', async () => {
      process.env.CREATIVE_VIDEO_WORKER_CONCURRENCY = '8';
      for (let index = 0; index < 4; index += 1)
        await enqueue(scopeA, {
          mode: 'generative_reel',
          prompt: `t${index}`,
          durationSeconds: 5,
        });
      await expect(worker('w-fair').processPending()).resolves.toBe(2);
      delete process.env.CREATIVE_VIDEO_WORKER_CONCURRENCY;
    });

    it('provider concurrency cap: excess work waits in Lyra, not in the provider queue', async () => {
      process.env.CREATIVE_VIDEO_PROVIDER_CONCURRENCY = '1';
      generative.statusScript.push(
        { state: 'pending' },
        { state: 'pending' },
        { state: 'pending' },
      );
      await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'a',
        durationSeconds: 5,
      });
      await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'b',
        durationSeconds: 5,
      });
      await drive(3);
      expect(generative.submits).toHaveLength(1);
    });
  });

  // ── idempotency / scope / disabled ──────────────────────────────────────

  describe('idempotency', () => {
    it('same key + same intent = same generation; any change of intent = 409', async () => {
      const key = randomUUID();
      const request: CreativeVideoGenerationRequest = {
        mode: 'generative_reel',
        prompt: 'vitrine',
        durationSeconds: 10,
        quality: 'standard',
      };
      const first = await enqueue(scopeA, request, key);
      await expect(enqueue(scopeA, { ...request }, key)).resolves.toEqual(
        first,
      );
      for (const change of [
        { durationSeconds: 12 },
        { quality: 'high' as const },
        { prompt: 'outra vitrine' },
      ])
        await expect(
          enqueue(scopeA, { ...request, ...change }, key),
        ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        enqueue(scopeA, { mode: 'ugc_avatar', script: 'oi', avatarId }, key),
      ).rejects.toBeInstanceOf(ConflictException);
      const [{ count }] = await db.query(
        'SELECT count(*)::int AS count FROM social_creative_video_generations WHERE idempotency_key = $1',
        [key],
      );
      expect(count).toBe(1);
    });

    it('concurrent requests with one key create exactly one generation and one plan', async () => {
      const key = randomUUID();
      const answers = await Promise.all(
        Array.from({ length: 6 }, () =>
          enqueue(
            scopeA,
            { mode: 'generative_reel', prompt: 'corrida', durationSeconds: 30 },
            key,
          ),
        ),
      );
      expect(new Set(answers.map((answer) => answer.generationId)).size).toBe(
        1,
      );
      expect(await operationRows(answers[0].generationId)).toHaveLength(3);
    });

    it('requires a valid Idempotency-Key', async () => {
      await expect(
        service.enqueue(
          scopeA,
          null,
          { mode: 'generative_reel', prompt: 'x' },
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('Company Context', () => {
    it('another company of the same client cannot read, stream, promote or reference', async () => {
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'A',
        durationSeconds: 5,
      });
      await drive();
      await expect(service.get(scopeB, generationId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.readContent(scopeB, generationId),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.promoteToNewAsset(scopeB, null, generationId, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Same answer as an id that never existed.
      await expect(service.get(scopeA, randomUUID())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const frameOfA = await durableImage(scopeA);
      await expect(
        enqueue(scopeB, {
          mode: 'generative_reel',
          prompt: 'B',
          startFrame: { source: 'operator', id: frameOfA.id, kind: 'product' },
        }),
      ).rejects.toMatchObject({ response: { code: 'reference_not_found' } });
      // A Planner item of A is invisible to B.
      const item = await plannerItem(scopeA, 'roteiro');
      await expect(
        enqueue(scopeB, {
          mode: 'ugc_avatar',
          contentItemId: item.id,
          avatarId,
        }),
      ).rejects.toMatchObject({ response: { code: 'content_item_not_found' } });
    });
  });

  it('provider disabled → 503 and nothing enqueued', async () => {
    enabled = false;
    const key = randomUUID();
    await expect(
      enqueue(
        scopeA,
        { mode: 'generative_reel', prompt: 'x', durationSeconds: 5 },
        key,
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'video_generation_unavailable' },
    });
    const [{ count }] = await db.query(
      'SELECT count(*)::int AS count FROM social_creative_video_generations WHERE idempotency_key = $1',
      [key],
    );
    expect(count).toBe(0);
  });

  it('kill switch mid-generation: no NEW submit (pending extension fails `unavailable`)', async () => {
    const { generationId } = await enqueue(scopeA, {
      mode: 'generative_reel',
      prompt: 'x',
      durationSeconds: 30,
    });
    await drive(2); // initial submitted + succeeded
    enabled = false;
    await drive();
    expect(generative.submits).toHaveLength(1);
    expect(await generationRow(generationId)).toMatchObject({
      status: 'failed',
      error_code: 'unavailable',
    });
    // The paid initial operation keeps its cost on the generation.
    expect((await generationRow(generationId)).cost_amount).toBe('0.500000');
  });

  // ── failures ────────────────────────────────────────────────────────────

  describe('failures', () => {
    it('provider job failed → generation failed with a public, sanitized code', async () => {
      generative.statusScript.push({
        state: 'failed',
        code: 'rejected',
        usage: { metrics: { credits: 0 }, reportedCost: null },
      });
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive();
      expect(await generationRow(generationId)).toMatchObject({
        status: 'failed',
        error_code: 'rejected',
        cost_amount: '0.000000',
      });
      const view = await service.get(scopeA, generationId);
      expect(view.error).toMatchObject({
        code: 'video_generation_rejected',
        retryable: false,
      });
      expect(view.output).toBeNull();
    });

    it('a reference whose bytes changed fails before any provider call', async () => {
      const frame = await durableImage(scopeA);
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        startFrame: { source: 'operator', id: frame.id, kind: 'product' },
      });
      objects.set(frame.storagePath, poster);
      await drive();
      expect(generative.submits).toHaveLength(0);
      expect(await generationRow(generationId)).toMatchObject({
        status: 'failed',
        error_code: 'reference_unavailable',
      });
    });

    it('unusable paid output → invalid_output, final (never re-bought)', async () => {
      generative.resultScript.push(async () => ({
        video: Buffer.from('not a video'),
        poster: null,
      }));
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive();
      expect(generative.submits).toHaveLength(1);
      expect(await generationRow(generationId)).toMatchObject({
        status: 'failed',
        error_code: 'invalid_output',
      });
    });
  });

  // ── promotion / Planner / cleanup / callbacks ───────────────────────────

  describe('promotion', () => {
    it('temporary → durable video Creative Asset with poster thumbnail; once; linked to the Planner item', async () => {
      const item = await plannerItem(scopeA, null);
      generative.poster = poster;
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'promo',
        contentItemId: item.id,
        durationSeconds: 5,
      });
      await drive();
      plannerReflections.length = 0;

      const asset = await service.promoteToNewAsset(
        scopeA,
        null,
        generationId,
        { name: 'Reel promo' },
      );
      expect(asset).toMatchObject({
        assetType: 'video',
        sourceType: 'generated',
        contentItemId: item.id,
      });
      const version = await db
        .getRepository(CreativeAssetVersionEntity)
        .findOneByOrFail({ id: asset.currentVersionId as string });
      expect(version.thumbnailMediaAssetId).not.toBeNull();
      const durable = await db
        .getRepository(MediaAssetEntity)
        .findOneByOrFail({ id: version.mediaAssetId });
      expect(durable.source).toBe('creative_studio');
      const row = await generationRow(generationId);
      expect(durable.id).not.toBe(row.output_media_asset_id);
      expect(row).toMatchObject({
        promotion_kind: 'new_asset',
        promoted_creative_asset_id: asset.id,
      });
      // Planner reflection through its owner, never written here.
      expect(plannerReflections).toEqual([
        expect.objectContaining({
          contentItemId: item.id,
          status: 'creative_in_progress',
        }),
      ]);

      await expect(
        service.promoteToNewAsset(scopeA, null, generationId, {}),
      ).resolves.toMatchObject({ id: asset.id });
      await expect(
        service.promoteToVersion(scopeA, null, generationId, {
          assetId: asset.id,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('promote as a new version of an existing video asset', async () => {
      const first = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'v1',
        durationSeconds: 5,
      });
      const second = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'v2',
        durationSeconds: 5,
      });
      await drive();
      const asset = await service.promoteToNewAsset(
        scopeA,
        null,
        first.generationId,
        {},
      );
      const version = await service.promoteToVersion(
        scopeA,
        null,
        second.generationId,
        { assetId: asset.id },
      );
      expect(version).toMatchObject({ versionNumber: 2, source: 'replace' });
    });

    it('a generation not completed cannot be promoted', async () => {
      generative.statusScript.push({ state: 'pending' });
      const { generationId } = await enqueue(scopeA, {
        mode: 'generative_reel',
        prompt: 'x',
        durationSeconds: 5,
      });
      await drive(1);
      await expect(
        service.promoteToNewAsset(scopeA, null, generationId, {}),
      ).rejects.toMatchObject({
        response: { code: 'video_generation_not_completed' },
      });
    });
  });

  it('cleanup expires a promoted Reel binary and its poster; provenance stays, content answers 410', async () => {
    generative.poster = poster;
    const { generationId } = await enqueue(scopeA, {
      mode: 'generative_reel',
      prompt: 'limpeza',
      durationSeconds: 5,
    });
    await drive();
    await service.promoteToNewAsset(scopeA, null, generationId, {});
    const before = await generationRow(generationId);
    expect(before.poster_media_asset_id).not.toBeNull();

    process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
    process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
    const cleanup = new CreativeGenerationCleanupWorker(
      db,
      mediaUpload,
      generationConfig,
    );
    const [result] = await cleanup.run();
    expect(result.eligible.promoted).toBeGreaterThanOrEqual(2);

    const after = await generationRow(generationId);
    expect(after).toMatchObject({
      status: 'completed',
      output_media_asset_id: null,
      poster_media_asset_id: null,
    });
    expect(after.promoted_version_id).toBe(before.promoted_version_id);
    expect(await operationRows(generationId)).toHaveLength(1);
    await expect(
      service.readContent(scopeA, generationId),
    ).rejects.toBeInstanceOf(GoneException);
    expect((await service.get(scopeA, generationId)).output).toMatchObject({
      available: false,
      contentPath: null,
    });
  });

  it('callbacks only wake the generation up; unknown job ids change nothing', async () => {
    generative.statusScript.push({ state: 'pending' });
    const { generationId } = await enqueue(scopeA, {
      mode: 'generative_reel',
      prompt: 'x',
      durationSeconds: 5,
    });
    await drive(2);
    const [operation] = await operationRows(generationId);
    await db.query(
      `UPDATE social_creative_video_generations SET available_at = now() + interval '1 hour' WHERE id = $1`,
      [generationId],
    );
    const callbacks = new CreativeVideoCallbackService(db, registry);
    const request = (body: string) => ({
      method: 'POST',
      path: '/x',
      query: '',
      headers: {},
      rawBody: Buffer.from(body),
    });

    await callbacks.handle('vidu-test', request('job-that-does-not-exist'));
    const untouched = await generationRow(generationId);
    expect(new Date(untouched.available_at).getTime()).toBeGreaterThan(
      Date.now() + 30 * 60_000,
    );

    await callbacks.handle('vidu-test', request(operation.provider_job_id));
    const woken = await generationRow(generationId);
    expect(new Date(woken.available_at).getTime()).toBeLessThanOrEqual(
      Date.now() + 1000,
    );
    // Nothing else moved: status still comes from the authenticated poll.
    expect(woken.status).toBe('processing');
    await callbacks.handle(
      'unknown-provider',
      request(operation.provider_job_id),
    );
  });
});
