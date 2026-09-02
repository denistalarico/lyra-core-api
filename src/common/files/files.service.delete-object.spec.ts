// Lyra Social S1.4.9 — `FilesService.deleteObject` (audit gap S-4).
//
// The S3 client is replaced on the instance, so these assertions are about
// the command that would be sent — no bucket, no network, no MinIO. Creating
// the service through the Nest container would build a real S3Client against
// whatever endpoint the environment names, which is exactly what §24 forbids.

import { BadRequestException } from '@nestjs/common';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service';

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
  const send = jest.fn().mockResolvedValue({});

  // Replace the transport and short-circuit bucket readiness: this spec is
  // about the command, not about provisioning a bucket.
  (service as unknown as { client: { send: unknown } }).client = { send };
  (
    service as unknown as { privateBucketReady: Promise<void> }
  ).privateBucketReady = Promise.resolve();

  return { service, send };
}

describe('FilesService.deleteObject', () => {
  it('issues a DeleteObjectCommand against the PRIVATE bucket', async () => {
    const { service, send } = createService();

    await service.deleteObject({
      bucket: 'private',
      path: 'brand-kit/tenant/agency/asset.png',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: 'test-private-assets',
          Key: 'brand-kit/tenant/agency/asset.png',
        },
      }),
    );
  });

  it('refuses any bucket other than the private one', async () => {
    const { service, send } = createService();

    await expect(
      service.deleteObject({
        bucket: 'public' as never,
        path: 'avatars/someone.png',
      }),
    ).rejects.toThrow(BadRequestException);

    // The public bucket backs <img> across two frontends; nothing here may
    // reach it (D-11 item 9).
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a traversal path before any command is sent', async () => {
    const { service, send } = createService();

    for (const path of ['../secrets', '/absolute', 'a\\b', '']) {
      await expect(
        service.deleteObject({ bucket: 'private', path }),
      ).rejects.toThrow(BadRequestException);
    }

    expect(send).not.toHaveBeenCalled();
  });
});
