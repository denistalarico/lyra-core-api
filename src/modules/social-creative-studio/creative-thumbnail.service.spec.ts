import sharp from 'sharp';
import type { MediaAssetScope } from '../../common/media-assets';
import type { MediaAssetUploadService } from '../../common/media-assets';
import { CreativeThumbnailService } from './creative-thumbnail.service';

const scope: MediaAssetScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
};
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lBcAAAAASUVORK5CYII=',
  'base64',
);

describe('CreativeThumbnailService', () => {
  it('stores a WebP derivative without changing the uploaded original', async () => {
    const original = Buffer.from(PNG);
    const mediaUpload = {
      upload: jest.fn().mockResolvedValue({ id: 'thumbnail-id' }),
    };
    const service = new CreativeThumbnailService(
      mediaUpload as unknown as MediaAssetUploadService,
    );

    await expect(
      service.create(scope, 'user-a', {
        buffer: original,
        originalname: 'poster.png',
        mimetype: 'image/png',
      }),
    ).resolves.toEqual({ id: 'thumbnail-id' });

    const input = mediaUpload.upload.mock.calls[0][2];
    expect(input.source).toBe('creative_studio_thumbnail');
    expect(input.file.mimetype).toBe('image/webp');
    expect(input.file.originalname).toBe('poster.png.webp');
    expect(input.file.buffer.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(input.file.buffer.subarray(8, 12).toString('latin1')).toBe('WEBP');
    const metadata = await sharp(input.file.buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBeLessThanOrEqual(480);
    expect(metadata.height).toBeLessThanOrEqual(480);
    expect(original).toEqual(PNG);
  });
});
