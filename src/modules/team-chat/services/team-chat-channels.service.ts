import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { AgencyChatChannel, AgencyChatChannelMember } from '../entities';
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
