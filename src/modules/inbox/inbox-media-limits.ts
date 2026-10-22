import { BadRequestException } from '@nestjs/common';

type MediaKind = 'image' | 'audio' | 'video' | 'file';

/** IX1: provider limits, enforced before storage and after audio conversion. */
export function assertInboxMediaSize(
  channel: string,
  kind: MediaKind,
  file: Pick<Express.Multer.File, 'size' | 'buffer'>,
): number {
  const mb =
    channel === 'whatsapp'
      ? kind === 'image'
        ? 5
        : kind === 'file'
          ? 100
          : 16
      : channel === 'instagram' && kind === 'image'
        ? 8
        : 25;
  const maxBytes = mb * 1024 * 1024;
  if (Math.max(file.size, file.buffer.length) > maxBytes) {
    const label =
      channel === 'whatsapp'
        ? 'WhatsApp'
        : channel === 'instagram'
          ? 'Instagram'
          : 'Messenger';
    throw new BadRequestException(
      `O arquivo excede o limite de ${mb} MB do ${label}.`,
    );
  }
  return maxBytes;
}
