import loadEnv from './env';

/**
 * Regression guard for PD1 §A.
 *
 * `files.s3.bucket` used to resolve as
 * `S3_BUCKET ?? OBJECT_STORAGE_BUCKET ?? 'lyra-assets'`. But
 * `OBJECT_STORAGE_BUCKET` names the *contracts* bucket (see
 * `contracts.service.ts`), so with `S3_BUCKET` unset every public asset —
 * contact avatars, bank logos, workspace logos, task covers — was written to
 * `lyra-contracts` while the URLs persisted in the database kept pointing at
 * `/api/assets/...`, which reads `lyra-assets`. Production ran in that state
 * from 2026-06-02 and 94 objects landed in the wrong bucket.
 *
 * The failure was silent: uploads returned 200 and persisted a URL that 404'd
 * only when rendered. These tests exist so the fallback is never reintroduced.
 */
describe('env configuration — object storage buckets', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.S3_BUCKET;
    delete process.env.OBJECT_STORAGE_BUCKET;
    delete process.env.S3_PUBLIC_BASE_URL;
    delete process.env.S3_ENDPOINT;
    delete process.env.OBJECT_STORAGE_ENDPOINT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('never resolves the asset bucket from OBJECT_STORAGE_BUCKET', () => {
    process.env.OBJECT_STORAGE_BUCKET = 'lyra-contracts';

    expect(loadEnv().files.s3.bucket).toBe('lyra-assets');
  });

  it('keeps the asset bucket distinct from the contracts bucket', () => {
    process.env.OBJECT_STORAGE_BUCKET = 'lyra-contracts';

    const { bucket, privateBucket } = loadEnv().files.s3;

    expect(bucket).not.toBe('lyra-contracts');
    expect(privateBucket).not.toBe('lyra-contracts');
    expect(bucket).not.toBe(privateBucket);
  });

  it('honours S3_BUCKET when it is set', () => {
    process.env.S3_BUCKET = 'custom-assets';
    process.env.OBJECT_STORAGE_BUCKET = 'lyra-contracts';

    expect(loadEnv().files.s3.bucket).toBe('custom-assets');
  });

  it('does not leak the contracts bucket into the derived public base URL', () => {
    process.env.OBJECT_STORAGE_BUCKET = 'lyra-contracts';
    process.env.S3_ENDPOINT = 'https://media.example.com';

    expect(loadEnv().files.s3.publicBaseUrl).toBe(
      'https://media.example.com/lyra-assets',
    );
  });

  it('defaults the asset and private buckets when nothing is configured', () => {
    const { bucket, privateBucket } = loadEnv().files.s3;

    expect(bucket).toBe('lyra-assets');
    expect(privateBucket).toBe('lyra-private-assets');
  });
});
