import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgencyChatChannel, AgencyChatMessage } from '../entities';
import {
  TeamChatChannelStatus,
  TeamChatMessageKind,
  TeamChatMessageStatus,
} from '../enums';
import { TeamChatGateway } from '../gateways/team-chat.gateway';
import type {
  TeamChatCardPostInput,
  TeamChatCardPostResult,
} from '../types/team-chat-card.types';

const AGENCY_CONNECTION = 'agency';

/**
 * Publishes a structured card into a Team Chat channel on behalf of the
 * platform, with no human author.
 *
 * This is the shared path for "a module has something to tell the team": the
 * message is stored like any other, so it is searchable, readable and counted as
 * unread, but it carries `metadata.card` for the rich rendering and a null
 * `senderUserId` so it reads as coming from the agent rather than from whoever
 * happened to configure the automation.
 *
 * Two consequences worth knowing before adopting it elsewhere:
 *  - a message with no `senderUserId` can never be edited or deleted through the
 *    API (`assertOwnMessage` needs an author), only reacted to and pinned;
 *  - delivery is at-most-once per `dedupeKey`, checked before insert. The
 *    callers are already idempotent upstream, so this guards the retry, not a
 *    genuine race between two different publications.
 */
@Injectable()
export class TeamChatCardPostService {
  private readonly logger = new Logger(TeamChatCardPostService.name);

  constructor(
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly messagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyChatChannel, AGENCY_CONNECTION)
    private readonly channelsRepository: Repository<AgencyChatChannel>,
    private readonly gateway: TeamChatGateway,
  ) {}

  async postCard(
    input: TeamChatCardPostInput,
  ): Promise<TeamChatCardPostResult> {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: input.channelId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      },
    });
    // An archived channel is as unusable as a deleted one: the operator picked a
    // destination that no longer receives anything.
    if (!channel || channel.status !== TeamChatChannelStatus.ACTIVE) {
      return { status: 'channel_unavailable' };
    }

    const existing = await this.messagesRepository
      .createQueryBuilder('message')
      .where('message.tenant_id = :tenantId', { tenantId: input.tenantId })
      .andWhere('message.workspace_id = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere("message.metadata ->> 'dedupeKey' = :dedupeKey", {
        dedupeKey: input.dedupeKey,
      })
      .getOne();
    if (existing) {
      return { status: 'duplicate', messageId: existing.id };
    }

    const saved = await this.messagesRepository.save(
      this.messagesRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channelId: channel.id,
        meetingRoomId: null,
        parentMessageId: null,
        senderUserId: null,
        senderTeamMemberId: null,
        externalGuestId: null,
        senderDisplayName: input.sender.displayName,
        kind: TeamChatMessageKind.TEXT,
        status: TeamChatMessageStatus.SENT,
        body: input.body,
        metadata: {
          card: input.card,
          dedupeKey: input.dedupeKey,
          agent: {
            id: input.sender.agentId ?? null,
            name: input.sender.displayName,
            type: input.sender.agentType ?? null,
          },
          source: input.source ?? null,
        },
        deliveredAt: new Date(),
      }),
    );

    try {
      this.gateway.broadcastMessageCreated(
        input.tenantId,
        input.workspaceId,
        channel.id,
        saved,
      );
    } catch (error) {
      // The message is already durable; a missing live push is not a failure of
      // the publication, it only delays when the room sees it.
      this.logger.warn(
        `Team chat card broadcast failed: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    }

    return { status: 'posted', messageId: saved.id };
  }
}
