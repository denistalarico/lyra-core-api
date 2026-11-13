import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { InternalServerErrorException } from '@nestjs/common';
import { Readable } from 'stream';
import { FilesService } from './files.service';

const r2 = {
  endpoint: 'https://acc.r2.cloudflarestorage.com',
  bucket: 'lyrasuite',
  accessKeyId: 'id',
  secretAccessKey: 'secret',
};

function service(withR2: boolean) {
  const values: Record<string, unknown> = {
    'files.s3.privateBucket': 'private',
    'files.s3.accessKeyId': 'test-key',
    'files.s3.secretAccessKey': 'test-secret',
    'files.s3.createBucket': false,
    ...(withR2 ? { 'files.r2': r2 } : {}),
  };
  return new FilesService({
    get: (key: string) => values[key],
  } as never);
}

describe('FilesService R2 routing', () => {
  let send: jest.SpyInstance;
  beforeEach(() => {
    send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((() =>
        Promise.resolve({ Body: Readable.from([]) })) as never);
  });
  afterEach(() => send.mockRestore());
  const lastInput = () =>
    (send.mock.calls.at(-1)?.[0] as { input: Record<string, unknown> }).input;

  it('prefixes new keys only when R2 is configured', () => {
    expect(service(true).r2Path('media-assets/a.png')).toBe(
      'r2/media-assets/a.png',
    );
    expect(service(false).r2Path('media-assets/a.png')).toBe(
      'media-assets/a.png',
    );
  });

  it.each([
    ['upload', PutObjectCommand],
    ['read', GetObjectCommand],
    ['delete', DeleteObjectCommand],
  ])(
    '%s of an R2 path uses the R2 bucket and the bare key',
    async (op, cmd) => {
      const files = service(true);
      const path = 'r2/media-assets/a.png';
      if (op === 'upload')
        await files.uploadPrivateBuffer({
          path,
          body: Buffer.from('x'),
          contentType: 'image/png',
        });
      else if (op === 'read') await files.getPrivateAsset(path);
      else await files.deleteObject({ bucket: 'private', path });
      expect(send.mock.calls.at(-1)?.[0]).toBeInstanceOf(cmd);
      expect(lastInput()).toMatchObject({
        Bucket: 'lyrasuite',
        Key: 'media-assets/a.png',
      });
    },
  );

  it('keeps every other path in the private bucket', async () => {
    await service(true).getPrivateAsset('media-assets/a.png');
    expect(lastInput()).toMatchObject({
      Bucket: 'private',
      Key: 'media-assets/a.png',
    });
  });

  it('presigns an R2 object against the R2 endpoint', async () => {
    const { url } = await service(true).getPresignedGetUrl({
      bucket: 'private',
      path: 'r2/media-assets/a.png',
    });
    expect(url).toContain(
      'acc.r2.cloudflarestorage.com/lyrasuite/media-assets/a.png',
    );
    expect(url).not.toContain('x-amz-checksum-mode');
  });

  it('fails loudly instead of reading the wrong bucket without R2', async () => {
    await expect(
      service(false).getPrivateAsset('r2/media-assets/a.png'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
