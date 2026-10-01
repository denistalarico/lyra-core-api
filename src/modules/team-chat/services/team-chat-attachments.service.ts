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
import { AssetAccessService } from '../../../common/files/asset-access.service';
import { authorizeAttachmentUrl } from './team-chat-attachment-urls';
import { TeamChatChannelsService } from './team-chat-channels.service';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
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
    private readonly assetAccess: AssetAccessService,
    private readonly channelsService: TeamChatChannelsService,
  ) {}

  /**
   * Appends a fresh, viewer-bound grant to the stored `publicUrl` (§25–§28).
   * The column keeps the plain storage path; the grant is added per read.
   */
  private authorizeAttachment(
    attachment: AgencyChatAttachment,
    viewerUserId: string | null | undefined,
  ): AgencyChatAttachment {
    const authorized = authorizeAttachmentUrl(
      this.assetAccess,
      attachment.publicUrl,
      viewerUserId,
    );

    if (authorized === attachment.publicUrl) {
      return attachment;
    }

    // A shallow copy, so the grant never reaches the stored row.
    return { ...attachment, publicUrl: authorized };
  }

  /**
   * Resolves the channel a message belongs to and authorizes the caller against
   * it with the shared primitive. Attachment reads were previously scoped only by
   * tenant/workspace, so an attachment of an inaccessible channel was listable
   * by message id (§16).
   */
  private async assertMessageChannelAccess(
    context: TeamChatContext,
    messageId: string,
    action: string,
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

    // `channel_id` is nullable: a meeting message has no channel. Without a
    // channel there is no membership to evaluate, so this fails closed rather
    // than defaulting to "accessible" — meeting attachments are reached through
    // `listByMeeting`, which the meetings module governs.
    if (!message.channelId) {
      throw new NotFoundException('Mensagem não encontrada.');
    }

    await this.channelsService.assertChannelAccess(
      context,
      message.channelId,
      action,
    );

    return message;
  }

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

    const saved = await this.attachmentsRepository.save(attachment);
    return this.authorizeAttachment(saved, context.userId);
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

    const saved = await this.attachmentsRepository.save(attachment);
    return this.authorizeAttachment(saved, context.userId);
  }

  async listByMessage(context: TeamChatContext, messageId: string) {
    await this.assertMessageChannelAccess(
      context,
      messageId,
      'attachments.list_by_message',
    );

    const attachments = await this.attachmentsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        messageId,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return attachments.map((attachment) =>
      this.authorizeAttachment(attachment, context.userId),
    );
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
    const attachments = await this.attachmentsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return attachments.map((attachment) =>
      this.authorizeAttachment(attachment, context.userId),
    );
  }
}
