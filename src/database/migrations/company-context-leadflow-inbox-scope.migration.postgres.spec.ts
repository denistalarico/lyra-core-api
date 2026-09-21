import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ScopeLeadflowInboxSettingsByCompany1794800000000 } from './1794800000000-scope-leadflow-inbox-settings-by-company';
import { ScopeInboxChannelsByCompany1794810000000 } from './1794810000000-scope-inbox-channels-by-company';
import { ScopeInboxConversationsByCompany1794820000000 } from './1794820000000-scope-inbox-conversations-by-company';

const run = describePostgresIntegration();

run('CC2E LeadFlow settings and Inbox company scope migrations', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('backfills safely, enforces parent scope and runs up/down/up', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    const schema = `cc2e_${process.pid}_${Date.now()}`;
    const settings = new ScopeLeadflowInboxSettingsByCompany1794800000000();
    const channels = new ScopeInboxChannelsByCompany1794810000000();
    const conversations = new ScopeInboxConversationsByCompany1794820000000();
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const singleClientId = randomUUID();
    const zeroClientId = randomUUID();
    const multiClientId = randomUUID();
    const singleCompanyId = randomUUID();
    const companyAId = randomUUID();
    const companyBId = randomUUID();

    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET LOCAL search_path TO "${schema}", public`);
      await createLegacySchema(runner);
      await runner.query(
        `INSERT INTO agency_client_company_contexts
          (id, tenant_id, workspace_id, agency_client_id)
         VALUES ($1,$4,$5,$6), ($2,$4,$5,$7), ($3,$4,$5,$7)`,
        [
          singleCompanyId,
          companyAId,
          companyBId,
          tenantId,
          workspaceId,
          singleClientId,
          multiClientId,
        ],
      );
      await runner.query(
        `INSERT INTO leadflow_client_settings
          (id, tenant_id, workspace_id, agency_client_id, context_type)
         VALUES ($1,$4,$5,$6,'client'), ($2,$4,$5,$7,'client'),
                ($3,$4,$5,$8,'client'), ($9,$4,$5,NULL,'agency')`,
        [
          SETTINGS_SINGLE,
          SETTINGS_ZERO,
          SETTINGS_MULTI,
          tenantId,
          workspaceId,
          singleClientId,
          zeroClientId,
          multiClientId,
          randomUUID(),
        ],
      );
      await runner.query(
        `INSERT INTO inbox_settings (id, tenant_id, workspace_id)
         VALUES ($1,$2,$3)`,
        [randomUUID(), tenantId, workspaceId],
      );
      await runner.query(
        `INSERT INTO inbox_autonomy_controls (id, tenant_id, workspace_id)
         VALUES ($1,$2,$3)`,
        [randomUUID(), tenantId, workspaceId],
      );
      await runner.query(
        `INSERT INTO inbox_channels
          (id, tenant_id, workspace_id, provider, type, external_phone_number_id, status)
         VALUES ($1,$2,$3,'meta','whatsapp','legacy-phone','active')`,
        [LEGACY_CHANNEL, tenantId, workspaceId],
      );
      await runner.query(
        `INSERT INTO inbox_channel_connection_sessions
          (id, tenant_id, workspace_id) VALUES ($1,$2,$3)`,
        [randomUUID(), tenantId, workspaceId],
      );
      await runner.query(
        `INSERT INTO inbox_conversations
          (id, tenant_id, workspace_id, channel_id)
         VALUES ($1,$2,$3,$4), ($5,$2,$3,NULL)`,
        [LEGACY_CONVERSATION, tenantId, workspaceId, LEGACY_CHANNEL, randomUUID()],
      );
      await runner.query(
        `INSERT INTO inbox_messages
          (id, tenant_id, workspace_id, conversation_id, channel_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), tenantId, workspaceId, LEGACY_CONVERSATION, LEGACY_CHANNEL],
      );

      await settings.up(runner);
      await channels.up(runner);
      await conversations.up(runner);

      const backfill = (await runner.query(
        `SELECT id, company_context_id FROM leadflow_client_settings
          WHERE id IN ($1,$2,$3) ORDER BY id`,
        [SETTINGS_SINGLE, SETTINGS_ZERO, SETTINGS_MULTI],
      )) as Array<{ id: string; company_context_id: string | null }>;
      expect(backfill).toEqual([
        { id: SETTINGS_SINGLE, company_context_id: singleCompanyId },
        { id: SETTINGS_ZERO, company_context_id: null },
        { id: SETTINGS_MULTI, company_context_id: null },
      ]);

      const legacyRoots = (await runner.query(
        `SELECT scope_kind, agency_client_id, company_context_id
           FROM inbox_settings
         UNION ALL
         SELECT scope_kind, agency_client_id, company_context_id
           FROM inbox_autonomy_controls
         UNION ALL
         SELECT scope_kind, agency_client_id, company_context_id
           FROM inbox_channels WHERE id = $1
         UNION ALL
         SELECT scope_kind, agency_client_id, company_context_id
           FROM inbox_conversations WHERE id = $2`,
        [LEGACY_CHANNEL, LEGACY_CONVERSATION],
      )) as Array<{
        scope_kind: string;
        agency_client_id: string | null;
        company_context_id: string | null;
      }>;
      expect(legacyRoots).toHaveLength(4);
      expect(
        legacyRoots.every(
          (row) =>
            row.scope_kind === 'legacy_unassigned' &&
            row.agency_client_id === null &&
            row.company_context_id === null,
        ),
      ).toBe(true);

      await runner.query(
        `INSERT INTO inbox_settings
          (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind)
         VALUES ($1,$2,$3,$4,$5,'company'), ($6,$2,$3,$4,$7,'company')`,
        [
          randomUUID(),
          tenantId,
          workspaceId,
          multiClientId,
          companyAId,
          randomUUID(),
          companyBId,
        ],
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO inbox_settings
            (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind)
           VALUES ($1,$2,$3,$4,$5,'company')`,
          [randomUUID(), tenantId, workspaceId, multiClientId, companyAId],
        ),
      );

      const channelAId = randomUUID();
      const channelBId = randomUUID();
      await runner.query(
        `INSERT INTO inbox_channels
          (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind,
           provider, type, external_phone_number_id, status)
         VALUES ($1,$2,$3,$4,$5,'company','meta','whatsapp','phone-a','active')`,
        [channelAId, tenantId, workspaceId, multiClientId, companyAId],
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO inbox_channels
            (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind,
             provider, type, external_phone_number_id, status)
           VALUES ($1,$2,$3,$4,$5,'company','meta','whatsapp','phone-a','active')`,
          [channelBId, tenantId, workspaceId, multiClientId, companyBId],
        ),
      );
      await runner.query(
        `INSERT INTO inbox_channel_connection_sessions
          (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind)
         VALUES ($1,$2,$3,$4,$5,'company')`,
        [randomUUID(), tenantId, workspaceId, multiClientId, companyAId],
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO inbox_channel_connection_sessions
            (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind)
           VALUES ($1,$2,$3,$4,$5,'company')`,
          [randomUUID(), randomUUID(), workspaceId, multiClientId, companyAId],
        ),
      );

      const conversationAId = randomUUID();
      await runner.query(
        `INSERT INTO inbox_conversations
          (id, tenant_id, workspace_id, channel_id, agency_client_id, company_context_id, scope_kind)
         VALUES ($1,$2,$3,$4,$5,$6,'company')`,
        [
          conversationAId,
          tenantId,
          workspaceId,
          channelAId,
          multiClientId,
          companyAId,
        ],
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO inbox_conversations
            (id, tenant_id, workspace_id, channel_id, agency_client_id, company_context_id, scope_kind)
           VALUES ($1,$2,$3,$4,$5,$6,'company')`,
          [
            randomUUID(),
            tenantId,
            workspaceId,
            channelAId,
            multiClientId,
            companyBId,
          ],
        ),
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO inbox_messages
            (id, tenant_id, workspace_id, conversation_id, channel_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), tenantId, workspaceId, conversationAId, LEGACY_CHANNEL],
        ),
      );

      await conversations.down(runner);
      await channels.down(runner);
      await settings.down(runner);
      await expectNoScopeColumns(runner);

      await settings.up(runner);
      await channels.up(runner);
      await conversations.up(runner);
      const scopeColumnCount = (await runner.query(
        `SELECT count(*)::int AS count
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name IN (
              'leadflow_client_settings', 'inbox_settings', 'inbox_autonomy_controls',
              'inbox_channels', 'inbox_channel_connection_sessions', 'inbox_conversations'
            )
            AND column_name IN ('company_context_id', 'scope_kind')`,
      )) as Array<{ count: number }>;
      expect(scopeColumnCount[0]?.count).toBe(11);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});

const SETTINGS_SINGLE = '00000000-0000-4000-8000-000000000001';
const SETTINGS_ZERO = '00000000-0000-4000-8000-000000000002';
const SETTINGS_MULTI = '00000000-0000-4000-8000-000000000003';
const LEGACY_CHANNEL = '00000000-0000-4000-8000-000000000011';
const LEGACY_CONVERSATION = '00000000-0000-4000-8000-000000000021';

async function createLegacySchema(runner: QueryRunner) {
  await runner.query(`
    CREATE TABLE agency_client_company_contexts (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL,
      UNIQUE (id, tenant_id, workspace_id, agency_client_id)
    );
    CREATE TABLE leadflow_client_settings (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, context_type varchar NOT NULL
    );
    CREATE UNIQUE INDEX "IDX_lf_client_settings_unique_client_context"
      ON leadflow_client_settings (tenant_id, workspace_id, agency_client_id)
      WHERE context_type = 'client';
    CREATE TABLE inbox_settings (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL
    );
    CREATE UNIQUE INDEX "idx_inbox_settings_tenant_workspace"
      ON inbox_settings (tenant_id, workspace_id);
    CREATE TABLE inbox_autonomy_controls (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL
    );
    CREATE UNIQUE INDEX "uq_inbox_autonomy_control_scope"
      ON inbox_autonomy_controls (tenant_id, workspace_id);
    CREATE TABLE inbox_channels (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      provider varchar, type varchar NOT NULL, external_id varchar,
      external_account_id varchar, external_page_id varchar,
      external_phone_number_id varchar, status varchar NOT NULL,
      deleted_at timestamptz
    );
    CREATE UNIQUE INDEX "uq_inbox_channel_meta_phone"
      ON inbox_channels (provider, type, external_phone_number_id)
      WHERE deleted_at IS NULL AND status = 'active' AND external_phone_number_id IS NOT NULL;
    CREATE TABLE inbox_channel_connection_sessions (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL
    );
    CREATE TABLE inbox_conversations (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      channel_id uuid
    );
    CREATE TABLE inbox_messages (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      conversation_id uuid NOT NULL, channel_id uuid
    );
  `);
}

async function expectNoScopeColumns(runner: QueryRunner) {
  const result = (await runner.query(
    `SELECT count(*)::int AS count
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (
          'leadflow_client_settings', 'inbox_settings', 'inbox_autonomy_controls',
          'inbox_channels', 'inbox_channel_connection_sessions', 'inbox_conversations'
        )
        AND column_name IN ('company_context_id', 'scope_kind', 'agency_client_id')`,
  )) as Array<{ count: number }>;
  expect(result[0]?.count).toBe(1);
}

async function expectViolation(runner: QueryRunner, runQuery: () => Promise<unknown>) {
  const savepoint = `cc2e_${randomUUID().replaceAll('-', '')}`;
  await runner.query(`SAVEPOINT ${savepoint}`);
  let rejected = false;
  try {
    await runQuery();
  } catch {
    rejected = true;
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await runner.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
  expect(rejected).toBe(true);
}
