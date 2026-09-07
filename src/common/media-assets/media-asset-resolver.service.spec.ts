/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- expect.objectContaining(...) is typed `any` by @types/jest. */
import { NotFoundException } from '@nestjs/common';
import { IsNull, type FindOneOptions, type Repository } from 'typeorm';
import { MediaAssetResolverService } from './media-asset-resolver.service';
import type { MediaAssetEntity } from './media-asset.entity';

function buildAsset(
  overrides: Partial<MediaAssetEntity> = {},
): MediaAssetEntity {
  return {
    id: 'media-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
    storagePath: 'tenant-1/workspace-1/media/asset.jpg',
    mimeType: 'image/jpeg',
    byteSize: '1000',
    originalFilename: null,
    checksum: null,
    width: 1080,
    height: 1080,
    durationMs: null,
    codec: null,
    source: 'upload',
    metadata: {},
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as MediaAssetEntity;
}

describe('MediaAssetResolverService', () => {
  let repository: { findOne: jest.Mock };
  let resolver: MediaAssetResolverService;

  beforeEach(() => {
    repository = { findOne: jest.fn() };
    resolver = new MediaAssetResolverService(
      repository as unknown as Repository<MediaAssetEntity>,
    );
  });

  it('resolves a media asset scoped to tenant/workspace/agencyClient', async () => {
    const asset = buildAsset();
    repository.findOne.mockResolvedValue(asset);

    const result = await resolver.resolve({
      mediaAssetId: 'media-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
    });

    expect(result).toEqual({
      id: 'media-1',
      storagePath: asset.storagePath,
      mimeType: 'image/jpeg',
      byteSize: '1000',
      width: 1080,
      height: 1080,
      durationMs: null,
      codec: null,
    });
  });

  it('queries agencyClientId with IsNull() for the agency-own context, not a literal null', async () => {
    repository.findOne.mockResolvedValue(buildAsset());

    await resolver.resolve({
      mediaAssetId: 'media-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
    });

    const options = repository.findOne.mock
      .calls[0][0] as FindOneOptions<MediaAssetEntity>;
    const where = options.where as { agencyClientId: unknown };
    expect(where.agencyClientId).toEqual(IsNull());
  });

  it('throws not-found for a mediaAssetId that does not exist', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      resolver.resolve({
        mediaAssetId: 'missing',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: null,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws not-found (not a different error) for a media asset belonging to another tenant', async () => {
    // The repository query itself excludes cross-tenant rows; simulate that
    // by returning null, proving the caller cannot distinguish "wrong tenant"
    // from "does not exist".
    repository.findOne.mockResolvedValue(null);

    await expect(
      resolver.resolve({
        mediaAssetId: 'media-1',
        tenantId: 'other-tenant',
        workspaceId: 'workspace-1',
        agencyClientId: null,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'other-tenant' }),
      }),
    );
  });

  it('throws not-found for a media asset belonging to another workspace', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      resolver.resolve({
        mediaAssetId: 'media-1',
        tenantId: 'tenant-1',
        workspaceId: 'other-workspace',
        agencyClientId: null,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'other-workspace' }),
      }),
    );
  });

  it('throws not-found for a media asset belonging to another agencyClient', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      resolver.resolve({
        mediaAssetId: 'media-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: 'other-client',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agencyClientId: 'other-client' }),
      }),
    );
  });

  it('does not resolve a tombstoned (deleted) asset', async () => {
    // TypeORM's default repository excludes soft-deleted rows automatically;
    // this asserts the resolver still surfaces the safe not-found error.
    repository.findOne.mockResolvedValue(null);

    await expect(
      resolver.resolve({
        mediaAssetId: 'media-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: null,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
