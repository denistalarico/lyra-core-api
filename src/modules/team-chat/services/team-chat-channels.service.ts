import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
} from '../entities';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import {
  ChannelAccessDenialReason,
  evaluateChannelAccess,
  isElevatedRole,
} from './team-chat-access';
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
import { TeamChatNotificationPublisher } from './team-chat-notification.publisher';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class TeamChatChannelsService {
  private readonly logger = new Logger(TeamChatChannelsService.name);

  constructor(
    @InjectRepository(AgencyChatChannel, AGENCY_CONNECTION)
    private readonly channelsRepository: Repository<AgencyChatChannel>,
    @InjectRepository(AgencyChatChannelMember, AGENCY_CONNECTION)
    private readonly membersRepository: Repository<AgencyChatChannelMember>,
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly messagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyChatAttachment, AGENCY_CONNECTION)
    private readonly attachmentsRepository: Repository<AgencyChatAttachment>,
    @InjectRepository(WorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepository: Repository<WorkspaceUserEntity>,
    private readonly teamChatNotificationPublisher: TeamChatNotificationPublisher,
  ) {}

  async getSummary(context: TeamChatContext) {
    const channelsQuery = this.channelsRepository
      .createQueryBuilder('channel')
      .where('channel.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('channel.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('channel.status = :status', {
        status: TeamChatChannelStatus.ACTIVE,
      });

    this.applyCollectionScope(channelsQuery, context);

    const [channels, unreadMemberships] = await Promise.all([
      channelsQuery.getCount(),
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
    const qb = this.channelsRepository
      .createQueryBuilder('channel')
      .where('channel.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('channel.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('channel.status = :status', {
        status: TeamChatChannelStatus.ACTIVE,
      });

    if (query.kind) {
      qb.andWhere('channel.kind = :kind', { kind: query.kind });
    }

    if (query.search) {
      qb.andWhere('channel.name ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    this.applyCollectionScope(qb, context);

    return qb
      .orderBy('channel.updated_at', 'DESC')
      .addOrderBy('channel.created_at', 'DESC')
      .take(100)
      .getMany();
  }

  private applyCollectionScope(
    qb: ReturnType<Repository<AgencyChatChannel>['createQueryBuilder']>,
    context: TeamChatContext,
  ) {
    if (isElevatedRole(context.role)) {
      return;
    }

    if (!context.userId) {
      qb.andWhere('1 = 0');
      return;
    }

    // TODO(permissions-sprint-9): expand manager department/client channel
    // visibility when channel ownership metadata can be tied to departments.
    qb.andWhere(
      `EXISTS (
        SELECT 1
        FROM agency_chat_channel_members member_scope
        WHERE member_scope.tenant_id = channel.tenant_id
          AND member_scope.workspace_id = channel.workspace_id
          AND member_scope.channel_id = channel.id
          AND member_scope.user_id = :scopeUserId
          AND member_scope.left_at IS NULL
      )`,
      { scopeUserId: context.userId },
    );
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

    if (!membership) {
      return 0;
    }

    /**
     * Unread is a watermark, and the watermark is `last_read_at` falling back
     * to `joined_at` (§29/§30).
     *
     * Before CCOM0.5 a member with `last_read_at = null` — every member who had
     * never opened the channel, including one just invited — counted the
     * channel's entire history as unread. Falling back to `joined_at` makes the
     * contract "unread = messages since you joined that you have not read".
     * Rows predating the join are history, not news.
     *
     * A member with neither timestamp (legacy rows) counts nothing rather than
     * everything: the badge may under-report for those rows, which is the safe
     * direction for a counter.
     */
    const watermark = membership.lastReadAt ?? membership.joinedAt;

    if (!watermark) {
      return 0;
    }

    return this.messagesRepository
      .createQueryBuilder('message')
      .where('message.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('message.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('message.channel_id = :channelId', { channelId })
      .andWhere('message.created_at > :watermark', { watermark })
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
      const joinedAt = new Date();
      await this.membersRepository.save(
        this.membersRepository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          channelId: savedChannel.id,
          userId: context.userId,
          teamMemberId: null,
          displayName: null,
          role: TeamChatMemberRole.OWNER,
          joinedAt,
          lastReadAt: joinedAt,
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
    const channel = await this.assertChannelAccess(
      context,
      channelId,
      'channel.patch',
    );

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
    const channel = await this.assertChannelAccess(
      context,
      channelId,
      'channel.remove',
    );

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
    const channel = await this.assertChannelAccess(
      context,
      channelId,
      'channel.add_members',
    );
    const createdMembers: AgencyChatChannelMember[] = [];

    // Before CCOM0.5 any UUID at all became a channel member. Only active users
    // of the authenticated workspace may be added now (§22); anything else —
    // a random UUID, a user of another workspace, or a Client Area-only
    // identity — is rejected rather than silently mixed into the channel.
    const eligibleUserIds = await this.resolveActiveWorkspaceUserIds(
      context,
      dto.userIds,
    );
    const rejectedUserIds = dto.userIds.filter(
      (userId) => !eligibleUserIds.has(userId),
    );

    if (rejectedUserIds.length > 0) {
      this.logger.warn(
        `Team Chat add_members rejected ${rejectedUserIds.length} ineligible ` +
          `identity(ies): channelId=${channelId} ` +
          `actorUserId=${context.userId ?? 'anonymous'} ` +
          `tenantId=${context.tenantId} workspaceId=${context.workspaceId}`,
      );
      throw new BadRequestException(
        'Um ou mais usuários não pertencem a este workspace.',
      );
    }

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

        const joinedAt = new Date();
        const savedMember = await this.membersRepository.save(
          this.membersRepository.create({
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            channelId: channel.id,
            userId,
            teamMemberId: null,
            displayName: null,
            role: TeamChatMemberRole.MEMBER,
            joinedAt,
            // Watermark starts at join time so history predating the member
            // does not arrive as unread (§29).
            lastReadAt: joinedAt,
          }),
        );
        createdMembers.push(savedMember);
        return savedMember;
      }),
    );

    await Promise.all(
      createdMembers.map((member) =>
          this.teamChatNotificationPublisher.publishChannelInvited({
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            channel,
            actorUserId: context.userId ?? null,
            occurredAt: member.createdAt,
            invitedUserId: member.userId,
            memberId: member.id,
          }),
      ),
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

    // A DM target is an identity like any other: it must be an active user of
    // this workspace, not merely a well-formed UUID (§22).
    const eligibleTargets = await this.resolveActiveWorkspaceUserIds(context, [
      dto.targetUserId,
    ]);

    if (!eligibleTargets.has(dto.targetUserId)) {
      this.logger.warn(
        `Team Chat direct channel rejected ineligible target: ` +
          `actorUserId=${context.userId} tenantId=${context.tenantId} ` +
          `workspaceId=${context.workspaceId}`,
      );
      throw new BadRequestException(
        'Usuário de destino não pertence a este workspace.',
      );
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
    const directJoinedAt = new Date();
    await this.membersRepository.save([
      this.membersRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId: channel.id,
        userId: context.userId,
        teamMemberId: null,
        displayName: null,
        role: TeamChatMemberRole.OWNER,
        joinedAt: directJoinedAt,
        lastReadAt: directJoinedAt,
      }),
      this.membersRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId: channel.id,
        userId: dto.targetUserId,
        teamMemberId: null,
        displayName: null,
        role: TeamChatMemberRole.MEMBER,
        joinedAt: directJoinedAt,
        lastReadAt: directJoinedAt,
      }),
    ]);

    return { ...channel, lastMessage: null, membersCount: 2, unreadCount: 0 };
  }

  async updateMembership(
    context: TeamChatContext,
    channelId: string,
    dto: UpdateChannelMembershipDto,
  ) {
    await this.assertChannelAccess(context, channelId, 'channel.update_membership');

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
    await this.assertChannelAccess(context, channelId, 'channel.leave');

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

  /**
   * The single authorization gate for any operation on one known channel.
   *
   * Replaces the former `assertChannel()`, which checked only
   * `id + tenant_id + workspace_id` and so let any authenticated user of the
   * workspace read and write any private channel by UUID (CCOM0 §2, §8).
   *
   * Fails closed as 404, never 403: a user who cannot access a channel must not
   * learn whether it exists. `getMessage()` inherits the same property.
   */
  async assertChannelAccess(
    context: TeamChatContext,
    channelId: string,
    action: string,
  ) {
    const channel = await this.channelsRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Canal não encontrado.');
    }

    const membership = context.userId
      ? await this.membersRepository.findOne({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            channelId,
            userId: context.userId,
          },
        })
      : null;

    const decision = evaluateChannelAccess(context, channel, membership);

    if (!decision.allowed) {
      this.logChannelDenial(context, channelId, action, decision.reason);
      throw new NotFoundException('Canal não encontrado.');
    }

    return channel;
  }

  /**
   * Security denials are logged with the authenticated actor, never with the
   * token or any payload-supplied identity (CCOM0.5 §41).
   */
  private logChannelDenial(
    context: TeamChatContext,
    channelId: string,
    action: string,
    reason: ChannelAccessDenialReason,
  ) {
    this.logger.warn(
      `Team Chat access denied: action=${action} reason=${reason} ` +
        `channelId=${channelId} userId=${context.userId ?? 'anonymous'} ` +
        `tenantId=${context.tenantId} workspaceId=${context.workspaceId}`,
    );
  }

  /**
   * Resolves which of `userIds` are real, active members of the authenticated
   * workspace.
   *
   * `workspace_users` is the agency's membership table, so a Client Area-only
   * identity — which lives in `user_security_settings` and has no row here —
   * can never be returned. That is the §22/§37 rule enforced by construction
   * rather than by a surface check.
   */
  async resolveActiveWorkspaceUserIds(
    context: TeamChatContext,
    userIds: string[],
  ): Promise<Set<string>> {
    const candidates = Array.from(
      new Set(userIds.filter((userId) => Boolean(userId))),
    );

    if (candidates.length === 0) {
      return new Set<string>();
    }

    const rows = await this.workspaceUsersRepository
      .createQueryBuilder('workspace_user')
      .select('workspace_user.user_id', 'userId')
      .where('workspace_user.tenant_id = :tenantId', {
        tenantId: context.tenantId,
      })
      .andWhere('workspace_user.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('workspace_user.status = :status', { status: 'active' })
      .andWhere('workspace_user.user_id IN (:...candidates)', { candidates })
      .getRawMany<{ userId: string | null }>();

    return new Set(
      rows
        .map((row) => row.userId)
        .filter((userId): userId is string => Boolean(userId)),
    );
  }

  /** Active participants of a channel, used to scope mentions (§21). */
  async getActiveParticipantUserIds(
    context: TeamChatContext,
    channelId: string,
  ): Promise<Set<string>> {
    const members = await this.membersRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
      },
    });

    return new Set(
      members
        .filter((member) => member.leftAt === null)
        .map((member) => member.userId)
        .filter((userId): userId is string => Boolean(userId)),
    );
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
