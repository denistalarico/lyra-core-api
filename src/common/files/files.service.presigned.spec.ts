// Lyra Social F4 — `FilesService.getPresignedGetUrl` (blueprint §11.3 r.1).
//
// `getSignedUrl` from `@aws-sdk/s3-request-presigner` is mocked: it signs
// requests using SigV4 internals that need real credentials/clock behaviour
// to produce a meaningful signature, and this spec is about which command
// and TTL FilesService hands it — not about SigV4 itself.

import { BadRequestException } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_PRESIGNED_GET_TTL_SECONDS,
  FilesService,
  MAX_PRESIGNED_GET_TTL_SECONDS,
} from './files.service';

const getSignedUrlMock = jest.fn(
  (): Promise<string> => Promise.resolve('https://signed.example.com/object'),
);

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (
    client: unknown,
    command: GetObjectCommand,
    options: { expiresIn: number },
  ) => getSignedUrlMock(client, command, options),
}));

function createService() {
  const config = new ConfigService({
    files: {
      s3: {
        endpoint: 'http://127.0.0.1:9000',
        bucket: 'test-assets',
        privateBucket: 'test-private-assets',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        region: 'us-east-1',
      },
    },
  });
  const service = new FilesService(config);

  // Short-circuit bucket readiness: this spec is about the signed command,
  // not about provisioning a bucket.
  (
    service as unknown as { privateBucketReady: Promise<void> }
  ).privateBucketReady = Promise.resolve();

  return { service };
}

describe('FilesService.getPresignedGetUrl', () => {
  beforeEach(() => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed.example.com/object');
  });

  it('signs a GetObjectCommand against the PRIVATE bucket with the default TTL', async () => {
    const { service } = createService();

    const result = await service.getPresignedGetUrl({
      bucket: 'private',
      path: 'brand-kit/tenant/agency/asset.png',
    });

    expect(result).toEqual({
      url: 'https://signed.example.com/object',
      expiresInSeconds: DEFAULT_PRESIGNED_GET_TTL_SECONDS,
    });

    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, command, options] = getSignedUrlMock.mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'test-private-assets',
      Key: 'brand-kit/tenant/agency/asset.png',
    });
    expect(options).toEqual({ expiresIn: DEFAULT_PRESIGNED_GET_TTL_SECONDS });
  });

  it('clamps a caller-supplied TTL to the maximum', async () => {
    const { service } = createService();

    const result = await service.getPresignedGetUrl({
      bucket: 'private',
      path: 'asset.png',
      ttlSeconds: MAX_PRESIGNED_GET_TTL_SECONDS * 10,
    });

    expect(result.expiresInSeconds).toBe(MAX_PRESIGNED_GET_TTL_SECONDS);
    const [, , options] = getSignedUrlMock.mock.calls[0];
    expect(options).toEqual({ expiresIn: MAX_PRESIGNED_GET_TTL_SECONDS });
  });

  it('accepts a caller-supplied TTL under the maximum', async () => {
    const { service } = createService();

    const result = await service.getPresignedGetUrl({
      bucket: 'private',
      path: 'asset.png',
      ttlSeconds: 60,
    });

    expect(result.expiresInSeconds).toBe(60);
  });

  it('rejects a non-positive TTL before signing', async () => {
    const { service } = createService();

    for (const ttlSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        service.getPresignedGetUrl({
          bucket: 'private',
          path: 'asset.png',
          ttlSeconds,
        }),
      ).rejects.toThrow(BadRequestException);
    }

    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('refuses any bucket other than the private one', async () => {
    const { service } = createService();

    await expect(
      service.getPresignedGetUrl({
        bucket: 'public' as never,
        path: 'avatars/someone.png',
      }),
    ).rejects.toThrow(BadRequestException);

    // The public bucket is already unauthenticated; presigning it would be
    // pointless and nothing here may reach it (D-11 item 9).
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a traversal path before any command is signed', async () => {
    const { service } = createService();

    for (const path of ['../secrets', '/absolute', 'a\\b', '']) {
      await expect(
        service.getPresignedGetUrl({ bucket: 'private', path }),
      ).rejects.toThrow(BadRequestException);
    }

    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});
