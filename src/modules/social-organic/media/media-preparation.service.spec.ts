import { readFileSync } from 'fs';
import { join } from 'path';
import { FilesService } from '../../../common/files/files.service';
import {
  MediaPreparationService,
  type ResolvedMediaObject,
} from './media-preparation.service';

function media(
  overrides: Partial<ResolvedMediaObject> = {},
): ResolvedMediaObject {
  return {
    storagePath: 'tenant-1/workspace-1/agency-client-1/asset.jpg',
    mimeType: 'image/jpeg',
    bytes: 1_000,
    ...overrides,
  };
}

function createService() {
  const getPresignedGetUrl = jest.fn();
  const filesService = {
    getPresignedGetUrl,
  } as unknown as FilesService;

  const service = new MediaPreparationService(filesService);

  return { service, getPresignedGetUrl };
}

describe('MediaPreparationService.prepare', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('presigns a GET against the private bucket and returns adapter-ready input', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 300,
    });

    const result = await service.prepare({
      media: media(),
      provider: 'meta',
      placement: 'feed',
    });

    expect(result).toEqual({
      sourceUrl: 'https://signed.example.com/asset.jpg',
      mimeType: 'image/jpeg',
      bytes: 1_000,
    });
    expect(getPresignedGetUrl).toHaveBeenCalledWith({
      bucket: 'private',
      path: 'tenant-1/workspace-1/agency-client-1/asset.jpg',
      ttlSeconds: undefined,
    });
  });

  it('forwards a caller-supplied TTL to FilesService', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 120,
    });

    await service.prepare({
      media: media(),
      provider: 'meta',
      placement: 'feed',
      ttlSeconds: 120,
    });

    expect(getPresignedGetUrl).toHaveBeenCalledWith(
      expect.objectContaining({ ttlSeconds: 120 }),
    );
  });

  it('reuses a cached rendition for the same (asset, provider, placement) triple', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 300,
    });

    const input = { media: media(), provider: 'meta', placement: 'feed' };
    const first = await service.prepare(input);
    const second = await service.prepare(input);

    expect(second).toEqual(first);
    expect(getPresignedGetUrl).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a cached rendition across different placements', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 300,
    });

    await service.prepare({
      media: media(),
      provider: 'meta',
      placement: 'feed',
    });
    await service.prepare({
      media: media(),
      provider: 'meta',
      placement: 'story',
    });

    expect(getPresignedGetUrl).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached rendition across different providers', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 300,
    });

    await service.prepare({
      media: media(),
      provider: 'meta',
      placement: 'feed',
    });
    await service.prepare({
      media: media(),
      provider: 'tiktok',
      placement: 'feed',
    });

    expect(getPresignedGetUrl).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached rendition across different source assets', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 300,
    });

    await service.prepare({
      media: media(),
      provider: 'meta',
      placement: 'feed',
    });
    await service.prepare({
      media: media({
        storagePath: 'tenant-1/workspace-1/agency-client-1/other.jpg',
      }),
      provider: 'meta',
      placement: 'feed',
    });

    expect(getPresignedGetUrl).toHaveBeenCalledTimes(2);
  });

  it('re-presigns once the cached rendition nears expiry', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 300,
    });

    const input = { media: media(), provider: 'meta', placement: 'feed' };
    await service.prepare(input);

    jest.advanceTimersByTime(300_000);
    await service.prepare(input);

    expect(getPresignedGetUrl).toHaveBeenCalledTimes(2);
  });

  it('always requests the private bucket, never the public one', async () => {
    const { service, getPresignedGetUrl } = createService();
    getPresignedGetUrl.mockResolvedValue({
      url: 'https://signed.example.com/asset.jpg',
      expiresInSeconds: 300,
    });

    await service.prepare({
      media: media(),
      provider: 'meta',
      placement: 'feed',
    });

    expect(getPresignedGetUrl).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'private' }),
    );
  });

  it('has no source-level path that requests the public bucket', () => {
    const source = readFileSync(
      join(__dirname, 'media-preparation.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/bucket:\s*'public'/);
    expect(source.match(/bucket: 'private'/g)).toHaveLength(1);
  });
});
