import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AgencyChatAttachment,
  AgencyChatMessage,
  AgencyMeetingRoom,
} from '../entities';
import { CreateTeamChatAttachmentDto } from '../dto';
import {
  inferAttachmentKind,
  validateTeamChatAttachment,
} from './team-chat-media-rules';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

@Injectable()
export class TeamChatAttachmentsService {
  constructor(
    @InjectRepository(AgencyChatAttachment, 'agency')
    private readonly attachmentsRepository: Repository<AgencyChatAttachment>,
    @InjectRepository(AgencyChatMessage, 'agency')
    private readonly messagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyMeetingRoom, 'agency')
    private readonly meetingsRepository: Repository<AgencyMeetingRoom>,
  ) {}

  async create(context: TeamChatContext, dto: CreateTeamChatAttachmentDto) {
    if (!dto.messageId && !dto.meetingRoomId) {
      throw new NotFoundException('Informe uma mensagem ou reunião para vincular o anexo.');
    }

    if (dto.messageId) {
      const message = await this.messagesRepository.findOne({
        where: {
          id: dto.messageId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      if (!message) {
        throw new NotFoundException('Mensagem não encontrada.');
      }
    }

    if (dto.meetingRoomId) {
      const meeting = await this.meetingsRepository.findOne({
        where: {
          id: dto.meetingRoomId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      if (!meeting) {
        throw new NotFoundException('Reunião não encontrada.');
      }
    }

    const sizeBytesNumber = Number(dto.sizeBytes);
    const kind = inferAttachmentKind(dto.mimeType);

    validateTeamChatAttachment({
      kind,
      mimeType: dto.mimeType,
      sizeBytes: sizeBytesNumber,
      fileName: dto.fileName,
      width: dto.width ?? null,
      height: dto.height ?? null,
    });

    const attachment = this.attachmentsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      messageId: dto.messageId ?? null,
      meetingRoomId: dto.meetingRoomId ?? null,
      uploadedById: context.userId ?? null,
      kind,
      fileName: dto.fileName,
      originalFileName: dto.originalFileName ?? dto.fileName,
      mimeType: dto.mimeType,
      sizeBytes: String(sizeBytesNumber),
      storageProvider: 'minio',
      storageKey: dto.storageKey,
      publicUrl: dto.publicUrl ?? null,
      width: dto.width ?? null,
      height: dto.height ?? null,
      durationSeconds: dto.durationSeconds ?? null,
      metadata: {
        validated: true,
      },
    });

    return this.attachmentsRepository.save(attachment);
  }

  async listByMessage(context: TeamChatContext, messageId: string) {
    return this.attachmentsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        messageId,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async listByMeeting(context: TeamChatContext, meetingRoomId: string) {
    return this.attachmentsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }
}
