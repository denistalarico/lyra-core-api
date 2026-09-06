import { Buffer } from 'buffer';

/** Stable binary fixtures: a real PNG and an ISO BMFF header hierarchy. */
export const IMAGE_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WAAAAABJRU5ErkJggg==',
  'base64',
);

function fourCc(value: string): Buffer {
  return Buffer.from(value, 'ascii');
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const content = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(content.length + header.length, 0);
  fourCc(type).copy(header, 4);
  return Buffer.concat([header, content]);
}

/** A one-second 640×360 AVC MP4 metadata fixture. */
export function createVideoFixture(): Buffer {
  const ftyp = box(
    'ftyp',
    Buffer.concat([
      fourCc('isom'),
      Buffer.alloc(4),
      fourCc('isom'),
      fourCc('avc1'),
    ]),
  );
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1_000, 12);
  mvhd.writeUInt32BE(1_000, 16);

  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(640 * 65_536, 76);
  tkhd.writeUInt32BE(360 * 65_536, 80);

  const hdlr = Buffer.alloc(12);
  fourCc('vide').copy(hdlr, 8);
  const stsd = Buffer.alloc(16);
  stsd.writeUInt32BE(1, 4);
  stsd.writeUInt32BE(8, 8);
  fourCc('avc1').copy(stsd, 12);

  const trak = box(
    'trak',
    box('tkhd', tkhd),
    box('mdia', box('hdlr', hdlr), box('minf', box('stbl', box('stsd', stsd)))),
  );

  return Buffer.concat([ftyp, box('moov', box('mvhd', mvhd), trak)]);
}
