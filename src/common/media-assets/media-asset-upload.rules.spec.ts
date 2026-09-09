import { BadRequestException } from '@nestjs/common';
import {
  assertMediaAssetSize,
  buildMediaAssetObjectKey,
  detectMediaAssetMimeType,
  MEDIA_ASSET_MAX_UPLOAD_BYTES,
  resolveMediaAssetContentType,
  sanitizeMediaAssetFilename,
} from './media-asset-upload.rules';

/** Minimal byte headers, long enough for each sniffer branch to reach its check. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.concat([
  Buffer.from([0x89]),
  Buffer.from('PNG\r\n\x1a\n', 'latin1'),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'latin1'),
]);
const GIF = Buffer.from('GIF89a', 'latin1');
const BMP = Buffer.from('BM\x00\x00', 'latin1');
const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);

function isoContainer(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(brand, 'latin1'),
  ]);
}

const MP4 = isoContainer('isom');
const MOV = isoContainer('qt  ');
const PDF = Buffer.from('%PDF-1.7', 'latin1');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');

describe('media asset upload rules', () => {
  describe('detectMediaAssetMimeType', () => {
    it.each([
      [JPEG, 'image/jpeg'],
      [PNG, 'image/png'],
      [WEBP, 'image/webp'],
      [GIF, 'image/gif'],
      [BMP, 'image/bmp'],
      [TIFF_LE, 'image/tiff'],
      [TIFF_BE, 'image/tiff'],
      [MP4, 'video/mp4'],
      [MOV, 'video/quicktime'],
    ])('recognizes %#', (buffer, expected) => {
      expect(detectMediaAssetMimeType(buffer)).toBe(expected);
    });

    it('does not recognize a PDF, which no placement can publish', () => {
      expect(detectMediaAssetMimeType(PDF)).toBeNull();
    });

    it('does not recognize an SVG, which has no magic bytes to check', () => {
      expect(detectMediaAssetMimeType(SVG)).toBeNull();
    });

    it('does not read a video container without an ftyp box', () => {
      expect(detectMediaAssetMimeType(Buffer.alloc(32))).toBeNull();
    });
  });

  describe('resolveMediaAssetContentType', () => {
    it('trusts the bytes over a lying declared type', () => {
      // A PNG renamed and re-declared as MP4 is still stored as a PNG, and is
      // therefore validated against image rules at schedule time.
      expect(resolveMediaAssetContentType(PNG, 'video/mp4')).toBe('image/png');
    });

    it('refuses SVG by name before the sniffer is even consulted', () => {
      expect(() => resolveMediaAssetContentType(PNG, 'image/svg+xml')).toThrow(
        BadRequestException,
      );
    });

    it('refuses an SVG that claims to be a PNG', () => {
      expect(() => resolveMediaAssetContentType(SVG, 'image/png')).toThrow(
        BadRequestException,
      );
    });

    it('refuses a PDF regardless of what it claims to be', () => {
      expect(() => resolveMediaAssetContentType(PDF, 'image/jpeg')).toThrow(
        BadRequestException,
      );
    });

    it('accepts a valid file with no declared type at all', () => {
      expect(resolveMediaAssetContentType(MP4, undefined)).toBe('video/mp4');
    });

    it('ignores charset parameters on the declared type', () => {
      expect(resolveMediaAssetContentType(JPEG, 'image/jpeg; charset=binary')).toBe(
        'image/jpeg',
      );
    });
  });

  describe('assertMediaAssetSize', () => {
    it('refuses an empty file', () => {
      expect(() => assertMediaAssetSize(0)).toThrow(BadRequestException);
    });

    it('accepts a file exactly at the ceiling', () => {
      expect(() =>
        assertMediaAssetSize(MEDIA_ASSET_MAX_UPLOAD_BYTES),
      ).not.toThrow();
    });

    it('refuses a file one byte over the ceiling', () => {
      expect(() =>
        assertMediaAssetSize(MEDIA_ASSET_MAX_UPLOAD_BYTES + 1),
      ).toThrow(BadRequestException);
    });
  });

  describe('sanitizeMediaAssetFilename', () => {
    it('strips directory components', () => {
      expect(sanitizeMediaAssetFilename('../../etc/passwd')).toBe('passwd');
      expect(sanitizeMediaAssetFilename('C:\\Users\\x\\foto.jpg')).toBe(
        'foto.jpg',
      );
    });

    it('neutralizes markup so a name cannot travel intact into a UI', () => {
      expect(sanitizeMediaAssetFilename('<script>x</script>.png')).not.toContain(
        '<',
      );
    });

    it('falls back to a placeholder for an unusable name', () => {
      expect(sanitizeMediaAssetFilename('...')).toBe('arquivo');
      expect(sanitizeMediaAssetFilename('')).toBe('arquivo');
    });

    it('caps the stored length', () => {
      expect(sanitizeMediaAssetFilename('a'.repeat(500))).toHaveLength(200);
    });
  });

  describe('buildMediaAssetObjectKey', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    it('never lets any part of the user filename into the key', () => {
      const { objectKey } = buildMediaAssetObjectKey({
        tenantId,
        agencyClientId: null,
        assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        contentType: 'image/png',
      });

      expect(objectKey).toBe(
        `media-assets/${tenantId}/agency/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`,
      );
    });

    it('separates a managed client from the agency in the path', () => {
      const clientId = '33333333-3333-4333-8333-333333333333';
      const { objectKey } = buildMediaAssetObjectKey({
        tenantId,
        agencyClientId: clientId,
        assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        contentType: 'video/mp4',
      });

      expect(objectKey).toBe(
        `media-assets/${tenantId}/clients/${clientId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4`,
      );
    });

    it('mints a fresh id when none is supplied, so two uploads never collide', () => {
      const first = buildMediaAssetObjectKey({
        tenantId,
        agencyClientId: null,
        contentType: 'image/jpeg',
      });
      const second = buildMediaAssetObjectKey({
        tenantId,
        agencyClientId: null,
        contentType: 'image/jpeg',
      });

      expect(first.assetId).not.toBe(second.assetId);
      expect(first.objectKey).not.toBe(second.objectKey);
    });
  });
});
