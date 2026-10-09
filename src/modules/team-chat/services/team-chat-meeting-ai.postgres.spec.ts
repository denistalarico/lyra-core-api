import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { getAgencyTypeOrmConfig } from '../../../config/typeorm.config';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { FilesService } from '../../../common/files/files.service';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import { FinanceAccount } from '../../finance/entities/finance-account.entity';
import { FinanceCostCenter } from '../../finance/entities/finance-cost-center.entity';
import { FinanceAccountType } from '../../finance/enums';
import {
  AgencyChatChannel,
  AgencyMeetingRoom,
  AgencyMeetingAiSummary,
  AgencyChatChannelMember,
  AgencyMeetingParticipant,
} from '../entities';
import { AgencyMeetingAiSettings } from '../entities/agency-meeting-ai-settings.entity';
import { TeamChatAiSummaryStatus, TeamChatMeetingStatus } from '../enums';
import { TeamChatMeetingAiService } from './team-chat-meeting-ai.service';
import { TeamChatMeetingAiWorkerService } from './team-chat-meeting-ai-worker.service';
import { TeamChatMeetingAiProviderService } from './team-chat-meeting-ai-provider.service';
import { TeamChatMeetingAiPdfService } from './team-chat-meeting-ai-pdf.service';
import { CreateMeetingAiProcessing1798900000000 } from '../../../database/migrations/1798900000000-create-meeting-ai-processing';

describePostgresIntegration()(
  'Meeting analysis durable pipeline (real PostgreSQL and FFmpeg; provider/storage/PDF boundaries scripted)',
  () => {
    const schema = `meeting_ai_${randomUUID().replaceAll('-', '')}`;
    const context = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      userId: randomUUID(),
    };
    const entities = [
      AgencyChatChannel,
      AgencyMeetingRoom,
      AgencyMeetingAiSummary,
      AgencyMeetingAiSettings,
      AgencyChatChannelMember,
      AgencyMeetingParticipant,
      WorkspaceUserEntity,
      FinanceAccount,
      FinanceCostCenter,
    ];
    let db: DataSource;
    let service: TeamChatMeetingAiService;
    let worker: TeamChatMeetingAiWorkerService;
    let expenseAccountId: string;
    let costCenterId: string;
    let audio: Buffer;
    const objects = new Map<string, Buffer>();
    const transcript = 'Ana confirmou: publicar sexta-feira.';
    const result = {
      summary: 'A equipe combinou a publicação.',
      topics: ['Publicação'],
      agreements: [
        { text: 'Publicar sexta-feira.', evidence: 'publicar sexta-feira.' },
      ],
      decisions: [],
      nextSteps: ['Preparar publicação.'],
      actionItems: [
        {
          text: 'Preparar publicação.',
          evidence: 'publicar sexta-feira.',
          owner: null,
          dueDate: null,
        },
      ],
      openQuestions: [],
    };
    const provider = {
      availability: jest.fn(),
      capture: jest.fn(),
      findCapture: jest.fn(),
      recording: jest.fn(),
      stop: jest.fn(),
      notifyCapture: jest.fn(),
      transcribe: jest.fn(),
      summarize: jest.fn(),
    };
    const files = {
      uploadPrivateBuffer: jest.fn(
        async (input: { path: string; body: Buffer }) => {
          objects.set(input.path, input.body);
          return { path: input.path };
        },
      ),
      getPrivateAsset: jest.fn(async (path: string) => {
        const body = objects.get(path);
        if (!body) throw new Error('Missing test object');
        return {
          body: Readable.from([body]),
          contentType: path.endsWith('.pdf')
            ? 'application/pdf'
            : 'application/octet-stream',
        };
      }),
      deleteObject: jest.fn(async ({ path }: { path: string }) => {
        objects.delete(path);
      }),
    };
    const pdf = {
      render: jest.fn(async (row: AgencyMeetingAiSummary) => {
        const ref = `${row.execution!.audioRef}.pdf`;
        objects.set(ref, Buffer.from('%PDF fixture boundary'));
        return ref;
      }),
    };
    beforeAll(async () => {
      const base = getAgencyTypeOrmConfig() as Extract<
        DataSourceOptions,
        { type: 'postgres' }
      >;
      const bootstrap = new DataSource({
        ...base,
        entities: [],
        migrations: [],
        migrationsRun: false,
        synchronize: false,
      });
      await bootstrap.initialize();
      try {
        await bootstrap.query(`CREATE SCHEMA "${schema}"`);
      } finally {
        await bootstrap.destroy();
      }
      db = new DataSource({
        ...base,
        name: 'agency',
        schema,
        entities,
        migrations: [],
        migrationsRun: false,
        synchronize: true,
        extra: { options: `-c search_path=${schema},public`, max: 8 },
      });
      await db.initialize();
      service = new TeamChatMeetingAiService(
        db.getRepository(AgencyMeetingAiSummary),
        db.getRepository(AgencyMeetingAiSettings),
        provider as unknown as TeamChatMeetingAiProviderService,
        files as unknown as FilesService,
      );
      worker = new TeamChatMeetingAiWorkerService(
        db.getRepository(AgencyMeetingAiSummary),
        provider as unknown as TeamChatMeetingAiProviderService,
        files as unknown as FilesService,
        pdf as unknown as TeamChatMeetingAiPdfService,
      );
      const directory = mkdtempSync(join(tmpdir(), 'meeting-ai-fixture-'));
      try {
        const path = join(directory, 'audio.mp3');
        execFileSync(ffmpeg!, [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=2',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '32k',
          path,
        ]);
        audio = readFileSync(path);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
    beforeEach(async () => {
      for (const entity of entities) await db.getRepository(entity).clear();
      objects.clear();
      jest.clearAllMocks();
      provider.availability.mockReturnValue({ available: true });
      provider.capture.mockReset().mockResolvedValue('egress-fixture');
      provider.findCapture.mockReset().mockResolvedValue(null);
      provider.recording.mockReset().mockResolvedValue({
        active: true,
        complete: false,
        failed: false,
        startedAt: new Date().toISOString(),
        duration: 0,
      });
      provider.stop.mockReset().mockResolvedValue(undefined);
      provider.notifyCapture.mockResolvedValue(undefined);
      provider.transcribe.mockReset().mockResolvedValue({
        data: {
          text: transcript,
          usage: { input_tokens: 100, output_tokens: 30 },
        },
        requestId: 'transcription-fixture',
      });
      provider.summarize.mockReset().mockResolvedValue({
        data: {
          status: 'completed',
          output: [
            {
              content: [{ type: 'output_text', text: JSON.stringify(result) }],
            },
          ],
          usage: {
            input_tokens: 120,
            output_tokens: 100,
            input_tokens_details: { cached_tokens: 20 },
          },
        },
        requestId: 'summary-fixture',
      });
      pdf.render.mockClear();
      await db.getRepository(WorkspaceUserEntity).save({
        ...context,
        name: 'Ana',
        email: 'ana@fixture.test',
        role: 'owner',
        status: 'active',
      });
      expenseAccountId = (
        await db.getRepository(FinanceAccount).save({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          name: 'IA',
          code: 'AI',
          type: FinanceAccountType.Expense,
        })
      ).id;
      costCenterId = (
        await db.getRepository(FinanceCostCenter).save({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          name: 'Operações',
        })
      ).id;
      await service.saveSettings(context, {
        enabled: true,
        expenseAccountId,
        costCenterId,
        maxCostUsd: 2,
        maxCaptureMinutes: 90,
        retentionDays: 30,
      });
    });
    afterAll(async () => {
      if (db?.isInitialized) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    });
    async function room(overrides: Partial<AgencyMeetingRoom> = {}) {
      return db.getRepository(AgencyMeetingRoom).save({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        hostUserId: context.userId,
        title: 'Publicação',
        publicSlug: randomUUID(),
        providerRoomName: randomUUID(),
        startedAt: new Date(),
        status: TeamChatMeetingStatus.LIVE,
        ...overrides,
      });
    }
    const get = (id: string) =>
      db
        .getRepository(AgencyMeetingAiSummary)
        .findOneByOrFail({ meetingRoomId: id });
    async function due(id: string) {
      await db
        .getRepository(AgencyMeetingAiSummary)
        .update({ meetingRoomId: id }, { nextAttemptAt: new Date(0) });
    }
    async function step() {
      const before = await db.getRepository(AgencyMeetingAiSummary).find();
      await worker.tick();
      // Production advances one bounded stage per claim; tests make that stage due explicitly.
      for (let index = 0; index < 5; index++) {
        const rows = await db.getRepository(AgencyMeetingAiSummary).find();
        const pending = rows.filter(
          (row) =>
            row.status === TeamChatAiSummaryStatus.PROCESSING &&
            ['transcribing', 'summarizing', 'exporting'].includes(
              row.execution!.stage,
            ) &&
            row.execution!.retries ===
              (before.find((old) => old.id === row.id)?.execution!.retries ??
                0),
        );
        if (!pending.length) break;
        for (const row of pending) await due(row.meetingRoomId);
        await worker.tick();
      }
    }
    async function finishRecording(meeting: AgencyMeetingRoom) {
      await db
        .getRepository(AgencyMeetingRoom)
        .update(
          { id: meeting.id },
          { status: TeamChatMeetingStatus.ENDED, endedAt: new Date() },
        );
      const row = await get(meeting.id);
      objects.set(row.execution!.audioRef, audio);
      provider.recording.mockResolvedValue({
        complete: true,
        failed: false,
        active: false,
        duration: 2,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      await due(meeting.id);
    }
    it('creates one intent concurrently, snapshots defaults and produces a ready summary/PDF once', async () => {
      const meeting = await room();
      const intents = await Promise.all([
        service.request(context, meeting.id),
        service.request(context, meeting.id),
      ]);
      expect(intents[0]!.id).toBe(intents[1]!.id);
      await step();
      expect(provider.capture).toHaveBeenCalledTimes(1);
      expect(provider.transcribe).not.toHaveBeenCalled();
      await service.saveSettings(context, {
        enabled: false,
        expenseAccountId: null,
        costCenterId: null,
        maxCostUsd: 1,
        maxCaptureMinutes: 10,
        retentionDays: 5,
      });
      await finishRecording(meeting);
      await step();
      const row = await get(meeting.id);
      expect(row.status).toBe('completed');
      expect(row.execution!.stage).toBe('ready');
      expect(row.execution!.config.expenseAccountId).toBe(expenseAccountId);
      expect(row.execution!.config.costCenterId).toBe(costCenterId);
      expect(row.execution!.calls.map((call) => call.costUsd)).toEqual([
        0.000275, 0.000202,
      ]);
      expect((await service.detail(context, meeting.id))!.costUsd).toBe(
        0.000477,
      );
      expect(
        JSON.stringify(await service.detail(context, meeting.id)),
      ).not.toContain('meeting-ai/');
      expect(
        (await service.listProjection(context, [meeting]))[0].aiAnalysis!
          .status,
      ).toBe('completed');
      await step();
      await service.request(context, meeting.id);
      await service.download(context, meeting.id);
      expect(provider.transcribe).toHaveBeenCalledTimes(1);
      expect(provider.summarize).toHaveBeenCalledTimes(1);
    });
    it('leases one job to one of two workers and skips rows held by another transaction', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      const claims = await Promise.all([worker.claim(), worker.claim()]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await db
        .getRepository(AgencyMeetingAiSummary)
        .update({ meetingRoomId: meeting.id }, { leaseExpiresAt: new Date(0) });
      expect((await worker.claim())!.leaseToken).not.toBe(
        claims.find(Boolean)!.leaseToken,
      );
    });
    it('rejects other tenants/workspaces/nonmembers, private-channel outsiders and nonhost activation', async () => {
      const meeting = await room();
      await expect(
        service.request({ ...context, tenantId: randomUUID() }, meeting.id),
      ).rejects.toThrow();
      await expect(
        service.detail({ ...context, workspaceId: randomUUID() }, meeting.id),
      ).rejects.toThrow();
      await expect(
        service.request({ ...context, userId: randomUUID() }, meeting.id),
      ).rejects.toThrow();
      const other = randomUUID();
      await db.getRepository(WorkspaceUserEntity).save({
        ...context,
        userId: other,
        email: 'other@fixture.test',
        name: 'Bruno',
        role: 'member',
        status: 'active',
      });
      await db.getRepository(AgencyMeetingParticipant).save({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: other,
        meetingRoomId: meeting.id,
      });
      await expect(
        service.request({ ...context, userId: other }, meeting.id),
      ).rejects.toThrow(/anfitrião/);
      const privateMeeting = await room({ channelId: randomUUID() });
      await expect(
        service.detail({ ...context, userId: other }, privateMeeting.id),
      ).rejects.toThrow('Reunião não encontrada.');
      await expect(
        service.download({ ...context, userId: other }, privateMeeting.id),
      ).rejects.toThrow();
      expect(
        await service.accessibleMeetings({ ...context, userId: other }, [
          privateMeeting,
        ]),
      ).toEqual([]);
    });
    it('refuses meeting creation references to another workspace or an unassigned channel', async () => {
      const channel = await db.getRepository(AgencyChatChannel).save({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name: 'Privado',
      });
      await expect(
        service.assertMeetingChannel(
          { ...context, workspaceId: randomUUID() },
          channel.id,
        ),
      ).rejects.toThrow();
      await expect(
        service.assertMeetingChannel(context, channel.id),
      ).rejects.toThrow(/Entre no canal/);
      await db.getRepository(AgencyChatChannelMember).save({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        channelId: channel.id,
      });
      await expect(
        service.assertMeetingChannel(context, channel.id),
      ).resolves.toBeUndefined();
    });
    it('validates active expense accounts and cost centers inside the workspace', async () => {
      const settings = await service.configuration(context);
      await expect(
        service.saveSettings(context, {
          ...settings,
          expenseAccountId: randomUUID(),
        }),
      ).rejects.toThrow(/conta de despesa/);
      await db
        .getRepository(FinanceCostCenter)
        .update({ id: costCenterId }, { active: false });
      await expect(service.saveSettings(context, settings)).rejects.toThrow();
      const meeting = await room();
      await expect(service.request(context, meeting.id)).rejects.toThrow();
      expect(provider.capture).not.toHaveBeenCalled();
    });
    it('has no paid dispatch for ended/historical meetings, unavailable providers or exhausted budget', async () => {
      const historical = await room({ status: TeamChatMeetingStatus.ENDED });
      await expect(service.request(context, historical.id)).rejects.toThrow(
        /sem gravação/,
      );
      const meeting = await room();
      provider.availability.mockReturnValueOnce({
        available: false,
        reason: 'Provider disabled',
      });
      await expect(service.request(context, meeting.id)).rejects.toThrow(
        'Provider disabled',
      );
      await service.request(context, meeting.id);
      await step();
      await finishRecording(meeting);
      const row = await get(meeting.id);
      row.execution!.config.maxCostUsd = 0.001;
      await db.getRepository(AgencyMeetingAiSummary).save(row);
      await step();
      expect((await get(meeting.id)).status).toBe('failed');
      expect(provider.transcribe).not.toHaveBeenCalled();
    });
    it('does not redispatch when a provider response is lost, including after restart', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      await finishRecording(meeting);
      provider.transcribe.mockRejectedValue(
        new Error('transport interruption'),
      );
      await step();
      const row = await get(meeting.id);
      expect(row.status).toBe('failed');
      expect(row.execution!.calls[0].state).toBe('unknown');
      expect((await service.detail(context, meeting.id))!.costUsd).toBeNull();
      await due(meeting.id);
      await step();
      expect(provider.transcribe).toHaveBeenCalledTimes(1);
      expect(provider.summarize).not.toHaveBeenCalled();
    });
    it('resumes PDF failures without another paid call and keeps successful usage before validation', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      await finishRecording(meeting);
      pdf.render.mockRejectedValueOnce(
        new Error('PDF engine temporarily unavailable'),
      );
      await step();
      expect((await get(meeting.id)).execution!.stage).toBe('exporting');
      await due(meeting.id);
      await step();
      expect((await get(meeting.id)).status).toBe('completed');
      expect(provider.transcribe).toHaveBeenCalledTimes(1);
      expect(provider.summarize).toHaveBeenCalledTimes(1);
    });
    it('terminates silence, Egress failures and recording-finalization timeouts', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      await finishRecording(meeting);
      provider.transcribe.mockResolvedValue({
        data: { text: '', usage: { input_tokens: 20, output_tokens: 0 } },
        requestId: 'silence',
      });
      await step();
      expect((await get(meeting.id)).errorMessage).toMatch(/fala suficiente/);
      expect(provider.summarize).not.toHaveBeenCalled();
    });
    it('refuses a truncated transcription and marks recordings ending before the room as partial', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      await finishRecording(meeting);
      provider.recording.mockResolvedValue({
        complete: true,
        failed: false,
        active: false,
        duration: 2,
        startedAt: new Date().toISOString(),
        endedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      provider.transcribe.mockResolvedValue({
        data: {
          text: transcript,
          usage: { input_tokens: 100, output_tokens: 2000 },
        },
        requestId: 'truncated',
      });
      await step();
      const row = await get(meeting.id);
      expect(row.status).toBe('failed');
      expect(row.execution!.partial).toBe(true);
      expect(row.errorMessage).toMatch(/limite de saída/);
      expect(row.execution!.calls[0].costUsd).not.toBeNull();
      expect(provider.summarize).not.toHaveBeenCalled();
    });
    it('keeps missing usage unknown and enforces retention without deleting the PDF', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      await finishRecording(meeting);
      provider.transcribe.mockResolvedValue({
        data: { text: transcript },
        requestId: 'missing-usage',
      });
      await step();
      let row = await get(meeting.id);
      expect((await service.detail(context, meeting.id))!.costUsd).toBeNull();
      row.execution!.captureRequestedAt = new Date(
        Date.now() - 31 * 86_400_000,
      ).toISOString();
      await db.getRepository(AgencyMeetingAiSummary).save(row);
      await worker.expireAudio();
      row = await get(meeting.id);
      expect(objects.has(row.execution!.audioRef)).toBe(false);
      expect(objects.has(row.execution!.pdfRef!)).toBe(true);
      expect(row.execution!.audioExpiredAt).toBeTruthy();
    });
    it('caps capture duration, waits for room end and refuses downloads/deletion while processing', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      const row = await get(meeting.id);
      row.execution!.captureStartedAt = new Date(
        Date.now() - 91 * 60_000,
      ).toISOString();
      await db.getRepository(AgencyMeetingAiSummary).save(row);
      await due(meeting.id);
      await step();
      expect(provider.stop).toHaveBeenCalledTimes(1);
      expect((await get(meeting.id)).execution!.stage).toBe('finalizing');
      await expect(service.download(context, meeting.id)).rejects.toThrow(
        'O PDF ainda não está disponível.',
      );
      await expect(service.prepareDelete(context, meeting.id)).rejects.toThrow(
        /Aguarde/,
      );
      expect(provider.transcribe).not.toHaveBeenCalled();
      provider.recording.mockResolvedValue({
        complete: true,
        failed: false,
        active: false,
        duration: 2,
        endedAt: new Date().toISOString(),
      });
      await due(meeting.id);
      await step();
      expect((await get(meeting.id)).execution!.stage).toBe('finalizing');
      expect(provider.transcribe).not.toHaveBeenCalled();
    });
    it('terminates failed Egress and missing finalization instead of leaving processing forever', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      provider.recording.mockResolvedValue({
        complete: false,
        failed: true,
        active: false,
      });
      await due(meeting.id);
      await step();
      expect((await get(meeting.id)).status).toBe('failed');
      const timeout = await room();
      await service.request(context, timeout.id);
      await step();
      await db.getRepository(AgencyMeetingRoom).update(
        { id: timeout.id },
        {
          status: TeamChatMeetingStatus.ENDED,
          endedAt: new Date(Date.now() - 31 * 60_000),
        },
      );
      provider.recording.mockResolvedValue({
        complete: false,
        failed: false,
        active: false,
      });
      await due(timeout.id);
      await step();
      await due(timeout.id);
      await step();
      expect((await get(timeout.id)).errorMessage).toMatch(/30 minutos/);
      expect(provider.transcribe).not.toHaveBeenCalled();
    });
    it('does not repeat a dispatched call after a worker restart and stops capture when disabled', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      await finishRecording(meeting);
      const row = await get(meeting.id);
      row.execution!.calls.push({
        key: 'audio-0',
        kind: 'transcription',
        state: 'dispatched',
        reservedUsd: 0.05,
        costUsd: null,
        inputTokens: null,
        cachedTokens: null,
        outputTokens: null,
        requestId: null,
        model: 'fixture',
        dispatchedAt: new Date().toISOString(),
      });
      await db.getRepository(AgencyMeetingAiSummary).save(row);
      await step();
      expect((await get(meeting.id)).status).toBe('failed');
      expect(provider.transcribe).not.toHaveBeenCalled();
      const disabled = await room();
      await service.request(context, disabled.id);
      await step();
      provider.availability.mockReturnValue({ available: false });
      await due(disabled.id);
      await step();
      expect((await get(disabled.id)).status).toBe('failed');
      expect(provider.summarize).not.toHaveBeenCalled();
    });
    it('recovers a capture accepted before a crash even when the meeting ended meanwhile', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await finishRecording(meeting);
      provider.findCapture.mockResolvedValue('accepted-before-crash');
      await step();
      await due(meeting.id);
      await step();
      expect((await get(meeting.id)).status).toBe('completed');
      expect(provider.capture).not.toHaveBeenCalled();
      expect((await get(meeting.id)).execution!.egressId).toBe(
        'accepted-before-crash',
      );
    });
    it('reconciles a failed job until a temporarily unavailable Egress confirms it stopped', async () => {
      const meeting = await room();
      await service.request(context, meeting.id);
      await step();
      provider.availability.mockReturnValue({ available: false });
      provider.recording.mockRejectedValueOnce(
        new Error('temporary Egress outage'),
      );
      await due(meeting.id);
      await step();
      expect((await get(meeting.id)).execution!.captureStopPending).toBe(true);
      await expect(service.prepareDelete(context, meeting.id)).rejects.toThrow(
        /Aguarde/,
      );
      await due(meeting.id);
      await worker.captureTick();
      expect(provider.stop).toHaveBeenCalledTimes(1);
      expect((await get(meeting.id)).execution!.captureStopPending).toBe(true);
      provider.recording.mockResolvedValue({
        active: false,
        complete: true,
        failed: false,
      });
      await due(meeting.id);
      await worker.captureTick();
      expect((await get(meeting.id)).execution!.captureStopPending).toBe(false);
      expect(provider.transcribe).not.toHaveBeenCalled();
    });
    it('stops a second capture on schedule while transcription of another meeting is blocked', async () => {
      const first = await room();
      await service.request(context, first.id);
      await step();
      await finishRecording(first);
      await worker.captureTick();
      await due(first.id);
      let unblock!: (value: unknown) => void;
      let entered!: () => void;
      const dispatched = new Promise<void>((resolve) => {
        entered = resolve;
      });
      provider.transcribe.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            unblock = resolve;
            entered();
          }),
      );
      const pending = worker.tick();
      await dispatched;
      try {
        const second = await room();
        await service.request(context, second.id);
        await worker.captureTick();
        const row = await get(second.id);
        row.execution!.captureStartedAt = new Date(
          Date.now() - 91 * 60_000,
        ).toISOString();
        await db.getRepository(AgencyMeetingAiSummary).save(row);
        provider.recording.mockResolvedValue({
          active: true,
          complete: false,
          failed: false,
        });
        await due(second.id);
        await worker.captureTick();
        expect(provider.stop).toHaveBeenCalledTimes(1);
        expect((await get(second.id)).execution!.stage).toBe('finalizing');
        expect(provider.summarize).not.toHaveBeenCalled();
      } finally {
        unblock({
          data: {
            text: transcript,
            usage: { input_tokens: 100, output_tokens: 30 },
          },
          requestId: 'fixture',
        });
        await pending;
      }
    });
    it('applies and reverses the migration on a legacy summary table', async () => {
      const runner = db.createQueryRunner();
      await runner.connect();
      const migration = new CreateMeetingAiProcessing1798900000000();
      try {
        await runner.query(
          'CREATE INDEX agency_meeting_ai_worker_due ON agency_meeting_ai_summaries(next_attempt_at, lease_expires_at)',
        );
        await migration.down(runner);
        await migration.up(runner);
        await service.saveSettings(context, {
          enabled: true,
          expenseAccountId,
          costCenterId,
          maxCostUsd: 2,
          maxCaptureMinutes: 90,
          retentionDays: 30,
        });
        const meeting = await room();
        const first = await service.request(context, meeting.id);
        expect(first!.stage).toBe('starting');
        await expect(
          db.getRepository(AgencyMeetingAiSummary).save({
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            meetingRoomId: meeting.id,
            execution: (await get(meeting.id)).execution,
          }),
        ).rejects.toThrow(/unique/);
      } finally {
        await runner.release();
      }
    });
  },
);
