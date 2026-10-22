import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { UpdateTeamConnectionStatusDto } from '../dto';
import { TeamMember } from '../entities';
import { TeamMemberStatus } from '../enums';
import { TeamService } from './team.service';

const run = describePostgresIntegration();

run('Team connection status (disposable PostgreSQL)', () => {
  const schema = `team_presence_${randomUUID().replace(/-/g, '')}`;
  const ctx = {
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    userId: randomUUID(),
  };
  const options = {
    type: 'postgres' as const,
    host: process.env.AGENCY_DB_HOST,
    port: Number(process.env.AGENCY_DB_PORT),
    username: process.env.AGENCY_DB_USERNAME,
    password: process.env.AGENCY_DB_PASSWORD,
    database: process.env.AGENCY_DB_NAME,
  };
  let admin: DataSource;
  let db: DataSource;
  let members: Repository<TeamMember>;
  let service: TeamService;
  let own: TeamMember;
  let others: TeamMember[];

  beforeAll(async () => {
    admin = await new DataSource(options).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      ...options,
      schema,
      entities: [TeamMember],
      synchronize: true,
      extra: { options: `-c search_path=${schema},public` },
    }).initialize();
    members = db.getRepository(TeamMember);
    service = new TeamService(
      {} as never,
      {} as never,
      {} as never,
      members,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    own = await members.save(
      members.create({
        ...ctx,
        displayName: 'Own member',
        metadata: {
          attendanceSchedule: { monday: 8 },
          profile: { summary: 'Kept' },
        },
      }),
    );
    const variants = [
      { userId: randomUUID() },
      { workspaceId: randomUUID() },
      { tenantId: randomUUID() },
      { status: TeamMemberStatus.Inactive },
      { archivedAt: new Date() },
    ];
    others = await members.save(
      variants.map((variant) =>
        members.create({
          ...ctx,
          displayName: 'Other member',
          ...variant,
        }),
      ),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('updates only connection metadata and projects the status in the directory', async () => {
    await service.updateOwnConnectionStatus(ctx, own.id, { status: 'busy' });
    const saved = await members.findOneByOrFail({ id: own.id });
    expect(saved.metadata).toMatchObject({
      attendanceSchedule: { monday: 8 },
      profile: { summary: 'Kept' },
    });
    expect(saved.metadata.connectionPresence).toHaveProperty('status', 'busy');
    expect(saved.metadata.connectionPresence).toHaveProperty('seenAt');
    const list = await service.listMembers(ctx, {});
    expect(list.find((member) => member.id === own.id)?.connectionStatus).toBe(
      'busy',
    );
    expect(
      list
        .filter((member) => member.id !== own.id)
        .every((member) => member.connectionStatus === 'offline'),
    ).toBe(true);
  });

  it('refuses another member, tenant, workspace, inactive or archived membership', async () => {
    for (const other of others) {
      await expect(
        service.updateOwnConnectionStatus(ctx, other.id, {
          status: 'available',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await members.findOneByOrFail({ id: other.id })).metadata,
      ).toEqual({});
    }
  });

  it('expires a lost connection and honors explicit offline', async () => {
    await members.update(own.id, {
      metadata: {
        connectionPresence: {
          status: 'available',
          seenAt: new Date(Date.now() - 91_000).toISOString(),
        },
      },
    });
    expect(
      (await service.listMembers(ctx, {})).find(
        (member) => member.id === own.id,
      )?.connectionStatus,
    ).toBe('offline');
    await service.updateOwnConnectionStatus(ctx, own.id, { status: 'offline' });
    expect(
      (await service.listMembers(ctx, {})).find(
        (member) => member.id === own.id,
      )?.connectionStatus,
    ).toBe('offline');
  });

  it('validates status and rejects client-supplied identity or timestamps', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    for (const body of [
      { status: 'admin' },
      { status: 'online' },
      {},
      { status: 'available', userId: ctx.userId },
      { status: 'available', seenAt: new Date().toISOString() },
    ]) {
      await expect(
        pipe.transform(body, {
          type: 'body',
          metatype: UpdateTeamConnectionStatusDto,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });
});
