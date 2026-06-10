import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
} from '../entities';
import {
  TeamChatChannelKind,
  TeamChatChannelStatus,
  TeamChatChannelVisibility,
  TeamChatMemberRole,
} from '../enums';
import {
  AddTeamChatChannelMembersDto,
  CreateTeamChatChannelDto,
  FindOrCreateDirectChannelDto,
  ListTeamChatChannelsQueryDto,
  PatchTeamChatChannelDto,
  UpdateChannelMembershipDto,
} from '../dto';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class TeamChatChannelsService {
  constructor(
    @InjectRepository(AgencyChatChannel, AGENCY_CONNECTION)
    private readonly channelsRepository: Repository<AgencyChatChannel>,
    @InjectRepository(AgencyChatChannelMember, AGENCY_CONNECTION)
    private readonly membersRepository: Repository<AgencyChatChannelMember>,
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly messagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyChatAttachment, AGENCY_CONNECTION)
    private readonly attachmentsRepository: Repository<AgencyChatAttachment>,
  ) {}

  async getSummary(context: TeamChatContext) {
    const [channels, unreadMemberships] = await Promise.all([
      this.channelsRepository.count({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          status: TeamChatChannelStatus.ACTIVE,
        },
      }),
      this.membersRepository.count({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId ?? undefined,
        },
      }),
    ]);

    return {
      channels,
      unreadMemberships,
      meetings: 0,
      pendingAiSummaries: 0,
    };
  }

  async list(context: TeamChatContext, query: ListTeamChatChannelsQueryDto) {
    const where: Record<string, unknown> = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      status: TeamChatChannelStatus.ACTIVE,
    };

    if (query.kind) {
      where.kind = query.kind;
    }

    if (query.search) {
      where.name = ILike(`%${query.search}%`);
    }

    return this.channelsRepository.find({
      where,
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
      take: 100,
    });
  }

  async listEnriched(context: TeamChatContext, query: ListTeamChatChannelsQueryDto) {
    const channels = await this.list(context, query);

    return Promise.all(
      channels.map(async (channel) => {
        const [lastMessage, membersCount, unreadCount, channelMembers] = await Promise.all([
          this.messagesRepository.findOne({
            where: {
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              channelId: channel.id,
            },
            order: {
              createdAt: 'DESC',
            },
          }),
          this.membersRepository.count({
            where: {
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              channelId: channel.id,
            },
          }),
          this.countUnreadMessages(context, channel.id),
          channel.kind === TeamChatChannelKind.DIRECT
            ? this.membersRepository.find({
                where: {
                  tenantId: context.tenantId,
                  workspaceId: context.workspaceId,
                  channelId: channel.id,
                },
              })
            : Promise.resolve([]),
        ]);

        const memberUserIds = channelMembers
          .map((member) => member.userId)
          .filter((userId): userId is string => Boolean(userId));
        const directTargetUserId =
          channel.kind === TeamChatChannelKind.DIRECT
            ? memberUserIds.find((userId) => userId !== context.userId) ?? null
            : null;

        return {
          ...channel,
          metadata:
            channel.kind === TeamChatChannelKind.DIRECT
              ? {
                  ...(channel.metadata ?? {}),
                  memberUserIds,
                  ...(directTargetUserId ? { targetUserId: directTargetUserId } : {}),
                }
              : channel.metadata,
          lastMessage,
          membersCount,
          unreadCount,
        };
      }),
    );
  }

  private async countUnreadMessages(context: TeamChatContext, channelId: string) {
    if (!context.userId) {
      return 0;
    }

    const membership = await this.membersRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
        userId: context.userId,
      },
    });

    if (!membership?.lastReadAt) {
      return this.messagesRepository.count({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          channelId,
        },
      });
    }

    return this.messagesRepository
      .createQueryBuilder('message')
      .where('message.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('message.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('message.channel_id = :channelId', { channelId })
      .andWhere('message.created_at > :lastReadAt', {
        lastReadAt: membership.lastReadAt,
      })
      .getCount();
  }

  async create(context: TeamChatContext, dto: CreateTeamChatChannelDto) {
    const channel = this.channelsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      name: dto.name,
      slug: this.slugify(dto.name),
      description: dto.description ?? null,
      kind: dto.kind ?? TeamChatChannelKind.CHANNEL,
      visibility: dto.visibility ?? TeamChatChannelVisibility.PRIVATE,
      status: TeamChatChannelStatus.ACTIVE,
      relatedClientId: dto.relatedClientId ?? null,
      relatedProjectId: dto.relatedProjectId ?? null,
      relatedTaskId: dto.relatedTaskId ?? null,
      createdById: context.userId ?? null,
      metadata: dto.metadata ?? null,
      archivedAt: null,
    });

    const savedChannel = await this.channelsRepository.save(channel);

    if (context.userId) {
      await this.membersRepository.save(
        this.membersRepository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          channelId: savedChannel.id,
          userId: context.userId,
          teamMemberId: null,
          displayName: null,
          role: TeamChatMemberRole.OWNER,
          joinedAt: new Date(),
        }),
      );
    }

    return savedChannel;
  }

  async patch(
    context: TeamChatContext,
    channelId: string,
    dto: PatchTeamChatChannelDto,
  ) {
    const channel = await this.assertChannel(context, channelId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Nome do canal é obrigatório.');
      }
      channel.name = name;
      channel.slug = this.slugify(name);
    }

    if (dto.description !== undefined) {
      channel.description = dto.description?.trim() || null;
    }

    if (dto.visibility !== undefined) {
      channel.visibility = dto.visibility;
    }

    if (dto.status !== undefined) {
      channel.status = dto.status;
      channel.archivedAt =
        dto.status === TeamChatChannelStatus.ARCHIVED ? new Date() : null;
    }

    if (dto.metadata !== undefined) {
      channel.metadata = {
        ...(channel.metadata ?? {}),
        ...dto.metadata,
      };
    }

    return this.channelsRepository.save(channel);
  }

  async remove(context: TeamChatContext, channelId: string) {
    const channel = await this.assertChannel(context, channelId);

    await this.attachmentsRepository
      .createQueryBuilder()
      .delete()
      .where('tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere(
        `message_id IN (
          SELECT id FROM agency_chat_messages
          WHERE tenant_id = :tenantId
            AND workspace_id = :workspaceId
            AND channel_id = :channelId
        )`,
        { channelId },
      )
      .execute();

    await this.messagesRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      channelId,
    });
    await this.membersRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      channelId,
    });
    await this.channelsRepository.delete(channel.id);

    return { ok: true, channelId };
  }

  async addMembers(
    context: TeamChatContext,
    channelId: string,
    dto: AddTeamChatChannelMembersDto,
  ) {
    const channel = await this.assertChannel(context, channelId);

    const results = await Promise.all(
      dto.userIds.map(async (userId) => {
        const existing = await this.membersRepository.findOne({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            channelId: channel.id,
            userId,
          },
        });

        if (existing) return existing;

        return this.membersRepository.save(
          this.membersRepository.create({
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            channelId: channel.id,
            userId,
            teamMemberId: null,
            displayName: null,
            role: TeamChatMemberRole.MEMBER,
            joinedAt: new Date(),
          }),
        );
      }),
    );

    return results;
  }

  async findOrCreateDirect(
    context: TeamChatContext,
    dto: FindOrCreateDirectChannelDto,
  ) {
    if (!context.userId) {
      throw new BadRequestException('Usuário não autenticado.');
    }

    const userIds = [context.userId, dto.targetUserId].sort();

    // Look for existing DM channel between these two users
    const existing = await this.channelsRepository
      .createQueryBuilder('channel')
      .where('channel.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('channel.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('channel.kind = :kind', { kind: TeamChatChannelKind.DIRECT })
      .andWhere('channel.status = :status', { status: TeamChatChannelStatus.ACTIVE })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM agency_chat_channel_members m1
          WHERE m1.channel_id = channel.id AND m1.user_id = :userId1
        )`,
        { userId1: userIds[0] },
      )
      .andWhere(
        `EXISTS (
          SELECT 1 FROM agency_chat_channel_members m2
          WHERE m2.channel_id = channel.id AND m2.user_id = :userId2
        )`,
        { userId2: userIds[1] },
      )
      .getOne();

    if (existing) {
      const [lastMessage, membersCount, unreadCount] = await Promise.all([
        this.messagesRepository.findOne({
          where: { tenantId: context.tenantId, workspaceId: context.workspaceId, channelId: existing.id },
          order: { createdAt: 'DESC' },
        }),
        this.membersRepository.count({
          where: { tenantId: context.tenantId, workspaceId: context.workspaceId, channelId: existing.id },
        }),
        this.countUnreadMessages(context, existing.id),
      ]);

      return { ...existing, lastMessage, membersCount, unreadCount };
    }

    // Create new DM channel
    const channel = await this.channelsRepository.save(
      this.channelsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name: `dm-${userIds[0].slice(0, 8)}-${userIds[1].slice(0, 8)}`,
        slug: `dm-${userIds[0].slice(0, 8)}-${userIds[1].slice(0, 8)}-${Date.now().toString(36)}`,
        kind: TeamChatChannelKind.DIRECT,
        visibility: TeamChatChannelVisibility.PRIVATE,
        status: TeamChatChannelStatus.ACTIVE,
        createdById: context.userId,
        description: null,
        relatedClientId: null,
        relatedProjectId: null,
        relatedTaskId: null,
        metadata: { memberUserIds: userIds, targetUserId: dto.targetUserId },
        archivedAt: null,
      }),
    );

    // Add both users as members
    await this.membersRepository.save([
      this.membersRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId: channel.id,
        userId: context.userId,
        teamMemberId: null,
        displayName: null,
        role: TeamChatMemberRole.OWNER,
        joinedAt: new Date(),
      }),
      this.membersRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId: channel.id,
        userId: dto.targetUserId,
        teamMemberId: null,
        displayName: null,
        role: TeamChatMemberRole.MEMBER,
        joinedAt: new Date(),
      }),
    ]);

    return { ...channel, lastMessage: null, membersCount: 2, unreadCount: 0 };
  }

  async updateMembership(
    context: TeamChatContext,
    channelId: string,
    dto: UpdateChannelMembershipDto,
  ) {
    await this.assertChannel(context, channelId);

    if (!context.userId) {
      throw new BadRequestException('Usuário não autenticado.');
    }

    const member = await this.membersRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
        userId: context.userId,
      },
    });

    if (!member) {
      throw new NotFoundException('Você não é membro deste canal.');
    }

    if (dto.notificationLevel !== undefined) {
      member.notificationLevel = dto.notificationLevel as never;
    }

    if (dto.mutedUntil !== undefined) {
      member.mutedUntil = dto.mutedUntil ? new Date(dto.mutedUntil) : null;
    }

    return this.membersRepository.save(member);
  }

  async leaveChannel(context: TeamChatContext, channelId: string) {
    await this.assertChannel(context, channelId);

    if (!context.userId) {
      throw new BadRequestException('Usuário não autenticado.');
    }

    await this.membersRepository.update(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
        userId: context.userId,
      },
      { leftAt: new Date() },
    );

    return { ok: true, channelId };
  }

  async assertChannel(context: TeamChatContext, channelId: string) {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: channelId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!channel) {
      throw new NotFoundException('Canal não encontrado.');
    }

    return channel;
  }

  private slugify(value: string) {
    const base = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);

    return `${base || 'canal'}-${Date.now().toString(36)}`;
  }
}
