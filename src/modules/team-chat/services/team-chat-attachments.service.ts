import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
import { FilesService } from '../../../common/files/files.service';

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
    private readonly filesService: FilesService,
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

  async uploadForMessage(
    context: TeamChatContext,
    messageId: string,
    file: Express.Multer.File,
  ) {
    const message = await this.messagesRepository.findOne({
      where: {
        id: messageId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!message) {
      throw new NotFoundException('Mensagem não encontrada.');
    }

    if (!context.userId || message.senderUserId !== context.userId) {
      throw new ForbiddenException('Você só pode anexar arquivos às suas próprias mensagens.');
    }

    const kind = inferAttachmentKind(file.mimetype);
    validateTeamChatAttachment({
      kind,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      fileName: file.originalname,
      width: null,
      height: null,
    });

    const ext = file.originalname.split('.').pop() ?? 'bin';
    const storagePath = `tenants/${context.tenantId}/workspaces/${context.workspaceId}/team-chat/messages/${messageId}/attachments/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const stored = await this.filesService.uploadRawFile({ file, path: storagePath });

    const attachment = this.attachmentsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      messageId,
      meetingRoomId: null,
      uploadedById: context.userId,
      kind,
      fileName: file.originalname,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: String(file.size),
      storageProvider: 'minio',
      storageKey: stored.path,
      publicUrl: stored.url,
      width: null,
      height: null,
      durationSeconds: null,
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

  async deleteFromMessage(
    context: TeamChatContext,
    messageId: string,
    attachmentId: string,
  ) {
    const attachment = await this.attachmentsRepository.findOne({
      where: {
        id: attachmentId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        messageId,
      },
    });

    if (!attachment) {
      throw new NotFoundException('Anexo não encontrado.');
    }

    if (!context.userId || attachment.uploadedById !== context.userId) {
      throw new ForbiddenException('Você só pode excluir seus próprios anexos.');
    }

    await this.attachmentsRepository.delete(attachment.id);
    return { deleted: true };
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
