import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  AgencyChatChannel,
  AgencyMeetingAiSummary,
  AgencyMeetingRoom,
  AgencyChatChannelMember,
  AgencyMeetingParticipant,
} from '../entities';
import { AgencyMeetingAiSettings } from '../entities/agency-meeting-ai-settings.entity';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import { FinanceAccount } from '../../finance/entities/finance-account.entity';
import { FinanceCostCenter } from '../../finance/entities/finance-cost-center.entity';
import { FinanceAccountStatus, FinanceAccountType } from '../../finance/enums';
import { FilesService } from '../../../common/files/files.service';
import {
  TeamChatChannelStatus,
  TeamChatAiSummaryStatus,
  TeamChatMeetingStatus,
} from '../enums';
import {
  DEFAULT_MEETING_AI_CONFIG,
  projectMeetingAi,
  type MeetingAiConfig,
  type MeetingAiContext,
} from '../meeting-ai.types';
import {
  MEETING_AI_RATES,
  MEETING_SUMMARY_MODEL,
  TeamChatMeetingAiProviderService,
} from './team-chat-meeting-ai-provider.service';

@Injectable()
export class TeamChatMeetingAiService {
  constructor(
    @InjectRepository(AgencyMeetingAiSummary, 'agency')
    private readonly summaries: Repository<AgencyMeetingAiSummary>,
    @InjectRepository(AgencyMeetingAiSettings, 'agency')
    private readonly settings: Repository<AgencyMeetingAiSettings>,
    private readonly provider: TeamChatMeetingAiProviderService,
    private readonly files: FilesService,
  ) {}

  async assertMember(context: MeetingAiContext) {
    if (!context.userId || !context.tenantId || !context.workspaceId)
      throw new ForbiddenException(
        'Contexto autenticado de workspace obrigatório.',
      );
    const member = await this.summaries.manager
      .getRepository(WorkspaceUserEntity)
      .findOne({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          status: 'active',
        },
      });
    if (!member)
      throw new ForbiddenException('Usuário não pertence a este workspace.');
  }

  async assertMeetingChannel(
    context: MeetingAiContext,
    channelId: string | null | undefined,
  ) {
    await this.assertMember(context);
    if (!channelId) return;
    const channel = await this.summaries.manager
      .getRepository(AgencyChatChannel)
      .findOneBy({
        id: channelId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        status: TeamChatChannelStatus.ACTIVE,
      });
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    if (context.role === 'owner' || context.role === 'admin') return;
    const membership = await this.summaries.manager
      .getRepository(AgencyChatChannelMember)
      .findOneBy({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
        userId: context.userId!,
        leftAt: IsNull(),
      });
    if (!membership)
      throw new ForbiddenException(
        'Entre no canal antes de criar uma reunião nele.',
      );
  }

  async accessibleMeetings(
    context: MeetingAiContext,
    rooms: AgencyMeetingRoom[],
  ) {
    await this.assertMember(context);
    const channelIds = rooms
      .map((room) => room.channelId)
      .filter((id): id is string => Boolean(id));
    const [memberships, participants] = await Promise.all([
      channelIds.length
        ? this.summaries.manager.getRepository(AgencyChatChannelMember).find({
            where: {
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              userId: context.userId!,
              channelId: In(channelIds),
              leftAt: IsNull(),
            },
          })
        : Promise.resolve<AgencyChatChannelMember[]>([]),
      rooms.length
        ? this.summaries.manager.getRepository(AgencyMeetingParticipant).find({
            where: {
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              userId: context.userId!,
              meetingRoomId: In(rooms.map((room) => room.id)),
            },
          })
        : Promise.resolve<AgencyMeetingParticipant[]>([]),
    ]);
    const channels = new Set(memberships.map((member) => member.channelId));
    const attended = new Set(
      participants.map((participant) => participant.meetingRoomId),
    );
    return rooms.filter(
      (room) =>
        room.tenantId === context.tenantId &&
        room.workspaceId === context.workspaceId &&
        (context.role === 'owner' ||
          context.role === 'admin' ||
          room.hostUserId === context.userId ||
          attended.has(room.id) ||
          (room.channelId && channels.has(room.channelId))),
    );
  }

  async meeting(context: MeetingAiContext, id: string) {
    const room = await this.summaries.manager
      .getRepository(AgencyMeetingRoom)
      .findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });
    if (!room || !(await this.accessibleMeetings(context, [room])).length)
      throw new NotFoundException('Reunião não encontrada.');
    return room;
  }

  async availability(context: MeetingAiContext) {
    await this.assertMember(context);
    const config = await this.configuration(context);
    return { ...this.provider.availability(), enabled: config.enabled };
  }

  async configuration(
    context: Pick<MeetingAiContext, 'tenantId' | 'workspaceId'>,
  ): Promise<MeetingAiConfig> {
    const row = await this.settings.findOne({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
    });
    return { ...DEFAULT_MEETING_AI_CONFIG, ...row?.config };
  }

  async getSettings(context: MeetingAiContext) {
    await this.assertMember(context);
    const [config, accounts, costCenters] = await Promise.all([
      this.configuration(context),
      this.summaries.manager.getRepository(FinanceAccount).find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          type: FinanceAccountType.Expense,
          status: FinanceAccountStatus.Active,
        },
        order: { code: 'ASC' },
      }),
      this.summaries.manager.getRepository(FinanceCostCenter).find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          active: true,
        },
        order: { name: 'ASC' },
      }),
    ]);
    return {
      config,
      ...this.provider.availability(),
      accounts: accounts.map((row) => ({
        id: row.id,
        name: `${row.code} — ${row.name}`,
      })),
      costCenters: costCenters.map((row) => ({ id: row.id, name: row.name })),
    };
  }

  async saveSettings(context: MeetingAiContext, config: MeetingAiConfig) {
    await this.assertMember(context);
    await this.financialDefaults(context, config);
    await this.settings.upsert(
      { tenantId: context.tenantId, workspaceId: context.workspaceId, config },
      ['tenantId', 'workspaceId'],
    );
    return this.getSettings(context);
  }

  private async financialDefaults(
    context: MeetingAiContext,
    config: MeetingAiConfig,
  ) {
    const [account, center] = await Promise.all([
      config.expenseAccountId
        ? this.summaries.manager.getRepository(FinanceAccount).findOne({
            where: {
              id: config.expenseAccountId,
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              type: FinanceAccountType.Expense,
              status: FinanceAccountStatus.Active,
            },
          })
        : null,
      config.costCenterId
        ? this.summaries.manager.getRepository(FinanceCostCenter).findOne({
            where: {
              id: config.costCenterId,
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              active: true,
            },
          })
        : null,
    ]);
    if (
      (config.expenseAccountId && !account) ||
      (config.costCenterId && !center) ||
      (config.enabled && (!account || !center))
    )
      throw new BadRequestException(
        'Selecione uma conta de despesa e um centro de custo ativos deste workspace.',
      );
    return { account, center };
  }

  async request(context: MeetingAiContext, meetingId: string) {
    const room = await this.meeting(context, meetingId);
    if (room.hostUserId !== context.userId)
      throw new ForbiddenException(
        'Somente o anfitrião pode ativar a análise.',
      );
    const existing = await this.summaries.findOne({
      where: {
        meetingRoomId: room.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      order: { createdAt: 'DESC' },
    });
    if (existing?.execution) return projectMeetingAi(existing);
    if (room.status !== TeamChatMeetingStatus.LIVE || !room.aiSummaryEnabled)
      throw new BadRequestException(
        'Ative a análise durante uma reunião ao vivo. Reuniões sem gravação não podem ser resumidas.',
      );
    const availability = this.provider.availability();
    if (!availability.available)
      throw new ServiceUnavailableException(
        availability.reason ?? 'Análise indisponível.',
      );
    const config = await this.configuration(context);
    if (!config.enabled)
      throw new BadRequestException(
        'Ative o resumo com IA nas configurações de Mensagens.',
      );
    const { account, center } = await this.financialDefaults(context, config);
    return this.summaries.manager.transaction(async (manager) => {
      const locked = await manager.getRepository(AgencyMeetingRoom).findOne({
        where: {
          id: room.id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== TeamChatMeetingStatus.LIVE)
        throw new BadRequestException('A reunião já foi encerrada.');
      const repository = manager.getRepository(AgencyMeetingAiSummary);
      let summary = await repository.findOne({
        where: {
          meetingRoomId: room.id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
        order: { createdAt: 'DESC' },
      });
      if (summary?.execution) return projectMeetingAi(summary);
      if (!summary)
        summary = repository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          meetingRoomId: room.id,
        });
      // Persist intent before invoking Egress. The worker owns all provider dispatches.
      summary.status = TeamChatAiSummaryStatus.PROCESSING;
      summary.model = MEETING_SUMMARY_MODEL;
      summary.requestedById = context.userId!;
      summary.errorMessage = null;
      summary.execution = {
        version: 1,
        stage: 'starting',
        config,
        accountName: account!.name,
        costCenterName: center!.name,
        captureRequestedAt: new Date().toISOString(),
        partial: true,
        audioRef: `meeting-ai/${context.tenantId}/${context.workspaceId}/${room.id}/audio.mp3`,
        calls: [],
        retries: 0,
        rates: { ...MEETING_AI_RATES },
      };
      summary.nextAttemptAt = new Date();
      locked.recordingEnabled = true;
      locked.transcriptionEnabled = true;
      await manager.getRepository(AgencyMeetingRoom).save(locked);
      return projectMeetingAi(await repository.save(summary));
    });
  }

  async listProjection(
    context: MeetingAiContext,
    meetings: AgencyMeetingRoom[],
  ) {
    const rooms = await this.accessibleMeetings(context, meetings);
    const summaries = rooms.length
      ? await this.summaries.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            meetingRoomId: In(rooms.map((room) => room.id)),
          },
          order: { createdAt: 'DESC' },
        })
      : [];
    return rooms.map((room) => ({
      ...room,
      aiAnalysis: projectMeetingAi(
        summaries.find((summary) => summary.meetingRoomId === room.id) ?? {
          id: '',
          status: 'pending',
          execution: null,
          errorMessage: null,
          completedAt: null,
        },
      ),
    }));
  }

  async detail(context: MeetingAiContext, meetingId: string) {
    await this.meeting(context, meetingId);
    const row = await this.summaries.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meetingId,
      },
      order: { createdAt: 'DESC' },
    });
    if (!row?.execution) return null;
    return {
      ...projectMeetingAi(row),
      summary: row.summary,
      topics: row.topics ?? [],
      agreements: row.agreements ?? [],
      decisions: row.decisions ?? [],
      nextSteps: row.nextSteps ?? [],
      actionItems: row.actionItems ?? [],
      openQuestions: row.openQuestions ?? [],
      participants: row.execution.participants ?? [],
      audioSeconds: row.execution.audioSeconds ?? null,
      captureEndedAt: row.execution.captureEndedAt ?? null,
      calls: row.execution.calls.map((call) => ({
        kind: call.kind,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        cachedTokens: call.cachedTokens,
        costUsd: call.costUsd,
        state: call.state,
      })),
      rateDate: row.execution.rates.date,
    };
  }

  async download(context: MeetingAiContext, meetingId: string) {
    const room = await this.meeting(context, meetingId);
    const row = await this.summaries.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meetingId,
      },
      order: { createdAt: 'DESC' },
    });
    if (
      room.status !== TeamChatMeetingStatus.ENDED ||
      row?.status !== TeamChatAiSummaryStatus.COMPLETED ||
      !row.execution?.pdfRef
    )
      throw new NotFoundException('O PDF ainda não está disponível.');
    return this.files.getPrivateAsset(row.execution.pdfRef);
  }

  async prepareDelete(context: MeetingAiContext, meetingId: string) {
    await this.meeting(context, meetingId);
    const row = await this.summaries.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meetingId,
      },
      order: { createdAt: 'DESC' },
    });
    if (
      row?.execution &&
      (row.status === TeamChatAiSummaryStatus.PROCESSING ||
        row.execution.captureStopPending)
    )
      throw new BadRequestException(
        'Aguarde a conclusão da análise antes de excluir a reunião.',
      );
    if (row?.execution) {
      const refs = new Set([
        row.execution.audioRef,
        `${row.execution.audioRef}.capture`,
        row.execution.pdfRef ??
          `${row.execution.audioRef.slice(0, -'audio.mp3'.length)}summary.pdf`,
        row.execution.layoutSnapshotRef ??
          `${row.execution.audioRef.slice(0, -'audio.mp3'.length)}layout.json`,
        row.execution.transcriptRef,
        ...row.execution.calls.map(
          (call) =>
            call.resultRef ??
            `${row.execution!.audioRef.slice(0, -'audio.mp3'.length)}${call.key}.json`,
        ),
      ]);
      for (const ref of refs)
        if (ref)
          await this.files.deleteObject({ bucket: 'private', path: ref });
    }
  }
}
