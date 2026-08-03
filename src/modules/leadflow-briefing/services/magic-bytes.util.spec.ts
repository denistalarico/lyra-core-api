import { assertExpectedKind, detectFileKind } from './magic-bytes.util';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20, 0x20)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
]);

describe('detectFileKind', () => {
  it('detects a real PDF signature', () => {
    expect(detectFileKind(PDF)).toBe('pdf');
  });

  it('detects a real JPEG signature', () => {
    expect(detectFileKind(JPEG)).toBe('jpeg');
  });

  it('detects a real PNG signature', () => {
    expect(detectFileKind(PNG)).toBe('png');
  });

  it('detects a real WEBP signature', () => {
    expect(detectFileKind(WEBP)).toBe('webp');
  });

  it('returns unknown for plain text pretending to be anything', () => {
    expect(detectFileKind(Buffer.from('hello world, this is not a real file'))).toBe('unknown');
  });

  it('returns unknown for an empty buffer', () => {
    expect(detectFileKind(Buffer.alloc(0))).toBe('unknown');
  });

  it('returns unknown for a truncated PDF header', () => {
    expect(detectFileKind(Buffer.from('%PD'))).toBe('unknown');
  });

  it('does not misdetect a PNG-extension file whose bytes are actually a script', () => {
    const fakePng = Buffer.from('<script>alert(1)</script>');
    expect(detectFileKind(fakePng)).toBe('unknown');
  });
});

describe('assertExpectedKind', () => {
  it('returns the kind when it is in the allowed set', () => {
    expect(assertExpectedKind(PDF, new Set(['pdf']))).toBe('pdf');
  });

  it('throws when the detected kind is not allowed', () => {
    expect(() => assertExpectedKind(JPEG, new Set(['pdf']))).toThrow();
  });

  it('throws when the content does not match any known signature', () => {
    expect(() =>
      assertExpectedKind(Buffer.from('not a real file'), new Set(['pdf', 'jpeg', 'png', 'webp'])),
    ).toThrow();
  });
});
