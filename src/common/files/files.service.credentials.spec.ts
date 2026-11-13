import { PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import envFactory from '../../config/env';
import { FilesService } from './files.service';

function s3Config(overrides: Record<string, unknown> = {}) {
  return new ConfigService({
    files: {
      s3: {
        endpoint: 'http://127.0.0.1:9000',
        bucket: 'test-assets',
        privateBucket: 'test-private-assets',
        region: 'us-east-1',
        ...overrides,
      },
    },
  });
}

describe('FilesService object storage hardening', () => {
  it('fails fast, without echoing values, when credentials are missing', () => {
    expect(() => new FilesService(s3Config())).toThrow(
      /credentials are not configured/,
    );
    expect(
      () => new FilesService(s3Config({ accessKeyId: 'only-the-id' })),
    ).toThrow(/credentials are not configured/);
    try {
      new FilesService(s3Config({ accessKeyId: 'only-the-id' }));
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('only-the-id');
    }
  });

  it('never applies a public-read bucket policy unless explicitly enabled', async () => {
    const service = new FilesService(
      s3Config({ accessKeyId: 'a', secretAccessKey: 'b' }),
    );
    const send = jest
      .spyOn(
        (service as unknown as { client: { send: () => Promise<unknown> } })
          .client,
        'send',
      )
      .mockResolvedValue({});

    await (
      service as unknown as { resolveBucket: () => Promise<void> }
    ).resolveBucket();

    const commands = send.mock.calls.map((call) => (call as unknown[])[0]);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some((c) => c instanceof PutBucketPolicyCommand)).toBe(
      false,
    );
  });
});

describe('env files.s3 defaults', () => {
  const keys = [
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_ACCESS_KEY',
    'OBJECT_STORAGE_SECRET_KEY',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
    'S3_SET_PUBLIC_READ_POLICY',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('has no credential fallback and keeps public-read opt-in', () => {
    process.env.MINIO_ROOT_USER = 'root-must-not-be-used';
    process.env.MINIO_ROOT_PASSWORD = 'root-must-not-be-used';
    const s3 = (envFactory() as { files: { s3: Record<string, unknown> } })
      .files.s3;
    expect(s3.accessKeyId).toBeUndefined();
    expect(s3.secretAccessKey).toBeUndefined();
    expect(s3.setPublicReadPolicy).toBe(false);
  });

  it('enables public-read only with S3_SET_PUBLIC_READ_POLICY=true', () => {
    process.env.S3_SET_PUBLIC_READ_POLICY = 'true';
    const s3 = (envFactory() as { files: { s3: Record<string, unknown> } })
      .files.s3;
    expect(s3.setPublicReadPolicy).toBe(true);
  });
});
