import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { FilesService } from '../files/files.service';
import type { MediaAssetMetadataReader } from './media-asset-metadata.port';
import type { MediaAssetScope } from './media-asset-resolver.service';
import { MediaAssetUploadService } from './media-asset-upload.service';
import type { MediaAssetEntity } from './media-asset.entity';

const PNG = Buffer.concat([
  Buffer.from([0x89]),
  Buffer.from('PNG\r\n\x1a\n', 'latin1'),
  Buffer.alloc(64),
]);

const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftyp', 'latin1'),
  Buffer.from('isom', 'latin1'),
  Buffer.alloc(64),
]);

describe('MediaAssetUploadService', () => {
  const agencyScope: MediaAssetScope = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
  };

  const clientScope: MediaAssetScope = {
    ...agencyScope,
    agencyClientId: '33333333-3333-4333-8333-333333333333',
  };

  const actorId = '55555555-5555-4555-8555-555555555555';

  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
  };
  let files: {
    uploadPrivateBuffer: jest.Mock;
    getPrivateAsset: jest.Mock;
    deleteObject: jest.Mock;
  };
  let metadata: { extract: jest.Mock };
  let service: MediaAssetUploadService;

  beforeEach(() => {
    repository = {
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({
        ...row,
        createdAt: new Date('2026-09-09T12:00:00.000Z'),
      })),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    files = {
      uploadPrivateBuffer: jest.fn().mockResolvedValue({ path: 'ok' }),
      getPrivateAsset: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    metadata = {
      extract: jest.fn().mockResolvedValue({
        width: 1080,
        height: 1920,
        durationSeconds: null,
        codec: 'png',
      }),
    };

    service = new MediaAssetUploadService(
      repository as never,
      files as unknown as FilesService,
      metadata as unknown as MediaAssetMetadataReader,
    );
  });

  function upload(scope: MediaAssetScope, buffer = PNG, mimetype = 'image/png') {
    return service.upload(scope, actorId, {
      file: {
        buffer,
        originalname: 'foto.png',
        mimetype,
        size: buffer.length,
      },
      source: 'planner_upload',
    });
  }

  describe('upload', () => {
    it('persists the scope from the caller, never from the payload', async () => {
      await upload(clientScope);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: clientScope.tenantId,
          workspaceId: clientScope.workspaceId,
          agencyClientId: clientScope.agencyClientId,
          createdById: actorId,
        }),
      );
    });

    it('stores the sniffed content type, not the declared one', async () => {
      await upload(agencyScope, PNG, 'video/mp4');

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: 'image/png' }),
      );
      expect(files.uploadPrivateBuffer).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'image/png' }),
      );
    });

    it('writes the object before the row', async () => {
      const order: string[] = [];
      files.uploadPrivateBuffer.mockImplementation(async () => {
        order.push('object');
        return { path: 'ok' };
      });
      repository.save.mockImplementation(async (row) => {
        order.push('row');
        return { ...row, createdAt: new Date() };
      });

      await upload(agencyScope);

      expect(order).toEqual(['object', 'row']);
    });

    it('removes the orphaned object when the row fails', async () => {
      repository.save.mockRejectedValue(new Error('constraint violation'));

      await expect(upload(agencyScope)).rejects.toThrow('constraint violation');

      expect(files.deleteObject).toHaveBeenCalledWith({
        bucket: 'private',
        path: expect.stringContaining('media-assets/'),
      });
    });

    it('reports the row failure, not a cleanup failure', async () => {
      repository.save.mockRejectedValue(new Error('constraint violation'));
      files.deleteObject.mockRejectedValue(new Error('bucket unreachable'));

      // The operator must learn why the upload failed. A cleanup error
      // replacing it would hide the real cause.
      await expect(upload(agencyScope)).rejects.toThrow('constraint violation');
    });

    it('never writes anything when the format is refused', async () => {
      await expect(
        upload(agencyScope, Buffer.from('%PDF-1.7', 'latin1'), 'application/pdf'),
      ).rejects.toThrow(BadRequestException);

      expect(files.uploadPrivateBuffer).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('never writes anything when the file is empty', async () => {
      await expect(
        service.upload(agencyScope, actorId, {
          file: { buffer: Buffer.alloc(0), originalname: 'x.png' },
          source: 'planner_upload',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(files.uploadPrivateBuffer).not.toHaveBeenCalled();
    });

    it('refuses a file whose metadata cannot be read, before storing it', async () => {
      // Storing it would produce a row that schedule-time validation always
      // rejects with `media_metadata_incomplete` — an upload that succeeds and
      // can never be published.
      metadata.extract.mockRejectedValue(
        new BadRequestException('Media metadata is unreadable.'),
      );

      await expect(upload(agencyScope)).rejects.toThrow(BadRequestException);

      expect(files.uploadPrivateBuffer).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('converts a video duration to exact milliseconds', async () => {
      metadata.extract.mockResolvedValue({
        width: 1080,
        height: 1920,
        durationSeconds: 12.345,
        codec: 'h264',
      });

      await upload(agencyScope, MP4, 'video/mp4');

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: '12345', codec: 'h264' }),
      );
    });

    it('leaves durationMs null for an image, which is how the capability check tells them apart', async () => {
      await upload(agencyScope);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: null }),
      );
    });

    it('keeps the byte size exact, as a string', async () => {
      await upload(agencyScope);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ byteSize: String(PNG.length) }),
      );
    });

    it('sanitizes the stored filename', async () => {
      await service.upload(agencyScope, actorId, {
        file: {
          buffer: PNG,
          originalname: '../../<script>.png',
          mimetype: 'image/png',
        },
        source: 'planner_upload',
      });

      const row = repository.create.mock.calls[0][0];
      expect(row.originalFilename).not.toContain('<');
      expect(row.originalFilename).not.toContain('..');
      expect(row.storagePath).not.toContain('script');
    });
  });

  describe('list', () => {
    it('matches a null client with IsNull, never a raw null', async () => {
      // A raw null is read by TypeORM as "no filter on this column", which
      // would return every managed client's media to an agency caller.
      await service.list(agencyScope);

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: agencyScope.tenantId,
            workspaceId: agencyScope.workspaceId,
            agencyClientId: IsNull(),
          },
        }),
      );
    });

    it('filters by the client id when a client context is active', async () => {
      await service.list(clientScope);

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agencyClientId: clientScope.agencyClientId,
          }),
        }),
      );
    });

    it('clamps an oversized limit', async () => {
      await service.list(agencyScope, { limit: 5000 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('clamps a nonsensical limit up to at least one row', async () => {
      await service.list(agencyScope, { limit: 0 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });

    it('applies the default page size when no limit is given', async () => {
      await service.list(agencyScope);

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe('getContent', () => {
    it('scopes the lookup with IsNull for the agency context', async () => {
      repository.findOne.mockResolvedValue({
        storagePath: 'media-assets/x.png',
      } as MediaAssetEntity);
      files.getPrivateAsset.mockResolvedValue({ body: {} });

      await service.getContent(agencyScope, 'asset-1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          id: 'asset-1',
          tenantId: agencyScope.tenantId,
          workspaceId: agencyScope.workspaceId,
          agencyClientId: IsNull(),
        },
      });
    });

    it('answers 404 for another scope, revealing nothing about existence', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.getContent(clientScope, 'asset-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(files.getPrivateAsset).not.toHaveBeenCalled();
    });
  });
});
