import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import {
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
import { CreateTeamChatChannelDto, ListTeamChatChannelsQueryDto } from '../dto';

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
        const [lastMessage, membersCount, unreadCount] = await Promise.all([
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
        ]);

        return {
          ...channel,
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
      metadata: null,
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
