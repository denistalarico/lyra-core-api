import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { EntityManager, Repository } from 'typeorm';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';

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
import { TeamChatNotificationPublisher } from './team-chat-notification.publisher';
import { NotificationInterestReason } from '../../notifications/enums';
import { TeamChatMeetingAiService } from './team-chat-meeting-ai.service';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
};

const AGENCY_CONNECTION = 'agency';

export type AppointmentMeetingBindingInput = {
  appointmentId: string;
  title: string;
  description?: string | null;
  startsAt?: Date | null;
  lifecycleStatus?:
    | 'pending'
    | 'confirmed'
    | 'rescheduled'
    | 'canceled'
    | 'no_show'
    | 'completed';
};

export type AppointmentMeetingBinding = {
  meetingRoomId: string;
  publicUrl: string;
  providerRoomName: string | null;
};

@Injectable()
export class TeamChatMeetingsService {
  private readonly logger = new Logger(TeamChatMeetingsService.name);
  private checkingEmptyRooms = false;

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
    private readonly teamChatNotificationPublisher: TeamChatNotificationPublisher,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profilesRepository: Repository<AgencyUserProfileEntity>,
    @InjectRepository(WorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepository: Repository<WorkspaceUserEntity>,
    @Optional() private readonly meetingAi?: TeamChatMeetingAiService,
  ) {}

  /** Provider presence is authoritative, including guests and closed browsers. */
  @Interval(60_000)
  async endEmptyMeetings(): Promise<void> {
    if (this.checkingEmptyRooms) return;
    this.checkingEmptyRooms = true;
    try {
      const meetings = await this.meetingsRepository.find({
        where: { status: TeamChatMeetingStatus.LIVE },
      });
      if (!meetings.length) return;
      const occupancy = await this.livekitProvider.roomOccupancy(
        meetings.map((meeting) => meeting.providerRoomName ?? meeting.id),
      );
      // A provider outage or missing configuration is not evidence of an empty room.
      if (!occupancy) return;
      for (const meeting of meetings) {
        const context = {
          tenantId: meeting.tenantId,
          workspaceId: meeting.workspaceId,
        };
        const roomName = meeting.providerRoomName ?? meeting.id;
        const emptySince = meeting.metadata?.emptySince;
        if ((occupancy.get(roomName) ?? 0) > 0) {
          if (emptySince) await this.setEmptySince(context, meeting.id, null);
          continue;
        }
        if (
          typeof emptySince !== 'string' ||
          !Number.isFinite(Date.parse(emptySince))
        ) {
          await this.setEmptySince(
            context,
            meeting.id,
            new Date().toISOString(),
          );
          continue;
        }
        if (Date.now() - Date.parse(emptySince) < 15 * 60_000) continue;
        await this.endMeeting(context, meeting.id, emptySince);
      }
    } catch {
      this.logger.warn(
        'Could not reconcile meeting room presence; will retry on the next interval.',
      );
    } finally {
      this.checkingEmptyRooms = false;
    }
  }

  private async setEmptySince(
    context: TeamChatContext,
    meetingId: string,
    value: string | null,
  ) {
    await this.meetingsRepository
      .createQueryBuilder()
      .update(AgencyMeetingRoom)
      .set({
        metadata: () =>
          value === null
            ? "COALESCE(metadata, '{}'::jsonb) - 'emptySince'"
            : "jsonb_set(COALESCE(metadata, '{}'::jsonb), '{emptySince}', to_jsonb(CAST(:emptySince AS text)))",
      })
      .where(
        'id = :id AND tenant_id = :tenantId AND workspace_id = :workspaceId',
        {
          id: meetingId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      )
      .andWhere('status = :status', { status: TeamChatMeetingStatus.LIVE })
      .setParameter('emptySince', value)
      .execute();
  }

  async list(context: TeamChatContext) {
    const rooms = await this.meetingsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      order: {
        createdAt: 'DESC',
      },
      take: 100,
    });
    return this.meetingAi
      ? this.meetingAi.listProjection(context, rooms)
      : rooms;
  }

  async create(context: TeamChatContext, dto: CreateTeamChatMeetingDto) {
    if (this.meetingAi)
      await this.meetingAi.assertMeetingChannel(context, dto.channelId);
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

  /**
   * Creates the native LiveKit room that belongs to one LeadFlow appointment.
   *
   * The caller supplies its EntityManager so the room, appointment and
   * appointment outbox event commit atomically in the Agency datasource.
   */
  async createForAppointment(
    context: TeamChatContext,
    input: AppointmentMeetingBindingInput,
    manager: EntityManager,
  ): Promise<AppointmentMeetingBinding> {
    const publicSlug = this.createPublicSlug();
    const meeting = await manager.getRepository(AgencyMeetingRoom).save(
      manager.getRepository(AgencyMeetingRoom).create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        title: input.title,
        description: input.description?.trim() || null,
        status: TeamChatMeetingStatus.SCHEDULED,
        accessMode: TeamChatMeetingAccessMode.PUBLIC_LINK,
        provider: TeamChatMeetingProvider.LIVEKIT,
        providerRoomName: `agency-${context.workspaceId}-${publicSlug}`,
        publicSlug,
        channelId: null,
        relatedClientId: null,
        relatedProjectId: null,
        relatedTaskId: null,
        hostUserId: context.userId ?? null,
        startsAt: input.startsAt ?? null,
        startedAt: null,
        endedAt: null,
        recordingEnabled: false,
        transcriptionEnabled: false,
        aiSummaryEnabled: true,
        metadata: {
          source: 'leadflow_appointment',
          appointmentId: input.appointmentId,
        },
      }),
    );

    await manager.getRepository(AgencyMeetingAiSummary).save(
      manager.getRepository(AgencyMeetingAiSummary).create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meeting.id,
        status: TeamChatAiSummaryStatus.PENDING,
        requestedById: context.userId ?? null,
      }),
    );

    return {
      meetingRoomId: meeting.id,
      publicUrl: `/meet/${meeting.publicSlug}`,
      providerRoomName: meeting.providerRoomName,
    };
  }

  /** Keeps a previously bound room aligned with its appointment lifecycle. */
  async syncAppointmentBinding(
    context: TeamChatContext,
    meetingRoomId: string,
    input: AppointmentMeetingBindingInput,
    manager: EntityManager,
  ): Promise<AppointmentMeetingBinding> {
    const repository = manager.getRepository(AgencyMeetingRoom);
    const meeting = await repository.findOne({
      where: {
        id: meetingRoomId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    if (!meeting) {
      throw new NotFoundException(
        'Sala vinculada ao agendamento não encontrada.',
      );
    }

    meeting.title = input.title;
    meeting.description = input.description?.trim() || null;
    meeting.startsAt = input.startsAt ?? null;
    meeting.metadata = {
      ...(meeting.metadata ?? {}),
      source: 'leadflow_appointment',
      appointmentId: input.appointmentId,
    };

    if (
      input.lifecycleStatus === 'canceled' ||
      input.lifecycleStatus === 'no_show'
    ) {
      meeting.status = TeamChatMeetingStatus.CANCELED;
      meeting.endedAt = meeting.endedAt ?? new Date();
    } else if (input.lifecycleStatus === 'completed') {
      meeting.status = TeamChatMeetingStatus.ENDED;
      meeting.endedAt = meeting.endedAt ?? new Date();
    } else if (
      meeting.status === TeamChatMeetingStatus.CANCELED &&
      (input.lifecycleStatus === 'pending' ||
        input.lifecycleStatus === 'confirmed' ||
        input.lifecycleStatus === 'rescheduled')
    ) {
      meeting.status = TeamChatMeetingStatus.SCHEDULED;
      meeting.endedAt = null;
    }

    const saved = await repository.save(meeting);
    return {
      meetingRoomId: saved.id,
      publicUrl: `/meet/${saved.publicSlug}`,
      providerRoomName: saved.providerRoomName,
    };
  }

  /** Cancels and releases a room when an appointment stops using native video. */
  async detachAppointmentBinding(
    context: TeamChatContext,
    meetingRoomId: string,
    appointmentId: string,
    manager: EntityManager,
  ): Promise<void> {
    const repository = manager.getRepository(AgencyMeetingRoom);
    const meeting = await repository.findOne({
      where: {
        id: meetingRoomId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    if (!meeting) {
      throw new NotFoundException(
        'Sala vinculada ao agendamento não encontrada.',
      );
    }

    meeting.status = TeamChatMeetingStatus.CANCELED;
    meeting.endedAt = meeting.endedAt ?? new Date();
    meeting.metadata = {
      ...(meeting.metadata ?? {}),
      source: 'leadflow_appointment',
      appointmentId,
      detachedAt: new Date().toISOString(),
    };
    await repository.save(meeting);
  }

  async get(context: TeamChatContext, meetingId: string) {
    if (this.meetingAi) await this.meetingAi.meeting(context, meetingId);
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
      aiSummary: this.meetingAi
        ? await this.meetingAi.detail(context, meetingId)
        : aiSummary,
      publicUrl: `/meet/${meeting.publicSlug}`,
    };
  }

  async startMeeting(context: TeamChatContext, meetingId: string) {
    const meeting = await this.findMeeting(context, meetingId);
    this.assertMeetingOpen(meeting);
    // Use the same conditional transition as joining so a concurrent end
    // cannot be overwritten by a stale meeting snapshot.
    await this.activateJoinedMeeting(context, meeting);
    const savedMeeting = await this.findMeeting(context, meeting.id);

    const event = await this.createEvent(context, meeting.id, {
      type: 'meeting_started',
      payload: {
        startedById: context.userId ?? null,
      },
    });

    const participants = await this.participantsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meeting.id,
      },
    });

    await this.teamChatNotificationPublisher.publishMeetingStarted({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      meeting: savedMeeting,
      eventId: event.id,
      actorUserId: context.userId ?? null,
      occurredAt: event.occurredAt,
      recipients: participants.map((participant) => ({
        userId: participant.userId,
        interestReason: NotificationInterestReason.PARTICIPANT,
      })),
    });

    return savedMeeting;
  }

  async endMeeting(
    context: TeamChatContext,
    meetingId: string,
    expectedEmptySince?: string,
  ) {
    if (this.meetingAi && context.userId)
      await this.meetingAi.meeting(context, meetingId);
    return this.meetingsRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(AgencyMeetingRoom);
      const meeting = await repository.findOne({
        where: {
          id: meetingId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!meeting) throw new NotFoundException('Reunião não encontrada.');
      if (
        meeting.status === TeamChatMeetingStatus.ENDED ||
        meeting.status === TeamChatMeetingStatus.CANCELED
      )
        return meeting;
      const roomName = meeting.providerRoomName ?? meeting.id;
      if (expectedEmptySince) {
        if (
          meeting.status !== TeamChatMeetingStatus.LIVE ||
          meeting.metadata?.emptySince !== expectedEmptySince
        )
          return meeting;
        // Under the row lock, recheck presence before closing. Concurrent joins
        // clear the timer through a conditional update on this same row.
        const current = await this.livekitProvider.roomOccupancy([roomName]);
        if (!current) return meeting;
        if ((current.get(roomName) ?? 0) > 0) {
          const metadata = { ...meeting.metadata };
          delete metadata.emptySince;
          meeting.metadata = metadata;
          return repository.save(meeting);
        }
      }
      await this.livekitProvider.closeRoom(roomName);
      meeting.status = TeamChatMeetingStatus.ENDED;
      meeting.endedAt = new Date();
      const saved = await repository.save(meeting);
      const events = manager.getRepository(AgencyMeetingEvent);
      await events.save(
        events.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          meetingRoomId: meeting.id,
          participantId: null,
          type: 'meeting_ended',
          occurredAt: meeting.endedAt,
          payload: expectedEmptySince
            ? { reason: 'empty_room_timeout', emptySince: expectedEmptySince }
            : { endedById: context.userId ?? null },
        }),
      );
      return saved;
    });
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
    if (this.meetingAi) await this.meetingAi.prepareDelete(context, meetingId);

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
    if (dto.model || dto.transcriptRef)
      throw new BadRequestException(
        'O modelo e o áudio são definidos pelo servidor.',
      );
    if (this.meetingAi) return this.meetingAi.request(context, meetingId);
    throw new BadRequestException('Análise de reuniões indisponível.');
  }

  async joinInternal(
    context: TeamChatContext,
    meetingId: string,
    // Legacy displayName is accepted for compatibility; authenticated identity is authoritative.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _dto: JoinTeamChatMeetingDto,
  ) {
    const meeting = await this.findMeeting(context, meetingId);

    this.assertMeetingOpen(meeting);
    if (!context.userId)
      throw new ForbiddenException('Usuário autenticado obrigatório.');
    const member = await this.workspaceUsersRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        status: 'active',
      },
    });
    if (!member)
      throw new ForbiddenException('Usuário não pertence a este workspace.');
    const profile = await this.profilesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        userId: context.userId,
      },
    });
    const participantName = profile?.displayName?.trim() || member.name;
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
      avatarUrl: profile?.avatarUrl ?? null,
      isHost: participant.role === TeamChatMeetingParticipantRole.HOST,
    });
    await this.activateJoinedMeeting(context, meeting);

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
    if (meeting.accessMode !== TeamChatMeetingAccessMode.PUBLIC_LINK)
      throw new ForbiddenException(
        'Esta reunião não permite convidados externos.',
      );
    this.assertMeetingOpen(meeting);

    const identity = `guest:${randomUUID()}`;

    let participant = dto.guestEmail
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
    await this.activateJoinedMeeting(
      { tenantId: meeting.tenantId, workspaceId: meeting.workspaceId },
      meeting,
    );

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
    if (this.meetingAi && context.userId)
      return this.meetingAi.meeting(context, meetingId);
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

  private async activateJoinedMeeting(
    context: TeamChatContext,
    meeting: AgencyMeetingRoom,
  ): Promise<void> {
    const result = await this.meetingsRepository
      .createQueryBuilder()
      .update(AgencyMeetingRoom)
      .set({
        status: TeamChatMeetingStatus.LIVE,
        startedAt: () => 'COALESCE(started_at, NOW())',
        metadata: () => "COALESCE(metadata, '{}'::jsonb) - 'emptySince'",
      })
      .where(
        'id = :id AND tenant_id = :tenantId AND workspace_id = :workspaceId',
        {
          id: meeting.id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      )
      .andWhere('status IN (:...statuses)', {
        statuses: [
          TeamChatMeetingStatus.SCHEDULED,
          TeamChatMeetingStatus.WAITING,
          TeamChatMeetingStatus.LIVE,
        ],
      })
      .execute();
    if (!result.affected)
      throw new BadRequestException('Esta reunião foi encerrada.');
    meeting.status = TeamChatMeetingStatus.LIVE;
  }

  private assertMeetingOpen(meeting: AgencyMeetingRoom): void {
    if (
      meeting.status === TeamChatMeetingStatus.ENDED ||
      meeting.status === TeamChatMeetingStatus.CANCELED
    ) {
      throw new BadRequestException('Esta reunião foi encerrada.');
    }
  }

  private createPublicSlug() {
    return randomUUID().replace(/-/g, '').slice(0, 18);
  }
}
