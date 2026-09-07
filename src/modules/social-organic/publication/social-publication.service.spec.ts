/* eslint-disable @typescript-eslint/unbound-method -- Jest mock methods asserted via expect(x.method).toHaveBeenCalledWith(...) are never invoked unbound. */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { MediaAssetResolverService } from '../../../common/media-assets';
import { SocialContentDestinationEntity } from '../../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../../social-planner/entities/social-content-item.entity';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import type { PublisherCapabilities } from '../providers/provider-capabilities';
import type {
  SocialPublisherAdapter,
  ValidationResult,
} from '../providers/social-publisher.adapter';
import type { SocialPublisherRegistry } from '../providers/social-publisher.registry';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import {
  SocialPublicationService,
  type SocialPublicationScope,
} from './social-publication.service';

type RepositoryMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function createRepositoryMock(): RepositoryMock {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn((value) => Promise.resolve(value)),
  };
}

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
    publish: jest.fn(() =>
      Promise.resolve({
        outcome: 'published' as const,
        externalPublicationId: 'ext-1',
        externalPermalink: null,
        publishedAt: new Date('2026-09-07T12:00:00Z'),
        providerMetadata: {},
      }),
    ),
    ...overrides,
  };
}

const VALID_RESOLVED_MEDIA = {
  id: 'media-asset-1',
  storagePath: 'tenant-1/workspace-1/media/asset.jpg',
  mimeType: 'image/jpeg',
  byteSize: '1000',
  width: 1080,
  height: 1080,
  durationMs: null,
  codec: null,
};

describe('SocialPublicationService', () => {
  let service: SocialPublicationService;

  let publicationsRepository: RepositoryMock;
  let contentRepository: RepositoryMock;
  let destinationsRepository: RepositoryMock;
  let assetsRepository: RepositoryMock;
  let mediaAssetResolver: { resolve: jest.Mock };
  let publisherRegistry: { resolve: jest.Mock; has: jest.Mock };
  let adapter: SocialPublisherAdapter;

  const agencyScope: SocialPublicationScope = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
  };

  const otherTenantScope: SocialPublicationScope = {
    tenantId: '99999999-9999-4999-8999-999999999999',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
  };

  const contentItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const destinationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const actorUserId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const contentItem: Partial<SocialContentItemEntity> = {
    id: contentItemId,
    caption: 'caption text',
    copy: 'copy text',
    cta: 'Saiba mais',
    hashtags: ['#lyra'],
    firstComment: null,
  };

  const destination: Partial<SocialContentDestinationEntity> = {
    id: destinationId,
    contentItemId,
    channel: 'instagram',
    placement: 'feed',
  };

  const asset: Partial<SocialOrganicAssetEntity> = {
    id: assetId,
    provider: 'meta',
    assetType: 'facebook_page',
    connectionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    externalAssetId: 'external-asset-1',
    status: 'active',
    isPublishEnabled: true,
  };

  const mediaAssetId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  beforeEach(() => {
    publicationsRepository = createRepositoryMock();
    contentRepository = createRepositoryMock();
    destinationsRepository = createRepositoryMock();
    assetsRepository = createRepositoryMock();
    mediaAssetResolver = {
      resolve: jest.fn().mockResolvedValue(VALID_RESOLVED_MEDIA),
    };
    adapter = buildAdapter();
    publisherRegistry = {
      resolve: jest.fn(() => adapter),
      has: jest.fn(() => true),
    };

    service = new SocialPublicationService(
      publicationsRepository as unknown as Repository<SocialPublicationEntity>,
      contentRepository as unknown as Repository<SocialContentItemEntity>,
      destinationsRepository as unknown as Repository<SocialContentDestinationEntity>,
      assetsRepository as unknown as Repository<SocialOrganicAssetEntity>,
      mediaAssetResolver as unknown as MediaAssetResolverService,
      publisherRegistry as unknown as SocialPublisherRegistry,
    );

    contentRepository.findOne.mockResolvedValue(contentItem);
    destinationsRepository.findOne.mockResolvedValue(destination);
    assetsRepository.findOne.mockResolvedValue(asset);
  });

  describe('create', () => {
    it('builds payload_snapshot from the content item, never from the request body (text-only)', async () => {
      const result = await service.create(agencyScope, actorUserId, {
        contentItemId,
        destinationId,
        assetId,
      });

      expect(publicationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: agencyScope.tenantId,
          workspaceId: agencyScope.workspaceId,
          agencyClientId: null,
          contentItemId,
          destinationId,
          provider: 'meta',
          connectionId: asset.connectionId,
          assetId,
          externalAssetId: 'external-asset-1',
          status: 'scheduled',
          mediaAssetId: null,
          payloadSnapshot: {
            placement: 'feed',
            caption: 'caption text',
            copy: 'copy text',
            cta: 'Saiba mais',
            hashtags: ['#lyra'],
            firstComment: null,
            mediaAssetId: null,
          },
          createdById: actorUserId,
        }),
      );
      expect(typeof result.payloadHash).toBe('string');
      expect(result.idempotencyKey).toBeTruthy();
      expect(mediaAssetResolver.resolve).not.toHaveBeenCalled();
      expect(publisherRegistry.resolve).not.toHaveBeenCalled();
    });

    it('resolves and validates a scoped mediaAssetId, persisting only the reference', async () => {
      const result = await service.create(agencyScope, actorUserId, {
        contentItemId,
        destinationId,
        assetId,
        mediaAssetId,
      });

      expect(mediaAssetResolver.resolve).toHaveBeenCalledWith({
        tenantId: agencyScope.tenantId,
        workspaceId: agencyScope.workspaceId,
        agencyClientId: agencyScope.agencyClientId,
        mediaAssetId,
      });
      expect(publisherRegistry.resolve).toHaveBeenCalledWith(
        'meta',
        'facebook_page',
      );
      expect(adapter.capabilities).toHaveBeenCalledWith('facebook_page');
      expect(publicationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaAssetId,
          payloadSnapshot: expect.objectContaining({ mediaAssetId }),
        }),
      );
      expect(result.mediaAssetId).toBe(mediaAssetId);
    });

    it('never generates a presigned URL and never calls prepareMedia/publish at schedule time', async () => {
      await service.create(agencyScope, actorUserId, {
        contentItemId,
        destinationId,
        assetId,
        mediaAssetId,
      });

      expect(adapter.prepareMedia).not.toHaveBeenCalled();
      expect(adapter.publish).not.toHaveBeenCalled();
    });

    it('propagates not-found when mediaAssetId is out of scope (wrong tenant/workspace/client, or deleted)', async () => {
      mediaAssetResolver.resolve.mockRejectedValue(
        new NotFoundException('Media asset not found.'),
      );

      await expect(
        service.create(agencyScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
          mediaAssetId,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(publicationsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a MIME type incompatible with the destination capabilities before saving', async () => {
      mediaAssetResolver.resolve.mockResolvedValue({
        ...VALID_RESOLVED_MEDIA,
        mimeType: 'image/png',
      });

      await expect(
        service.create(agencyScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
          mediaAssetId,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(publicationsRepository.save).not.toHaveBeenCalled();
      expect(publicationsRepository.create).not.toHaveBeenCalled();
      expect(adapter.prepareMedia).not.toHaveBeenCalled();
      expect(adapter.publish).not.toHaveBeenCalled();
    });

    it('rejects an incompatible aspect ratio before saving', async () => {
      mediaAssetResolver.resolve.mockResolvedValue({
        ...VALID_RESOLVED_MEDIA,
        width: 1920,
        height: 1080,
      });

      await expect(
        service.create(agencyScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
          mediaAssetId,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(publicationsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects an incompatible video (duration/mime) before saving', async () => {
      const videoAdapter = buildAdapter({
        capabilities: jest.fn(() => ({
          ...IMAGE_CAPABILITIES,
          media: {
            feed: {
              acceptedMimeTypes: ['video/mp4'],
              maxBytes: 50_000_000,
              minDurationSeconds: 3,
              maxDurationSeconds: 60,
              aspectRatios: ['9:16'],
            },
          },
        })),
      });
      publisherRegistry.resolve.mockReturnValue(videoAdapter);
      mediaAssetResolver.resolve.mockResolvedValue({
        ...VALID_RESOLVED_MEDIA,
        mimeType: 'video/mp4',
        durationMs: '120000',
        width: 1080,
        height: 1080,
      });

      await expect(
        service.create(agencyScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
          mediaAssetId,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(publicationsRepository.save).not.toHaveBeenCalled();
      expect(videoAdapter.prepareMedia).not.toHaveBeenCalled();
      expect(videoAdapter.publish).not.toHaveBeenCalled();
    });

    it('fails safe when metadata (dimensions) is missing rather than assuming defaults', async () => {
      mediaAssetResolver.resolve.mockResolvedValue({
        ...VALID_RESOLVED_MEDIA,
        width: null,
        height: null,
      });

      await expect(
        service.create(agencyScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
          mediaAssetId,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(publicationsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects when the destination provider has no registered adapter', async () => {
      publisherRegistry.has.mockReturnValue(false);

      await expect(
        service.create(agencyScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
          mediaAssetId,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(publisherRegistry.resolve).not.toHaveBeenCalled();
      expect(publicationsRepository.save).not.toHaveBeenCalled();
    });

    it('defaults scheduledAt to now when omitted', async () => {
      const before = Date.now();

      await service.create(agencyScope, actorUserId, {
        contentItemId,
        destinationId,
        assetId,
      });

      const created = publicationsRepository.create.mock
        .calls[0][0] as SocialPublicationEntity;
      expect(created.scheduledAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('rejects a request for a content item outside the caller scope (not-found, not 403)', async () => {
      contentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create(otherTenantScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an asset that is not active or not publish-enabled', async () => {
      assetsRepository.findOne.mockResolvedValue({
        ...asset,
        isPublishEnabled: false,
      });

      await expect(
        service.create(agencyScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('resolves mediaAssetId under the caller scope, not a cross-tenant/workspace/client one', async () => {
      mediaAssetResolver.resolve.mockRejectedValue(
        new NotFoundException('Media asset not found.'),
      );

      await expect(
        service.create(otherTenantScope, actorUserId, {
          contentItemId,
          destinationId,
          assetId,
          mediaAssetId,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mediaAssetResolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: otherTenantScope.tenantId,
        }),
      );
    });
  });

  describe('cancel', () => {
    it('cancels a scheduled publication', async () => {
      publicationsRepository.findOne.mockResolvedValue({
        id: 'pub-1',
        status: 'scheduled',
        tenantId: agencyScope.tenantId,
        workspaceId: agencyScope.workspaceId,
        agencyClientId: null,
      });

      const result = await service.cancel(agencyScope, actorUserId, 'pub-1');

      expect(result.status).toBe('cancelled');
      expect(result.cancelledById).toBe(actorUserId);
      expect(result.cancelledAt).toBeInstanceOf(Date);
    });

    it('refuses to cancel a terminal publication', async () => {
      publicationsRepository.findOne.mockResolvedValue({
        id: 'pub-1',
        status: 'published',
        tenantId: agencyScope.tenantId,
        workspaceId: agencyScope.workspaceId,
        agencyClientId: null,
      });

      await expect(
        service.cancel(agencyScope, actorUserId, 'pub-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('returns not-found for a publication outside the caller scope', async () => {
      publicationsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.cancel(otherTenantScope, actorUserId, 'pub-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('publishNow', () => {
    it('brings a scheduled publication due time forward to now', async () => {
      const future = new Date(Date.now() + 60 * 60_000);
      publicationsRepository.findOne.mockResolvedValue({
        id: 'pub-1',
        status: 'scheduled',
        scheduledAt: future,
        availableAt: future,
        tenantId: agencyScope.tenantId,
        workspaceId: agencyScope.workspaceId,
        agencyClientId: null,
      });

      const before = Date.now();
      const result = await service.publishNow(agencyScope, 'pub-1');

      expect(result.scheduledAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.availableAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('refuses to publish now a publication that is not scheduled', async () => {
      publicationsRepository.findOne.mockResolvedValue({
        id: 'pub-1',
        status: 'queued',
        tenantId: agencyScope.tenantId,
        workspaceId: agencyScope.workspaceId,
        agencyClientId: null,
      });

      await expect(service.publishNow(agencyScope, 'pub-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('retry', () => {
    const original = {
      id: 'pub-1',
      tenantId: agencyScope.tenantId,
      workspaceId: agencyScope.workspaceId,
      agencyClientId: null,
      contentItemId,
      destinationId,
      provider: 'meta',
      connectionId: asset.connectionId,
      assetId,
      externalAssetId: 'external-asset-1',
      mediaAssetId: null as string | null,
      status: 'failed',
      payloadSnapshot: {
        placement: 'feed',
        mediaAssetId: null as string | null,
      },
      payloadHash: 'hash-1',
      idempotencyKey: 'original-key',
      maxAttempts: 5,
    };

    it('creates a new attempt row for a failed publication instead of reopening it (text-only)', async () => {
      publicationsRepository.findOne.mockResolvedValue({ ...original });

      const result = await service.retry(agencyScope, actorUserId, 'pub-1');

      expect(result.status).toBe('scheduled');
      expect(result.attempts).toBe(0);
      expect(result.idempotencyKey).not.toBe('original-key');
      expect(result.payloadSnapshot).toEqual(original.payloadSnapshot);
      expect(result.mediaAssetId).toBe(null);
      expect(mediaAssetResolver.resolve).not.toHaveBeenCalled();
    });

    it('re-validates a still-compatible mediaAssetId and creates the new attempt row', async () => {
      publicationsRepository.findOne.mockResolvedValue({
        ...original,
        mediaAssetId,
        payloadSnapshot: { placement: 'feed', mediaAssetId },
      });

      const result = await service.retry(agencyScope, actorUserId, 'pub-1');

      expect(mediaAssetResolver.resolve).toHaveBeenCalledWith({
        tenantId: agencyScope.tenantId,
        workspaceId: agencyScope.workspaceId,
        agencyClientId: agencyScope.agencyClientId,
        mediaAssetId,
      });
      expect(result.status).toBe('scheduled');
      expect(result.mediaAssetId).toBe(mediaAssetId);
    });

    it('rejects retry when the media is now incompatible with declared capabilities', async () => {
      publicationsRepository.findOne.mockResolvedValue({
        ...original,
        mediaAssetId,
        payloadSnapshot: { placement: 'feed', mediaAssetId },
      });
      mediaAssetResolver.resolve.mockResolvedValue({
        ...VALID_RESOLVED_MEDIA,
        mimeType: 'image/png',
      });

      await expect(
        service.retry(agencyScope, actorUserId, 'pub-1'),
      ).rejects.toThrow(BadRequestException);
      expect(publicationsRepository.save).not.toHaveBeenCalled();
    });

    it('refuses to retry a publication that has not failed', async () => {
      publicationsRepository.findOne.mockResolvedValue({
        id: 'pub-1',
        status: 'published',
        tenantId: agencyScope.tenantId,
        workspaceId: agencyScope.workspaceId,
        agencyClientId: null,
      });

      await expect(
        service.retry(agencyScope, actorUserId, 'pub-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('scopes the query to the caller tenant/workspace/client', async () => {
      publicationsRepository.find.mockResolvedValue([]);

      await service.list(agencyScope, {});

      expect(publicationsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: agencyScope.tenantId,
            workspaceId: agencyScope.workspaceId,
          }),
        }),
      );
    });
  });
});
