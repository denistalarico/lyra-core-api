import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {
  AgencyMeetingAiSummary,
  AgencyMeetingRoom,
  AgencyMeetingParticipant,
} from '../entities';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import { FilesService } from '../../../common/files/files.service';
import { TeamChatAiSummaryStatus, TeamChatMeetingStatus } from '../enums';
import type { MeetingAiCall } from '../meeting-ai.types';
import {
  MEETING_TRANSCRIPTION_MODEL,
  MEETING_SUMMARY_MODEL,
  parseMeetingAiResult,
  TeamChatMeetingAiProviderService,
  type MeetingAiProviderResponse,
} from './team-chat-meeting-ai-provider.service';
import {
  readMeetingAsset,
  TeamChatMeetingAiPdfService,
} from './team-chat-meeting-ai-pdf.service';

class MeetingAiTerminalError extends Error {}
class MeetingAiLeaseLost extends Error {}

@Injectable()
export class TeamChatMeetingAiWorkerService {
  private busy = false;
  private captureBusy = false;
  private readonly logger = new Logger(TeamChatMeetingAiWorkerService.name);
  constructor(
    @InjectRepository(AgencyMeetingAiSummary, 'agency')
    private readonly summaries: Repository<AgencyMeetingAiSummary>,
    private readonly provider: TeamChatMeetingAiProviderService,
    private readonly files: FilesService,
    private readonly pdf: TeamChatMeetingAiPdfService,
  ) {}

  @Interval(10_000)
  async tick() {
    // Capture control runs independently, even while a provider/PDF request is pending.
    await this.captureTick();
    if (this.busy) return;
    this.busy = true;
    try {
      await this.run('analysis');
    } finally {
      this.busy = false;
    }
  }

  @Interval(5_000)
  async captureTick() {
    if (this.captureBusy) return;
    this.captureBusy = true;
    try {
      for (let index = 0; index < 20; index++)
        if (!(await this.run('capture'))) break;
    } finally {
      this.captureBusy = false;
    }
  }

  private async run(kind: 'capture' | 'analysis') {
    try {
      const row = await this.claim(kind);
      if (!row) return false;
      const lease = row.leaseToken!;
      const heartbeat = setInterval(
        () =>
          void this.summaries
            .createQueryBuilder()
            .update()
            .set({ leaseExpiresAt: new Date(Date.now() + 10 * 60_000) })
            .where('id = :id AND lease_token = :lease', { id: row.id, lease })
            .execute()
            .catch(() => undefined),
        30_000,
      );
      try {
        if (row.status === TeamChatAiSummaryStatus.FAILED)
          await this.reconcileStop(row);
        else await this.process(row);
        await this.save(row, true);
      } catch (error) {
        if (error instanceof MeetingAiLeaseLost) return;
        const execution = row.execution!;
        const uncertain = execution.calls.some(
          (call) => call.state === 'dispatched' || call.state === 'unknown',
        );
        if (
          uncertain ||
          error instanceof MeetingAiTerminalError ||
          ++execution.retries >= 5
        ) {
          execution.stage = 'failed';
          row.status = TeamChatAiSummaryStatus.FAILED;
          row.errorMessage = uncertain
            ? 'Uma chamada de IA não retornou resultado confirmado. O custo pode ser desconhecido; não foi realizada uma nova chamada automática.'
            : error instanceof MeetingAiTerminalError
              ? error.message
              : 'Não foi possível concluir a análise após cinco tentativas. Verifique a gravação, o armazenamento e o serviço de PDF.';
          execution.captureStopPending = true;
          row.nextAttemptAt = new Date(Date.now() + 15_000);
          await this.reconcileStop(row).catch(() => undefined);
        } else {
          row.nextAttemptAt = new Date(
            Date.now() + Math.min(300_000, 15_000 * 2 ** execution.retries),
          );
        }
        this.logger.warn(
          `Meeting AI ${row.id}: stage ${execution.stage}, retry ${execution.retries}.`,
        );
        await this.save(row, true);
      } finally {
        clearInterval(heartbeat);
      }
    } catch {
      this.logger.warn(
        'Meeting AI worker could not claim/persist work; next interval will recover.',
      );
    }
    return true;
  }

  async claim(kind?: 'capture' | 'analysis') {
    return this.summaries.manager.transaction(async (manager) => {
      const repository = manager.getRepository(AgencyMeetingAiSummary);
      const query = repository
        .createQueryBuilder('summary')
        .where(
          "(summary.status = :status OR (summary.status = :failed AND summary.execution->>'captureStopPending' = 'true'))",
          {
            status: TeamChatAiSummaryStatus.PROCESSING,
            failed: TeamChatAiSummaryStatus.FAILED,
          },
        )
        .andWhere('summary.execution IS NOT NULL')
        .andWhere(
          '(summary.next_attempt_at IS NULL OR summary.next_attempt_at <= NOW())',
        )
        .andWhere(
          '(summary.lease_expires_at IS NULL OR summary.lease_expires_at < NOW())',
        )
        .orderBy('summary.next_attempt_at', 'ASC', 'NULLS FIRST')
        .addOrderBy('summary.created_at', 'ASC')
        .take(1)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked');
      if (kind)
        query.andWhere(
          kind === 'capture'
            ? "(summary.execution->>'stage' IN ('starting', 'capturing', 'finalizing') OR summary.execution->>'captureStopPending' = 'true')"
            : "summary.execution->>'stage' IN ('transcribing', 'summarizing', 'exporting')",
        );
      const row = await query.getOne();
      if (!row) return null;
      row.leaseToken = randomUUID();
      row.leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
      return repository.save(row);
    });
  }

  private async reconcileStop(row: AgencyMeetingAiSummary) {
    const execution = row.execution!;
    const room = await this.summaries.manager
      .getRepository(AgencyMeetingRoom)
      .findOneBy({
        id: row.meetingRoomId,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
      });
    const roomName = room?.providerRoomName ?? row.meetingRoomId;
    execution.egressId ??=
      (await this.provider.findCapture(roomName, execution.audioRef)) ??
      undefined;
    if (execution.egressId) {
      const info = await this.provider.recording(execution.egressId);
      if (!info.complete && !info.failed) {
        await this.provider.stop(execution.egressId);
        row.nextAttemptAt = new Date(Date.now() + 15_000);
        return; // Keep reconciling until Egress confirms termination.
      }
    }
    execution.captureStopPending = false;
    await this.provider.notifyCapture(roomName, 'failed');
  }

  private async save(row: AgencyMeetingAiSummary, release = false) {
    const lease = row.leaseToken;
    const result = await this.summaries
      .createQueryBuilder()
      .update()
      .set({
        execution: row.execution,
        status: row.status,
        summary: row.summary,
        topics: row.topics,
        agreements: row.agreements,
        decisions: row.decisions,
        nextSteps: row.nextSteps,
        actionItems: row.actionItems,
        openQuestions: row.openQuestions,
        transcriptRef: row.transcriptRef,
        model: row.model,
        errorMessage: row.errorMessage,
        completedAt: row.completedAt,
        nextAttemptAt: row.nextAttemptAt ?? new Date(Date.now() + 15_000),
        ...(release ? { leaseToken: null, leaseExpiresAt: null } : {}),
      })
      .where('id = :id AND lease_token = :lease', { id: row.id, lease })
      .execute();
    if (result.affected !== 1) throw new MeetingAiLeaseLost();
  }

  private async process(row: AgencyMeetingAiSummary) {
    const execution = row.execution!;
    const room = await this.summaries.manager
      .getRepository(AgencyMeetingRoom)
      .findOneBy({
        id: row.meetingRoomId,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
      });
    if (!room) throw new MeetingAiTerminalError('Reunião não encontrada.');
    if (!this.provider.availability().available)
      throw new MeetingAiTerminalError(
        'A análise foi desativada neste ambiente. Nenhuma nova chamada de IA foi feita.',
      );
    if (
      execution.calls.some(
        (call) => call.state === 'dispatched' || call.state === 'unknown',
      )
    )
      throw new MeetingAiTerminalError(
        'Resultado de uma chamada anterior incerto.',
      );
    if (room.status === TeamChatMeetingStatus.CANCELED)
      throw new MeetingAiTerminalError('A reunião foi cancelada.');
    const roomName = room.providerRoomName ?? room.id;
    row.nextAttemptAt = new Date(Date.now() + 15_000);
    if (execution.stage === 'starting') {
      execution.egressId ??=
        (await this.provider.findCapture(roomName, execution.audioRef)) ??
        undefined;
      if (!execution.egressId && room.status !== TeamChatMeetingStatus.LIVE)
        throw new MeetingAiTerminalError(
          'A reunião encerrou antes de iniciar a captura. Não há áudio para resumir.',
        );
      // Creates/verifies the private bucket before Cloud Egress writes to it.
      if (!execution.egressId) {
        await this.files.uploadPrivateBuffer({
          path: `${execution.audioRef}.capture`,
          body: Buffer.from(row.id),
          contentType: 'text/plain',
        });
        await this.provider.notifyCapture(roomName, 'starting');
        execution.egressId = await this.provider.capture(roomName, execution);
      }
      execution.stage = 'capturing';
      await this.save(row);
      return;
    }
    if (execution.stage === 'capturing' || execution.stage === 'finalizing') {
      if (!execution.egressId)
        throw new MeetingAiTerminalError(
          'Não há gravação associada a esta análise.',
        );
      const info = await this.provider.recording(execution.egressId);
      if (info.failed)
        throw new MeetingAiTerminalError(
          'O LiveKit não conseguiu gravar o áudio. Confira Egress e acesso ao armazenamento privado.',
        );
      if (info.startedAt && !execution.captureStartedAt) {
        execution.captureStartedAt = info.startedAt;
        execution.partial =
          !room.startedAt ||
          Date.parse(info.startedAt) - room.startedAt.getTime() > 15_000;
      }
      if (info.active) await this.provider.notifyCapture(roomName, 'capturing');
      const limitReached =
        execution.captureStartedAt &&
        Date.now() - Date.parse(execution.captureStartedAt) >=
          execution.config.maxCaptureMinutes * 60_000;
      if (
        !info.complete &&
        (room.status === TeamChatMeetingStatus.ENDED || limitReached) &&
        execution.stage !== 'finalizing'
      ) {
        execution.stage = 'finalizing';
        execution.partial ||= Boolean(limitReached);
        await this.save(row);
        await this.provider.stop(execution.egressId);
        await this.provider.notifyCapture(roomName, 'stopped');
        return;
      }
      if (!info.complete) {
        // Retry stop if the process restarted between the checkpoint and the stop request.
        if (execution.stage === 'finalizing' && info.active)
          await this.provider.stop(execution.egressId);
        if (room.endedAt && Date.now() - room.endedAt.getTime() > 30 * 60_000)
          throw new MeetingAiTerminalError(
            'A gravação não finalizou em 30 minutos após o encerramento.',
          );
        return;
      }
      execution.captureEndedAt = info.endedAt ?? new Date().toISOString();
      execution.audioSeconds = Math.min(
        info.duration,
        execution.config.maxCaptureMinutes * 60,
      );
      execution.partial ||=
        info.duration > execution.config.maxCaptureMinutes * 60 + 10 ||
        room.status !== TeamChatMeetingStatus.ENDED ||
        Boolean(
          info.endedAt &&
          room.endedAt &&
          room.endedAt.getTime() - Date.parse(info.endedAt) > 15_000,
        );
      await this.provider.notifyCapture(roomName, 'stopped');
      if (room.status !== TeamChatMeetingStatus.ENDED) {
        execution.stage = 'finalizing';
        return;
      }
      if (!execution.audioSeconds || execution.audioSeconds < 1)
        throw new MeetingAiTerminalError('A gravação não contém áudio útil.');
      execution.stage = 'transcribing';
      await this.save(row);
      return;
    }
    if (execution.stage === 'transcribing') {
      await this.transcribe(row);
      return;
    }
    if (execution.stage === 'summarizing') {
      const asset = await this.files.getPrivateAsset(execution.transcriptRef!);
      const transcript = (
        await readMeetingAsset(asset.body, 4 * 1024 * 1024)
      ).toString();
      if (!transcript.trim())
        throw new MeetingAiTerminalError(
          'Não foi detectada fala suficiente para gerar o resumo.',
        );
      if (transcript.length > 600_000)
        throw new MeetingAiTerminalError(
          'A transcrição excede o limite desta análise.',
        );
      const reservedUsd =
        ((Buffer.byteLength(transcript) + 4096) * execution.rates.summaryInput +
          6000 * execution.rates.summaryOutput) /
        1_000_000;
      const response = await this.call(
        row,
        'summary',
        'summary-v1',
        reservedUsd,
        () => this.provider.summarize(transcript),
      );
      let result;
      try {
        result = parseMeetingAiResult(response.data, transcript);
      } catch {
        throw new MeetingAiTerminalError(
          'A IA retornou um resumo incompleto ou sem evidências válidas. O uso desta tentativa foi registrado.',
        );
      }
      Object.assign(row, result);
      const participants = await this.summaries.manager
        .getRepository(AgencyMeetingParticipant)
        .findBy({
          tenantId: row.tenantId,
          workspaceId: row.workspaceId,
          meetingRoomId: room.id,
        });
      const members = await this.summaries.manager
        .getRepository(WorkspaceUserEntity)
        .findBy({ tenantId: row.tenantId, workspaceId: row.workspaceId });
      execution.participants = [
        ...new Set(
          participants.map(
            (participant) =>
              participant.guestName ||
              members.find((member) => member.userId === participant.userId)
                ?.name ||
              'Participante sem identificação',
          ),
        ),
      ];
      execution.stage = 'exporting';
      await this.save(row);
      return;
    }
    if (execution.stage === 'exporting') {
      execution.pdfRef = await this.pdf.render(row, room, () => this.save(row));
      execution.stage = 'ready';
      row.status = TeamChatAiSummaryStatus.COMPLETED;
      row.completedAt = new Date();
      row.errorMessage = null;
      await this.files
        .deleteObject({
          bucket: 'private',
          path: `${execution.audioRef}.capture`,
        })
        .catch(() => undefined);
    }
  }

  private async transcribe(row: AgencyMeetingAiSummary) {
    const execution = row.execution!;
    const directory = await mkdtemp(join(tmpdir(), 'lyra-meeting-audio-'));
    try {
      const asset = await this.files.getPrivateAsset(execution.audioRef);
      const source = join(directory, 'source.mp3');
      const audio = await readMeetingAsset(asset.body, 64 * 1024 * 1024);
      const checksum = createHash('sha256').update(audio).digest('hex');
      if (execution.audioChecksum && execution.audioChecksum !== checksum)
        throw new MeetingAiTerminalError(
          'O áudio foi alterado depois de iniciar a transcrição.',
        );
      execution.audioChecksum = checksum;
      await this.save(row);
      await writeFile(source, audio);
      const transcripts: string[] = [];
      let hasSpeech = false;
      let dispatched = false;
      const duration = execution.audioSeconds!;
      for (
        let offset = 0, index = 0;
        offset < duration;
        offset += 175, index++
      ) {
        const seconds = Math.min(180, duration - offset);
        const key = `audio-${index}`;
        const target = join(directory, 'chunk.mp3');
        const previous = execution.calls.find((call) => call.key === key);
        if (!previous) {
          if (dispatched) return; // At most one paid chunk per claim.
          if (!this.provider.availability().available)
            throw new MeetingAiTerminalError(
              'A análise foi desativada neste ambiente.',
            );
          // Five seconds of overlap preserve words crossing a chunk boundary.
          await this.chunk(source, target, offset, seconds);
          dispatched = true;
        }
        const response = await this.call(row, 'transcription', key, 0.05, () =>
          readFile(target).then((buffer) => this.provider.transcribe(buffer)),
        );
        if (typeof response.data.text !== 'string')
          throw new MeetingAiTerminalError(
            'Transcrição inválida. O uso desta tentativa foi registrado.',
          );
        const usage = response.data.usage as
          | { output_tokens?: number }
          | undefined;
        if (
          typeof usage?.output_tokens === 'number' &&
          usage.output_tokens >= 2000
        )
          throw new MeetingAiTerminalError(
            'Um trecho excedeu o limite de saída da transcrição; o uso foi registrado, mas não há transcrição completa para resumir.',
          );
        hasSpeech ||= Boolean(response.data.text.trim());
        transcripts.push(
          `[Trecho ${index + 1}, ${offset}s–${offset + seconds}s]\n${response.data.text}`,
        );
      }
      if (!hasSpeech)
        throw new MeetingAiTerminalError(
          'Não foi detectada fala suficiente para gerar o resumo.',
        );
      const transcriptRef = `${execution.audioRef.slice(0, -'audio.mp3'.length)}transcript.txt`;
      await this.files.uploadPrivateBuffer({
        path: transcriptRef,
        body: Buffer.from(transcripts.join('\n\n')),
        contentType: 'text/plain; charset=utf-8',
      });
      execution.transcriptRef = transcriptRef;
      row.transcriptRef = execution.transcriptRef;
      execution.stage = 'summarizing';
      await this.save(row);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private chunk(
    source: string,
    target: string,
    offset: number,
    seconds: number,
  ): Promise<void> {
    if (!ffmpeg)
      throw new MeetingAiTerminalError('Processador de áudio indisponível.');
    return new Promise((resolve, reject) => {
      const process = spawn(
        ffmpeg!,
        [
          '-nostdin',
          '-y',
          '-v',
          'error',
          '-ss',
          String(offset),
          '-i',
          source,
          '-t',
          String(seconds),
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '32k',
          target,
        ],
        { stdio: 'ignore', timeout: 120_000 },
      );
      process.once('error', () =>
        reject(new Error('Falha ao preparar o áudio.')),
      );
      process.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error('Falha ao preparar o áudio.')),
      );
    });
  }

  private async call(
    row: AgencyMeetingAiSummary,
    kind: MeetingAiCall['kind'],
    key: string,
    reservedUsd: number,
    dispatch: () => Promise<MeetingAiProviderResponse>,
  ) {
    const execution = row.execution!;
    const previous = execution.calls.find((call) => call.key === key);
    if (previous) {
      if (previous.state !== 'completed' || !previous.resultRef)
        throw new MeetingAiTerminalError(
          'Uma chamada anterior não tem resultado confirmado.',
        );
      const asset = await this.files.getPrivateAsset(previous.resultRef);
      return JSON.parse(
        (await readMeetingAsset(asset.body, 4 * 1024 * 1024)).toString(),
      ) as MeetingAiProviderResponse;
    }
    const spent = execution.calls.reduce(
      (sum, call) => sum + (call.costUsd ?? call.reservedUsd),
      0,
    );
    if (spent + reservedUsd > execution.config.maxCostUsd)
      throw new MeetingAiTerminalError(
        'O limite de custo configurado para esta reunião foi atingido. As tentativas já realizadas estão contabilizadas.',
      );
    const call: MeetingAiCall = {
      key,
      kind,
      state: 'dispatched',
      reservedUsd,
      costUsd: null,
      inputTokens: null,
      cachedTokens: null,
      outputTokens: null,
      requestId: null,
      model:
        kind === 'transcription'
          ? MEETING_TRANSCRIPTION_MODEL
          : MEETING_SUMMARY_MODEL,
      dispatchedAt: new Date().toISOString(),
    };
    execution.calls.push(call);
    await this.save(row);
    let response: MeetingAiProviderResponse;
    try {
      response = await dispatch();
    } catch {
      call.state = 'unknown';
      await this.save(row);
      throw new MeetingAiTerminalError(
        'O resultado da chamada de IA é desconhecido.',
      );
    }
    call.requestId = response.requestId;
    const usage = response.data.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          input_tokens_details?: { cached_tokens?: number };
        }
      | undefined;
    const valid = (value: unknown): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    call.inputTokens = valid(usage?.input_tokens) ? usage.input_tokens : null;
    call.outputTokens = valid(usage?.output_tokens)
      ? usage.output_tokens
      : null;
    call.cachedTokens =
      kind === 'summary' && valid(usage?.input_tokens_details?.cached_tokens)
        ? Math.min(
            call.inputTokens ?? 0,
            usage.input_tokens_details.cached_tokens,
          )
        : 0;
    const rates = execution.rates;
    if (call.inputTokens !== null && call.outputTokens !== null)
      call.costUsd = Number(
        (kind === 'transcription'
          ? (call.inputTokens * rates.transcriptionInput +
              call.outputTokens * rates.transcriptionOutput) /
            1_000_000
          : ((call.inputTokens - call.cachedTokens) * rates.summaryInput +
              call.cachedTokens * rates.summaryCached +
              call.outputTokens * rates.summaryOutput) /
            1_000_000
        ).toFixed(8),
      );
    // Persist usage even if saving the response or validating its content fails later.
    await this.save(row);
    call.resultRef = `${execution.audioRef.slice(0, -'audio.mp3'.length)}${key}.json`;
    await this.files.uploadPrivateBuffer({
      path: call.resultRef,
      body: Buffer.from(JSON.stringify(response)),
      contentType: 'application/json',
    });
    call.state = 'completed';
    await this.save(row);
    return response;
  }

  @Interval(60 * 60_000)
  async expireAudio() {
    const rows = await this.summaries
      .createQueryBuilder('summary')
      .where('summary.execution IS NOT NULL')
      .andWhere('summary.status IN (:...statuses)', {
        statuses: ['completed', 'failed'],
      })
      .getMany();
    for (const row of rows) {
      const execution = row.execution!;
      if (
        execution.captureStopPending ||
        execution.audioExpiredAt ||
        Date.now() - Date.parse(execution.captureRequestedAt) <
          execution.config.retentionDays * 86_400_000
      )
        continue;
      try {
        for (const ref of [
          execution.audioRef,
          `${execution.audioRef}.capture`,
          execution.transcriptRef,
          ...execution.calls.map(
            (call) =>
              call.resultRef ??
              `${execution.audioRef.slice(0, -'audio.mp3'.length)}${call.key}.json`,
          ),
        ])
          if (ref)
            await this.files.deleteObject({ bucket: 'private', path: ref });
        execution.audioExpiredAt = new Date().toISOString();
        await this.summaries.update(
          { id: row.id, status: row.status },
          { execution },
        );
      } catch {
        this.logger.warn(`Meeting AI ${row.id}: retention cleanup will retry.`);
      }
    }
  }
}
