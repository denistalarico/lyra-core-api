import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IsNull, type Repository } from 'typeorm';
import { MediaAssetEntity } from '../../../common/media-assets';
import { SocialContentDestinationEntity } from '../../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../../social-planner/entities/social-content-item.entity';
import { SocialDestinationCreativeEntity } from '../../social-planner/entities/social-destination-creative.entity';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import type { PublisherCapabilities } from '../providers/provider-capabilities';
import type { SocialPublisherAdapter } from '../providers/social-publisher.adapter';
import type { SocialPublisherRegistry } from '../providers/social-publisher.registry';
import {
  DestinationCreativeService,
  type DestinationCreativeScope,
} from './destination-creative.service';

type RepositoryMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  manager: { transaction: jest.Mock };
};

function createRepositoryMock(): RepositoryMock {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    delete: jest.fn(() => Promise.resolve({ affected: 0 })),
    manager: { transaction: jest.fn() },
  };
}

/**
 * Feed accepts a square JPEG; story accepts only 9:16 video. Two placements
 * with genuinely incompatible shapes is what lets one asset be proven valid
 * for one destination and rejected for the other.
 */
const CAPABILITIES: PublisherCapabilities = {
  provider: 'meta',
  assetType: 'facebook_page',
  placements: ['feed', 'story'],
  media: {
    feed: {
      acceptedMimeTypes: ['image/jpeg'],
      maxBytes: 10_000_000,
      aspectRatios: ['1:1'],
    },
    story: {
      acceptedMimeTypes: ['video/mp4'],
      maxBytes: 10_000_000,
      aspectRatios: ['9:16'],
    },
  },
  supportsScheduling: true,
  supportsCaption: true,
  supportsFirstComment: true,
  supportsHashtags: true,
  requiresReconciliation: false,
  supportsRemoval: false,
};

const CONTENT_ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DESTINATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEDIA_ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORGANIC_ASSET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function buildSquareJpeg(
  overrides: Partial<MediaAssetEntity> = {},
): MediaAssetEntity {
  return {
    id: MEDIA_ASSET_ID,
    storagePath: 'tenant-1/workspace-1/media/asset.jpg',
    mimeType: 'image/jpeg',
    byteSize: '1000',
    originalFilename: 'asset.jpg',
    checksum: null,
    width: 1080,
    height: 1080,
    durationMs: null,
    codec: null,
    source: 'manual',
    metadata: {},
    createdById: null,
    createdAt: new Date('2026-09-10T12:00:00Z'),
    updatedAt: new Date('2026-09-10T12:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as MediaAssetEntity;
}

function buildOrganicAsset(
  overrides: Partial<SocialOrganicAssetEntity> = {},
): SocialOrganicAssetEntity {
  return {
    id: ORGANIC_ASSET_ID,
    provider: 'meta',
    assetType: 'facebook_page',
    status: 'active',
    isPublishEnabled: true,
    ...overrides,
  } as SocialOrganicAssetEntity;
}

function buildDestination(
  overrides: Partial<SocialContentDestinationEntity> = {},
): SocialContentDestinationEntity {
  return {
    id: DESTINATION_ID,
    contentItemId: CONTENT_ITEM_ID,
    channel: 'facebook',
    placement: 'feed',
    ...overrides,
  } as SocialContentDestinationEntity;
}

describe('DestinationCreativeService', () => {
  let service: DestinationCreativeService;

  let creativesRepository: RepositoryMock;
  let destinationsRepository: RepositoryMock;
  let contentRepository: RepositoryMock;
  let mediaAssetsRepository: RepositoryMock;
  let organicAssetsRepository: RepositoryMock;
  let publisherRegistry: { resolve: jest.Mock; has: jest.Mock };

  const agencyScope: DestinationCreativeScope = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
  };

  const clientScope: DestinationCreativeScope = {
    ...agencyScope,
    agencyClientId: '33333333-3333-4333-8333-333333333333',
  };

  beforeEach(() => {
    creativesRepository = createRepositoryMock();
    destinationsRepository = createRepositoryMock();
    contentRepository = createRepositoryMock();
    mediaAssetsRepository = createRepositoryMock();
    organicAssetsRepository = createRepositoryMock();

    const adapter = {
      provider: 'meta',
      assetTypes: ['facebook_page'],
      capabilities: jest.fn(() => CAPABILITIES),
    } as unknown as SocialPublisherAdapter;

    publisherRegistry = {
      has: jest.fn(() => true),
      resolve: jest.fn(() => adapter),
    };

    /**
     * Runs the callback against the same repository mocks, so a test can
     * assert on the delete-then-insert pair the real transaction performs.
     */
    creativesRepository.manager.transaction.mockImplementation(
      (callback: (manager: unknown) => unknown) =>
        callback({ getRepository: () => creativesRepository }),
    );

    service = new DestinationCreativeService(
      creativesRepository as unknown as Repository<SocialDestinationCreativeEntity>,
      destinationsRepository as unknown as Repository<SocialContentDestinationEntity>,
      contentRepository as unknown as Repository<SocialContentItemEntity>,
      mediaAssetsRepository as unknown as Repository<MediaAssetEntity>,
      organicAssetsRepository as unknown as Repository<SocialOrganicAssetEntity>,
      publisherRegistry as unknown as SocialPublisherRegistry,
    );
  });

  describe('replaceForDestination', () => {
    beforeEach(() => {
      destinationsRepository.findOne.mockResolvedValue(buildDestination());
      organicAssetsRepository.findOne.mockResolvedValue(buildOrganicAsset());
      mediaAssetsRepository.findOne.mockResolvedValue(buildSquareJpeg());
      creativesRepository.save.mockImplementation((value: unknown) =>
        Promise.resolve({
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          ...(value as object),
          createdAt: new Date('2026-09-10T12:00:00Z'),
          updatedAt: new Date('2026-09-10T12:00:00Z'),
        }),
      );
    });

    it('binds a media that satisfies the placement capability', async () => {
      const view = await service.replaceForDestination(
        agencyScope,
        DESTINATION_ID,
        'user-1',
        { mediaAssetId: MEDIA_ASSET_ID, organicAssetId: ORGANIC_ASSET_ID },
      );

      expect(view.destinationId).toBe(DESTINATION_ID);
      expect(view.media?.id).toBe(MEDIA_ASSET_ID);
      expect(view.role).toBe('primary');
      expect(view.source).toBe('manual');
    });

    it('derives scope and contentItemId from trusted sources, never the body', async () => {
      await service.replaceForDestination(
        clientScope,
        DESTINATION_ID,
        'user-1',
        { mediaAssetId: MEDIA_ASSET_ID, organicAssetId: ORGANIC_ASSET_ID },
      );

      expect(creativesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: clientScope.tenantId,
          workspaceId: clientScope.workspaceId,
          agencyClientId: clientScope.agencyClientId,
          // Comes from the resolved destination row, not from the request.
          contentItemId: CONTENT_ITEM_ID,
        }),
      );
    });

    it('replaces the previous primary creative in one transaction', async () => {
      await service.replaceForDestination(
        agencyScope,
        DESTINATION_ID,
        'user-1',
        { mediaAssetId: MEDIA_ASSET_ID, organicAssetId: ORGANIC_ASSET_ID },
      );

      expect(creativesRepository.manager.transaction).toHaveBeenCalledTimes(1);
      expect(creativesRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationId: DESTINATION_ID,
          role: 'primary',
          agencyClientId: IsNull(),
        }),
      );
      expect(creativesRepository.save).toHaveBeenCalledTimes(1);
    });

    /**
     * E5's definition of done, stated as a test: the same square JPEG that
     * feed accepts must be refused for a story placement whose capability
     * declares 9:16 video.
     */
    it('rejects a square image for a story placement', async () => {
      destinationsRepository.findOne.mockResolvedValue(
        buildDestination({ placement: 'story' }),
      );

      await expect(
        service.replaceForDestination(agencyScope, DESTINATION_ID, 'user-1', {
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(creativesRepository.save).not.toHaveBeenCalled();
    });

    it('fails closed when the asset has no usable dimensions', async () => {
      mediaAssetsRepository.findOne.mockResolvedValue(
        buildSquareJpeg({ width: null, height: null }),
      );

      await expect(
        service.replaceForDestination(agencyScope, DESTINATION_ID, 'user-1', {
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fails closed when no adapter is registered for the provider', async () => {
      publisherRegistry.has.mockReturnValue(false);

      await expect(
        service.replaceForDestination(agencyScope, DESTINATION_ID, 'user-1', {
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(publisherRegistry.resolve).not.toHaveBeenCalled();
    });

    it('refuses an organic asset that is not publishable', async () => {
      organicAssetsRepository.findOne.mockResolvedValue(
        buildOrganicAsset({ isPublishEnabled: false }),
      );

      await expect(
        service.replaceForDestination(agencyScope, DESTINATION_ID, 'user-1', {
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a role other than primary while carousel is out of scope', async () => {
      await expect(
        service.replaceForDestination(agencyScope, DESTINATION_ID, 'user-1', {
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
          role: 'slide',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(destinationsRepository.findOne).not.toHaveBeenCalled();
    });

    it('queries the media asset within the caller scope only', async () => {
      await service.replaceForDestination(
        clientScope,
        DESTINATION_ID,
        'user-1',
        { mediaAssetId: MEDIA_ASSET_ID, organicAssetId: ORGANIC_ASSET_ID },
      );

      expect(mediaAssetsRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: MEDIA_ASSET_ID,
          tenantId: clientScope.tenantId,
          workspaceId: clientScope.workspaceId,
          agencyClientId: clientScope.agencyClientId,
        },
      });
    });

    it('reports a media from another context as not found', async () => {
      mediaAssetsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.replaceForDestination(agencyScope, DESTINATION_ID, 'user-1', {
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports a destination from another context as not found', async () => {
      destinationsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.replaceForDestination(agencyScope, DESTINATION_ID, 'user-1', {
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mediaAssetsRepository.findOne).not.toHaveBeenCalled();
    });

    /**
     * The agency context must be filtered with IsNull(), never a raw null:
     * TypeORM drops a raw null from the where clause, which would widen the
     * query to every client of the workspace.
     */
    it('uses IsNull for the agency context', async () => {
      await service.replaceForDestination(
        agencyScope,
        DESTINATION_ID,
        'user-1',
        { mediaAssetId: MEDIA_ASSET_ID, organicAssetId: ORGANIC_ASSET_ID },
      );

      expect(destinationsRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: DESTINATION_ID,
          tenantId: agencyScope.tenantId,
          workspaceId: agencyScope.workspaceId,
          agencyClientId: IsNull(),
          contentItemId: expect.anything(),
        },
      });
    });
  });

  describe('replaceCollectionForDestination', () => {
    it('stores up to ten creatives as an ordered slide collection in one transaction', async () => {
      const secondMediaId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      destinationsRepository.findOne.mockResolvedValue(buildDestination());
      organicAssetsRepository.findOne.mockResolvedValue(buildOrganicAsset());
      mediaAssetsRepository.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(buildSquareJpeg({ id: where.id })),
      );
      creativesRepository.save.mockImplementation((values: unknown[]) =>
        Promise.resolve(
          values.map((value, index) => ({
            id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${index}`,
            ...(value as object),
            createdAt: new Date('2026-09-10T12:00:00Z'),
            updatedAt: new Date('2026-09-10T12:00:00Z'),
          })),
        ),
      );

      const result = await service.replaceCollectionForDestination(
        agencyScope,
        DESTINATION_ID,
        'user-1',
        {
          organicAssetId: ORGANIC_ASSET_ID,
          items: [
            { mediaAssetId: MEDIA_ASSET_ID },
            { mediaAssetId: secondMediaId },
          ],
        },
      );

      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.role)).toEqual(['slide', 'slide']);
      expect(result.items.map((item) => item.sortOrder)).toEqual([0, 1]);
      expect(creativesRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({ destinationId: DESTINATION_ID }),
      );
      expect(creativesRepository.manager.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('listForContent', () => {
    it('proves the content belongs to the scope before reading creatives', async () => {
      contentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.listForContent(agencyScope, CONTENT_ITEM_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(creativesRepository.find).not.toHaveBeenCalled();
    });

    it('projects each creative with its media, never the storage path', async () => {
      contentRepository.findOne.mockResolvedValue({ id: CONTENT_ITEM_ID });
      creativesRepository.find.mockResolvedValue([
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          destinationId: DESTINATION_ID,
          contentItemId: CONTENT_ITEM_ID,
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
          role: 'primary',
          sortOrder: 0,
          source: 'manual',
          createdAt: new Date('2026-09-10T12:00:00Z'),
          updatedAt: new Date('2026-09-10T12:00:00Z'),
        },
      ]);
      mediaAssetsRepository.find.mockResolvedValue([buildSquareJpeg()]);

      const result = await service.listForContent(agencyScope, CONTENT_ITEM_ID);

      expect(result.total).toBe(1);
      expect(result.items[0].media?.id).toBe(MEDIA_ASSET_ID);
      expect(JSON.stringify(result)).not.toContain('storagePath');
      expect(JSON.stringify(result)).not.toContain('tenant-1/workspace-1');
    });

    /**
     * A media row the caller cannot read leaves the link visible with a null
     * media rather than hiding the link: the destination is not empty, and a
     * caller told otherwise would overwrite a creative it never saw.
     */
    it('keeps the link visible when its media cannot be read in scope', async () => {
      contentRepository.findOne.mockResolvedValue({ id: CONTENT_ITEM_ID });
      creativesRepository.find.mockResolvedValue([
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          destinationId: DESTINATION_ID,
          contentItemId: CONTENT_ITEM_ID,
          mediaAssetId: MEDIA_ASSET_ID,
          organicAssetId: ORGANIC_ASSET_ID,
          role: 'primary',
          sortOrder: 0,
          source: 'manual',
          createdAt: new Date('2026-09-10T12:00:00Z'),
          updatedAt: new Date('2026-09-10T12:00:00Z'),
        },
      ]);
      mediaAssetsRepository.find.mockResolvedValue([]);

      const result = await service.listForContent(agencyScope, CONTENT_ITEM_ID);

      expect(result.items[0].media).toBeNull();
      expect(result.items[0].id).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    });
  });

  describe('removeForDestination', () => {
    it('clears only the scoped destination', async () => {
      destinationsRepository.findOne.mockResolvedValue(buildDestination());

      await service.removeForDestination(clientScope, DESTINATION_ID);

      expect(creativesRepository.delete).toHaveBeenCalledWith({
        tenantId: clientScope.tenantId,
        workspaceId: clientScope.workspaceId,
        agencyClientId: clientScope.agencyClientId,
        destinationId: DESTINATION_ID,
      });
    });

    it('does not delete anything for an out-of-scope destination', async () => {
      destinationsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeForDestination(agencyScope, DESTINATION_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(creativesRepository.delete).not.toHaveBeenCalled();
    });
  });
});
