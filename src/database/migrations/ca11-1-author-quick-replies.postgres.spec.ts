import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AddCrmOpportunityAuthor1800060000000 } from './1800060000000-add-crm-opportunity-author';
import { ConsolidateInboxQuickReplies1800070000000 } from './1800070000000-consolidate-inbox-quick-replies';

describePostgresIntegration()(
  'CA11.1 opportunity author and quick replies migrations (Agency test only)',
  () => {
    let runner: QueryRunner;
    let schema: string;
    const tenant = randomUUID(),
      workspace = randomUUID(),
      author = randomUUID(),
      later = randomUUID();
    beforeAll(async () => {
      if (
        AgencyDataSource.options.type !== 'postgres' ||
        AgencyDataSource.options.database !== 'lyra_agency_test'
      )
        throw new Error('CA11.1 requires lyra_agency_test');
      if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    });
    afterAll(async () => {
      await AgencyDataSource.destroy();
    });
    beforeEach(async () => {
      runner = AgencyDataSource.createQueryRunner();
      await runner.connect();
      schema = `ca11_1_${randomUUID().replaceAll('-', '')}`;
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}",public`);
    });
    afterEach(async () => {
      await runner.query('SET search_path TO public');
      await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
      await runner.release();
    });

    it('backfills the author from the first event actor, keeps null for agent creations and reverses', async () => {
      await runner.query(
        'CREATE TABLE crm_opportunities(id uuid PRIMARY KEY,tenant_id uuid,workspace_id uuid)',
      );
      await runner.query(
        'CREATE TABLE crm_opportunity_events(id uuid PRIMARY KEY,opportunity_id uuid,tenant_id uuid,workspace_id uuid,actor_user_id uuid,created_at timestamptz)',
      );
      const human = randomUUID(),
        agent = randomUUID(),
        foreign = randomUUID();
      for (const id of [human, agent, foreign])
        await runner.query('INSERT INTO crm_opportunities VALUES($1,$2,$3)', [
          id,
          tenant,
          workspace,
        ]);
      const event = (
        opportunity: string,
        actor: string | null,
        at: string,
        tenantId = tenant,
      ) =>
        runner.query(
          'INSERT INTO crm_opportunity_events VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), opportunity, tenantId, workspace, actor, at],
        );
      await event(human, later, '2026-01-02');
      await event(human, author, '2026-01-01');
      await event(agent, null, '2026-01-01');
      await event(agent, later, '2026-01-02');
      // An event of another tenant with the same opportunity id never becomes the author.
      await event(foreign, author, '2026-01-01', randomUUID());
      const migration = new AddCrmOpportunityAuthor1800060000000();
      const authors = async () =>
        Object.fromEntries(
          (
            (await runner.query(
              'SELECT id,created_by_user_id FROM crm_opportunities',
            )) as { id: string; created_by_user_id: string | null }[]
          ).map((row) => [row.id, row.created_by_user_id]),
        );
      await migration.up(runner);
      expect(await authors()).toEqual({
        [human]: author,
        [agent]: null,
        [foreign]: null,
      });
      await migration.down(runner);
      expect(
        await runner.query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='crm_opportunities' AND column_name='created_by_user_id'",
          [schema],
        ),
      ).toEqual([]);
      await migration.up(runner);
      expect((await authors())[human]).toBe(author);
    });

    it('moves Agency quick replies to the canonical column and back', async () => {
      await runner.query(
        "CREATE TABLE inbox_settings(id uuid PRIMARY KEY,quick_replies jsonb NOT NULL DEFAULT '[]'::jsonb,metadata jsonb NOT NULL DEFAULT '{}'::jsonb)",
      );
      const edited = randomUUID(),
        untouched = randomUUID();
      const agencyReplies = [
        {
          id: 'r1',
          shortcut: 'ola',
          title: 'Oi',
          message: 'Olá',
          enabled: true,
        },
      ];
      await runner.query(
        'INSERT INTO inbox_settings VALUES($1,$2,$3),($4,$5,$6)',
        [
          edited,
          JSON.stringify([{ id: 'default' }]),
          JSON.stringify({
            composerSendMode: 'enter',
            agencyInbox: {
              composerSendMode: 'enter',
              quickReplies: agencyReplies,
              tags: [{ id: 'vip' }],
            },
          }),
          untouched,
          JSON.stringify([{ id: 'default' }]),
          JSON.stringify({ composerSendMode: 'ctrl_enter' }),
        ],
      );
      const rows = async () =>
        Object.fromEntries(
          (
            (await runner.query(
              'SELECT id,quick_replies,metadata FROM inbox_settings',
            )) as {
              id: string;
              quick_replies: unknown;
              metadata: Record<string, unknown>;
            }[]
          ).map((row) => [row.id, row]),
        );
      const migration = new ConsolidateInboxQuickReplies1800070000000();
      await migration.up(runner);
      let state = await rows();
      expect(state[edited].quick_replies).toEqual(agencyReplies);
      expect(state[edited].metadata).toEqual({
        composerSendMode: 'enter',
        agencyInbox: { composerSendMode: 'enter', tags: [{ id: 'vip' }] },
      });
      expect(state[untouched].quick_replies).toEqual([{ id: 'default' }]);
      expect(state[untouched].metadata).toEqual({
        composerSendMode: 'ctrl_enter',
      });
      await migration.down(runner);
      state = await rows();
      expect(
        (state[edited].metadata.agencyInbox as Record<string, unknown>)
          .quickReplies,
      ).toEqual(agencyReplies);
      expect(state[untouched].metadata).toEqual({
        composerSendMode: 'ctrl_enter',
      });
      await migration.up(runner);
      state = await rows();
      expect(state[edited].quick_replies).toEqual(agencyReplies);
      expect(state[edited].metadata.agencyInbox).not.toHaveProperty(
        'quickReplies',
      );
    });
  },
);
