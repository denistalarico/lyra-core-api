import { BadRequestException } from '@nestjs/common';
import { ContractAttachmentKind } from './enums';
const formats: Record<
  string,
  { extension: string; matches: (buffer: Buffer) => boolean }
> = {
  'application/pdf': {
    extension: 'pdf',
    matches: (b) => b.subarray(0, 4).toString() === '%PDF',
  },
  'image/png': {
    extension: 'png',
    matches: (b) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  'image/jpeg': {
    extension: 'jpg',
    matches: (b) => b.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  },
  'image/webp': {
    extension: 'webp',
    matches: (b) =>
      b.subarray(0, 4).toString() === 'RIFF' &&
      b.subarray(8, 12).toString() === 'WEBP',
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: 'docx',
    matches: (b) => b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extension: 'xlsx',
    matches: (b) => b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
  },
  'application/msword': {
    extension: 'doc',
    matches: (b) => b.subarray(0, 4).equals(Buffer.from([208, 207, 17, 224])),
  },
};
export function decodeContractUpload(
  dto: { fileBase64: string; mimeType?: string },
  signed: boolean,
  kind = ContractAttachmentKind.ContractPdf,
) {
  const mimeType = dto.mimeType ?? 'application/pdf',
    format = formats[mimeType];
  const allowed = signed
    ? [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ]
    : kind === ContractAttachmentKind.ContractPdf
      ? ['application/pdf']
      : Object.keys(formats).filter((mime) => mime !== 'application/msword');
  if (!format || !allowed.includes(mimeType))
    throw new BadRequestException('Unsupported contract upload MIME type');
  const encoded = dto.fileBase64.includes(',')
    ? dto.fileBase64.slice(dto.fileBase64.indexOf(',') + 1)
    : dto.fileBase64;
  if (
    !encoded ||
    encoded.length > Math.ceil((7 * 1024 * 1024) / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length % 4 === 1
  )
    throw new BadRequestException(
      'Invalid fileBase64 payload or file too large (7 MB maximum)',
    );
  const buffer = Buffer.from(encoded, 'base64');
  if (
    !buffer.length ||
    buffer.length > 7 * 1024 * 1024 ||
    !format.matches(buffer)
  )
    throw new BadRequestException(
      'Invalid file signature or file too large (7 MB maximum)',
    );
  return { buffer, mimeType, extension: format.extension };
}
