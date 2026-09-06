import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

export type ExtractedMediaMetadata = {
  readonly mimeType: string;
  readonly bytes: number;
  readonly kind: 'image' | 'video';
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number | null;
  readonly codec: string;
  readonly aspectRatio: number;
};

export type ExtractMediaMetadataInput = {
  readonly body: Buffer;
  readonly mimeType: string;
};

type IsoBox = {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly headerSize: number;
};

const ISO_CONTAINER_BOXES = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'dinf',
  'udta',
]);

/**
 * Reads intrinsic media properties before capability validation (M2).
 *
 * Metadata extraction deliberately has no fallback values: a missing dimension,
 * duration, or codec would turn provider validation into a guess. ISO BMFF is
 * parsed directly because the deployed API has no metadata-reader dependency;
 * the parser only reads container atoms and never executes a media binary.
 */
@Injectable()
export class MediaMetadataService {
  async extract(
    input: ExtractMediaMetadataInput,
  ): Promise<ExtractedMediaMetadata> {
    const mimeType = this.normalizeMimeType(input.mimeType);

    if (!Buffer.isBuffer(input.body) || input.body.length === 0) {
      throw new BadRequestException('Media metadata is unreadable.');
    }

    if (mimeType.startsWith('image/')) {
      return this.extractImage(input.body, mimeType);
    }

    if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
      return this.extractIsoVideo(input.body, mimeType);
    }

    throw new BadRequestException('Media metadata is unreadable.');
  }

  private async extractImage(
    body: Buffer,
    mimeType: string,
  ): Promise<ExtractedMediaMetadata> {
    try {
      const metadata = await sharp(body, { failOn: 'error' }).metadata();

      if (!metadata.width || !metadata.height || !metadata.format) {
        throw new Error('Missing image metadata.');
      }

      return {
        mimeType,
        bytes: body.length,
        kind: 'image',
        width: metadata.width,
        height: metadata.height,
        durationSeconds: null,
        codec: metadata.format,
        aspectRatio: metadata.width / metadata.height,
      };
    } catch {
      throw new BadRequestException('Media metadata is unreadable.');
    }
  }

  private extractIsoVideo(
    body: Buffer,
    mimeType: string,
  ): ExtractedMediaMetadata {
    try {
      const root = this.readBoxes(body, 0, body.length);
      if (!root.some((box) => box.type === 'ftyp')) {
        throw new Error('Missing ISO file type box.');
      }

      const moov = root.find((box) => box.type === 'moov');
      if (!moov) {
        throw new Error('Missing movie box.');
      }

      const movie = this.readChildBoxes(body, moov);
      const mvhd = movie.find((box) => box.type === 'mvhd');
      const durationSeconds = mvhd ? this.readMovieDuration(body, mvhd) : null;
      const videoTrack = movie
        .filter((box) => box.type === 'trak')
        .find((track) => this.isVideoTrack(body, track));

      if (!videoTrack || durationSeconds === null || durationSeconds <= 0) {
        throw new Error('Missing video track metadata.');
      }

      const tkhd = this.findDescendant(body, videoTrack, 'tkhd');
      const stsd = this.findDescendant(body, videoTrack, 'stsd');
      if (!tkhd || !stsd) {
        throw new Error('Missing video dimensions or codec.');
      }

      const { width, height } = this.readTrackDimensions(body, tkhd);
      const codec = this.readSampleEntryCodec(body, stsd);
      if (!width || !height || !codec) {
        throw new Error('Incomplete video metadata.');
      }

      return {
        mimeType,
        bytes: body.length,
        kind: 'video',
        width,
        height,
        durationSeconds,
        codec,
        aspectRatio: width / height,
      };
    } catch {
      throw new BadRequestException('Media metadata is unreadable.');
    }
  }

  private normalizeMimeType(mimeType: string): string {
    const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Media metadata is unreadable.');
    }
    return normalized;
  }

  private readBoxes(buffer: Buffer, start: number, end: number): IsoBox[] {
    const boxes: IsoBox[] = [];
    let offset = start;

    while (offset < end) {
      if (end - offset < 8) {
        throw new Error('Truncated ISO box header.');
      }

      const declaredSize = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      let headerSize = 8;
      let size = declaredSize;

      if (declaredSize === 1) {
        if (end - offset < 16) {
          throw new Error('Truncated extended ISO box size.');
        }
        size = Number(buffer.readBigUInt64BE(offset + 8));
        headerSize = 16;
      } else if (declaredSize === 0) {
        size = end - offset;
      }

      if (
        !Number.isSafeInteger(size) ||
        size < headerSize ||
        offset + size > end
      ) {
        throw new Error('Invalid ISO box size.');
      }

      boxes.push({ type, start: offset, end: offset + size, headerSize });
      offset += size;
    }

    return boxes;
  }

  private readChildBoxes(buffer: Buffer, box: IsoBox): IsoBox[] {
    if (!ISO_CONTAINER_BOXES.has(box.type)) {
      return [];
    }
    return this.readBoxes(buffer, box.start + box.headerSize, box.end);
  }

  private findDescendant(
    buffer: Buffer,
    box: IsoBox,
    type: string,
  ): IsoBox | undefined {
    for (const child of this.readChildBoxes(buffer, box)) {
      if (child.type === type) {
        return child;
      }
      const nested = this.findDescendant(buffer, child, type);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  private isVideoTrack(buffer: Buffer, track: IsoBox): boolean {
    const hdlr = this.findDescendant(buffer, track, 'hdlr');
    if (!hdlr || hdlr.end - (hdlr.start + hdlr.headerSize) < 12) {
      return false;
    }
    return (
      buffer.toString(
        'ascii',
        hdlr.start + hdlr.headerSize + 8,
        hdlr.start + hdlr.headerSize + 12,
      ) === 'vide'
    );
  }

  private readMovieDuration(buffer: Buffer, box: IsoBox): number | null {
    const payload = box.start + box.headerSize;
    const version = buffer.readUInt8(payload);

    if (version === 0 && box.end - payload >= 20) {
      const timescale = buffer.readUInt32BE(payload + 12);
      const duration = buffer.readUInt32BE(payload + 16);
      return timescale > 0 ? duration / timescale : null;
    }

    if (version === 1 && box.end - payload >= 32) {
      const timescale = buffer.readUInt32BE(payload + 20);
      const duration = Number(buffer.readBigUInt64BE(payload + 24));
      return timescale > 0 && Number.isSafeInteger(duration)
        ? duration / timescale
        : null;
    }

    return null;
  }

  private readTrackDimensions(
    buffer: Buffer,
    box: IsoBox,
  ): { width: number; height: number } {
    if (box.end - (box.start + box.headerSize) < 8) {
      throw new Error('Truncated track header.');
    }
    return {
      width: buffer.readUInt32BE(box.end - 8) / 65_536,
      height: buffer.readUInt32BE(box.end - 4) / 65_536,
    };
  }

  private readSampleEntryCodec(buffer: Buffer, box: IsoBox): string | null {
    const payload = box.start + box.headerSize;
    if (box.end - payload < 16 || buffer.readUInt32BE(payload + 4) < 1) {
      return null;
    }
    const codec = buffer.toString('ascii', payload + 12, payload + 16);
    return /^[ -~]{4}$/.test(codec) ? codec : null;
  }
}
