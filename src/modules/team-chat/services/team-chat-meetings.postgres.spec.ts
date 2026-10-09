import { randomUUID } from 'crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../../config/typeorm.config';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import {
  AgencyMeetingRoom,
  AgencyMeetingAiSummary,
  AgencyMeetingEvent,
  AgencyMeetingParticipant,
} from '../entities';
import { TeamChatMeetingStatus } from '../enums';
import { TeamChatMeetingsService } from './team-chat-meetings.service';
import type { TeamChatLiveKitProviderService } from './team-chat-livekit-provider.service';
import type { TeamChatNotificationPublisher } from './team-chat-notification.publisher';

const run = describePostgresIntegration();
run(
  'Meeting identity, lifecycle and idle timeout (PostgreSQL; provider boundary scripted)',
  () => {
    const schema = `messages_${randomUUID().replace(/-/g, '')}`;
    const context = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      userId: randomUUID(),
    };
    let db: DataSource;
    let service: TeamChatMeetingsService;
    const provider = {
      roomOccupancy: jest.fn(),
      closeRoom: jest.fn(),
      createParticipantToken: jest.fn(),
    };
    const entities = [
      AgencyMeetingRoom,
      AgencyMeetingAiSummary,
      AgencyMeetingEvent,
      AgencyMeetingParticipant,
      AgencyUserProfileEntity,
      WorkspaceUserEntity,
    ];
    beforeAll(async () => {
      const base = getAgencyTypeOrmConfig() as Extract<
        DataSourceOptions,
        { type: 'postgres' }
      >;
      const bootstrap = new DataSource({
        ...base,
        name: 'messages_bootstrap',
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
        extra: { options: `-c search_path=${schema},public`, max: 6 },
      });
      await db.initialize();
      service = new TeamChatMeetingsService(
        db.getRepository(AgencyMeetingRoom),
        db.getRepository(AgencyMeetingAiSummary),
        db.getRepository(AgencyMeetingParticipant),
        db.getRepository(AgencyMeetingEvent),
        provider as unknown as TeamChatLiveKitProviderService,
        {
          publishMeetingStarted: jest.fn(),
        } as unknown as TeamChatNotificationPublisher,
        db.getRepository(AgencyUserProfileEntity),
        db.getRepository(WorkspaceUserEntity),
      );
    });
    beforeEach(async () => {
      for (const entity of entities) await db.getRepository(entity).clear();
      jest.clearAllMocks();
      provider.roomOccupancy.mockReset().mockResolvedValue(new Map());
      provider.closeRoom.mockReset().mockResolvedValue(undefined);
      provider.createParticipantToken.mockResolvedValue({
        provider: 'livekit',
        token: 'scripted',
        url: 'ws://fixture',
        identity: `user:${context.userId}`,
      });
    });
    afterAll(async () => {
      if (db?.isInitialized) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    });
    async function room(overrides: Partial<AgencyMeetingRoom> = {}) {
      return db.getRepository(AgencyMeetingRoom).save(
        db.getRepository(AgencyMeetingRoom).create({
          ...context,
          title: 'Reunião de refinamento',
          publicSlug: randomUUID(),
          providerRoomName: `fixture-${randomUUID()}`,
          status: TeamChatMeetingStatus.LIVE,
          metadata: { source: 'preserve_parallel_metadata' },
          ...overrides,
        }),
      );
    }
    const expired = () =>
      new Date(Date.now() - 15 * 60_000 - 1000).toISOString();
    const fetchRoom = (id: string) =>
      db.getRepository(AgencyMeetingRoom).findOneByOrFail({ id });

    it('starts an idle timer without losing existing metadata', async () => {
      const meeting = await room();
      await service.endEmptyMeetings();
      const saved = await fetchRoom(meeting.id);
      expect(saved.status).toBe('live');
      expect(saved.metadata).toMatchObject({
        source: 'preserve_parallel_metadata',
        emptySince: expect.any(String),
      });
      expect(provider.closeRoom).not.toHaveBeenCalled();
    });
    it('does not close an empty room before fifteen minutes', async () => {
      const meeting = await room({
        metadata: {
          emptySince: new Date(Date.now() - 14 * 60_000).toISOString(),
        },
      });
      await service.endEmptyMeetings();
      expect((await fetchRoom(meeting.id)).status).toBe('live');
      expect(provider.closeRoom).not.toHaveBeenCalled();
    });
    it('closes after fifteen minutes and records only one event across concurrent workers', async () => {
      const meeting = await room({
        metadata: { emptySince: expired(), source: 'keep' },
      });
      const anotherWorker = new TeamChatMeetingsService(
        db.getRepository(AgencyMeetingRoom),
        db.getRepository(AgencyMeetingAiSummary),
        db.getRepository(AgencyMeetingParticipant),
        db.getRepository(AgencyMeetingEvent),
        provider as never,
        {} as never,
        db.getRepository(AgencyUserProfileEntity),
        db.getRepository(WorkspaceUserEntity),
      );
      await Promise.all([
        service.endEmptyMeetings(),
        anotherWorker.endEmptyMeetings(),
      ]);
      const saved = await fetchRoom(meeting.id);
      expect(saved.status).toBe('ended');
      expect(saved.endedAt).toBeInstanceOf(Date);
      expect(provider.closeRoom).toHaveBeenCalledTimes(1);
      const events = await db
        .getRepository(AgencyMeetingEvent)
        .findBy({ meetingRoomId: meeting.id });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ reason: 'empty_room_timeout' });
    });
    it('resets the timer if any real participant including a guest returns', async () => {
      const meeting = await room({
        metadata: { emptySince: expired(), source: 'keep' },
      });
      provider.roomOccupancy.mockResolvedValue(
        new Map([[meeting.providerRoomName, 1]]),
      );
      await service.endEmptyMeetings();
      expect((await fetchRoom(meeting.id)).metadata).toEqual({
        source: 'keep',
      });
      expect(provider.closeRoom).not.toHaveBeenCalled();
    });
    it('rechecks presence at the timeout boundary', async () => {
      const meeting = await room({ metadata: { emptySince: expired() } });
      provider.roomOccupancy
        .mockResolvedValueOnce(new Map())
        .mockResolvedValue(new Map([[meeting.providerRoomName, 1]]));
      await service.endEmptyMeetings();
      expect((await fetchRoom(meeting.id)).status).toBe('live');
      expect(
        (await fetchRoom(meeting.id)).metadata?.emptySince,
      ).toBeUndefined();
      expect(provider.closeRoom).not.toHaveBeenCalled();
    });
    it.each(['missing', 'unavailable'])(
      'does not interpret %s provider as an empty room',
      async (kind) => {
        const meeting = await room({ metadata: { emptySince: expired() } });
        if (kind === 'missing') provider.roomOccupancy.mockResolvedValue(null);
        else
          provider.roomOccupancy.mockRejectedValue(
            new Error('provider offline'),
          );
        await service.endEmptyMeetings();
        expect((await fetchRoom(meeting.id)).status).toBe('live');
        expect(provider.closeRoom).not.toHaveBeenCalled();
      },
    );
    it('retries closing after a provider error without committing an ended status', async () => {
      const meeting = await room({ metadata: { emptySince: expired() } });
      provider.closeRoom.mockRejectedValueOnce(new Error('close failed'));
      await service.endEmptyMeetings();
      expect((await fetchRoom(meeting.id)).status).toBe('live');
      await service.endEmptyMeetings();
      expect((await fetchRoom(meeting.id)).status).toBe('ended');
    });
    it('manual closing is idempotent and refuses another workspace', async () => {
      const meeting = await room();
      await expect(
        service.endMeeting(
          { ...context, workspaceId: randomUUID() },
          meeting.id,
        ),
      ).rejects.toThrow('Reunião não encontrada');
      expect(provider.closeRoom).not.toHaveBeenCalled();
      await service.endMeeting(context, meeting.id);
      await service.endMeeting(context, meeting.id);
      expect(provider.closeRoom).toHaveBeenCalledTimes(1);
    });
    it('uses authenticated workspace identity and profile avatar, ignoring caller displayName', async () => {
      const meeting = await room();
      await db.getRepository(WorkspaceUserEntity).save({
        ...context,
        name: 'Nome do workspace',
        email: 'test@fixture.invalid',
        role: 'member',
        status: 'active',
      });
      await db.getRepository(AgencyUserProfileEntity).save({
        tenantId: context.tenantId,
        userId: context.userId,
        displayName: 'Ana Lima',
        avatarUrl: '/avatar-ana.png',
      });
      await service.joinInternal(context, meeting.id, {
        displayName: 'Nome falsificado',
      });
      expect(provider.createParticipantToken).toHaveBeenCalledWith(
        expect.objectContaining({
          participantName: 'Ana Lima',
          avatarUrl: '/avatar-ana.png',
          identity: `user:${context.userId}`,
        }),
      );
    });
    it('rejects an internal user with no active membership', async () => {
      const meeting = await room();
      await expect(
        service.joinInternal(context, meeting.id, {}),
      ).rejects.toThrow('Usuário não pertence');
      expect(provider.createParticipantToken).not.toHaveBeenCalled();
    });
    it('public admission activates a scheduled meeting so its idle timer works', async () => {
      const meeting = await room({ status: TeamChatMeetingStatus.SCHEDULED });
      await service.joinPublic(meeting.publicSlug, { guestName: 'Convidado' });
      const saved = await fetchRoom(meeting.id);
      expect(saved.status).toBe('live');
      expect(saved.startedAt).toBeInstanceOf(Date);
    });
    it.each([TeamChatMeetingStatus.ENDED, TeamChatMeetingStatus.CANCELED])(
      'refuses new tokens for a %s meeting',
      async (status) => {
        const meeting = await room({ status });
        await expect(
          service.joinInternal(context, meeting.id, {}),
        ).rejects.toThrow('reunião foi encerrada');
        await expect(
          service.joinPublic(meeting.publicSlug, { guestName: 'Convidado' }),
        ).rejects.toThrow('reunião foi encerrada');
        await expect(service.startMeeting(context, meeting.id)).rejects.toThrow(
          'reunião foi encerrada',
        );
        expect(provider.createParticipantToken).not.toHaveBeenCalled();
      },
    );
  },
);
