/* eslint-disable @typescript-eslint/unbound-method -- Jest mock methods asserted via expect(x.method).toHaveBeenCalledWith(...) are never invoked unbound. */
import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { MediaAssetResolverService } from '../../../common/media-assets';
import type { ResolvedOrganicCredential } from '../credentials/resolved-organic-credential';
import type { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import type { MediaPreparationService } from '../media/media-preparation.service';
import type {
  PublicationResult,
  SocialPublisherAdapter,
  ValidationResult,
} from '../providers/social-publisher.adapter';
import type { PublisherCapabilities } from '../providers/provider-capabilities';
import type { SocialPublisherRegistry } from '../providers/social-publisher.registry';
import type { SocialPublicationEntity } from './entities/social-publication.entity';
import type { SocialPublicationConfigService } from './social-publication-config.service';
import { SocialPublicationExecutionError } from './social-publication.worker';
import { SocialPublicationExecutorService } from './social-publication.executor';

const IMAGE_CAPABILITIES: PublisherCapabilities = {
  provider: 'meta',
  assetType: 'facebook_page',
  placements: ['feed'],
  media: {
    feed: {
      acceptedMimeTypes: ['image/jpeg'],
      maxBytes: 10_000_000,
      aspectRatios: ['1:1'],
    },
  },
  supportsScheduling: true,
  supportsCaption: true,
  supportsFirstComment: true,
  supportsHashtags: true,
  requiresReconciliation: false,
  supportsRemoval: false,
};

function buildAdapter(
  overrides: Partial<SocialPublisherAdapter> = {},
): SocialPublisherAdapter {
  return {
    provider: 'meta',
    assetTypes: ['facebook_page'],
    retrySafety: 'provider_idempotency_key',
    capabilities: jest.fn(() => IMAGE_CAPABILITIES),
    validate: jest.fn((): ValidationResult => ({ valid: true })),
    prepareMedia: jest.fn(() =>
      Promise.resolve({ providerMediaRef: 'ref-1', expiresAt: null }),
    ),
    publish: jest.fn(
      (): Promise<PublicationResult> =>
        Promise.resolve({
          outcome: 'published',
          externalPublicationId: 'ext-1',
          externalPermalink: null,
          publishedAt: new Date('2026-09-07T12:00:00Z'),
          providerMetadata: {},
        }),
    ),
    ...overrides,
  };
}

function buildPublication(
  overrides: Partial<SocialPublicationEntity> = {},
): SocialPublicationEntity {
  return {
    id: 'pub-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
    provider: 'meta',
    assetId: 'asset-1',
    mediaAssetId: null,
    idempotencyKey: 'idem-1',
    scheduledAt: new Date('2026-09-07T11:00:00Z'),
    payloadSnapshot: {
      placement: 'feed',
      caption: 'caption',
      cta: null,
      hashtags: [],
      firstComment: null,
    },
    ...overrides,
  } as SocialPublicationEntity;
}

const CREDENTIAL = {
  assetId: 'asset-1',
  connectionId: 'conn-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  provider: 'meta',
  assetType: 'facebook_page',
  externalAssetId: 'ext-asset-1',
  scopes: [],
  credentialVersion: 1,
  accessToken: 'token',
  toJSON: () => ({}),
} as unknown as ResolvedOrganicCredential;

describe('SocialPublicationExecutorService', () => {
  let assetsRepository: { findOne: jest.Mock };
  let registry: { resolve: jest.Mock; has: jest.Mock };
  let credentialResolver: { resolve: jest.Mock };
  let mediaAssetResolver: { resolve: jest.Mock };
  let mediaPreparationService: { prepare: jest.Mock };
  let config: { isProviderEnabled: jest.Mock };
  let executor: SocialPublicationExecutorService;

  beforeEach(() => {
    assetsRepository = {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 'asset-1',
          assetType: 'facebook_page',
        } as Partial<SocialOrganicAssetEntity>),
      ),
    };
    registry = { resolve: jest.fn(), has: jest.fn(() => true) };
    credentialResolver = {
      resolve: jest.fn(() => Promise.resolve(CREDENTIAL)),
    };
    mediaAssetResolver = { resolve: jest.fn() };
    mediaPreparationService = {
      prepare: jest.fn(() =>
        Promise.resolve({
          sourceUrl: 'https://signed.example/media',
          mimeType: 'image/jpeg',
          bytes: 1000,
        }),
      ),
    };
    config = { isProviderEnabled: jest.fn(() => true) };

    executor = new SocialPublicationExecutorService(
      assetsRepository as unknown as Repository<SocialOrganicAssetEntity>,
      registry as unknown as SocialPublisherRegistry,
      credentialResolver as unknown as SocialOrganicCredentialResolver,
      mediaAssetResolver as unknown as MediaAssetResolverService,
      mediaPreparationService as unknown as MediaPreparationService,
      config as unknown as SocialPublicationConfigService,
    );
  });

  describe('text-only publications', () => {
    it('publishes with preparedMedia null and never touches media resolution', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      const publication = buildPublication();

      const identity = await executor.publish(publication);

      expect(mediaAssetResolver.resolve).not.toHaveBeenCalled();
      expect(mediaPreparationService.prepare).not.toHaveBeenCalled();
      expect(adapter.prepareMedia).not.toHaveBeenCalled();
      expect(adapter.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          preparedMedia: null,
          idempotencyKey: 'idem-1',
        }),
      );
      expect(identity.externalPublicationId).toBe('ext-1');
    });
  });

  describe('publications with mediaAssetId', () => {
    const mediaAssetId = 'media-asset-1';

    function withMedia(): SocialPublicationEntity {
      return buildPublication({ mediaAssetId });
    }

    function mockResolvedMedia(overrides: Record<string, unknown> = {}) {
      mediaAssetResolver.resolve.mockResolvedValue({
        id: mediaAssetId,
        storagePath: 'tenant-1/workspace-1/media/asset.jpg',
        mimeType: 'image/jpeg',
        byteSize: '1000',
        width: 1080,
        height: 1080,
        durationMs: null,
        codec: null,
        ...overrides,
      });
    }

    it('runs validate -> resolve -> M1 -> M3 -> prepareMedia -> publish in order before any external effect', async () => {
      const calls: string[] = [];
      const adapter = buildAdapter({
        validate: jest.fn(() => {
          calls.push('validate');
          return { valid: true };
        }),
        prepareMedia: jest.fn(() => {
          calls.push('prepareMedia');
          return Promise.resolve({
            providerMediaRef: 'ref-1',
            expiresAt: null,
          });
        }),
        publish: jest.fn(() => {
          calls.push('publish');
          return Promise.resolve({
            outcome: 'published' as const,
            externalPublicationId: 'ext-1',
            externalPermalink: null,
            publishedAt: new Date(),
            providerMetadata: {},
          });
        }),
      });
      registry.resolve.mockReturnValue(adapter);
      mockResolvedMedia();
      mediaAssetResolver.resolve.mockImplementation(() => {
        calls.push('resolveMedia');
        return Promise.resolve({
          id: mediaAssetId,
          storagePath: 'tenant-1/workspace-1/media/asset.jpg',
          mimeType: 'image/jpeg',
          byteSize: '1000',
          width: 1080,
          height: 1080,
          durationMs: null,
          codec: null,
        });
      });
      mediaPreparationService.prepare.mockImplementation(() => {
        calls.push('preparationService');
        return Promise.resolve({
          sourceUrl: 'https://signed.example/media',
          mimeType: 'image/jpeg',
          bytes: 1000,
        });
      });

      await executor.publish(withMedia());

      expect(calls).toEqual([
        'validate',
        'resolveMedia',
        'preparationService',
        'prepareMedia',
        'publish',
      ]);
    });

    it('resolves the media asset scoped to the publication tenant/workspace/agencyClient', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      mockResolvedMedia();

      await executor.publish(withMedia());

      expect(mediaAssetResolver.resolve).toHaveBeenCalledWith({
        mediaAssetId,
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: null,
      });
    });

    it('calls M3 MediaPreparationService for valid media and hands the adapter a signed URL/metadata', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      mockResolvedMedia();

      await executor.publish(withMedia());

      expect(mediaPreparationService.prepare).toHaveBeenCalledWith({
        media: {
          storagePath: 'tenant-1/workspace-1/media/asset.jpg',
          mimeType: 'image/jpeg',
          bytes: 1000,
        },
        provider: 'meta',
        placement: 'feed',
      });
      expect(adapter.prepareMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: 'https://signed.example/media',
          mimeType: 'image/jpeg',
          bytes: 1000,
        }),
      );
    });

    it('delivers PreparedMedia (not raw source) to adapter.publish', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      mockResolvedMedia();

      await executor.publish(withMedia());

      expect(adapter.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          preparedMedia: { providerMediaRef: 'ref-1', expiresAt: null },
        }),
      );
    });

    it('rejects media that fails M1 capability validation before calling prepareMedia/publish', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      mockResolvedMedia({ mimeType: 'image/png' }); // not in acceptedMimeTypes

      await expect(executor.publish(withMedia())).rejects.toThrow(
        SocialPublicationExecutionError,
      );
      expect(adapter.prepareMedia).not.toHaveBeenCalled();
      expect(adapter.publish).not.toHaveBeenCalled();
    });

    it('fails as media_rejected (not a leaked provider detail) when capability validation fails', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      mockResolvedMedia({ mimeType: 'image/png' });

      try {
        await executor.publish(withMedia());
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(SocialPublicationExecutionError);
        expect((error as SocialPublicationExecutionError).reason).toBe(
          'media_rejected',
        );
      }
    });

    it('surfaces not-found for a mediaAssetId outside the publication scope', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      mediaAssetResolver.resolve.mockRejectedValue(
        new NotFoundException('Media asset not found.'),
      );

      await expect(executor.publish(withMedia())).rejects.toThrow(
        NotFoundException,
      );
      expect(adapter.publish).not.toHaveBeenCalled();
    });

    it('does not call media preparation when a media preparation error occurs upstream, and never reaches publish', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      mockResolvedMedia();
      mediaPreparationService.prepare.mockRejectedValue(
        new Error('presign failed'),
      );

      await expect(executor.publish(withMedia())).rejects.toThrow(
        'presign failed',
      );
      expect(adapter.publish).not.toHaveBeenCalled();
    });
  });

  describe('provider validation ordering', () => {
    it('calls adapter.validate before any media resolution or publish', async () => {
      const adapter = buildAdapter({
        validate: jest.fn(
          (): ValidationResult => ({
            valid: false,
            issues: [{ field: 'caption', reason: 'too_long' }],
          }),
        ),
      });
      registry.resolve.mockReturnValue(adapter);

      await expect(executor.publish(buildPublication())).rejects.toThrow(
        SocialPublicationExecutionError,
      );
      expect(mediaAssetResolver.resolve).not.toHaveBeenCalled();
      expect(adapter.publish).not.toHaveBeenCalled();
    });
  });

  describe('provider publish outcomes', () => {
    it('returns processing with the provider container identity instead of marking it published', async () => {
      const adapter = buildAdapter({
        publish: jest.fn(() =>
          Promise.resolve({
            outcome: 'processing' as const,
            externalPublicationId: 'ig-container:container-1',
            providerMetadata: { phase: 'container_processing' },
          }),
        ),
        reconcile: jest.fn(),
      });
      registry.resolve.mockReturnValue(adapter);

      await expect(executor.publish(buildPublication())).resolves.toEqual({
        outcome: 'processing',
        externalPublicationId: 'ig-container:container-1',
        providerMetadata: { phase: 'container_processing' },
      });
    });

    it('reconciles a persisted processing identity without creating or publishing another container', async () => {
      const adapter = buildAdapter({
        reconcile: jest.fn(() =>
          Promise.resolve({
            outcome: 'published' as const,
            externalPublicationId: 'media-1',
            externalPermalink: null,
            publishedAt: new Date('2026-09-07T12:00:00Z'),
            providerMetadata: {},
          }),
        ),
      });
      registry.resolve.mockReturnValue(adapter);

      await expect(
        executor.publish(
          buildPublication({
            status: 'processing',
            externalPublicationId: 'ig-container:container-1',
          }),
        ),
      ).resolves.toMatchObject({ externalPublicationId: 'media-1' });
      expect(adapter.reconcile).toHaveBeenCalledWith({
        credential: CREDENTIAL,
        externalPublicationId: 'ig-container:container-1',
      });
      expect(adapter.prepareMedia).not.toHaveBeenCalled();
      expect(adapter.publish).not.toHaveBeenCalled();
    });

    it('honours the per-provider kill switch before validation or any external effect', async () => {
      const adapter = buildAdapter();
      registry.resolve.mockReturnValue(adapter);
      config.isProviderEnabled.mockReturnValue(false);

      await expect(executor.publish(buildPublication())).rejects.toMatchObject({
        code: 'provider_publication_disabled',
      });
      expect(adapter.validate).not.toHaveBeenCalled();
      expect(adapter.prepareMedia).not.toHaveBeenCalled();
      expect(adapter.publish).not.toHaveBeenCalled();
    });

    it('translates a failed PublicationResult into SocialPublicationExecutionError with the provider-declared reason', async () => {
      const adapter = buildAdapter({
        publish: jest.fn(
          (): Promise<PublicationResult> =>
            Promise.resolve({
              outcome: 'failed',
              reason: 'rate_limited',
              code: 'graph_rate_limited',
            }),
        ),
      });
      registry.resolve.mockReturnValue(adapter);

      try {
        await executor.publish(buildPublication());
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(SocialPublicationExecutionError);
        expect((error as SocialPublicationExecutionError).reason).toBe(
          'rate_limited',
        );
      }
    });
  });

  describe('retry safety checks', () => {
    it('treats an unavailable reconciliation read as unsafe, never as proof that the post is absent', async () => {
      const adapter = buildAdapter({
        reconcile: jest.fn(() =>
          Promise.resolve({
            outcome: 'failed' as const,
            reason: 'provider_unavailable' as const,
            code: 'meta_network_error',
          }),
        ),
      });
      registry.resolve.mockReturnValue(adapter);

      await expect(
        executor.checkExisting(
          buildPublication({
            externalPublicationId: 'ig-container:container-1',
          }),
        ),
      ).resolves.toEqual({ outcome: 'unsafe_to_retry' });
    });
  });
});
