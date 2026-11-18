import { BadRequestException } from '@nestjs/common';
import { createVideoFixture } from '../../modules/social-organic/media/media-metadata.fixtures';
import { MediaMetadataService } from '../../modules/social-organic/media/media-metadata.service';
import {
  assertDirectUploadPartNumbers,
  assertDirectUploadRequest,
  type DirectUploadClaims,
  directUploadPartCount,
  MEDIA_ASSET_DIRECT_UPLOAD_MAX_BYTES,
  normalizeDirectUploadParts,
  readIsoMediaHead,
  signDirectUploadToken,
  verifyDirectUploadToken,
} from './media-asset-direct-upload.rules';

const secret = Buffer.alloc(32, 7);
const claims: DirectUploadClaims = {
  v: 1,
  path: 'r2/media-assets/t/agency/a.mp4',
  uploadId: 'upload-1',
  assetId: 'a',
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  companyContextId: null,
  actorUserId: 'u',
  source: 'planner_upload',
  mimeType: 'video/mp4',
  byteSize: 40 * 1024 * 1024,
  filename: 'video.mp4',
  exp: 2_000,
};

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function rangeReader(file: Buffer) {
  const calls: Array<[number, number]> = [];
  const read = (start: number, end: number) => {
    calls.push([start, end]);
    return Promise.resolve(file.subarray(start, end + 1));
  };
  return { read, calls };
}

describe('direct upload rules', () => {
  it('accepts only MP4/MOV up to 2 GB', () => {
    expect(
      assertDirectUploadRequest({ mimeType: 'video/mp4', byteSize: 10 }),
    ).toBe('video/mp4');
    expect(() =>
      assertDirectUploadRequest({ mimeType: 'image/png', byteSize: 10 }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertDirectUploadRequest({
        mimeType: 'video/mp4',
        byteSize: MEDIA_ASSET_DIRECT_UPLOAD_MAX_BYTES + 1,
      }),
    ).toThrow('O vídeo excede o limite de 2 GB.');
  });

  it('round-trips a token and refuses a tampered or expired one', () => {
    const token = signDirectUploadToken(claims, secret);
    expect(verifyDirectUploadToken(token, secret, 1_000)).toEqual(claims);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims, tenantId: 'other' }),
    ).toString('base64url');
    expect(() =>
      verifyDirectUploadToken(`${forged}.${signature}`, secret, 1_000),
    ).toThrow(BadRequestException);
    expect(() =>
      verifyDirectUploadToken(token, Buffer.alloc(32, 8), 1_000),
    ).toThrow(BadRequestException);
    expect(() => verifyDirectUploadToken(token, secret, 2_000)).toThrow(
      BadRequestException,
    );
    expect(payload.length).toBeGreaterThan(0);
  });

  it('signs only parts inside the upload, without repeats', () => {
    const count = directUploadPartCount(claims.byteSize);
    expect(count).toBe(3);
    expect(() => assertDirectUploadPartNumbers([1, 2, 3], count)).not.toThrow();
    expect(() => assertDirectUploadPartNumbers([4], count)).toThrow(
      BadRequestException,
    );
    expect(() => assertDirectUploadPartNumbers([1, 1], count)).toThrow(
      BadRequestException,
    );
  });

  it('completes only with every part exactly once', () => {
    const parts = [
      { partNumber: 2, etag: '"b"' },
      { partNumber: 1, etag: '"a"' },
      { partNumber: 3, etag: '"c"' },
    ];
    expect(
      normalizeDirectUploadParts(parts, 3).map((p) => p.partNumber),
    ).toEqual([1, 2, 3]);
    expect(() => normalizeDirectUploadParts(parts.slice(0, 2), 3)).toThrow(
      BadRequestException,
    );
  });

  it('reads ftyp + moov by ranges and skips mdat, with moov at the end', async () => {
    const fixture = createVideoFixture();
    const ftypSize = fixture.readUInt32BE(0);
    const ftyp = fixture.subarray(0, ftypSize);
    const moov = fixture.subarray(ftypSize);
    const mdat = box('mdat', Buffer.alloc(2 * 1024 * 1024, 1));
    const file = Buffer.concat([ftyp, mdat, moov]);
    const { read, calls } = rangeReader(file);

    const head = await readIsoMediaHead(read, file.length);

    expect(head.equals(Buffer.concat([ftyp, moov]))).toBe(true);
    const bytesRead = calls.reduce(
      (sum, [start, end]) => sum + (end - start + 1),
      0,
    );
    expect(bytesRead).toBeLessThan(fixture.length + 64);
    const metadata = await new MediaMetadataService().extract({
      body: head,
      mimeType: 'video/mp4',
    });
    expect(metadata).toMatchObject({
      width: 640,
      height: 360,
      durationSeconds: 1,
      codec: 'avc1',
    });
  });

  it('refuses a file without moov', async () => {
    const fixture = createVideoFixture();
    const ftyp = fixture.subarray(0, fixture.readUInt32BE(0));
    const file = Buffer.concat([ftyp, box('mdat', Buffer.alloc(64))]);
    await expect(
      readIsoMediaHead(rangeReader(file).read, file.length),
    ).rejects.toThrow(BadRequestException);
  });
});
