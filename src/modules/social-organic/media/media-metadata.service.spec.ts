import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { IMAGE_FIXTURE, createVideoFixture } from './media-metadata.fixtures';
import { MediaMetadataService } from './media-metadata.service';

describe('MediaMetadataService', () => {
  const service = new MediaMetadataService();

  it('extracts dimensions and codec from an image fixture', async () => {
    await expect(
      service.extract({ body: IMAGE_FIXTURE, mimeType: 'image/png' }),
    ).resolves.toEqual({
      mimeType: 'image/png',
      bytes: IMAGE_FIXTURE.length,
      kind: 'image',
      width: 1,
      height: 1,
      durationSeconds: null,
      codec: 'png',
      aspectRatio: 1,
    });
  });

  it('extracts dimensions, duration and codec from an MP4 fixture', async () => {
    const body = createVideoFixture();

    await expect(
      service.extract({ body, mimeType: 'video/mp4' }),
    ).resolves.toEqual({
      mimeType: 'video/mp4',
      bytes: body.length,
      kind: 'video',
      width: 640,
      height: 360,
      durationSeconds: 1,
      codec: 'avc1',
      aspectRatio: 640 / 360,
    });
  });

  it('refuses unreadable metadata rather than supplying defaults', async () => {
    await expect(
      service.extract({
        body: Buffer.from('not media'),
        mimeType: 'video/mp4',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a video format without a supported metadata reader', async () => {
    await expect(
      service.extract({ body: Buffer.from('webm'), mimeType: 'video/webm' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('has no process-execution path for media conversion', () => {
    const source = readFileSync(
      join(__dirname, 'media-metadata.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/child_process|execFile|spawn|ffmpeg-static/);
  });
});
