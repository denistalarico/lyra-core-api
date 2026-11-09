import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Readable } from 'node:stream';
import { FindOperator, IsNull, Repository } from 'typeorm';
import type { CreativeStudioScope } from './creative-studio.scope';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from './entities';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeFolderService } from './creative-folder.service';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import { MediaAssetEntity } from '../../common/media-assets';

const agency: CreativeStudioScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: null,
  companyContextId: null,
};
const clientA: CreativeStudioScope = {
  ...agency,
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};
const clientB: CreativeStudioScope = {
  ...agency,
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000002',
};
const anotherTenant: CreativeStudioScope = {
  ...clientA,
  tenantId: '10000000-0000-4000-8000-000000000002',
};
const anotherWorkspace: CreativeStudioScope = {
  ...clientA,
  workspaceId: '20000000-0000-4000-8000-000000000002',
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const WEBP = Buffer.from('RIFF0000WEBP', 'latin1');
const MP4 = Buffer.from([
  0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
const QUICKTIME = Buffer.from([
  0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
]);

type Row = Record<string, any>;
const id = (n: number) =>
  `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function rowMatches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'not') return row[key] !== null;
      return expected.type === 'isNull'
        ? row[key] === null
        : row[key] === expected.value;
    }
    return row[key] === expected;
  });
}

function makeAsset(
  scope: CreativeStudioScope,
  overrides: Partial<CreativeAssetEntity> = {},
) {
  const now = new Date('2026-09-20T12:00:00.000Z');
  return {
    id: id(1),
    ...scope,
    name: 'Asset A',
    assetType: 'image',
    sourceType: 'upload',
    status: 'ready',
    folderId: null,
    currentVersionId: null,
    contentItemId: null,
    metadata: {},
    createdById: 'user-a',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    trashedAt: null,
    deletedAt: null,
    ...overrides,
  } as CreativeAssetEntity;
}

function makeVersion(
  assetId: string,
  number: number,
  overrides: Partial<CreativeAssetVersionEntity> = {},
) {
  return {
    id: id(number + 10),
    creativeAssetId: assetId,
    versionNumber: number,
    mediaAssetId: `media-${number}`,
    thumbnailMediaAssetId: `thumbnail-${number}`,
    source: number === 1 ? 'upload' : 'replace',
    createdById: 'user-a',
    createdAt: new Date(
      `2026-09-${String(20 - number).padStart(2, '0')}T12:00:00.000Z`,
    ),
    ...overrides,
  } as CreativeAssetVersionEntity;
}

function makeHarness() {
  const state = {
    assets: [] as CreativeAssetEntity[],
    versions: [] as CreativeAssetVersionEntity[],
    folders: [] as CreativeFolderEntity[],
    nextId: 100,
  };
  const nextId = () => id(state.nextId++);
  const now = () => new Date('2026-09-20T12:00:00.000Z');

  const assets: Row = {
    create: jest.fn((input: Row) => ({
      id: nextId(),
      createdAt: now(),
      updatedAt: now(),
      trashedAt: null,
      deletedAt: null,
      ...input,
    })),
    save: jest.fn(async (input: CreativeAssetEntity) => {
      const existing = state.assets.findIndex((asset) => asset.id === input.id);
      input.updatedAt = now();
      if (existing < 0) state.assets.push(input);
      else state.assets[existing] = input;
      return input;
    }),
    find: jest.fn(async ({ where }: { where: Row }) =>
      state.assets.filter((asset) =>
        rowMatches(asset as unknown as Row, where),
      ),
    ),
    findOne: jest.fn(
      async ({ where }: { where: Row }) =>
        state.assets.find((asset) =>
          rowMatches(asset as unknown as Row, where),
        ) ?? null,
    ),
    exists: jest.fn(async ({ where }: { where: Row }) =>
      state.assets.some((asset) => rowMatches(asset as unknown as Row, where)),
    ),
    update: jest.fn(async (where: Row, patch: Partial<CreativeAssetEntity>) => {
      // Matches every given column, so a compare-and-set misses like SQL does.
      const matched = state.assets.filter((asset) =>
        rowMatches(asset as unknown as Row, where),
      );
      for (const asset of matched)
        Object.assign(asset, patch, { updatedAt: now() });
      return { affected: matched.length };
    }),
    remove: jest.fn(async (asset: CreativeAssetEntity) => {
      state.assets = state.assets.filter((item) => item.id !== asset.id);
    }),
    count: jest.fn(
      async ({ where }: { where: Row }) =>
        state.assets.filter((asset) =>
          rowMatches(asset as unknown as Row, where),
        ).length,
    ),
    createQueryBuilder: jest.fn(() => {
      let scope: Row = {};
      const filters: Row[] = [];
      let take = Number.MAX_SAFE_INTEGER;
      const builder: Row = {
        leftJoinAndMapOne: jest.fn(() => builder),
        where: jest.fn((_sql: string, params: Row) => {
          scope = params;
          return builder;
        }),
        andWhere: jest.fn((sql: string, params: Row = {}) => {
          filters.push({ sql, ...params });
          return builder;
        }),
        orderBy: jest.fn(() => builder),
        addOrderBy: jest.fn(() => builder),
        take: jest.fn((value: number) => {
          take = value;
          return builder;
        }),
        getMany: jest.fn(async () => {
          const inScope = state.assets.filter(
            (asset) =>
              asset.tenantId === scope.tenantId &&
              asset.workspaceId === scope.workspaceId &&
              (filters.some((filter) =>
                String(filter.sql).includes('agencyClientId IS NULL'),
              )
                ? asset.agencyClientId === null
                : asset.agencyClientId === scope.agencyClientId) &&
              (filters.some((filter) =>
                String(filter.sql).includes('companyContextId IS NULL'),
              )
                ? asset.companyContextId === null
                : asset.companyContextId ===
                  filters.find((filter) => filter.companyContextId)
                    ?.companyContextId),
          );
          const filtered = inScope.filter((asset) =>
            filters.every((filter) => {
              if (filter.status) return asset.status === filter.status;
              if (filter.assetType) return asset.assetType === filter.assetType;
              if (filter.folderId) return asset.folderId === filter.folderId;
              if (filter.search)
                return asset.name
                  .toLowerCase()
                  .includes(
                    String(filter.search).replaceAll('%', '').toLowerCase(),
                  );
              return true;
            }),
          );
          return filtered.slice(0, take).map((asset) =>
            Object.assign(asset, {
              currentVersion: state.versions.find(
                (version) => version.id === asset.currentVersionId,
              ),
            }),
          );
        }),
      };
      return builder;
    }),
  };

  const versions: Row = {
    create: jest.fn((input: Row) => ({
      id: nextId(),
      createdAt: now(),
      ...input,
    })),
    save: jest.fn(async (input: CreativeAssetVersionEntity) => {
      state.versions.push(input);
      return input;
    }),
    find: jest.fn(async ({ where, order }: { where: Row; order?: Row }) => {
      const result = state.versions.filter((version) =>
        rowMatches(version as unknown as Row, where),
      );
      return order?.versionNumber === 'DESC'
        ? result.sort((left, right) => right.versionNumber - left.versionNumber)
        : result.sort(
            (left, right) => left.versionNumber - right.versionNumber,
          );
    }),
    findOne: jest.fn(
      async ({ where }: { where: Row }) =>
        state.versions.find((version) =>
          rowMatches(version as unknown as Row, where),
        ) ?? null,
    ),
    createQueryBuilder: jest.fn(() => {
      let assetId: string | undefined;
      const builder: Row = {
        select: jest.fn(() => builder),
        where: jest.fn((_sql: string, params: { id: string }) => {
          assetId = params.id;
          return builder;
        }),
        getRawOne: jest.fn(async () => ({
          max:
            state.versions
              .filter((version) => version.creativeAssetId === assetId)
              .reduce<number | null>(
                (max, version) => Math.max(max ?? 0, version.versionNumber),
                null,
              )
              ?.toString() ?? null,
        })),
      };
      return builder;
    }),
  };

  const folders: Row = {
    create: jest.fn((input: Row) => ({
      id: nextId(),
      createdAt: now(),
      updatedAt: now(),
      ...input,
    })),
    save: jest.fn(async (input: CreativeFolderEntity) => {
      const existing = state.folders.findIndex(
        (folder) => folder.id === input.id,
      );
      if (existing < 0) state.folders.push(input);
      else state.folders[existing] = input;
      return input;
    }),
    find: jest.fn(async ({ where }: { where: Row }) =>
      state.folders
        .filter((folder) => rowMatches(folder as unknown as Row, where))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ),
    findOne: jest.fn(
      async ({ where }: { where: Row }) =>
        state.folders.find((folder) =>
          rowMatches(folder as unknown as Row, where),
        ) ?? null,
    ),
    exists: jest.fn(async ({ where }: { where: Row }) =>
      state.folders.some((folder) =>
        rowMatches(folder as unknown as Row, where),
      ),
    ),
    count: jest.fn(
      async ({ where }: { where: Row }) =>
        state.folders.filter((folder) =>
          rowMatches(folder as unknown as Row, where),
        ).length,
    ),
    remove: jest.fn(async (folder: CreativeFolderEntity) => {
      state.folders = state.folders.filter((item) => item.id !== folder.id);
    }),
  };

  const mediaUpload = {
    upload: jest.fn(
      async (
        _scope: CreativeStudioScope,
        _actor: string | null,
        input: { file: { originalname: string } },
      ) => ({
        id: `media-${nextId()}`,
        originalFilename: input.file.originalname,
      }),
    ),
    removeAfterFailedConsumerOperation: jest.fn(async () => undefined),
  };
  const mediaResolver = {
    resolve: jest.fn(async (input: { mediaAssetId: string }) => ({
      id: input.mediaAssetId,
      storagePath: `${input.mediaAssetId}.bin`,
      mimeType: 'image/png',
      byteSize: '10',
      width: 1,
      height: 1,
      durationMs: null,
      codec: null,
    })),
  };
  const thumbnails = {
    create: jest.fn(async () => ({ id: `thumbnail-${nextId()}` })),
  };
  const mediaQuery: Row = {};
  mediaQuery.select = jest.fn(() => mediaQuery);
  mediaQuery.where = jest.fn(() => mediaQuery);
  mediaQuery.andWhere = jest.fn(() => mediaQuery);
  mediaQuery.getRawOne = jest.fn(async () => ({ usedBytes: '4294967296' }));
  const mediaAssets = {
    createQueryBuilder: jest.fn(() => mediaQuery),
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) =>
      entity === MediaAssetEntity ? mediaAssets : undefined,
    ),
    transaction: jest.fn(
      async (
        callback: (manager: {
          getRepository: (entity: unknown) => Row;
        }) => unknown,
      ) => {
        const assetSnapshot = [...state.assets];
        const versionSnapshot = [...state.versions];
        try {
          return await callback({
            getRepository: (entity) =>
              entity === CreativeAssetEntity ? assets : versions,
          });
        } catch (error) {
          state.assets = assetSnapshot;
          state.versions = versionSnapshot;
          throw error;
        }
      },
    ),
  };
  const contentItems = { findOne: jest.fn().mockResolvedValue(null) };
  const plans = { findOne: jest.fn().mockResolvedValue(null) };
  const plannerStatus = {
    reflectCreativeStatus: jest.fn().mockResolvedValue(true),
    reflectCreativeRevisionStarted: jest.fn().mockResolvedValue(true),
  };

  return {
    state,
    assets,
    versions,
    folders,
    mediaUpload,
    mediaResolver,
    thumbnails,
    dataSource,
    mediaAssets,
    contentItems,
    plans,
    plannerStatus,
    assetService: new CreativeAssetService(
      assets as unknown as Repository<CreativeAssetEntity>,
      versions as unknown as Repository<CreativeAssetVersionEntity>,
      folders as unknown as Repository<CreativeFolderEntity>,
      contentItems as never,
      plans as never,
      dataSource as never,
      mediaUpload as never,
      mediaResolver as never,
      thumbnails as unknown as CreativeThumbnailService,
      plannerStatus as never,
    ),
    folderService: new CreativeFolderService(
      folders as unknown as Repository<CreativeFolderEntity>,
      assets as unknown as Repository<CreativeAssetEntity>,
    ),
  };
}

function file(
  buffer: Buffer,
  originalname = 'criativo.png',
  mimetype = 'image/png',
  size = buffer.length,
) {
  return { buffer, originalname, mimetype, size };
}

describe('Creative Studio asset service', () => {
  it('uses the agency data source for transactional asset writes', () => {
    expect(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, CreativeAssetService),
    ).toEqual(
      expect.arrayContaining([
        { index: 5, param: getDataSourceToken('agency') },
      ]),
    );
  });

  it('reports scoped storage usage against the temporary 5 GB quota', async () => {
    const h = makeHarness();
    await expect(h.assetService.storage(clientA)).resolves.toEqual({
      usedBytes: 4 * 1024 * 1024 * 1024,
      quotaBytes: 5 * 1024 * 1024 * 1024,
      trashCount: 0,
    });
    expect(h.dataSource.getRepository).toHaveBeenCalledWith(MediaAssetEntity);
  });

  it('sends a file to the Lixeira, where it can no longer be changed', async () => {
    const h = makeHarness();
    const asset = makeAsset(clientA, { id: id(44), folderId: id(41) });
    h.state.assets.push(asset);

    await h.assetService.remove(clientA, asset.id);

    expect(asset.trashedAt).toBeInstanceOf(Date);
    expect(asset.deletedAt).toBeNull();
    expect(asset.folderId).toBeNull();
    await expect(
      h.assetService.update(clientA, asset.id, { name: 'Novo' }),
    ).rejects.toThrow('Criativo não encontrado.');
    await expect(h.assetService.storage(clientA)).resolves.toMatchObject({
      trashCount: 1,
    });
  });

  it('empties only the Lixeira of the active scope', async () => {
    const h = makeHarness();
    const trashed = makeAsset(clientA, { id: id(45), trashedAt: new Date() });
    const active = makeAsset(clientA, { id: id(46) });
    const other = makeAsset(clientB, { id: id(47), trashedAt: new Date() });
    h.state.assets.push(trashed, active, other);

    await expect(h.assetService.emptyTrash(clientA)).resolves.toEqual({
      deleted: 1,
    });
    expect(trashed.deletedAt).toBeInstanceOf(Date);
    expect(active.deletedAt).toBeNull();
    expect(other.deletedAt).toBeNull();
  });

  it('deletes permanently, keeping the row for existing references', async () => {
    const h = makeHarness();
    const asset = makeAsset(clientA, { id: id(40), folderId: id(41) });
    h.state.assets.push(asset);

    await h.assetService.remove(clientA, asset.id, true);

    expect(h.state.assets).toHaveLength(1);
    expect(asset.folderId).toBeNull();
    expect(asset.status).toBe('archived');
    await expect(h.assetService.detail(clientA, asset.id)).rejects.toThrow(
      'Criativo não encontrado.',
    );
  });

  it('refuses to delete an asset linked to the Planner', async () => {
    const h = makeHarness();
    const asset = makeAsset(clientA, { id: id(42), contentItemId: id(43) });
    h.state.assets.push(asset);

    await expect(h.assetService.remove(clientA, asset.id)).rejects.toThrow(
      'vinculado a um conteúdo do Planner',
    );
    expect(asset.deletedAt).toBeNull();
  });

  it('copies an asset without duplicating its private media and clears Planner linkage', async () => {
    const h = makeHarness();
    const source = makeAsset(clientA, {
      id: id(30),
      name: 'Campanha',
      contentItemId: id(31),
      currentVersionId: id(32),
    });
    const sourceVersion = makeVersion(source.id, 1, {
      id: id(32),
      mediaAssetId: 'shared-media',
      thumbnailMediaAssetId: 'shared-thumbnail',
    });
    h.state.assets.push(source);
    h.state.versions.push(sourceVersion);

    const copied = await h.assetService.copy(clientA, 'user-b', source.id);

    expect(copied.id).not.toBe(source.id);
    expect(copied.name).toBe('Campanha - cópia');
    expect(copied.contentItemId).toBeNull();
    const copiedVersion = h.state.versions.find(
      (version) => version.creativeAssetId === copied.id,
    );
    expect(copiedVersion?.mediaAssetId).toBe('shared-media');
    expect(copiedVersion?.thumbnailMediaAssetId).toBe('shared-thumbnail');
  });

  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
  ])(
    'creates an atomic initial asset/version for %s',
    async (_name, buffer, mime) => {
      const h = makeHarness();
      const uploaded = await h.assetService.upload(clientA, 'user-a', {
        file: file(
          buffer,
          `asset.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`,
          mime,
        ),
      });
      const logical = h.state.assets[0];
      const version = h.state.versions[0];

      expect(uploaded.currentVersionId).toBe(version.id);
      expect(version.versionNumber).toBe(1);
      expect(version.mediaAssetId).toContain('media-');
      expect(version.thumbnailMediaAssetId).toContain('thumbnail-');
      expect(logical.metadata).toEqual({});
      expect(h.mediaUpload.upload).toHaveBeenCalledWith(
        clientA,
        'user-a',
        expect.objectContaining({ source: 'creative_studio' }),
      );
      expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('uses file magic for image/video type and rejects unrecognized bytes before storage', async () => {
    const h = makeHarness();
    const video = await h.assetService.upload(clientA, 'user-a', {
      file: file(MP4, 'photo.png', 'image/png'),
    });
    expect(video.assetType).toBe('video');
    expect(h.thumbnails.create).not.toHaveBeenCalled();
    const quicktime = await h.assetService.upload(clientA, 'user-a', {
      file: file(QUICKTIME, 'clip.mov', 'video/quicktime'),
    });
    expect(quicktime.assetType).toBe('video');
    const videoVersion = await h.assetService.createVersion(
      clientA,
      'user-a',
      video.id,
      file(MP4, 'replacement.mp4', 'video/mp4'),
    );
    expect(videoVersion.thumbnailPath).toBeNull();
    expect(
      h.state.versions.find((v) => v.id === videoVersion.id)
        ?.thumbnailMediaAssetId,
    ).toBeNull();
    expect(h.thumbnails.create).not.toHaveBeenCalled();
    await h.assetService.list(clientA, { assetType: 'video' });
    expect(h.mediaResolver.resolve).not.toHaveBeenCalled();
    await expect(
      h.assetService.upload(clientA, 'user-a', {
        file: file(Buffer.from('not media'), 'valid.png', 'image/png'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.mediaUpload.upload).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['image', file(PNG, 'large.png', 'image/png', 20 * 1024 * 1024 + 1)],
    ['video', file(MP4, 'large.mp4', 'video/mp4', 300 * 1024 * 1024 + 1)],
  ])(
    'rejects an oversized %s at the Creative Studio boundary',
    async (_type, uploadFile) => {
      const h = makeHarness();
      await expect(
        h.assetService.upload(clientA, 'user-a', { file: uploadFile }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.mediaUpload.upload).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing file as a client error', async () => {
    const h = makeHarness();
    await expect(
      h.assetService.upload(clientA, 'user-a', { file: undefined as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rolls back logical rows and compensates both binaries when initial creation fails', async () => {
    const h = makeHarness();
    h.assets.save
      .mockImplementationOnce(async (input: CreativeAssetEntity) => {
        h.state.assets.push(input);
        return input;
      })
      .mockRejectedValueOnce(new Error('save current version failed'));

    await expect(
      h.assetService.upload(clientA, 'user-a', { file: file(PNG) }),
    ).rejects.toThrow('save current version failed');
    expect(h.state.assets).toHaveLength(0);
    expect(h.state.versions).toHaveLength(0);
    expect(
      h.mediaUpload.removeAfterFailedConsumerOperation,
    ).toHaveBeenCalledTimes(2);
  });

  it('cleans the original and derivative when the logical asset insert fails', async () => {
    const h = makeHarness();
    h.assets.save.mockRejectedValueOnce(new Error('asset insert failed'));

    await expect(
      h.assetService.upload(clientA, 'user-a', { file: file(PNG) }),
    ).rejects.toThrow('asset insert failed');
    expect(h.state.assets).toHaveLength(0);
    expect(h.state.versions).toHaveLength(0);
    expect(
      h.mediaUpload.removeAfterFailedConsumerOperation,
    ).toHaveBeenCalledTimes(2);
  });

  it('treats thumbnail generation failure as a full rollback', async () => {
    const h = makeHarness();
    h.thumbnails.create.mockRejectedValueOnce(new Error('thumbnail failed'));
    await expect(
      h.assetService.upload(clientA, 'user-a', { file: file(PNG) }),
    ).rejects.toThrow('thumbnail failed');
    expect(h.state.assets).toHaveLength(0);
    expect(h.state.versions).toHaveLength(0);
    expect(
      h.mediaUpload.removeAfterFailedConsumerOperation,
    ).toHaveBeenCalledTimes(1);
  });

  it('increments versions monotonically, preserves history and resolves each version binary/thumbnail', async () => {
    const h = makeHarness();
    const initial = await h.assetService.upload(clientA, 'user-a', {
      file: file(PNG),
    });
    const v1 = h.state.versions[0];
    await h.assetService.createVersion(
      clientA,
      'user-a',
      initial.id,
      file(PNG, 'replacement.png'),
    );
    await h.assetService.createVersion(
      clientA,
      'user-a',
      initial.id,
      file(PNG, 'replacement-again.png'),
    );
    const detail = await h.assetService.detail(clientA, initial.id);

    expect(h.state.versions.map((version) => version.versionNumber)).toEqual([
      1, 2, 3,
    ]);
    expect(
      h.state.versions.map((version) => version.mediaAssetId),
    ).toHaveLength(3);
    expect(
      new Set(h.state.versions.map((version) => version.mediaAssetId)).size,
    ).toBe(3);
    expect(h.state.assets[0].currentVersionId).toBe(h.state.versions[2].id);
    expect(detail.versions.map((version) => version.versionNumber)).toEqual([
      3, 2, 1,
    ]);
    expect(detail.versions[2].contentPath).toContain(`versionId=${v1.id}`);
    expect(detail.versions[2].thumbnailPath).toContain(`versionId=${v1.id}`);
    await h.assetService.content(clientA, initial.id, false);
    expect(h.mediaResolver.resolve).toHaveBeenLastCalledWith({
      ...clientA,
      mediaAssetId: h.state.versions[2].mediaAssetId,
    });
    await h.assetService.content(clientA, initial.id, true, v1.id);
    expect(h.mediaResolver.resolve).toHaveBeenLastCalledWith({
      ...clientA,
      mediaAssetId: v1.thumbnailMediaAssetId,
    });
    await h.assetService.content(clientA, initial.id, true);
    expect(h.mediaResolver.resolve).toHaveBeenLastCalledWith({
      ...clientA,
      mediaAssetId: h.state.versions[2].thumbnailMediaAssetId,
    });
    await h.assetService.content(clientA, initial.id, false, v1.id);
    expect(h.mediaResolver.resolve).toHaveBeenLastCalledWith({
      ...clientA,
      mediaAssetId: v1.mediaAssetId,
    });
  });

  it('cleans a newly uploaded version on transactional failure and leaves the previous current version intact', async () => {
    const h = makeHarness();
    const initial = await h.assetService.upload(clientA, 'user-a', {
      file: file(PNG),
    });
    const currentVersionId = h.state.assets[0].currentVersionId;
    h.versions.save.mockRejectedValueOnce(new Error('version insert failed'));
    await expect(
      h.assetService.createVersion(clientA, 'user-a', initial.id, file(PNG)),
    ).rejects.toThrow('version insert failed');
    expect(h.state.versions).toHaveLength(1);
    expect(h.state.assets[0].currentVersionId).toBe(currentVersionId);
    expect(
      h.mediaUpload.removeAfterFailedConsumerOperation,
    ).toHaveBeenCalledTimes(2);
  });

  it('uses IsNull for agency scope and returns only the requested managed client and tenant', async () => {
    const h = makeHarness();
    h.state.assets.push(
      makeAsset(agency, { id: id(4), name: 'Agency asset' }),
      makeAsset(clientA, { id: id(5), name: 'Client A asset' }),
    );
    const agencyList = await h.assetService.list(agency, {});
    const clientList = await h.assetService.list(clientA, {});
    const clientBList = await h.assetService.list(clientB, {});
    expect(agencyList.items.map((item) => item.name)).toEqual(['Agency asset']);
    expect(clientList.items.map((item) => item.name)).toEqual([
      'Client A asset',
    ]);
    expect(clientBList.items).toEqual([]);

    await h.assetService.detail(agency, id(4));
    const where = h.assets.findOne.mock.calls.at(-1)?.[0].where as Row;
    expect(where.agencyClientId).toBeInstanceOf(FindOperator);
    expect((where.agencyClientId as FindOperator<unknown>).type).toBe('isNull');
    expect(IsNull()).toBeInstanceOf(FindOperator);
    await expect(
      h.assetService.detail(anotherTenant, id(5)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks client B and another tenant from every scoped asset operation', async () => {
    const h = makeHarness();
    const asset = makeAsset(clientA, { id: id(6), currentVersionId: id(16) });
    h.state.assets.push(asset);
    h.state.versions.push(makeVersion(asset.id, 1, { id: id(16) }));
    const attempts = [
      () => h.assetService.detail(clientB, asset.id),
      () => h.assetService.update(clientB, asset.id, { name: 'stolen' }),
      () =>
        h.assetService.createVersion(clientB, 'user-b', asset.id, file(PNG)),
      () => h.assetService.archive(clientB, asset.id),
      () => h.assetService.content(clientB, asset.id),
      () => h.assetService.content(clientB, asset.id, true),
      () => h.assetService.versionsFor(clientB, asset.id),
      () => h.assetService.detail(anotherTenant, asset.id),
      () => h.assetService.archive(anotherTenant, asset.id),
      () => h.assetService.content(anotherWorkspace, asset.id, true),
    ];
    for (const attempt of attempts)
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundException);
    expect(h.state.assets[0].name).toBe('Asset A');
    expect(h.state.assets[0].status).toBe('ready');
    expect(h.state.versions).toHaveLength(1);
    expect(h.mediaResolver.resolve).not.toHaveBeenCalled();
    expect(h.mediaUpload.upload).not.toHaveBeenCalled();
  });

  it('rejects an editorial content link whose parent plan belongs to another company', async () => {
    const h = makeHarness();
    const contentItemId = id(70);
    const planId = id(71);
    h.contentItems.findOne.mockResolvedValue({
      id: contentItemId,
      planId,
      title: 'Post',
      plannedDate: null,
    });
    h.plans.findOne.mockResolvedValue(null);

    await expect(
      h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.plans.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: planId,
          agencyClientId: clientA.agencyClientId,
          companyContextId: clientA.companyContextId,
        }),
      }),
    );
    expect(h.mediaUpload.upload).not.toHaveBeenCalled();
  });

  it('never links a soft-deleted content item or one under a deleted plan', async () => {
    const h = makeHarness();
    const contentItemId = id(72);
    h.contentItems.findOne.mockResolvedValue({
      id: contentItemId,
      planId: id(73),
      title: 'Post',
      plannedDate: null,
    });
    h.plans.findOne.mockResolvedValue({ id: id(99), title: 'Plano' });

    await h.assetService.upload(clientA, 'user-a', {
      file: file(PNG),
      contentItemId,
    });

    expect(h.contentItems.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: contentItemId,
          deletedAt: IsNull(),
        }),
      }),
    );
    expect(h.plans.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: id(73), deletedAt: IsNull() }),
      }),
    );
  });

  describe('Restaurar', () => {
    it('returns a file to the folder it left, active again', async () => {
      const h = makeHarness();
      const folder = await h.folderService.create(clientA, 'user-a', {
        name: 'Pasta',
      });
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        folderId: folder.id,
      });
      await h.assetService.remove(clientA, asset.id);
      await expect(
        h.assetService.restore(clientA, asset.id),
      ).resolves.toMatchObject({ status: 'ready', folderId: folder.id });
      expect(h.state.assets.find((row) => row.id === asset.id)).toMatchObject({
        trashedAt: null,
        purgeAfter: null,
        archivedAt: null,
        restoredAt: expect.any(Date),
      });
    });

    it('keeps a file archived if it was archived before the Lixeira', async () => {
      const h = makeHarness();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
      });
      const row = h.state.assets.find((item) => item.id === asset.id)!;
      row.status = 'archived';
      row.archivedAt = new Date('2026-01-01T00:00:00.000Z');
      await h.assetService.remove(clientA, asset.id);
      await expect(
        h.assetService.restore(clientA, asset.id),
      ).resolves.toMatchObject({ status: 'archived' });
    });

    it('falls back to the root when the folder no longer exists', async () => {
      const h = makeHarness();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
      });
      const row = h.state.assets.find((item) => item.id === asset.id)!;
      await h.assetService.remove(clientA, asset.id);
      row.restoreFolderId = id(500);
      await expect(
        h.assetService.restore(clientA, asset.id),
      ).resolves.toMatchObject({ folderId: null });
    });

    it('refuses a file that is not in the Lixeira', async () => {
      const h = makeHarness();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
      });
      await expect(
        h.assetService.restore(clientA, asset.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never reaches a file of another company', async () => {
      const h = makeHarness();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
      });
      await h.assetService.remove(clientA, asset.id);
      await expect(
        h.assetService.restore(clientB, asset.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Planner uploads', () => {
    const contentItemId = id(95);
    const mediaAssetId = id(96);
    const adoptable = (mimeType = 'image/png') => {
      const h = makeHarness();
      h.contentItems.findOne.mockResolvedValue({
        id: contentItemId,
        planId: id(97),
        title: 'Post',
        plannedDate: null,
      });
      h.plans.findOne.mockResolvedValue({ id: id(97), title: 'Plano' });
      const body = Readable.from([Buffer.from(PNG)]);
      (h.mediaUpload as Row).getContent = jest.fn(async () => ({
        asset: { id: mediaAssetId, mimeType, originalFilename: 'post.png' },
        file: { body },
      }));
      return { h, body };
    };

    it('lists the upload in the folder of its item, sharing the binary', async () => {
      const { h } = adoptable();
      const asset = await h.assetService.adoptPlannerUpload(clientA, 'user-a', {
        mediaAssetId,
        contentItemId,
      });
      expect(asset).toMatchObject({
        name: 'post.png',
        sourceType: 'planner_upload',
        contentItemId,
        folderId: h.state.folders.find(
          (folder) => folder.contentItemId === contentItemId,
        )?.id,
      });
      expect(h.state.versions[0]).toMatchObject({
        mediaAssetId,
        thumbnailMediaAssetId: expect.stringContaining('thumbnail-'),
      });
      expect(h.mediaUpload.upload).not.toHaveBeenCalled();
      expect(h.plannerStatus.reflectCreativeStatus).not.toHaveBeenCalled();
    });

    it('still lists the file when its thumbnail fails', async () => {
      const { h } = adoptable();
      h.thumbnails.create.mockRejectedValue(new Error('bad image'));
      await h.assetService.adoptPlannerUpload(clientA, 'user-a', {
        mediaAssetId,
        contentItemId,
      });
      expect(h.state.versions[0].thumbnailMediaAssetId).toBeNull();
    });

    it('can be sent to the Lixeira and deleted from it while linked', async () => {
      const { h } = adoptable();
      const asset = await h.assetService.adoptPlannerUpload(clientA, 'user-a', {
        mediaAssetId,
        contentItemId,
      });
      await h.assetService.remove(clientA, asset!.id);
      await h.assetService.remove(clientA, asset!.id, true);
      expect(
        h.state.assets.find((row) => row.id === asset!.id)?.deletedAt,
      ).toEqual(expect.any(Date));
    });
  });

  describe('Planner folders', () => {
    const contentItemId = id(90);
    const linked = () => {
      const h = makeHarness();
      h.contentItems.findOne.mockResolvedValue({
        id: contentItemId,
        planId: id(91),
        title: 'Lançamento',
        plannedDate: '2026-11-15',
      });
      h.plans.findOne.mockResolvedValue({
        id: id(91),
        title: 'Novembro',
      });
      return h;
    };

    it('files a linked upload in the subfolder of its item, inside the folder of its plan', async () => {
      const h = linked();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      });
      const plan = h.state.folders.find(
        (folder) => folder.socialPlanId === id(91),
      );
      const item = h.state.folders.find(
        (folder) => folder.contentItemId === contentItemId,
      );
      expect(plan).toMatchObject({ name: 'Novembro', parentId: null });
      expect(item).toMatchObject({
        name: '2026-11-15 · Lançamento',
        parentId: plan?.id,
      });
      expect(asset.folderId).toBe(item?.id);
    });

    it('reuses the folders for the next file of the same item', async () => {
      const h = linked();
      const upload = () =>
        h.assetService.upload(clientA, 'user-a', {
          file: file(PNG),
          contentItemId,
        });
      await upload();
      const second = await upload();
      expect(h.state.folders).toHaveLength(2);
      expect(second.folderId).toBe(
        h.state.folders.find((folder) => folder.contentItemId === contentItemId)
          ?.id,
      );
    });

    it('keeps a folder chosen explicitly', async () => {
      const h = linked();
      const chosen = await h.folderService.create(clientA, 'user-a', {
        name: 'Escolhida',
      });
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
        folderId: chosen.id,
      });
      expect(asset.folderId).toBe(chosen.id);
      expect(h.state.folders).toHaveLength(1);
    });

    it('names the plan and the item in the detail of a linked file', async () => {
      const h = linked();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      });
      await expect(
        h.assetService.detail(clientA, asset.id),
      ).resolves.toMatchObject({
        planner: {
          planId: id(91),
          planTitle: 'Novembro',
          contentItemId,
          contentTitle: 'Lançamento',
          plannedDate: '2026-11-15',
        },
      });
    });

    it('reports no link once the content left the Planner', async () => {
      const h = linked();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      });
      h.contentItems.findOne.mockResolvedValue(null);
      await expect(
        h.assetService.detail(clientA, asset.id),
      ).resolves.toMatchObject({ planner: null, contentItemId });
    });
  });

  describe('CS2B.4 Planner production status reflection', () => {
    const contentItemId = id(80);
    const linkedHarness = () => {
      const h = makeHarness();
      h.contentItems.findOne.mockResolvedValue({
        id: contentItemId,
        planId: id(81),
        title: 'Post',
        plannedDate: null,
      });
      h.plans.findOne.mockResolvedValue({ id: id(99), title: 'Plano' });
      return h;
    };

    it('never reaches the Planner for an asset without contentItemId', async () => {
      const h = makeHarness();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
      });
      await h.assetService.createVersion(
        clientA,
        'user-a',
        asset.id,
        file(PNG),
      );

      expect(h.plannerStatus.reflectCreativeStatus).not.toHaveBeenCalled();
    });

    it('reports creative_in_progress for the first version, inside the upload transaction', async () => {
      const h = linkedHarness();
      await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      });

      expect(h.plannerStatus.reflectCreativeStatus).toHaveBeenCalledTimes(1);
      expect(h.plannerStatus.reflectCreativeStatus).toHaveBeenCalledWith(
        clientA,
        {
          contentItemId,
          status: 'creative_in_progress',
          actorUserId: 'user-a',
        },
        expect.objectContaining({ getRepository: expect.any(Function) }),
      );
    });

    it('reports every later version with the same Planner scope and leaves the decision to the Planner', async () => {
      const h = linkedHarness();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      });
      for (let i = 0; i < 2; i++)
        await h.assetService.createVersion(
          clientA,
          'user-b',
          asset.id,
          file(PNG),
        );

      const calls = h.plannerStatus.reflectCreativeStatus.mock.calls;
      expect(calls).toHaveLength(3);
      for (const [scope, input] of calls) {
        expect(scope).toEqual(clientA);
        expect(input).toMatchObject({
          contentItemId,
          status: 'creative_in_progress',
        });
      }
      expect(calls.at(-1)?.[1].actorUserId).toBe('user-b');
      expect(h.state.versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
    });

    it('rolls the version back with the Planner when the reflection fails', async () => {
      const h = linkedHarness();
      const asset = await h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      });
      h.plannerStatus.reflectCreativeStatus.mockRejectedValueOnce(
        new Error('planner write failed'),
      );

      await expect(
        h.assetService.createVersion(clientA, 'user-a', asset.id, file(PNG)),
      ).rejects.toThrow('planner write failed');
      expect(h.state.versions).toHaveLength(1);
      // Original + thumbnail of the failed version are compensated.
      expect(
        h.mediaUpload.removeAfterFailedConsumerOperation,
      ).toHaveBeenCalledTimes(2);
    });

    it('never reflects for a cross-company content link, which fails before any write', async () => {
      const h = makeHarness();
      h.contentItems.findOne.mockResolvedValue({
        id: contentItemId,
        planId: id(81),
        title: 'Post',
        plannedDate: null,
      });
      h.plans.findOne.mockResolvedValue(null);

      await expect(
        h.assetService.upload(clientB, 'user-b', {
          file: file(PNG),
          contentItemId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.plannerStatus.reflectCreativeStatus).not.toHaveBeenCalled();
    });
  });

  describe('CS2B.6 revision after changes_requested', () => {
    const contentItemId = id(80);
    const seeded = (overrides: Partial<CreativeAssetEntity> = {}) => {
      const h = makeHarness();
      const asset = makeAsset(clientA, {
        id: id(50),
        currentVersionId: id(51),
        ...overrides,
      });
      const v1 = makeVersion(asset.id, 1, { id: id(51) });
      h.state.assets.push(asset);
      h.state.versions.push(v1);
      return { h, asset, v1, v1Snapshot: { ...v1 } };
    };
    const revise = (
      h: ReturnType<typeof makeHarness>,
      assetId: string,
      revisesVersionId: string,
      scope = clientA,
    ) =>
      h.assetService.createVersion(scope, 'user-b', assetId, file(PNG), {
        revisesVersionId,
      });

    it('creates the next immutable version of the same asset and leaves v1 intact', async () => {
      const { h, asset, v1, v1Snapshot } = seeded();

      const v2 = await revise(h, asset.id, v1.id);

      expect(v2.id).not.toBe(v1.id);
      expect(v2).toMatchObject({ versionNumber: 2, source: 'replace' });
      // The response is the canonical version view: no media/storage ids.
      expect(v2).not.toHaveProperty('mediaAssetId');
      expect(v2).not.toHaveProperty('thumbnailMediaAssetId');
      expect(h.state.versions.find((v) => v.id === v2.id)).toMatchObject({
        creativeAssetId: asset.id,
        versionNumber: 2,
        source: 'replace',
        createdById: 'user-b',
      });
      expect(h.state.versions.find((v) => v.id === v1.id)).toEqual(v1Snapshot);
      expect(asset.currentVersionId).toBe(v2.id);
      expect(h.state.assets).toHaveLength(1);
      expect(
        (await h.assetService.versionsFor(clientA, asset.id)).map(
          (v) => v.versionNumber,
        ),
      ).toEqual([2, 1]);
    });

    it('follows the existing sequence when the revised version is not v1', async () => {
      const { h, asset } = seeded({ currentVersionId: id(53) });
      h.state.versions.push(
        makeVersion(asset.id, 2, { id: id(52) }),
        makeVersion(asset.id, 3, { id: id(53) }),
      );
      await expect(revise(h, asset.id, id(53))).resolves.toMatchObject({
        versionNumber: 4,
      });
    });

    it('reports the revision start to the Planner inside the version transaction, never the generic status', async () => {
      const { h, asset, v1 } = seeded({ contentItemId });

      await revise(h, asset.id, v1.id);

      expect(
        h.plannerStatus.reflectCreativeRevisionStarted,
      ).toHaveBeenCalledWith(
        clientA,
        { contentItemId, actorUserId: 'user-b' },
        expect.objectContaining({ getRepository: expect.any(Function) }),
      );
      expect(h.plannerStatus.reflectCreativeStatus).not.toHaveBeenCalled();
    });

    it('a plain new version still uses only the non-regressing generic status', async () => {
      const { h, asset } = seeded({ contentItemId });
      await h.assetService.createVersion(
        clientA,
        'user-b',
        asset.id,
        file(PNG),
      );
      expect(h.plannerStatus.reflectCreativeStatus).toHaveBeenCalledTimes(1);
      expect(
        h.plannerStatus.reflectCreativeRevisionStarted,
      ).not.toHaveBeenCalled();
    });

    it('works without a Planner link', async () => {
      const { h, asset, v1 } = seeded();
      await expect(revise(h, asset.id, v1.id)).resolves.toMatchObject({
        versionNumber: 2,
      });
      expect(
        h.plannerStatus.reflectCreativeRevisionStarted,
      ).not.toHaveBeenCalled();
    });

    it('rolls the version back with the Planner when the revision reflection fails', async () => {
      const { h, asset, v1 } = seeded({ contentItemId });
      h.plannerStatus.reflectCreativeRevisionStarted.mockRejectedValueOnce(
        new Error('planner write failed'),
      );
      await expect(revise(h, asset.id, v1.id)).rejects.toThrow(
        'planner write failed',
      );
      // The pointer rollback itself is proven against PostgreSQL in
      // creative-revision-loop.postgres.spec.ts (this mock does not undo it).
      expect(h.state.versions).toHaveLength(1);
      expect(
        h.mediaUpload.removeAfterFailedConsumerOperation,
      ).toHaveBeenCalledTimes(2);
    });

    it('refuses an archived asset before any storage write', async () => {
      const { h, asset, v1 } = seeded({
        status: 'archived',
        archivedAt: new Date(),
      });
      await expect(revise(h, asset.id, v1.id)).rejects.toThrow(
        'Criativo arquivado',
      );
      expect(h.mediaUpload.upload).not.toHaveBeenCalled();
      expect(h.state.versions).toHaveLength(1);
    });

    it('only revises the current version: a second revision of v1 (double click) is a conflict', async () => {
      const { h, asset, v1 } = seeded();
      await revise(h, asset.id, v1.id);
      h.mediaUpload.upload.mockClear();

      await expect(revise(h, asset.id, v1.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(h.mediaUpload.upload).not.toHaveBeenCalled();
      expect(h.state.versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    });

    it('compare-and-sets the current version: a revision that loses the race rolls back and compensates its binaries', async () => {
      const { h, asset, v1 } = seeded();
      // Another operator's revision commits while this upload is in flight.
      h.mediaUpload.upload.mockImplementationOnce(async () => {
        asset.currentVersionId = id(99);
        return { id: 'media-race', originalFilename: 'r.png' };
      });

      await expect(revise(h, asset.id, v1.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(h.state.versions).toHaveLength(1);
      expect(asset.currentVersionId).toBe(id(99));
      expect(
        h.mediaUpload.removeAfterFailedConsumerOperation,
      ).toHaveBeenCalledWith(clientA, 'media-race');
    });

    it.each([
      ['revision', true],
      ['plain version', false],
    ])(
      'maps a version-number unique violation to 409 for a %s',
      async (_label, isRevision) => {
        const { h, asset, v1 } = seeded();
        h.versions.save.mockRejectedValueOnce(
          Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'UQ_social_creative_asset_versions_number',
          }),
        );
        const attempt = isRevision
          ? revise(h, asset.id, v1.id)
          : h.assetService.createVersion(
              clientA,
              'user-b',
              asset.id,
              file(PNG),
            );
        await expect(attempt).rejects.toBeInstanceOf(ConflictException);
        expect(
          h.mediaUpload.removeAfterFailedConsumerOperation,
        ).toHaveBeenCalledTimes(2);
      },
    );

    it('keeps other failures untouched', async () => {
      const { h, asset } = seeded();
      h.versions.save.mockRejectedValueOnce(
        Object.assign(new Error('other unique'), { code: '23505' }),
      );
      await expect(
        h.assetService.createVersion(clientA, 'user-b', asset.id, file(PNG)),
      ).rejects.toThrow('other unique');
    });

    it('never revises another company asset', async () => {
      const { h, asset, v1 } = seeded();
      await expect(revise(h, asset.id, v1.id, clientB)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.mediaUpload.upload).not.toHaveBeenCalled();
    });
  });

  it('archives without deleting and allows the archived filter to retrieve history', async () => {
    const h = makeHarness();
    const asset = makeAsset(clientA, { id: id(7) });
    h.state.assets.push(asset);
    const archived = await h.assetService.archive(clientA, asset.id);
    expect(archived.status).toBe('archived');
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(h.state.assets).toHaveLength(1);
    expect(
      (await h.assetService.list(clientA, { status: 'archived' })).items,
    ).toHaveLength(1);
    expect(
      (await h.assetService.list(clientA, { status: 'ready' })).items,
    ).toHaveLength(0);
    expect((await h.assetService.list(clientA, {})).items).toHaveLength(0);
  });

  it('preserves archived history and current update/version behavior', async () => {
    const h = makeHarness();
    const asset = makeAsset(clientA, {
      id: id(22),
      currentVersionId: id(32),
    });
    h.state.assets.push(asset);
    h.state.versions.push(makeVersion(asset.id, 1, { id: id(32) }));

    await h.assetService.archive(clientA, asset.id);
    await h.assetService.update(clientA, asset.id, { name: 'Archived rename' });
    const newVersion = await h.assetService.createVersion(
      clientA,
      'user-a',
      asset.id,
      file(PNG),
    );

    expect(asset.status).toBe('archived');
    expect(asset.name).toBe('Archived rename');
    expect(asset.currentVersionId).toBe(newVersion.id);
    expect(
      (await h.assetService.versionsFor(clientA, asset.id)).map(
        (version) => version.versionNumber,
      ),
    ).toEqual([2, 1]);
    expect(
      (await h.assetService.list(clientA, { status: 'archived' })).items,
    ).toHaveLength(1);
    expect((await h.assetService.list(clientA, {})).items).toHaveLength(0);
  });

  it('does not let a caller resolve another asset version by guessing its id', async () => {
    const h = makeHarness();
    const first = makeAsset(clientA, { id: id(8), currentVersionId: id(18) });
    const second = makeAsset(clientA, { id: id(9), currentVersionId: id(19) });
    h.state.assets.push(first, second);
    h.state.versions.push(
      makeVersion(first.id, 1, { id: id(18) }),
      makeVersion(second.id, 1, { id: id(19) }),
    );
    await expect(
      h.assetService.content(clientA, first.id, false, id(19)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.mediaResolver.resolve).not.toHaveBeenCalled();
  });
});

describe('Creative Studio folder service', () => {
  it('creates, renames and lists folders within the active scope', async () => {
    const h = makeHarness();
    const parent = await h.folderService.create(clientA, 'user-a', {
      name: ' Raiz ',
    });
    const child = await h.folderService.create(clientA, 'user-a', {
      name: ' Subpasta ',
      parentId: parent.id,
    });
    await h.folderService.update(clientA, child.id, 'Atualizada');
    expect(child.parentId).toBe(parent.id);
    expect(
      (await h.folderService.list(clientA)).map((folder) => folder.name),
    ).toEqual(['Atualizada', 'Raiz']);
    expect(await h.folderService.list(clientB)).toEqual([]);
    await h.folderService.list(agency);
    const where = h.folders.find.mock.calls.at(-1)?.[0].where as Row;
    expect(where.agencyClientId).toBeInstanceOf(FindOperator);
    expect((where.agencyClientId as FindOperator<unknown>).type).toBe('isNull');
  });

  it('moves an asset only into a folder in its active scope', async () => {
    const h = makeHarness();
    const folderA = await h.folderService.create(clientA, 'user-a', {
      name: 'A',
    });
    const folderB = await h.folderService.create(clientB, 'user-b', {
      name: 'B',
    });
    const asset = makeAsset(clientA, { id: id(21) });
    h.state.assets.push(asset);

    await h.assetService.update(clientA, asset.id, { folderId: folderA.id });
    expect(asset.folderId).toBe(folderA.id);
    await expect(
      h.assetService.update(clientA, asset.id, { folderId: folderB.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.assetService.update(clientB, asset.id, { folderId: folderA.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prevents cross-client folder access and refuses deletion while assets or children exist', async () => {
    const h = makeHarness();
    const folder = await h.folderService.create(clientA, 'user-a', {
      name: 'With content',
    });
    const child = await h.folderService.create(clientA, 'user-a', {
      name: 'Child',
      parentId: folder.id,
    });
    const asset = makeAsset(clientA, { id: id(20), folderId: folder.id });
    h.state.assets.push(asset);
    await expect(
      h.folderService.find(clientB, folder.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.folderService.create(clientB, 'user-b', {
        name: 'Invalid child',
        parentId: folder.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.folderService.remove(clientA, folder.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.folderService.remove(clientA, child.id),
    ).resolves.toBeUndefined();
    expect(h.state.assets).toContain(asset);
    expect(h.state.folders).toContain(folder);
    await expect(
      h.folderService.remove(anotherTenant, folder.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only removes an empty folder and never removes assets implicitly', async () => {
    const h = makeHarness();
    const folder = await h.folderService.create(clientA, 'user-a', {
      name: 'Empty',
    });
    await expect(
      h.folderService.remove(clientA, folder.id),
    ).resolves.toBeUndefined();
    expect(h.folders.remove).toHaveBeenCalledTimes(1);
    expect(h.assets.remove).not.toHaveBeenCalled();
  });
});
