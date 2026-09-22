import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import type { MediaAssetScope } from '../../common/media-assets';
import { MediaAssetUploadService } from '../../common/media-assets';

@Injectable()
export class CreativeThumbnailService {
  constructor(private readonly mediaUpload: MediaAssetUploadService) {}
  async create(
    scope: MediaAssetScope,
    actor: string | null,
    file: { buffer: Buffer; originalname: string; mimetype?: string },
  ) {
    const buffer = await sharp(file.buffer, { failOn: 'error' })
      .rotate()
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return this.mediaUpload.upload(scope, actor, {
      file: {
        buffer,
        size: buffer.length,
        originalname: `${file.originalname || 'imagem'}.webp`,
        mimetype: 'image/webp',
      },
      source: 'creative_studio_thumbnail',
    });
  }
}
