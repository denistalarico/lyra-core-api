import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { MediaAssetUploadService } from '../../common/media-assets';
import type { CreativeStudioBrandContext } from './creative-brand-context.service';
import type { CreativeAssetService } from './creative-asset.service';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  buildGenerationContext,
  type CreativeGenerationContextService,
} from './creative-generation-context';
import {
  DisabledImageGenerationProvider,
  ImageGenerationProvider,
  type ImageGenerationProviderResult,
} from './creative-image-generation.provider';
import { CreativeGenerationReferenceSelector } from './creative-generation-references';
import {
  CreativeImageGenerationException,
  type CreativeImageGenerationRequest,
  CreativeImageGenerationService,
  imageRequestFingerprint,
} from './creative-image-generation.service';
import { CREATIVE_GENERATION_MEDIA_SOURCE } from './creative-retention';
import type { CreativeStudioScope } from './creative-studio.scope';
import type { CreativeVersionApprovalService } from './creative-version-approval.service';
import type {
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
} from './entities';

const companyA: CreativeStudioScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};
const EMPTY_BRAND: CreativeStudioBrandContext = {
  palette: [],
  typography: [],
  guidelines: null,
  assets: [],
  references: [],
};
const EMPTY_DIGEST = buildGenerationContext({
  contentItemId: null,
  brand: EMPTY_BRAND,
  item: null,
}).digest;
const CONTENT_ID = '40000000-0000-4000-8000-000000000001';
type PlannerItem = NonNullable<
  Parameters<typeof buildGenerationContext>[0]['item']
>;
function plannerItem(patch: Partial<PlannerItem> = {}): PlannerItem {
  return {
    id: CONTENT_ID,
    planId: '41000000-0000-4000-8000-000000000001',
    title: 'Lançamento do blend de inverno',
    theme: null,
    brief: 'Mostrar o café em clima aconchegante',
    keyMessage: null,
    copy: null,
    caption: 'Chegou o blend de inverno',
    script: null,
    cta: null,
    hashtags: [],
    firstComment: null,
    currentRevisionId: '42000000-0000-4000-8000-000000000001',
    funnelStage: null,
    contentType: 'post',
    objective: null,
    creativeFormat: 'image',
    planningStatus: 'copy_ready',
    calendarOnly: false,
    plannedDate: null,
    sortOrder: 0,
    campaignInstanceId: null,
    editorialPillarId: null,
    destinations: [],
    archivedAt: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    ...patch,
  } as PlannerItem;
}
const PNG = Buffer.concat([
  Buffer.from([0x89]),
  Buffer.from('PNG\r\n\x1a\n', 'latin1'),
  Buffer.alloc(32, 1),
]);

/** A durable, in-scope image as the media boundary would answer it. */
function durableImage(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    mimeType: 'image/png',
    byteSize: '2048',
    checksum: createHash('sha256').update(id).digest('hex'),
    ...patch,
  };
}

class EnabledProvider extends ImageGenerationProvider {
  readonly id = 'fake';
  generate(): Promise<ImageGenerationProviderResult> {
    return Promise.reject(new Error('the API never calls the provider'));
  }
}

function generationRow(
  patch: Partial<CreativeGenerationEntity> = {},
): CreativeGenerationEntity {
  return {
    id: 'gen-1',
    ...companyA,
    generationType: 'image',
    status: 'completed',
    originType: 'fresh',
    originGenerationId: null,
    originOutputId: null,
    originVersionId: null,
    prompt: 'café na mesa',
    outputCount: 1,
    aspectRatio: '1:1',
    quality: 'standard',
    contentItemId: null,
    effectivePrompt: 'composed: café na mesa',
    generationContext: null,
    idempotencyKey: 'key-1',
    requestFingerprint: imageRequestFingerprint({
      prompt: 'café na mesa',
      contentItemId: null,
      outputCount: 1,
      aspectRatio: '1:1',
      quality: 'standard',
      contextDigest: EMPTY_DIGEST,
      referencesDigest: null,
    }),
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date('2026-10-05T10:00:00Z'),
    lockedAt: null,
    lockedBy: null,
    errorCode: null,
    errorRetryable: null,
    provider: 'secret-provider',
    model: 'secret-model',
    usageMetrics: { images: 1 },
    costAmount: '0.040000',
    costCurrency: 'USD',
    requestedById: 'user-a',
    createdAt: new Date('2026-10-05T10:00:00Z'),
    updatedAt: new Date('2026-10-05T10:00:30Z'),
    startedAt: new Date('2026-10-05T10:00:05Z'),
    completedAt: new Date('2026-10-05T10:00:30Z'),
    failedAt: null,
    ...patch,
  };
}

function outputRow(
  patch: Partial<CreativeGenerationOutputEntity> = {},
): CreativeGenerationOutputEntity {
  return {
    id: 'output-1',
    generationId: 'gen-1',
    outputIndex: 0,
    mediaAssetId: 'media-1',
    promotionKind: null,
    promotedCreativeAssetId: null,
    promotedVersionId: null,
    promotedById: null,
    promotedAt: null,
    createdAt: new Date('2026-10-05T10:00:30Z'),
    ...patch,
  };
}

function harness(provider: ImageGenerationProvider = new EnabledProvider()) {
  let output = outputRow();
  /** What an idempotency-key lookup finds; `null` = key never used. */
  let byKey: CreativeGenerationEntity | null = null;
  const generations = {
    create: jest.fn((row: object) => row),
    save: jest.fn(
      async (row: object): Promise<object> => ({
        ...row,
        id: 'gen-new',
      }),
    ),
    findOne: jest.fn(
      async ({ where }: { where: { idempotencyKey?: string } }) =>
        where.idempotencyKey === undefined ? generationRow() : byKey,
    ),
    exists: jest.fn(async () => true),
  };
  const outputs = {
    find: jest.fn(async () => [output]),
    findOneBy: jest.fn(async () => output),
  };
  const media = {
    find: jest.fn(async () => [
      {
        id: 'media-1',
        mimeType: 'image/png',
        width: 1024,
        height: 1024,
        byteSize: String(PNG.length),
        storagePath: 'media-assets/secret-key.png',
      },
    ]),
  };
  const creativeAssets = {
    findOne: jest.fn(async () => ({ id: 'asset-new' })),
  };
  const mediaUpload = {
    getTemporaryContent: jest.fn(async () => ({
      asset: {
        id: 'media-1',
        mimeType: 'image/png',
        originalFilename: 'imagem-gerada-1.png',
        storagePath: 'media-assets/secret-key.png',
      },
      file: { body: Readable.from([PNG]) },
    })),
  };
  /** Runs the promotion hook against a fake manager whose CAS answers `casAffected`. */
  let casAffected = 1;
  const manager = {
    update: jest.fn(async () => {
      if (casAffected === 1)
        output = outputRow({
          promotionKind: 'new_asset',
          promotedCreativeAssetId: 'asset-new',
          promotedVersionId: 'version-new',
          promotedAt: new Date('2026-10-05T11:00:00Z'),
        });
      return { affected: casAffected };
    }),
  };
  type Hook = (
    m: typeof manager,
    created: { creativeAssetId: string; versionId: string },
  ) => Promise<void>;
  const assets = {
    upload: jest.fn(async (_s, _a, input: { onVersionCreated: Hook }) => {
      await input.onVersionCreated(manager, {
        creativeAssetId: 'asset-new',
        versionId: 'version-new',
      });
      return { id: 'asset-new' };
    }),
    createVersion: jest.fn(
      async (_s, _a, assetId: string, _f, _r, hook: Hook) => {
        await hook(manager, { creativeAssetId: assetId, versionId: 'v-2' });
        return { id: 'v-2' };
      },
    ),
    versionsFor: jest.fn(async () => [{ id: 'v-2' }, { id: 'v-1' }]),
  };
  const versionApprovals = {
    startRevision: jest.fn(
      async (_s, _a, assetId: string, _v, _f, hook: Hook) => {
        await hook(manager, { creativeAssetId: assetId, versionId: 'v-2' });
        return { id: 'v-2' };
      },
    ),
  };
  /** What the server resolves: the Brand Kit of the scope, the Planner item if it is visible. */
  let brand = EMPTY_BRAND;
  let visibleItem: PlannerItem | null = plannerItem();
  /** The item's Planner Visual References (identities from the Planner contract). */
  let plannerReferences: {
    referenceId: string;
    mediaAssetId: string;
    kind: string;
    sortOrder: number;
  }[] = [];
  const context = {
    resolve: jest.fn(async (_scope: CreativeStudioScope, id: string | null) => {
      if (id && !visibleItem)
        throw new BadRequestException({ code: 'content_item_not_found' });
      return buildGenerationContext({
        contentItemId: id,
        brand,
        item: id ? visibleItem : null,
        plannerReferences: id ? plannerReferences : [],
      });
    }),
  };
  /** Owner rows the selector reads: Brand Kit assets and durable media, per id. */
  const brandAssets = new Map<string, Record<string, unknown>>();
  const brandPort = {
    resolveAssets: jest.fn(async (_scope: CreativeStudioScope, ids: string[]) =>
      ids.flatMap((id) => (brandAssets.has(id) ? [brandAssets.get(id)] : [])),
    ),
  };
  const durableMedia = new Map<string, Record<string, unknown>>();
  const referenceMedia = {
    find: jest.fn(async ({ where }: { where: { id: { value: string[] } } }) =>
      where.id.value.flatMap((id) =>
        durableMedia.has(id) ? [durableMedia.get(id)] : [],
      ),
    ),
  };
  const referenceRows: Record<string, unknown>[] = [];
  const references = {
    insert: jest.fn(async (row: Record<string, unknown>) => {
      referenceRows.push(row);
    }),
    find: jest.fn(async () =>
      referenceRows.map((row) => ({ dispatchStartedAt: null, ...row })),
    ),
  };
  Object.assign(generations, {
    manager: {
      transaction: jest.fn(async (work: (m: unknown) => unknown) =>
        work({
          withRepository: () => generations,
          getRepository: () => references,
        }),
      ),
    },
  });
  const service = new CreativeImageGenerationService(
    provider,
    new CreativeGenerationConfigService(),
    generations as never,
    outputs as never,
    media as never,
    creativeAssets as never,
    mediaUpload as unknown as MediaAssetUploadService,
    assets as unknown as CreativeAssetService,
    versionApprovals as unknown as CreativeVersionApprovalService,
    context as unknown as CreativeGenerationContextService,
    new CreativeGenerationReferenceSelector(
      brandPort as never,
      referenceMedia as never,
    ),
    references as never,
  );
  return {
    service,
    generations,
    outputs,
    media,
    mediaUpload,
    assets,
    versionApprovals,
    manager,
    setOutput: (next: CreativeGenerationOutputEntity) => (output = next),
    setCasAffected: (n: number) => (casAffected = n),
    setByKey: (row: CreativeGenerationEntity | null) => (byKey = row),
    context,
    setBrand: (next: CreativeStudioBrandContext) => (brand = next),
    setVisibleItem: (next: PlannerItem | null) => (visibleItem = next),
    setPlannerReferences: (next: typeof plannerReferences) =>
      (plannerReferences = next),
    brandAssets,
    durableMedia,
    brandPort,
    referenceMedia,
    references,
    referenceRows,
  };
}

describe('CreativeImageGenerationService (CS3.2)', () => {
  describe('enqueue', () => {
    it('persists a queued generation in the caller scope and answers without calling the provider', async () => {
      const provider = new EnabledProvider();
      const generate = jest.spyOn(provider, 'generate');
      const { service, generations } = harness(provider);

      const accepted = await service.enqueue(
        companyA,
        'user-a',
        { prompt: '  café na mesa  ' },
        'key-1',
      );

      expect(accepted).toEqual({
        generationId: 'gen-new',
        status: 'queued',
        statusPath: '/social/creative-studio/generations/gen-new',
      });
      expect(generations.create).toHaveBeenCalledWith({
        ...companyA,
        generationType: 'image',
        status: 'queued',
        prompt: 'café na mesa',
        contentItemId: null,
        outputCount: 1,
        aspectRatio: '1:1',
        quality: 'standard',
        originType: 'fresh',
        originGenerationId: null,
        originOutputId: null,
        originVersionId: null,
        effectivePrompt: expect.stringContaining('café na mesa'),
        generationContext: expect.objectContaining({
          version: 'generation-context.v1',
          composer: 'image-prompt.v3',
          digest: EMPTY_DIGEST,
          brand: null,
          content: null,
        }),
        idempotencyKey: 'key-1',
        requestFingerprint: generationRow().requestFingerprint,
        maxAttempts: 3,
        requestedById: 'user-a',
      });
      expect(generate).not.toHaveBeenCalled();
    });

    it('freezes max attempts from configuration on the row', async () => {
      process.env.CREATIVE_GENERATION_MAX_ATTEMPTS = '5';
      try {
        const { service, generations } = harness();
        await service.enqueue(companyA, null, { prompt: 'x' }, 'key-1');
        expect(generations.create).toHaveBeenCalledWith(
          expect.objectContaining({ maxAttempts: 5, requestedById: null }),
        );
      } finally {
        delete process.env.CREATIVE_GENERATION_MAX_ATTEMPTS;
      }
    });

    it('refuses with the CS3.1 503 and records nothing while no provider is bound', async () => {
      const { service, generations } = harness(
        new DisabledImageGenerationProvider(),
      );

      const error = await service
        .enqueue(companyA, 'user-a', { prompt: 'x' }, 'key-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CreativeImageGenerationException);
      expect((error as CreativeImageGenerationException).getStatus()).toBe(503);
      expect((error as CreativeImageGenerationException).getResponse()).toEqual(
        expect.objectContaining({
          code: 'image_generation_unavailable',
          retryable: false,
        }),
      );
      expect(generations.save).not.toHaveBeenCalled();
    });

    it.each([
      [{ prompt: '   ' }],
      [{ prompt: 'x', outputCount: 0 }],
      [{ prompt: 'x', outputCount: 5 }],
      [{ prompt: 'x', outputCount: 1.5 }],
    ])('validates the request before recording it: %p', async (req) => {
      const { service, generations } = harness();
      await expect(
        service.enqueue(companyA, 'user-a', req, 'key-1'),
      ).rejects.toThrow(BadRequestException);
      expect(generations.save).not.toHaveBeenCalled();
    });
  });

  describe('enqueue idempotency (CS3.2.1)', () => {
    it.each([
      [undefined],
      [''],
      ['   '],
      ['has space'],
      ['ç'],
      ['x'.repeat(181)],
    ])('requires a valid Idempotency-Key: %p', async (key) => {
      const { service, generations } = harness();
      const error = await service
        .enqueue(companyA, 'user-a', { prompt: 'x' }, key)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code: 'idempotency_key_required' }),
      );
      expect(generations.findOne).not.toHaveBeenCalled();
      expect(generations.save).not.toHaveBeenCalled();
    });

    it('looks the key up in the full four-part scope and operation', async () => {
      const { service, generations } = harness();
      await service.enqueue(companyA, null, { prompt: 'x' }, ' key-1 ');
      expect(generations.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: companyA.tenantId,
          workspaceId: companyA.workspaceId,
          agencyClientId: companyA.agencyClientId,
          companyContextId: companyA.companyContextId,
          generationType: 'image',
          idempotencyKey: 'key-1',
        }),
      });
    });

    it.each(['queued', 'processing', 'completed', 'failed'] as const)(
      'replays a %s generation as it is: no new row, no reset',
      async (status) => {
        const { service, generations, setByKey } = harness();
        setByKey(generationRow({ id: 'gen-1', status }));

        const accepted = await service.enqueue(
          companyA,
          'user-b',
          // Same request once normalized: trimmed prompt, explicit defaults.
          { prompt: ' café na mesa ', outputCount: 1, quality: 'standard' },
          'key-1',
        );

        expect(accepted).toEqual({
          generationId: 'gen-1',
          status,
          statusPath: '/social/creative-studio/generations/gen-1',
        });
        expect(generations.save).not.toHaveBeenCalled();
      },
    );

    it.each([
      [{ prompt: 'outra coisa' }],
      [{ prompt: 'café na mesa', outputCount: 4 }],
      [{ prompt: 'café na mesa', aspectRatio: '9:16' as const }],
      [{ prompt: 'café na mesa', quality: 'high' as const }],
    ])('refuses the same key for another request with 409: %p', async (req) => {
      const { service, generations, setByKey } = harness();
      setByKey(generationRow());

      const error = await service
        .enqueue(companyA, 'user-a', req, 'key-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: 'idempotency_key_conflict' }),
      );
      expect(generations.save).not.toHaveBeenCalled();
    });

    it('replays an existing generation even while the provider is disabled', async () => {
      const { service, setByKey } = harness(
        new DisabledImageGenerationProvider(),
      );
      setByKey(generationRow({ status: 'queued' }));
      await expect(
        service.enqueue(companyA, null, { prompt: 'café na mesa' }, 'key-1'),
      ).resolves.toEqual(expect.objectContaining({ generationId: 'gen-1' }));
    });

    it('a lost insert race answers with the winner (unique index violation)', async () => {
      const { service, generations, setByKey } = harness();
      generations.save.mockImplementationOnce(async () => {
        setByKey(generationRow({ id: 'gen-winner', status: 'queued' }));
        throw Object.assign(new Error('duplicate key'), {
          driverError: {
            code: '23505',
            constraint: 'UQ_social_creative_generations_idempotency',
          },
        });
      });

      await expect(
        service.enqueue(companyA, null, { prompt: 'café na mesa' }, 'key-1'),
      ).resolves.toEqual(
        expect.objectContaining({
          generationId: 'gen-winner',
          status: 'queued',
        }),
      );
    });

    it('rethrows any other insert failure', async () => {
      const { service, generations } = harness();
      const other = Object.assign(new Error('other'), {
        driverError: { code: '23505', constraint: 'PK_other' },
      });
      generations.save.mockRejectedValueOnce(other);
      await expect(
        service.enqueue(companyA, null, { prompt: 'x' }, 'key-1'),
      ).rejects.toBe(other);
    });

    it('fingerprints only the normalized business fields and context, deterministically', () => {
      const base = {
        prompt: 'café',
        contentItemId: null as string | null,
        outputCount: 1,
        aspectRatio: '1:1' as const,
        quality: 'standard' as const,
        contextDigest: EMPTY_DIGEST,
        referencesDigest: null as string | null,
      };
      expect(imageRequestFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
      expect(imageRequestFingerprint({ ...base })).toBe(
        imageRequestFingerprint(base),
      );
      for (const changed of [
        { prompt: 'café!' },
        { outputCount: 2 },
        { aspectRatio: '4:5' as const },
        { quality: 'high' as const },
        { contentItemId: CONTENT_ID },
        { contextDigest: 'f'.repeat(64) },
        { referencesDigest: 'e'.repeat(64) },
      ])
        expect(imageRequestFingerprint({ ...base, ...changed })).not.toBe(
          imageRequestFingerprint(base),
        );
    });
  });

  describe('generation context (CS3.4.1)', () => {
    const BRAND: CreativeStudioBrandContext = {
      palette: [{ role: 'primary', hex: '#0B3D2E', label: 'Verde escuro' }],
      typography: [{ role: 'heading', family: 'Montserrat' }],
      guidelines: 'Fotografia natural, luz quente.',
      assets: [
        {
          id: '50000000-0000-4000-8000-000000000001',
          kind: 'logo',
          usage: 'asset',
          mimeType: 'image/png',
          width: 512,
          height: 512,
          metadata: {},
        },
      ],
      references: [],
    };

    /** Enqueues and returns what was persisted. */
    async function enqueued(
      h: ReturnType<typeof harness>,
      request: { prompt: string; contentItemId?: string },
    ) {
      await h.service.enqueue(companyA, 'user-a', request, 'key-ctx');
      const calls = h.generations.create.mock.calls as unknown as [
        Partial<CreativeGenerationEntity>,
      ][];
      return calls[calls.length - 1][0];
    }

    it('standalone: operator prompt + Brand Kit compose a deterministic effective prompt', async () => {
      const h = harness();
      h.setBrand(BRAND);

      const first = await enqueued(h, { prompt: 'xícara na mesa' });
      const second = await enqueued(h, { prompt: 'xícara na mesa' });

      expect(h.context.resolve).toHaveBeenCalledWith(companyA, null);
      expect(first.prompt).toBe('xícara na mesa');
      expect(first.contentItemId).toBeNull();
      expect(first.effectivePrompt).toContain('xícara na mesa');
      expect(first.effectivePrompt).toContain('#0B3D2E');
      expect(first.effectivePrompt).not.toContain('CONTENT CONTEXT');
      expect(second.effectivePrompt).toBe(first.effectivePrompt);
      expect(second.requestFingerprint).toBe(first.requestFingerprint);
      expect(first.generationContext).toEqual(
        expect.objectContaining({
          brand: expect.objectContaining({
            applied: ['palette', 'typography', 'guidelines'],
          }),
          content: null,
          references: {
            delivery: 'none',
            brand: expect.objectContaining({ count: 1, kinds: { logo: 1 } }),
            planner: { count: 0, kinds: {}, digest: null },
            // Available is not selected: Brand Kit images are never sent by default.
            selected: {
              selection: 'default',
              count: 0,
              sources: {},
              kinds: {},
              digest: null,
            },
          },
        }),
      );
    });

    it('planner: content item A is resolved in the caller scope and frames the prompt', async () => {
      const h = harness();
      const row = await enqueued(h, {
        prompt: 'xícara na mesa',
        contentItemId: CONTENT_ID,
      });

      expect(h.context.resolve).toHaveBeenCalledWith(companyA, CONTENT_ID);
      expect(row.contentItemId).toBe(CONTENT_ID);
      expect(row.effectivePrompt).toContain(
        'Brief: Mostrar o café em clima aconchegante',
      );
      expect(row.generationContext?.content).toEqual(
        expect.objectContaining({
          revisionId: '42000000-0000-4000-8000-000000000001',
        }),
      );
    });

    it('company isolation: an item the scope cannot see resolves to nothing and records nothing', async () => {
      const h = harness();
      h.setVisibleItem(null);

      await expect(
        h.service.enqueue(
          companyA,
          'user-a',
          { prompt: 'x', contentItemId: CONTENT_ID },
          'key-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(h.generations.findOne).not.toHaveBeenCalled();
      expect(h.generations.save).not.toHaveBeenCalled();
    });

    it('refuses a malformed content item id before resolving anything', async () => {
      const h = harness();
      await expect(
        h.service.enqueue(
          companyA,
          'user-a',
          { prompt: 'x', contentItemId: 'not-a-uuid' },
          'key-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(h.context.resolve).not.toHaveBeenCalled();
    });

    it('works without a Brand Kit: request-only prompt, nothing invented', async () => {
      const h = harness();
      const row = await enqueued(h, { prompt: 'xícara na mesa' });
      expect(row.effectivePrompt).not.toContain('BRAND IDENTITY');
      expect(row.effectivePrompt).not.toContain('palette');
      expect(row.generationContext?.brand).toBeNull();
    });

    describe('idempotency over context', () => {
      async function replayAfter(
        change: (h: ReturnType<typeof harness>) => void,
        request: { prompt: string; contentItemId?: string } = {
          prompt: 'xícara na mesa',
          contentItemId: CONTENT_ID,
        },
      ) {
        const h = harness();
        h.setBrand(BRAND);
        const first = await enqueued(h, request);
        h.setByKey(
          generationRow({
            id: 'gen-1',
            requestFingerprint: first.requestFingerprint ?? null,
          }),
        );
        change(h);
        return h.service
          .enqueue(companyA, 'user-a', request, 'key-ctx')
          .catch((e: unknown) => e);
      }

      it('a retry of the same intent over the same context replays the generation', async () => {
        await expect(replayAfter(() => undefined)).resolves.toEqual(
          expect.objectContaining({ generationId: 'gen-1' }),
        );
      });

      it.each([
        [
          'brand palette changed',
          (h: ReturnType<typeof harness>) =>
            h.setBrand({
              ...BRAND,
              palette: [{ role: 'primary', hex: '#FF0000', label: null }],
            }),
        ],
        [
          'brand reference added',
          (h: ReturnType<typeof harness>) =>
            h.setBrand({
              ...BRAND,
              references: [
                {
                  id: '50000000-0000-4000-8000-000000000002',
                  kind: 'reference',
                  usage: 'reference',
                  mimeType: 'image/jpeg',
                  width: null,
                  height: null,
                  metadata: {},
                },
              ],
            }),
        ],
        [
          'planner brief edited in place (no new revision)',
          (h: ReturnType<typeof harness>) =>
            h.setVisibleItem(plannerItem({ brief: 'Outro brief' })),
        ],
        [
          'planner reference photo swapped',
          (h: ReturnType<typeof harness>) => {
            h.durableMedia.set(
              '61000000-0000-4000-8000-000000000002',
              durableImage('61000000-0000-4000-8000-000000000002'),
            );
            h.setPlannerReferences([
              {
                referenceId: '60000000-0000-4000-8000-000000000001',
                mediaAssetId: '61000000-0000-4000-8000-000000000002',
                kind: 'product',
                sortOrder: 0,
              },
            ]);
          },
        ],
        [
          'planner copy revised',
          (h: ReturnType<typeof harness>) =>
            h.setVisibleItem(
              plannerItem({
                caption: 'Nova legenda',
                currentRevisionId: '42000000-0000-4000-8000-000000000002',
              }),
            ),
        ],
      ])(
        'a real context change under the same key is a 409: %s',
        async (_label, change) => {
          const error = await replayAfter(change);
          expect(error).toBeInstanceOf(ConflictException);
          expect((error as ConflictException).getResponse()).toEqual(
            expect.objectContaining({ code: 'idempotency_key_conflict' }),
          );
        },
      );

      it('timestamps and revision ids alone are not a context change', async () => {
        await expect(
          replayAfter((h) =>
            h.setVisibleItem(
              plannerItem({
                updatedAt: new Date('2026-10-06T00:00:00Z'),
                currentRevisionId: '42000000-0000-4000-8000-000000000009',
              }),
            ),
          ),
        ).resolves.toEqual(expect.objectContaining({ generationId: 'gen-1' }));
      });

      it('the same typed prompt standalone and for a content item are different intents', async () => {
        const h = harness();
        const standalone = await enqueued(h, { prompt: 'xícara na mesa' });
        h.setByKey(
          generationRow({
            requestFingerprint: standalone.requestFingerprint ?? null,
          }),
        );
        const error = await h.service
          .enqueue(
            companyA,
            'user-a',
            { prompt: 'xícara na mesa', contentItemId: CONTENT_ID },
            'key-ctx',
          )
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ConflictException);
      });
    });

    it('security: no scope, item, plan, revision or asset id reaches the effective prompt or its record text', async () => {
      const h = harness();
      h.setBrand(BRAND);
      h.setVisibleItem(
        plannerItem({
          destinations: [
            {
              id: '43000000-0000-4000-8000-000000000001',
              channel: 'instagram',
              placement: 'feed',
              plannedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      );
      const row = await enqueued(h, {
        prompt: 'xícara na mesa',
        contentItemId: CONTENT_ID,
      });

      expect(row.effectivePrompt).toContain('instagram/feed');
      for (const id of [
        companyA.tenantId,
        companyA.workspaceId,
        companyA.agencyClientId!,
        companyA.companyContextId!,
        CONTENT_ID,
        '41000000-0000-4000-8000-000000000001',
        '42000000-0000-4000-8000-000000000001',
        '43000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001',
      ])
        expect(row.effectivePrompt).not.toContain(id);
      expect(row.effectivePrompt).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    });
  });

  describe('get', () => {
    it('returns status, request and outputs without provider, usage, storage or scope internals', async () => {
      const { service, generations, media } = harness();

      const view = await service.get(companyA, 'gen-1');
      const json = JSON.stringify(view);

      expect(generations.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'gen-1',
          tenantId: companyA.tenantId,
          companyContextId: companyA.companyContextId,
        }),
      });
      expect(media.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          source: CREATIVE_GENERATION_MEDIA_SOURCE,
          companyContextId: companyA.companyContextId,
        }),
      });
      expect(view).toEqual({
        generationId: 'gen-1',
        type: 'image',
        status: 'completed',
        request: {
          prompt: 'café na mesa',
          contentItemId: null,
          outputCount: 1,
          aspectRatio: '1:1',
          quality: 'standard',
        },
        origin: {
          type: 'fresh',
          generationId: null,
          outputId: null,
          creativeAssetId: null,
          versionId: null,
        },
        references: [],
        outputs: [
          {
            id: 'output-1',
            outputIndex: 0,
            mediaType: 'image',
            available: true,
            mimeType: 'image/png',
            width: 1024,
            height: 1024,
            byteSize: String(PNG.length),
            retentionClass: 'temporary_generation',
            contentPath:
              '/social/creative-studio/generations/outputs/output-1/content',
            promotion: null,
          },
        ],
        error: null,
        createdAt: '2026-10-05T10:00:00.000Z',
        startedAt: '2026-10-05T10:00:05.000Z',
        completedAt: '2026-10-05T10:00:30.000Z',
        failedAt: null,
      });
      for (const leak of [
        'media-assets/',
        'media-1',
        'storagePath',
        'secret-provider',
        'secret-model',
        'cost',
        'usage',
        'locked',
        companyA.tenantId,
        companyA.agencyClientId!,
        companyA.companyContextId!,
        // The composed prompt stays internal (provenance, not UI).
        'composed:',
      ])
        expect(json).not.toContain(leak);
    });

    it('shows a failed generation with the sanitized message of its code', async () => {
      const { service, generations, outputs } = harness();
      generations.findOne.mockResolvedValue(
        generationRow({
          status: 'failed',
          completedAt: null,
          failedAt: new Date('2026-10-05T10:01:00Z'),
          errorCode: 'rate_limited',
          errorRetryable: true,
        }),
      );

      const view = await service.get(companyA, 'gen-1');

      expect(view.outputs).toEqual([]);
      expect(outputs.find).not.toHaveBeenCalled();
      expect(view.error).toEqual({
        code: 'image_generation_rate_limited',
        message: 'Muitas gerações em pouco tempo. Aguarde e tente novamente.',
        retryable: true,
      });
    });

    it('keeps the output after its binary expired, as unavailable', async () => {
      const { service, media, setOutput } = harness();
      setOutput(outputRow({ mediaAssetId: null }));
      media.find.mockResolvedValue([]);

      const [output] = (await service.get(companyA, 'gen-1')).outputs;

      expect(output).toEqual(
        expect.objectContaining({
          available: false,
          contentPath: null,
          mimeType: null,
        }),
      );
    });

    it('answers 404 for a generation outside the caller scope', async () => {
      const { service, generations } = harness();
      generations.findOne.mockResolvedValue(null as never);
      await expect(service.get(companyA, 'gen-b')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('readOutput', () => {
    it('reads the output media through the owner path, after proving the generation scope', async () => {
      const { service, generations, mediaUpload } = harness();

      await service.readOutput(companyA, 'output-1');

      expect(generations.exists).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'gen-1',
          companyContextId: companyA.companyContextId,
        }),
      });
      expect(mediaUpload.getTemporaryContent).toHaveBeenCalledWith(
        companyA,
        'media-1',
        CREATIVE_GENERATION_MEDIA_SOURCE,
      );
    });

    it('answers 404 before opening anything when the generation is outside the scope', async () => {
      const { service, generations, mediaUpload } = harness();
      generations.exists.mockResolvedValue(false);

      await expect(service.readOutput(companyA, 'output-b')).rejects.toThrow(
        NotFoundException,
      );
      expect(mediaUpload.getTemporaryContent).not.toHaveBeenCalled();
    });

    it('answers 410 when the temporary binary is gone', async () => {
      const { service, setOutput } = harness();
      setOutput(outputRow({ mediaAssetId: null }));
      await expect(service.readOutput(companyA, 'output-1')).rejects.toThrow(
        GoneException,
      );
    });

    it('answers the same 410 while cleanup holds a tombstone or the object is already gone (CS3.6.1)', async () => {
      const { service, mediaUpload } = harness();
      mediaUpload.getTemporaryContent.mockRejectedValue(
        new NotFoundException('Media asset not found.'),
      );
      await expect(service.readOutput(companyA, 'output-1')).rejects.toThrow(
        GoneException,
      );
    });

    it('lets any other storage error through (never disguised as expiry)', async () => {
      const { service, mediaUpload } = harness();
      mediaUpload.getTemporaryContent.mockRejectedValue(new Error('down'));
      await expect(service.readOutput(companyA, 'output-1')).rejects.toThrow(
        'down',
      );
    });
  });

  describe('promotion', () => {
    it('copies the output into a new generated asset and records the promotion in the same transaction', async () => {
      const { service, assets, manager } = harness();

      const result = await service.promoteToNewAsset(
        companyA,
        'user-a',
        'output-1',
        { name: 'Post café', contentItemId: 'item-1' },
      );

      expect(result).toEqual({ id: 'asset-new' });
      expect(assets.upload).toHaveBeenCalledWith(companyA, 'user-a', {
        file: {
          buffer: PNG,
          originalname: 'imagem-gerada-1.png',
          mimetype: 'image/png',
          size: PNG.length,
        },
        name: 'Post café',
        contentItemId: 'item-1',
        sourceType: 'generated',
        onVersionCreated: expect.any(Function),
      });
      expect(manager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'output-1', promotedVersionId: expect.anything() },
        expect.objectContaining({
          promotionKind: 'new_asset',
          promotedCreativeAssetId: 'asset-new',
          promotedVersionId: 'version-new',
          promotedById: 'user-a',
        }),
      );
    });

    it('a repeated promotion with the same intent answers with the first result and creates nothing', async () => {
      const { service, assets, setOutput, mediaUpload } = harness();
      setOutput(
        outputRow({
          promotionKind: 'new_asset',
          promotedCreativeAssetId: 'asset-new',
          promotedVersionId: 'version-new',
          promotedAt: new Date(),
        }),
      );

      await expect(
        service.promoteToNewAsset(companyA, 'user-a', 'output-1', {}),
      ).resolves.toEqual({ id: 'asset-new' });
      expect(assets.upload).not.toHaveBeenCalled();
      expect(mediaUpload.getTemporaryContent).not.toHaveBeenCalled();
    });

    it('refuses a different intent on an already promoted output with 409', async () => {
      const { service, assets, setOutput } = harness();
      setOutput(
        outputRow({
          promotionKind: 'new_asset',
          promotedCreativeAssetId: 'asset-new',
          promotedVersionId: 'version-new',
          promotedAt: new Date(),
        }),
      );

      await expect(
        service.promoteToVersion(companyA, 'user-a', 'output-1', {
          assetId: 'asset-other',
        }),
      ).rejects.toThrow(ConflictException);
      expect(assets.createVersion).not.toHaveBeenCalled();
    });

    it('the loser of a race (CAS affects nothing) answers with the winner result', async () => {
      const { service, setOutput, setCasAffected, assets } = harness();
      setCasAffected(0);
      assets.upload.mockImplementationOnce(async (_s, _a, input) => {
        // The winner commits while this request is inside its transaction.
        setOutput(
          outputRow({
            promotionKind: 'new_asset',
            promotedCreativeAssetId: 'asset-winner',
            promotedVersionId: 'version-winner',
            promotedAt: new Date(),
          }),
        );
        await input.onVersionCreated(
          { update: async () => ({ affected: 0 }) } as never,
          { creativeAssetId: 'asset-loser', versionId: 'version-loser' },
        );
        return { id: 'asset-loser' };
      });
      const { creativeAssets } = service as unknown as {
        creativeAssets: { findOne: jest.Mock };
      };
      creativeAssets.findOne.mockResolvedValue({ id: 'asset-winner' });

      await expect(
        service.promoteToNewAsset(companyA, 'user-a', 'output-1', {}),
      ).resolves.toEqual({ id: 'asset-winner' });
    });

    it('promotes into a new version of an existing asset and replays as that version', async () => {
      const { service, assets, versionApprovals } = harness();

      await expect(
        service.promoteToVersion(companyA, 'user-a', 'output-1', {
          assetId: 'asset-1',
        }),
      ).resolves.toEqual({ id: 'v-2' });
      expect(assets.createVersion).toHaveBeenCalledWith(
        companyA,
        'user-a',
        'asset-1',
        expect.objectContaining({ buffer: PNG, mimetype: 'image/png' }),
        undefined,
        expect.any(Function),
      );
      expect(versionApprovals.startRevision).not.toHaveBeenCalled();
    });

    it('answers a changes-requested revision through the CS2B.6 loop with the same hook', async () => {
      const { service, assets, versionApprovals, manager } = harness();

      await service.promoteToVersion(companyA, 'user-a', 'output-1', {
        assetId: 'asset-1',
        revisesVersionId: 'version-1',
      });

      expect(versionApprovals.startRevision).toHaveBeenCalledWith(
        companyA,
        'user-a',
        'asset-1',
        'version-1',
        expect.objectContaining({ buffer: PNG }),
        expect.any(Function),
      );
      expect(manager.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ promotionKind: 'revision' }),
      );
      expect(assets.createVersion).not.toHaveBeenCalled();
    });

    it('rethrows an unrelated failure when nothing was promoted', async () => {
      const { service, assets } = harness();
      assets.upload.mockRejectedValueOnce(
        new BadRequestException('Pasta não encontrada.'),
      );
      await expect(
        service.promoteToNewAsset(companyA, 'user-a', 'output-1', {
          folderId: 'f',
        }),
      ).rejects.toThrow('Pasta não encontrada.');
    });

    it('creates nothing when the output is outside the caller scope', async () => {
      const { service, generations, assets, mediaUpload } = harness();
      generations.exists.mockResolvedValue(false);

      await expect(
        service.promoteToNewAsset(companyA, 'user-a', 'output-b', {}),
      ).rejects.toThrow(NotFoundException);
      expect(mediaUpload.getTemporaryContent).not.toHaveBeenCalled();
      expect(assets.upload).not.toHaveBeenCalled();
    });
  });
});

describe('CreativeImageGenerationService — reference images (CS3.4.2)', () => {
  const LOGO = '70000000-0000-4000-8000-000000000001';
  const STYLE = '70000000-0000-4000-8000-000000000002';
  const PRODUCT = '71000000-0000-4000-8000-000000000001';
  const PACKSHOT = '71000000-0000-4000-8000-000000000002';
  const LIBRARY = '72000000-0000-4000-8000-000000000001';

  function brandAsset(id: string, kind: string, patch = {}) {
    return {
      id,
      kind,
      usage: kind === 'reference' ? 'reference' : 'asset',
      mimeType: 'image/png',
      byteSize: '4096',
      checksum: createHash('sha256').update(`brand:${id}`).digest('hex'),
      ...patch,
    };
  }

  /** Item with two Planner references; brand logo + style; one library image. */
  function setup() {
    const h = harness();
    h.brandAssets.set(LOGO, brandAsset(LOGO, 'logo'));
    h.brandAssets.set(STYLE, brandAsset(STYLE, 'reference'));
    h.durableMedia.set(PRODUCT, durableImage(PRODUCT));
    h.durableMedia.set(
      PACKSHOT,
      durableImage(PACKSHOT, { mimeType: 'image/jpeg' }),
    );
    h.durableMedia.set(
      LIBRARY,
      durableImage(LIBRARY, { mimeType: 'image/webp' }),
    );
    h.setPlannerReferences([
      {
        referenceId: 'r-1',
        mediaAssetId: PRODUCT,
        kind: 'product',
        sortOrder: 0,
      },
      {
        referenceId: 'r-2',
        mediaAssetId: PACKSHOT,
        kind: 'packaging',
        sortOrder: 1,
      },
    ]);
    return h;
  }

  function created(h: ReturnType<typeof harness>) {
    const calls = h.generations.create.mock.calls;
    return calls[calls.length - 1][0] as CreativeGenerationEntity;
  }

  const withItem = (references?: unknown[]) =>
    ({
      prompt: 'xícara na mesa',
      contentItemId: CONTENT_ID,
      ...(references === undefined ? {} : { references }),
    }) as CreativeImageGenerationRequest;

  async function refusal(promise: Promise<unknown>) {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { code: string })
      .code;
  }

  it("default selection: the item's Planner references in Planner order — never Brand Kit", async () => {
    const h = setup();
    await h.service.enqueue(companyA, 'user-a', withItem(), 'k');

    expect(h.referenceRows).toEqual([
      expect.objectContaining({
        generationId: 'gen-new',
        position: 0,
        source: 'planner',
        kind: 'product',
        role: 'subject',
        mediaAssetId: PRODUCT,
        brandKitAssetId: null,
        mimeType: 'image/png',
        checksum: createHash('sha256').update(PRODUCT).digest('hex'),
      }),
      expect.objectContaining({
        position: 1,
        source: 'planner',
        kind: 'packaging',
        mediaAssetId: PACKSHOT,
      }),
    ]);
    const row = created(h);
    expect(row.generationContext?.references).toEqual(
      expect.objectContaining({
        delivery: 'provider_reference_images',
        selected: expect.objectContaining({
          selection: 'default',
          count: 2,
          sources: { planner: 2 },
        }),
      }),
    );
    expect(row.effectivePrompt).toContain('REFERENCE IMAGES');
    expect(row.effectivePrompt).toContain('- Image 1: the product');
    expect(row.effectivePrompt).toContain('- Image 2: the product packaging');
    // Nothing internal reaches the provider text.
    for (const id of [PRODUCT, PACKSHOT, LOGO, CONTENT_ID])
      expect(row.effectivePrompt).not.toContain(id);
    expect(h.brandPort.resolveAssets).toHaveBeenCalledWith(companyA, []);
  });

  it('brand only: an explicitly chosen Brand Kit logo, its kind from the Brand Kit', async () => {
    const h = setup();
    await h.service.enqueue(
      companyA,
      'user-a',
      {
        prompt: 'post com a marca',
        references: [{ source: 'brand', id: LOGO }],
      },
      'k',
    );
    expect(h.referenceRows).toEqual([
      expect.objectContaining({
        source: 'brand',
        kind: 'logo',
        role: 'logo',
        brandKitAssetId: LOGO,
        mediaAssetId: null,
      }),
    ]);
    const prompt = created(h).effectivePrompt;
    expect(prompt).toContain("- Image 1: the brand's logo");
    expect(prompt).toContain(
      'the only logo allowed is the one in the reference images',
    );
  });

  it('brand + planner + operator stay distinct, in exactly the order chosen', async () => {
    const h = setup();
    await h.service.enqueue(
      companyA,
      'user-a',
      withItem([
        { source: 'operator', id: LIBRARY, kind: 'environment' },
        { source: 'planner', id: PACKSHOT },
        { source: 'brand', id: STYLE },
      ]),
      'k',
    );
    expect(
      h.referenceRows.map((r) => [r.position, r.source, r.kind, r.role]),
    ).toEqual([
      [0, 'operator', 'environment', 'context'],
      [1, 'planner', 'packaging', 'subject'],
      [2, 'brand', 'reference', 'style'],
    ]);
    // The unselected Planner reference (PRODUCT) is available, not sent.
    expect(h.referenceRows.some((r) => r.mediaAssetId === PRODUCT)).toBe(false);
    expect(created(h).generationContext?.references.selected).toEqual(
      expect.objectContaining({
        selection: 'explicit',
        sources: { operator: 1, planner: 1, brand: 1 },
      }),
    );
  });

  it('an explicit empty selection sends nothing, even with Planner references', async () => {
    const h = setup();
    await h.service.enqueue(companyA, 'user-a', withItem([]), 'k');
    expect(h.references.insert).not.toHaveBeenCalled();
    expect(created(h).generationContext?.references.delivery).toBe('none');
    expect(created(h).effectivePrompt).not.toContain('REFERENCE IMAGES');
  });

  it.each([
    [
      "another company's Brand Kit asset (absent from this scope)",
      [{ source: 'brand', id: '70000000-0000-4000-8000-0000000000ff' }],
      'reference_not_found',
    ],
    [
      'media not in this scope, temporary or deleted',
      [
        {
          source: 'operator',
          id: '72000000-0000-4000-8000-0000000000ff',
          kind: 'product',
        },
      ],
      'reference_not_found',
    ],
    [
      "a media that is not one of this item's Planner references",
      [{ source: 'planner', id: LIBRARY }],
      'reference_not_found',
    ],
    [
      'operator choice without a kind',
      [{ source: 'operator', id: LIBRARY }],
      'reference_kind_required',
    ],
    [
      'a kind override on a Planner reference',
      [{ source: 'planner', id: PRODUCT, kind: 'style' }],
      'reference_kind_not_allowed',
    ],
    [
      'the same image twice',
      [
        { source: 'planner', id: PRODUCT },
        { source: 'operator', id: PRODUCT, kind: 'product' },
      ],
      'reference_duplicated',
    ],
    [
      'more than six',
      Array.from({ length: 7 }, (_, i) => ({
        source: 'brand',
        id: `70000000-0000-4000-8000-00000000001${i}`,
      })),
      'reference_limit_exceeded',
    ],
  ])(
    'refuses %s before anything is persisted',
    async (_label, references, code) => {
      const h = setup();
      expect(
        await refusal(
          h.service.enqueue(companyA, 'user-a', withItem(references), 'k'),
        ),
      ).toBe(code);
      expect(h.generations.save).not.toHaveBeenCalled();
      expect(h.references.insert).not.toHaveBeenCalled();
    },
  );

  it('asks the media boundary only for durable media of the exact four-part scope', async () => {
    const h = setup();
    await h.service.enqueue(companyA, 'user-a', withItem(), 'k');
    const where = h.referenceMedia.find.mock.calls[0][0].where as Record<
      string,
      unknown
    >;
    expect(where).toEqual(
      expect.objectContaining({
        tenantId: companyA.tenantId,
        workspaceId: companyA.workspaceId,
        agencyClientId: companyA.agencyClientId,
        companyContextId: companyA.companyContextId,
      }),
    );
    // `Not(Like('temporary:%'))` — a generation output is never a reference.
    expect(JSON.stringify(where.source)).toContain('temporary:%');
  });

  it('refuses formats the provider cannot take instead of skipping them', async () => {
    const h = setup();
    h.durableMedia.set(
      PRODUCT,
      durableImage(PRODUCT, { mimeType: 'image/gif' }),
    );
    expect(
      await refusal(h.service.enqueue(companyA, 'u', withItem(), 'k')),
    ).toBe('reference_format_unsupported');
  });

  it('never truncates: more Planner references than the limit require an explicit selection', async () => {
    const h = setup();
    const many = Array.from({ length: 7 }, (_, i) => {
      const id = `73000000-0000-4000-8000-00000000000${i}`;
      h.durableMedia.set(id, durableImage(id));
      return {
        referenceId: `r-${i}`,
        mediaAssetId: id,
        kind: 'product',
        sortOrder: i,
      };
    });
    h.setPlannerReferences(many);
    expect(
      await refusal(h.service.enqueue(companyA, 'u', withItem(), 'k')),
    ).toBe('reference_selection_required');
    // ...and an explicit subset of the same item works.
    await h.service.enqueue(
      companyA,
      'u',
      withItem(
        many
          .slice(0, 3)
          .map((r) => ({ source: 'planner', id: r.mediaAssetId })),
      ),
      'k2',
    );
    expect(h.referenceRows).toHaveLength(3);
  });

  it('refuses references over the per-image size limit', async () => {
    const h = setup();
    h.durableMedia.set(
      PRODUCT,
      durableImage(PRODUCT, { byteSize: String(17 * 1024 * 1024) }),
    );
    expect(
      await refusal(h.service.enqueue(companyA, 'u', withItem(), 'k')),
    ).toBe('reference_too_large');
  });

  describe('idempotency over the selection', () => {
    async function retryWith(
      first: unknown[] | undefined,
      second: unknown[] | undefined,
      change: (h: ReturnType<typeof harness>) => void = () => undefined,
    ) {
      const h = setup();
      await h.service.enqueue(companyA, 'u', withItem(first), 'key-refs');
      h.setByKey(
        generationRow({
          id: 'gen-1',
          requestFingerprint: created(h).requestFingerprint,
        }),
      );
      change(h);
      return h.service
        .enqueue(companyA, 'u', withItem(second), 'key-refs')
        .catch((e: unknown) => e);
    }

    it('same images in the same order replay — default or explicit alike', async () => {
      await expect(
        retryWith(undefined, [
          { source: 'planner', id: PRODUCT },
          { source: 'planner', id: PACKSHOT },
        ]),
      ).resolves.toEqual(expect.objectContaining({ generationId: 'gen-1' }));
    });

    it.each([
      [
        'another product photo selected',
        [{ source: 'planner', id: PRODUCT }],
        [{ source: 'planner', id: PACKSHOT }],
      ],
      [
        'same images, other order',
        [
          { source: 'planner', id: PRODUCT },
          { source: 'planner', id: PACKSHOT },
        ],
        [
          { source: 'planner', id: PACKSHOT },
          { source: 'planner', id: PRODUCT },
        ],
      ],
      [
        'an operator kind changed',
        [{ source: 'operator', id: LIBRARY, kind: 'product' }],
        [{ source: 'operator', id: LIBRARY, kind: 'style' }],
      ],
      ['a brand logo added', [], [{ source: 'brand', id: LOGO }]],
    ])(
      'a different selection under the same key is a 409: %s',
      async (_l, first, second) => {
        const error = await retryWith(first, second);
        expect(error).toBeInstanceOf(ConflictException);
      },
    );

    it('same id with different bytes (checksum) is a 409', async () => {
      const error = await retryWith(
        [{ source: 'operator', id: LIBRARY, kind: 'product' }],
        [{ source: 'operator', id: LIBRARY, kind: 'product' }],
        (h) =>
          h.durableMedia.set(
            LIBRARY,
            durableImage(LIBRARY, {
              mimeType: 'image/webp',
              checksum: 'a'.repeat(64),
            }),
          ),
      );
      expect(error).toBeInstanceOf(ConflictException);
    });
  });

  it('GET exposes the frozen references by owner id — no checksum, storage or scope', async () => {
    const h = setup();
    await h.service.enqueue(
      companyA,
      'u',
      withItem([
        { source: 'brand', id: LOGO },
        { source: 'planner', id: PRODUCT },
      ]),
      'k',
    );
    const view = await h.service.get(companyA, 'gen-1');
    expect(view.references).toEqual([
      {
        position: 0,
        source: 'brand',
        id: LOGO,
        kind: 'logo',
        role: 'logo',
        dispatchStartedAt: null,
      },
      {
        position: 1,
        source: 'planner',
        id: PRODUCT,
        kind: 'product',
        role: 'subject',
        dispatchStartedAt: null,
      },
    ]);
    const json = JSON.stringify(view.references);
    expect(json).not.toMatch(/checksum|storage|tenant|company|[0-9a-f]{64}/i);
  });
});
