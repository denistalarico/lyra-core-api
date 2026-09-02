// Lyra Social S1.4.9 — domain + storage behaviour (§34-A/C, §27).
//
// Storage is an in-memory fake rather than a bare jest.fn() so the tests can
// assert what actually ended up in the bucket — the point of the phase is
// that binaries land in the private bucket and really disappear on delete.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrandKitService } from './brand-kit.service';

const TENANT_ID = '3fcf6e35-9881-4713-b704-795956eec0c8';
const OTHER_TENANT_ID = '9c0f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const WORKSPACE_ID = 'b9c311c3-96e9-4bc4-b2a4-f02763063b1b';
const USER_ID = 'c821ac23-bf9f-46aa-87b9-fe1b34351941';
const CLIENT_A = '2f0f1f4a-8f77-4a2f-9a6a-0f6f0b1c2d3e';
const CLIENT_B = '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';
const ASSET_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** A buffer of exactly `size` bytes that really starts with the PNG signature. */
function pngBuffer(size = 32): Buffer {
  const signature = Buffer.concat([
    Buffer.from([0x89]),
    Buffer.from('PNG\r\n\n', 'latin1'),
  ]);
  return Buffer.concat(
    [signature, Buffer.alloc(Math.max(0, size - signature.length))],
    Math.max(size, signature.length),
  );
}

/** Minimal in-memory private bucket. */
function fakeStorage() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    uploadPrivateBuffer: jest.fn(
      (input: { body: Buffer; path: string; contentType: string }) => {
        objects.set(input.path, {
          body: input.body,
          contentType: input.contentType,
        });
        return Promise.resolve({ path: input.path });
      },
    ),
    getPrivateAsset: jest.fn((path: string) => {
      const stored = objects.get(path);
      if (!stored)
        return Promise.reject(new NotFoundException('Asset not found.'));
      return Promise.resolve({
        body: stored.body,
        contentType: stored.contentType,
        cacheControl: 'private, no-store',
      });
    }),
    deleteObject: jest.fn((input: { bucket: string; path: string }) => {
      objects.delete(input.path);
      return Promise.resolve();
    }),
  };
}

type KitRow = {
  id: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  palette: unknown[];
  typography: unknown[];
  guidelines: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AssetRow = {
  id: string;
  brandKitId: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  kind: string;
  variant: string | null;
  theme: string | null;
  storagePath: string;
  mimeType: string;
  byteSize: string;
  width: number | null;
  height: number | null;
  originalFilename: string;
  checksum: string | null;
  metadata: Record<string, unknown>;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

/** Applies the equality/IsNull subset of `where` the service actually uses. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && '_type' in expected) {
      return actual === null || actual === undefined;
    }
    return actual === expected;
  });
}

function createFixture(
  options: {
    failAssetSave?: boolean;
    failSoftDelete?: boolean;
    failHardDelete?: boolean;
  } = {},
) {
  const kitRows: KitRow[] = [];
  const assetRows: AssetRow[] = [];
  const storage = fakeStorage();
  let kitSequence = 0;

  const kits = {
    rows: kitRows,
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(kitRows.find((row) => matches(row, where)) ?? null),
    ),
    save: jest.fn((row: KitRow) => {
      const index = kitRows.findIndex((candidate) => candidate.id === row.id);
      if (index >= 0) kitRows[index] = { ...row, updatedAt: new Date() };
      return Promise.resolve(kitRows[index] ?? row);
    }),
  };

  /**
   * Models TypeORM's soft-delete semantics, which this correction depends on:
   * a repository with a `@DeleteDateColumn` hides rows whose `deletedAt` is
   * set unless the query opts in with `withDeleted: true`. A mock that
   * ignored that would pass whether or not the production code respects it —
   * exactly the bug this phase is fixing.
   */
  function visible(
    rows: AssetRow[],
    where: Record<string, unknown>,
    withDeleted: boolean | undefined,
  ) {
    return rows.filter(
      (row) => matches(row, where) && (withDeleted === true || !row.deletedAt),
    );
  }

  const assets = {
    rows: assetRows,
    find: jest.fn(
      ({
        where,
        withDeleted,
      }: {
        where: Record<string, unknown>;
        withDeleted?: boolean;
      }) => Promise.resolve(visible(assetRows, where, withDeleted)),
    ),
    findOne: jest.fn(
      ({
        where,
        withDeleted,
      }: {
        where: Record<string, unknown>;
        withDeleted?: boolean;
      }) => Promise.resolve(visible(assetRows, where, withDeleted)[0] ?? null),
    ),
    create: jest.fn((value: AssetRow) => ({
      ...value,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    save: jest.fn((row: AssetRow) => {
      if (options.failAssetSave) {
        return Promise.reject(new Error('db write failed'));
      }
      assetRows.push(row);
      return Promise.resolve(row);
    }),
    softDelete: jest.fn((criteria: { id: string; tenantId: string }) => {
      if (options.failSoftDelete) {
        return Promise.reject(new Error('tombstone write failed'));
      }
      const row = assetRows.find(
        (candidate) =>
          candidate.id === criteria.id &&
          candidate.tenantId === criteria.tenantId,
      );
      if (row) row.deletedAt = new Date();
      return Promise.resolve({ affected: row ? 1 : 0 });
    }),
    delete: jest.fn((criteria: { id: string; tenantId: string }) => {
      if (options.failHardDelete) {
        return Promise.reject(new Error('final delete failed'));
      }
      const index = assetRows.findIndex(
        (row) => row.id === criteria.id && row.tenantId === criteria.tenantId,
      );
      if (index >= 0) assetRows.splice(index, 1);
      return Promise.resolve({ affected: index >= 0 ? 1 : 0 });
    }),
  };

  /**
   * Mimics `INSERT ... ON CONFLICT DO NOTHING` against the two partial unique
   * indexes: a second insert for a scope that already has a row is silently
   * ignored, exactly as Postgres would.
   */
  const insertBuilder = {
    into: () => insertBuilder,
    values: (value: Partial<KitRow>) => {
      insertBuilder.pending = value;
      return insertBuilder;
    },
    orIgnore: () => insertBuilder,
    execute: () => {
      const value = insertBuilder.pending;
      const conflict = kitRows.some(
        (row) =>
          row.tenantId === value.tenantId &&
          row.workspaceId === value.workspaceId &&
          row.agencyClientId === (value.agencyClientId ?? null),
      );
      if (!conflict) {
        kitRows.push({
          id: `kit-${++kitSequence}`,
          tenantId: value.tenantId!,
          workspaceId: value.workspaceId!,
          agencyClientId: value.agencyClientId ?? null,
          palette: [],
          typography: [],
          guidelines: null,
          createdById: value.createdById ?? null,
          updatedById: value.updatedById ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return Promise.resolve({ raw: [] });
    },
    pending: {} as Partial<KitRow>,
  };

  const dataSource = {
    createQueryBuilder: () => ({ insert: () => insertBuilder }),
  };

  const service = new BrandKitService(
    dataSource as never,
    kits as never,
    assets as never,
    storage as never,
  );

  return { service, kits, assets, storage, kitRows, assetRows };
}

function contextFor(
  productKey: 'social' | 'leadflow' = 'social',
  tenantId = TENANT_ID,
) {
  return {
    tenantId,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: 'owner',
    managedContext: {
      productKey,
      operatingMode: 'agency' as const,
      clientId: null,
      managedTenantId: null,
    },
  };
}

describe('BrandKitService', () => {
  afterEach(() => jest.clearAllMocks());

  describe('read without creating (§14)', () => {
    it('returns empty defaults for a scope that has no Brand Kit, and writes nothing', async () => {
      const fixture = createFixture();

      const result = await fixture.service.getBrandKit(contextFor(), null);

      expect(result.id).toBeNull();
      expect(result.palette).toEqual([]);
      expect(result.assets).toEqual([]);
      expect(fixture.kitRows).toHaveLength(0);
      expect(fixture.kits.save).not.toHaveBeenCalled();
    });

    it('never exposes the storage path in a response', async () => {
      const fixture = createFixture();
      await fixture.service.uploadAsset(contextFor(), null, {
        file: {
          buffer: pngBuffer(),
          originalname: 'logo.png',
          mimetype: 'image/png',
        },
        kind: 'logo',
      });

      const result = await fixture.service.getBrandKit(contextFor(), null);
      const serialized = JSON.stringify(result);

      // The stored key must not leak. `contentPath` legitimately starts with
      // `/brand-kit/assets/` — that is the API route, not the bucket key —
      // so the assertion targets the actual storage key that was written.
      const storedKey = [...fixture.storage.objects.keys()][0];
      expect(storedKey).toMatch(/^brand-kit\/.+\/agency\/.+\.png$/);
      expect(serialized).not.toContain(storedKey);
      expect(serialized).not.toContain(TENANT_ID);
      expect(result.assets[0].contentPath).toBe(
        `/brand-kit/assets/${result.assets[0].id}/content`,
      );
      expect(result.assets[0]).not.toHaveProperty('storagePath');
    });
  });

  describe('create-if-missing is race-safe (§14)', () => {
    it('PATCH creates the kit when absent', async () => {
      const fixture = createFixture();

      const result = await fixture.service.updateBrandKit(contextFor(), null, {
        guidelines: 'Nunca distorcer a marca.',
      });

      expect(result.id).not.toBeNull();
      expect(result.guidelines).toBe('Nunca distorcer a marca.');
      expect(fixture.kitRows).toHaveLength(1);
    });

    it('two concurrent writes converge on one kit — the conflict is absorbed', async () => {
      const fixture = createFixture();

      await Promise.all([
        fixture.service.updateBrandKit(contextFor(), null, { guidelines: 'a' }),
        fixture.service.updateBrandKit(contextFor(), null, { guidelines: 'b' }),
      ]);

      expect(fixture.kitRows).toHaveLength(1);
    });

    it('agency and client kits are separate rows in the same tenant', async () => {
      const fixture = createFixture();

      await fixture.service.updateBrandKit(contextFor(), null, {
        guidelines: 'agency',
      });
      await fixture.service.updateBrandKit(contextFor(), CLIENT_A, {
        guidelines: 'client a',
      });
      await fixture.service.updateBrandKit(contextFor(), CLIENT_B, {
        guidelines: 'client b',
      });

      expect(fixture.kitRows).toHaveLength(3);
      expect(
        fixture.kitRows.filter((row) => row.agencyClientId === null),
      ).toHaveLength(1);
    });
  });

  describe('partial update never blanks an omitted field', () => {
    it('a palette-only PATCH keeps the stored guidelines', async () => {
      const fixture = createFixture();
      await fixture.service.updateBrandKit(contextFor(), null, {
        guidelines: 'texto original',
      });

      const result = await fixture.service.updateBrandKit(contextFor(), null, {
        palette: [{ role: 'primary', hex: '#112233' }],
      });

      expect(result.guidelines).toBe('texto original');
      expect(result.palette).toEqual([
        { role: 'primary', hex: '#112233', label: null },
      ]);
    });
  });

  describe('upload (§17/§27)', () => {
    it('writes the binary to the private bucket under a server-built key', async () => {
      const fixture = createFixture();

      const asset = await fixture.service.uploadAsset(contextFor(), null, {
        file: {
          buffer: pngBuffer(),
          originalname: '../../evil name.png',
          mimetype: 'image/png',
        },
        kind: 'logo',
        variant: 'horizontal',
        theme: 'dark',
      });

      const [call] = fixture.storage.uploadPrivateBuffer.mock.calls;
      expect(call[0].path).toBe(
        `brand-kit/${TENANT_ID}/agency/${asset.id}.png`,
      );
      expect(call[0].path).not.toContain('..');
      expect(call[0].path).not.toContain('evil');
      expect(asset.originalFilename).toBe('evil name.png');
      expect(asset.variant).toBe('horizontal');
      expect(asset.theme).toBe('dark');
    });

    it('persists the metadata row alongside the object', async () => {
      const fixture = createFixture();

      await fixture.service.uploadAsset(contextFor(), CLIENT_A, {
        file: {
          buffer: pngBuffer(64),
          originalname: 'logo.png',
          mimetype: 'image/png',
        },
        kind: 'logo',
      });

      expect(fixture.assetRows).toHaveLength(1);
      expect(fixture.assetRows[0]).toMatchObject({
        tenantId: TENANT_ID,
        agencyClientId: CLIENT_A,
        mimeType: 'image/png',
        byteSize: '64',
      });
      expect(fixture.assetRows[0].checksum).toHaveLength(64);
    });

    it('drops variant/theme on a reference — they describe a logo only', async () => {
      const fixture = createFixture();

      const asset = await fixture.service.uploadAsset(contextFor(), null, {
        file: {
          buffer: pngBuffer(),
          originalname: 'ref.png',
          mimetype: 'image/png',
        },
        kind: 'reference',
        variant: 'mark',
        theme: 'light',
      });

      expect(asset.variant).toBeNull();
      expect(asset.theme).toBeNull();
    });

    it('a DB failure after the object was written cleans the object up', async () => {
      const fixture = createFixture({ failAssetSave: true });

      await expect(
        fixture.service.uploadAsset(contextFor(), null, {
          file: {
            buffer: pngBuffer(),
            originalname: 'logo.png',
            mimetype: 'image/png',
          },
          kind: 'logo',
        }),
      ).rejects.toThrow('db write failed');

      expect(fixture.storage.deleteObject).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: 'private' }),
      );
      // No orphan left behind, and no row claiming an asset exists.
      expect(fixture.storage.objects.size).toBe(0);
      expect(fixture.assetRows).toHaveLength(0);
    });

    it('a storage failure leaves no metadata row behind', async () => {
      const fixture = createFixture();
      fixture.storage.uploadPrivateBuffer.mockRejectedValueOnce(
        new Error('bucket unreachable'),
      );

      await expect(
        fixture.service.uploadAsset(contextFor(), null, {
          file: {
            buffer: pngBuffer(),
            originalname: 'logo.png',
            mimetype: 'image/png',
          },
          kind: 'logo',
        }),
      ).rejects.toThrow('bucket unreachable');

      expect(fixture.assetRows).toHaveLength(0);
    });

    it('rejects an oversized file before touching storage', async () => {
      const fixture = createFixture();

      await expect(
        fixture.service.uploadAsset(contextFor(), null, {
          file: {
            buffer: pngBuffer(),
            originalname: 'logo.png',
            mimetype: 'image/png',
            size: 6 * 1024 * 1024,
          },
          kind: 'logo',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(fixture.storage.uploadPrivateBuffer).not.toHaveBeenCalled();
    });

    it('rejects a disallowed MIME before touching storage', async () => {
      const fixture = createFixture();

      await expect(
        fixture.service.uploadAsset(contextFor(), null, {
          file: {
            buffer: Buffer.from('%PDF-1.7'),
            originalname: 'doc.pdf',
            mimetype: 'application/pdf',
          },
          kind: 'reference',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(fixture.storage.uploadPrivateBuffer).not.toHaveBeenCalled();
      expect(fixture.kitRows).toHaveLength(0);
    });

    it('rejects an empty upload', async () => {
      const fixture = createFixture();

      await expect(
        fixture.service.uploadAsset(contextFor(), null, {
          file: { buffer: Buffer.alloc(0), originalname: 'x.png' },
          kind: 'logo',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('content read + isolation (§13/§26)', () => {
    async function seedAsset(
      fixture: ReturnType<typeof createFixture>,
      clientId: string | null,
      tenantId = TENANT_ID,
    ) {
      return fixture.service.uploadAsset(
        contextFor('social', tenantId),
        clientId,
        {
          file: {
            buffer: pngBuffer(),
            originalname: 'logo.png',
            mimetype: 'image/png',
          },
          kind: 'logo',
        },
      );
    }

    it('returns the bytes and the real content type', async () => {
      const fixture = createFixture();
      const asset = await seedAsset(fixture, null);

      const { file, asset: row } = await fixture.service.getAssetContent(
        contextFor(),
        null,
        asset.id,
      );

      expect(file.contentType).toBe('image/png');
      expect(row.mimeType).toBe('image/png');
    });

    it("client B's context cannot read client A's asset", async () => {
      const fixture = createFixture();
      const asset = await seedAsset(fixture, CLIENT_A);

      await expect(
        fixture.service.getAssetContent(contextFor(), CLIENT_B, asset.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("a client context cannot read the agency's asset", async () => {
      const fixture = createFixture();
      const asset = await seedAsset(fixture, null);

      await expect(
        fixture.service.getAssetContent(contextFor(), CLIENT_A, asset.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('another tenant cannot read the asset, and gets the same answer as for a missing id', async () => {
      const fixture = createFixture();
      const asset = await seedAsset(fixture, null);

      await expect(
        fixture.service.getAssetContent(
          contextFor('social', OTHER_TENANT_ID),
          null,
          asset.id,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('an unknown or malformed asset id leaks nothing', async () => {
      const fixture = createFixture();

      await expect(
        fixture.service.getAssetContent(contextFor(), null, ASSET_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        fixture.service.getAssetContent(contextFor(), null, 'not-a-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('listing is scoped: a client sees only its own assets', async () => {
      const fixture = createFixture();
      await seedAsset(fixture, CLIENT_A);
      await seedAsset(fixture, CLIENT_B);
      await seedAsset(fixture, null);

      const clientA = await fixture.service.listAssets(contextFor(), CLIENT_A);
      const agency = await fixture.service.listAssets(contextFor(), null);

      expect(clientA).toHaveLength(1);
      expect(agency).toHaveLength(1);
      expect(clientA[0].id).not.toBe(agency[0].id);
    });
  });

  describe('delete: tombstone → storage → finalization', () => {
    async function seedForDelete(
      fixture: ReturnType<typeof createFixture>,
      clientId: string | null = null,
    ) {
      return fixture.service.uploadAsset(contextFor(), clientId, {
        file: {
          buffer: pngBuffer(),
          originalname: 'logo.png',
          mimetype: 'image/png',
        },
        kind: 'logo',
      });
    }

    it('1: the happy path tombstones, removes the binary, then drops the row', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture);
      expect(fixture.storage.objects.size).toBe(1);

      await fixture.service.deleteAsset(contextFor(), null, asset.id);

      expect(fixture.assetRows).toHaveLength(0);
      expect(fixture.storage.objects.size).toBe(0);
      // The tombstone really was written before the bucket was touched.
      expect(fixture.assets.softDelete).toHaveBeenCalledTimes(1);
      const softDeleteOrder =
        fixture.assets.softDelete.mock.invocationCallOrder[0];
      const storageOrder =
        fixture.storage.deleteObject.mock.invocationCallOrder[0];
      const hardDeleteOrder = fixture.assets.delete.mock.invocationCallOrder[0];
      expect(softDeleteOrder).toBeLessThan(storageOrder);
      expect(storageOrder).toBeLessThan(hardDeleteOrder);
    });

    it('2: a failure to persist the tombstone never touches storage', async () => {
      const fixture = createFixture({ failSoftDelete: true });
      const asset = await seedForDelete(fixture);

      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).rejects.toThrow('tombstone write failed');

      // Nothing was removed: a delete that could not be recorded must not
      // destroy bytes.
      expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
      expect(fixture.storage.objects.size).toBe(1);
      expect(fixture.assetRows).toHaveLength(1);
      expect(fixture.assetRows[0].deletedAt).toBeNull();
    });

    it('3: a storage failure keeps the row, the tombstone and the storage_path, and fails the request', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture);
      const storedKey = [...fixture.storage.objects.keys()][0];
      fixture.storage.deleteObject.mockRejectedValueOnce(
        new Error('bucket unreachable'),
      );

      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).rejects.toThrow('bucket unreachable');

      // Everything a reconciler needs survives.
      expect(fixture.assetRows).toHaveLength(1);
      expect(fixture.assetRows[0].deletedAt).toBeInstanceOf(Date);
      expect(fixture.assetRows[0].storagePath).toBe(storedKey);
      expect(fixture.assetRows[0].tenantId).toBe(TENANT_ID);
      // The row was NOT finalized.
      expect(fixture.assets.delete).not.toHaveBeenCalled();
    });

    it('3b: after a storage failure the asset is already invisible to list and content', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture);
      fixture.storage.deleteObject.mockRejectedValueOnce(
        new Error('bucket unreachable'),
      );
      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).rejects.toThrow();

      // The bytes may still be in the bucket, but the user's intent stands.
      expect(fixture.storage.objects.size).toBe(1);
      await expect(
        fixture.service.listAssets(contextFor(), null),
      ).resolves.toEqual([]);
      await expect(
        fixture.service.getAssetContent(contextFor(), null, asset.id),
      ).rejects.toThrow(NotFoundException);
      const kit = await fixture.service.getBrandKit(contextFor(), null);
      expect(kit.assets).toEqual([]);
    });

    it('4: retrying after a storage failure finds the tombstone and completes', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture);
      const storedKey = [...fixture.storage.objects.keys()][0];
      fixture.storage.deleteObject.mockRejectedValueOnce(
        new Error('bucket unreachable'),
      );
      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).rejects.toThrow();

      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).resolves.toBeUndefined();

      // The same object was retried, and the row is finally gone.
      expect(fixture.storage.deleteObject).toHaveBeenLastCalledWith({
        bucket: 'private',
        path: storedKey,
      });
      expect(fixture.storage.objects.size).toBe(0);
      expect(fixture.assetRows).toHaveLength(0);
      // The tombstone was written once, not again on the retry.
      expect(fixture.assets.softDelete).toHaveBeenCalledTimes(1);
    });

    it('5: an object that is already absent counts as removed, so delete converges', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture);
      fixture.storage.deleteObject.mockRejectedValueOnce(
        new NotFoundException('Asset not found.'),
      );

      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).resolves.toBeUndefined();

      expect(fixture.assetRows).toHaveLength(0);
    });

    it('5b: a raw NoSuchKey / 404 from the driver is treated the same way', async () => {
      for (const storageError of [
        Object.assign(new Error('gone'), { name: 'NoSuchKey' }),
        Object.assign(new Error('gone'), {
          $metadata: { httpStatusCode: 404 },
        }),
      ]) {
        const fixture = createFixture();
        const asset = await seedForDelete(fixture);
        fixture.storage.deleteObject.mockRejectedValueOnce(storageError);

        await expect(
          fixture.service.deleteAsset(contextFor(), null, asset.id),
        ).resolves.toBeUndefined();
        expect(fixture.assetRows).toHaveLength(0);
      }
    });

    it('6: a DB failure after the object was removed leaves the asset tombstoned, and a retry finishes it', async () => {
      const fixture = createFixture({ failHardDelete: true });
      const asset = await seedForDelete(fixture);

      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).rejects.toThrow('final delete failed');

      // The bytes are gone; the row must NOT be active, or it would serve a
      // 404 forever as if it were a real asset.
      expect(fixture.storage.objects.size).toBe(0);
      expect(fixture.assetRows).toHaveLength(1);
      expect(fixture.assetRows[0].deletedAt).toBeInstanceOf(Date);
      await expect(
        fixture.service.listAssets(contextFor(), null),
      ).resolves.toEqual([]);

      // The retry finalizes without needing the object back.
      fixture.assets.delete.mockImplementationOnce(
        (criteria: { id: string; tenantId: string }) => {
          const index = fixture.assetRows.findIndex(
            (row) =>
              row.id === criteria.id && row.tenantId === criteria.tenantId,
          );
          if (index >= 0) fixture.assetRows.splice(index, 1);
          return Promise.resolve({ affected: 1 });
        },
      );
      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).resolves.toBeUndefined();
      expect(fixture.assetRows).toHaveLength(0);
      expect(fixture.storage.objects.size).toBe(0);
    });

    it('7: a tombstoned asset of client A cannot be probed from client B', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture, CLIENT_A);
      fixture.storage.deleteObject.mockRejectedValueOnce(
        new Error('bucket unreachable'),
      );
      await expect(
        fixture.service.deleteAsset(contextFor(), CLIENT_A, asset.id),
      ).rejects.toThrow();

      // Same answer as a nonexistent id — the tombstone leaks nothing, and a
      // delete retry from the wrong scope cannot finish someone else's.
      await expect(
        fixture.service.getAssetContent(contextFor(), CLIENT_B, asset.id),
      ).rejects.toThrow(NotFoundException);
      await expect(
        fixture.service.deleteAsset(contextFor(), CLIENT_B, asset.id),
      ).rejects.toThrow(NotFoundException);
      await expect(
        fixture.service.deleteAsset(
          contextFor('social', OTHER_TENANT_ID),
          CLIENT_A,
          asset.id,
        ),
      ).rejects.toThrow(NotFoundException);

      // Client A's row is untouched by any of those attempts.
      expect(fixture.assetRows).toHaveLength(1);
    });

    it('refuses to delete an asset from another scope', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture, CLIENT_A);

      await expect(
        fixture.service.deleteAsset(contextFor(), CLIENT_B, asset.id),
      ).rejects.toThrow(NotFoundException);

      expect(fixture.assetRows).toHaveLength(1);
      expect(fixture.assetRows[0].deletedAt).toBeNull();
      expect(fixture.storage.objects.size).toBe(1);
    });

    it('8: no object key or bucket name reaches the API surface, even mid-delete', async () => {
      const fixture = createFixture();
      const asset = await seedForDelete(fixture);
      const storedKey = [...fixture.storage.objects.keys()][0];

      const beforeDelete = await fixture.service.getBrandKit(
        contextFor(),
        null,
      );
      fixture.storage.deleteObject.mockRejectedValueOnce(
        new Error('bucket unreachable'),
      );
      await expect(
        fixture.service.deleteAsset(contextFor(), null, asset.id),
      ).rejects.toThrow();
      const afterFailedDelete = await fixture.service.getBrandKit(
        contextFor(),
        null,
      );

      for (const projection of [beforeDelete, afterFailedDelete]) {
        const serialized = JSON.stringify(projection);
        expect(serialized).not.toContain(storedKey);
        expect(serialized).not.toContain('lyra-private-assets');
        expect(serialized).not.toContain('storagePath');
        expect(serialized).not.toContain('deletedAt');
      }
    });

    it('multiple assets of the same kind coexist — no undocumented singleton rule', async () => {
      const fixture = createFixture();

      await fixture.service.uploadAsset(contextFor(), null, {
        file: {
          buffer: pngBuffer(),
          originalname: 'a.png',
          mimetype: 'image/png',
        },
        kind: 'logo',
        variant: 'horizontal',
        theme: 'light',
      });
      await fixture.service.uploadAsset(contextFor(), null, {
        file: {
          buffer: pngBuffer(),
          originalname: 'b.png',
          mimetype: 'image/png',
        },
        kind: 'logo',
        variant: 'horizontal',
        theme: 'dark',
      });

      expect(fixture.assetRows).toHaveLength(2);
    });
  });

  describe('context requirements', () => {
    it('refuses a context without a workspace', async () => {
      const fixture = createFixture();

      await expect(
        fixture.service.getBrandKit(
          { tenantId: TENANT_ID, userId: USER_ID } as never,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
