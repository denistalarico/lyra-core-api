import { randomUUID } from 'crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AgencyMeetingAiSummary,
  AgencyMeetingParticipant,
  AgencyMeetingEvent,
  AgencyMeetingRoom,
} from '../entities';
import {
  TeamChatAiSummaryStatus,
  TeamChatMeetingAccessMode,
  TeamChatMeetingProvider,
  TeamChatMeetingParticipantRole,
  TeamChatMeetingParticipantStatus,
  TeamChatMeetingStatus,
} from '../enums';
import {
  CreateTeamChatMeetingDto,
  CreateTeamChatMeetingEventDto,
  JoinPublicTeamChatMeetingDto,
  JoinTeamChatMeetingDto,
  PatchTeamChatMeetingDto,
  RequestTeamChatMeetingAiSummaryDto,
} from '../dto';
import { TeamChatLiveKitProviderService } from './team-chat-livekit-provider.service';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class TeamChatMeetingsService {
  constructor(
    @InjectRepository(AgencyMeetingRoom, AGENCY_CONNECTION)
    private readonly meetingsRepository: Repository<AgencyMeetingRoom>,
    @InjectRepository(AgencyMeetingAiSummary, AGENCY_CONNECTION)
    private readonly summariesRepository: Repository<AgencyMeetingAiSummary>,
    @InjectRepository(AgencyMeetingParticipant, AGENCY_CONNECTION)
    private readonly participantsRepository: Repository<AgencyMeetingParticipant>,
    @InjectRepository(AgencyMeetingEvent, AGENCY_CONNECTION)
    private readonly eventsRepository: Repository<AgencyMeetingEvent>,
    private readonly livekitProvider: TeamChatLiveKitProviderService,
  ) {}

  async list(context: TeamChatContext) {
    return this.meetingsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      order: {
        createdAt: 'DESC',
      },
      take: 100,
    });
  }

  async create(context: TeamChatContext, dto: CreateTeamChatMeetingDto) {
    const publicSlug = this.createPublicSlug();

    const meeting = await this.meetingsRepository.save(
      this.meetingsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        title: dto.title,
        description: dto.description ?? null,
        status: TeamChatMeetingStatus.SCHEDULED,
        accessMode: dto.accessMode ?? TeamChatMeetingAccessMode.PUBLIC_LINK,
        provider: TeamChatMeetingProvider.LIVEKIT,
        providerRoomName: `agency-${context.workspaceId}-${publicSlug}`,
        publicSlug,
        channelId: dto.channelId ?? null,
        relatedClientId: dto.relatedClientId ?? null,
        relatedProjectId: dto.relatedProjectId ?? null,
        relatedTaskId: dto.relatedTaskId ?? null,
        hostUserId: context.userId ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        startedAt: null,
        endedAt: null,
        recordingEnabled: dto.recordingEnabled ?? false,
        transcriptionEnabled: dto.transcriptionEnabled ?? false,
        aiSummaryEnabled: dto.aiSummaryEnabled ?? true,
        metadata: null,
      }),
    );

    if (meeting.aiSummaryEnabled) {
      await this.summariesRepository.save(
        this.summariesRepository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          meetingRoomId: meeting.id,
          status: TeamChatAiSummaryStatus.PENDING,
          requestedById: context.userId ?? null,
        }),
      );
    }

    return meeting;
  }

  async get(context: TeamChatContext, meetingId: string) {
    const meeting = await this.meetingsRepository.findOne({
      where: {
        id: meetingId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!meeting) {
      throw new NotFoundException('Reunião não encontrada.');
    }

    const aiSummary = await this.summariesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meeting.id,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      ...meeting,
      aiSummary,
      publicUrl: `/meet/${meeting.publicSlug}`,
    };
  }

  async startMeeting(context: TeamChatContext, meetingId: string) {
    const meeting = await this.findMeeting(context, meetingId);
    const now = new Date();

    meeting.status = TeamChatMeetingStatus.LIVE;
    meeting.startedAt = meeting.startedAt ?? now;

    const savedMeeting = await this.meetingsRepository.save(meeting);

    await this.createEvent(context, meeting.id, {
      type: 'meeting_started',
      payload: {
        startedById: context.userId ?? null,
      },
    });

    return savedMeeting;
  }

  async endMeeting(context: TeamChatContext, meetingId: string) {
    const meeting = await this.findMeeting(context, meetingId);
    const now = new Date();

    meeting.status = TeamChatMeetingStatus.ENDED;
    meeting.endedAt = now;

    const savedMeeting = await this.meetingsRepository.save(meeting);

    await this.createEvent(context, meeting.id, {
      type: 'meeting_ended',
      payload: {
        endedById: context.userId ?? null,
      },
    });

    return savedMeeting;
  }

  async patchMeeting(
    context: TeamChatContext,
    meetingId: string,
    dto: PatchTeamChatMeetingDto,
  ) {
    const meeting = await this.findMeeting(context, meetingId);

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) {
        throw new BadRequestException('Título da reunião é obrigatório.');
      }
      meeting.title = title;
    }

    if (dto.description !== undefined) {
      meeting.description = dto.description?.trim() || null;
    }

    if (dto.startsAt !== undefined) {
      meeting.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
      if (meeting.status === TeamChatMeetingStatus.CANCELED) {
        meeting.status = TeamChatMeetingStatus.SCHEDULED;
        meeting.endedAt = null;
      }
    }

    const savedMeeting = await this.meetingsRepository.save(meeting);

    await this.createEvent(context, meeting.id, {
      type: 'meeting_updated',
      payload: {
        updatedById: context.userId ?? null,
        fields: Object.keys(dto),
      },
    });

    return savedMeeting;
  }

  async cancelMeeting(context: TeamChatContext, meetingId: string) {
    const meeting = await this.findMeeting(context, meetingId);

    meeting.status = TeamChatMeetingStatus.CANCELED;
    meeting.endedAt = meeting.endedAt ?? new Date();

    const savedMeeting = await this.meetingsRepository.save(meeting);

    await this.createEvent(context, meeting.id, {
      type: 'meeting_canceled',
      payload: {
        canceledById: context.userId ?? null,
      },
    });

    return savedMeeting;
  }

  async deleteMeeting(context: TeamChatContext, meetingId: string) {
    await this.findMeeting(context, meetingId);

    await this.summariesRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      meetingRoomId: meetingId,
    });
    await this.eventsRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      meetingRoomId: meetingId,
    });
    await this.participantsRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      meetingRoomId: meetingId,
    });
    await this.meetingsRepository.delete({
      id: meetingId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    });

    return { ok: true };
  }

  async listEvents(context: TeamChatContext, meetingId: string) {
    await this.findMeeting(context, meetingId);

    return this.eventsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meetingId,
      },
      order: {
        occurredAt: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  async createEvent(
    context: TeamChatContext,
    meetingId: string,
    dto: CreateTeamChatMeetingEventDto,
  ) {
    await this.findMeeting(context, meetingId);

    return this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meetingId,
        participantId: null,
        type: dto.type,
        payload: dto.payload ?? null,
        occurredAt: new Date(),
      }),
    );
  }

  async requestAiSummary(
    context: TeamChatContext,
    meetingId: string,
    dto: RequestTeamChatMeetingAiSummaryDto,
  ) {
    const meeting = await this.findMeeting(context, meetingId);

    let summary = await this.summariesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meeting.id,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!summary) {
      summary = this.summariesRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meeting.id,
        status: TeamChatAiSummaryStatus.PENDING,
        requestedById: context.userId ?? null,
      });
    }

    summary.status = TeamChatAiSummaryStatus.PROCESSING;
    summary.model = dto.model ?? summary.model ?? null;
    summary.transcriptRef = dto.transcriptRef ?? summary.transcriptRef ?? null;
    summary.requestedById = context.userId ?? summary.requestedById ?? null;
    summary.errorMessage = null;

    const savedSummary = await this.summariesRepository.save(summary);

    await this.createEvent(context, meeting.id, {
      type: 'ai_summary_requested',
      payload: {
        requestedById: context.userId ?? null,
        summaryId: savedSummary.id,
        model: savedSummary.model,
        transcriptRef: savedSummary.transcriptRef,
      },
    });

    return savedSummary;
  }

  async joinInternal(
    context: TeamChatContext,
    meetingId: string,
    dto: JoinTeamChatMeetingDto,
  ) {
    const meeting = await this.findMeeting(context, meetingId);

    const participantName = dto.displayName || 'Usuário interno';
    const identity = `user:${context.userId ?? randomUUID()}`;

    let participant = await this.participantsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meeting.id,
        userId: context.userId ?? undefined,
      },
    });

    if (participant) {
      participant.status = TeamChatMeetingParticipantStatus.JOINED;
      participant.providerIdentity = participant.providerIdentity ?? identity;
      participant.joinedAt = new Date();
      participant.leftAt = null;
      participant.role =
        meeting.hostUserId && meeting.hostUserId === context.userId
          ? TeamChatMeetingParticipantRole.HOST
          : participant.role;
      participant = await this.participantsRepository.save(participant);
    } else {
      participant = await this.participantsRepository.save(
        this.participantsRepository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          meetingRoomId: meeting.id,
          userId: context.userId ?? null,
          teamMemberId: null,
          guestName: null,
          guestEmail: null,
          role:
            meeting.hostUserId && meeting.hostUserId === context.userId
              ? TeamChatMeetingParticipantRole.HOST
              : TeamChatMeetingParticipantRole.MEMBER,
          status: TeamChatMeetingParticipantStatus.JOINED,
          providerIdentity: identity,
          joinedAt: new Date(),
          leftAt: null,
          metadata: {
            source: 'internal',
          },
        }),
      );
    }

    const token = await this.livekitProvider.createParticipantToken({
      roomName: meeting.providerRoomName ?? meeting.id,
      identity,
      participantName,
      isHost: participant.role === TeamChatMeetingParticipantRole.HOST,
    });

    return {
      meeting,
      participant,
      livekit: token,
    };
  }

  async joinPublic(publicSlug: string, dto: JoinPublicTeamChatMeetingDto) {
    const meeting = await this.meetingsRepository.findOne({
      where: {
        publicSlug,
      },
    });

    if (!meeting) {
      throw new NotFoundException('Reunião pública não encontrada.');
    }

    const identity = `guest:${randomUUID()}`;

    let participant =
      dto.guestEmail
        ? await this.participantsRepository.findOne({
            where: {
              tenantId: meeting.tenantId,
              workspaceId: meeting.workspaceId,
              meetingRoomId: meeting.id,
              guestEmail: dto.guestEmail,
            },
          })
        : null;

    if (participant) {
      participant.status = TeamChatMeetingParticipantStatus.JOINED;
      participant.guestName = dto.guestName;
      participant.providerIdentity = participant.providerIdentity ?? identity;
      participant.joinedAt = new Date();
      participant.leftAt = null;
      participant = await this.participantsRepository.save(participant);
    } else {
      participant = await this.participantsRepository.save(
        this.participantsRepository.create({
          tenantId: meeting.tenantId,
          workspaceId: meeting.workspaceId,
          meetingRoomId: meeting.id,
          userId: null,
          teamMemberId: null,
          guestName: dto.guestName,
          guestEmail: dto.guestEmail ?? null,
          role: TeamChatMeetingParticipantRole.GUEST,
          status: TeamChatMeetingParticipantStatus.JOINED,
          providerIdentity: identity,
          joinedAt: new Date(),
          leftAt: null,
          metadata: {
            source: 'public_link',
          },
        }),
      );
    }

    const token = await this.livekitProvider.createParticipantToken({
      roomName: meeting.providerRoomName ?? meeting.id,
      identity,
      participantName: dto.guestName,
      isHost: false,
    });

    return {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        status: meeting.status,
        publicSlug: meeting.publicSlug,
      },
      participant,
      livekit: token,
    };
  }

  private async findMeeting(context: TeamChatContext, meetingId: string) {
    const meeting = await this.meetingsRepository.findOne({
      where: {
        id: meetingId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!meeting) {
      throw new NotFoundException('Reunião não encontrada.');
    }

    return meeting;
  }

  private createPublicSlug() {
    return randomUUID().replace(/-/g, '').slice(0, 18);
  }
}
