import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { getDataSourceToken } from '@nestjs/typeorm';
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
      ...input,
    })),
    save: jest.fn(async (input: CreativeAssetEntity) => {
      const existing = state.assets.findIndex((asset) => asset.id === input.id);
      input.updatedAt = now();
      if (existing < 0) state.assets.push(input);
      else state.assets[existing] = input;
      return input;
    }),
    findOne: jest.fn(
      async ({ where }: { where: Row }) =>
        state.assets.find((asset) =>
          rowMatches(asset as unknown as Row, where),
        ) ?? null,
    ),
    exists: jest.fn(async ({ where }: { where: Row }) =>
      state.assets.some((asset) => rowMatches(asset as unknown as Row, where)),
    ),
    update: jest.fn(
      async (
        { id: assetId }: { id: string },
        patch: Partial<CreativeAssetEntity>,
      ) => {
        const asset = state.assets.find((item) => item.id === assetId);
        if (asset) Object.assign(asset, patch, { updatedAt: now() });
      },
    ),
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
  const dataSource = {
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
  const plans = { exists: jest.fn().mockResolvedValue(false) };

  return {
    state,
    assets,
    versions,
    folders,
    mediaUpload,
    mediaResolver,
    thumbnails,
    dataSource,
    contentItems,
    plans,
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
    expect(videoVersion.thumbnailMediaAssetId).toBeNull();
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
    h.contentItems.findOne.mockResolvedValue({ id: contentItemId, planId });
    h.plans.exists.mockResolvedValue(false);

    await expect(
      h.assetService.upload(clientA, 'user-a', {
        file: file(PNG),
        contentItemId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.plans.exists).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: planId,
        agencyClientId: clientA.agencyClientId,
        companyContextId: clientA.companyContextId,
      }),
    });
    expect(h.mediaUpload.upload).not.toHaveBeenCalled();
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
