import { BadRequestException } from '@nestjs/common';

import { TeamChatAttachmentKind } from '../enums';

export const TEAM_CHAT_MEDIA_LIMITS = {
  audio: {
    maxBytes: 25 * 1024 * 1024,
    mimeTypes: ['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/x-wav'],
    extensions: ['webm', 'mp3', 'm4a', 'wav'],
  },
  image: {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
    maxWidth: 4096,
    maxHeight: 4096,
  },
  video: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    extensions: ['mp4', 'webm', 'mov'],
    maxWidth: 1920,
    maxHeight: 1080,
  },
  document: {
    maxBytes: 25 * 1024 * 1024,
    mimeTypes: [
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    extensions: ['pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
  },
} as const;

export function inferAttachmentKind(mimeType: string): TeamChatAttachmentKind {
  if (mimeType.startsWith('image/')) return TeamChatAttachmentKind.IMAGE;
  if (mimeType.startsWith('video/')) return TeamChatAttachmentKind.VIDEO;
  if (mimeType.startsWith('audio/')) return TeamChatAttachmentKind.AUDIO;
  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('pdf') ||
    mimeType.includes('word') ||
    mimeType.includes('excel') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('presentation')
  ) {
    return TeamChatAttachmentKind.DOCUMENT;
  }

  return TeamChatAttachmentKind.OTHER;
}

export function validateTeamChatAttachment(input: {
  kind: TeamChatAttachmentKind;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  width?: number | null;
  height?: number | null;
}) {
  const extension = input.fileName.split('.').pop()?.toLowerCase() ?? '';

  if (input.kind === TeamChatAttachmentKind.OTHER) {
    throw new BadRequestException('Tipo de arquivo não permitido.');
  }

  const rules = getRules(input.kind);

  if (!rules.mimeTypes.includes(input.mimeType as never)) {
    throw new BadRequestException(`MIME type não permitido: ${input.mimeType}`);
  }

  if (!rules.extensions.includes(extension as never)) {
    throw new BadRequestException(`Extensão de arquivo não permitida: ${extension}`);
  }

  if (input.sizeBytes > rules.maxBytes) {
    throw new BadRequestException(
      `Arquivo excede o limite permitido para ${input.kind}.`,
    );
  }

  if (
    input.kind === TeamChatAttachmentKind.IMAGE ||
    input.kind === TeamChatAttachmentKind.VIDEO
  ) {
    if (input.width && 'maxWidth' in rules && input.width > rules.maxWidth) {
      throw new BadRequestException(`Largura excede o limite permitido.`);
    }

    if (input.height && 'maxHeight' in rules && input.height > rules.maxHeight) {
      throw new BadRequestException(`Altura excede o limite permitido.`);
    }
  }
}

function getRules(kind: TeamChatAttachmentKind) {
  switch (kind) {
    case TeamChatAttachmentKind.AUDIO:
      return TEAM_CHAT_MEDIA_LIMITS.audio;
    case TeamChatAttachmentKind.IMAGE:
      return TEAM_CHAT_MEDIA_LIMITS.image;
    case TeamChatAttachmentKind.VIDEO:
      return TEAM_CHAT_MEDIA_LIMITS.video;
    case TeamChatAttachmentKind.DOCUMENT:
      return TEAM_CHAT_MEDIA_LIMITS.document;
    default:
      throw new BadRequestException('Tipo de arquivo não permitido.');
  }
}
