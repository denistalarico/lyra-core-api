import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { MediaAssetUploadService } from '../../common/media-assets';
import type { CreativeAssetService } from './creative-asset.service';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  DisabledImageGenerationProvider,
  ImageGenerationProvider,
  type ImageGenerationProviderResult,
} from './creative-image-generation.provider';
import {
  CreativeImageGenerationException,
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
const PNG = Buffer.concat([
  Buffer.from([0x89]),
  Buffer.from('PNG\r\n\x1a\n', 'latin1'),
  Buffer.alloc(32, 1),
]);

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
    prompt: 'café na mesa',
    outputCount: 1,
    aspectRatio: '1:1',
    quality: 'standard',
    idempotencyKey: 'key-1',
    requestFingerprint: imageRequestFingerprint({
      prompt: 'café na mesa',
      outputCount: 1,
      aspectRatio: '1:1',
      quality: 'standard',
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
        outputCount: 1,
        aspectRatio: '1:1',
        quality: 'standard',
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

    it('fingerprints only the normalized business fields, deterministically', () => {
      const base = {
        prompt: 'café',
        outputCount: 1,
        aspectRatio: '1:1' as const,
        quality: 'standard' as const,
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
      ])
        expect(imageRequestFingerprint({ ...base, ...changed })).not.toBe(
          imageRequestFingerprint(base),
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
          outputCount: 1,
          aspectRatio: '1:1',
          quality: 'standard',
        },
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
