import { randomUUID } from 'node:crypto';
import {
  Table,
  type DataSource,
  type EntityManager,
  type QueryRunner,
} from 'typeorm';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { CreateOrionTurnsAndHelpSearch1800700000000 } from '../../database/migrations/1800700000000-create-orion-turns-and-help-search';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import type { AiCostLedgerService } from '../ai-costs/ai-cost-ledger.service';
import { HelpArticle } from '../knowledge/help/entities';
import {
  OrionBudgetService,
  type OrionTurnScope,
} from './orion-budget.service';
import type { OrionConfigService } from './orion-config.service';
import { OrionHelpSearchService } from './tools/orion-help-search.service';

/**
 * OR4 on real PostgreSQL, in a throwaway schema of `lyra_agency_test`:
 * migration up/down/up (and idempotent re-run), the reservation under the
 * tenant advisory lock (two concurrent turns, one ceiling), the hourly limit,
 * idempotency, and the Portuguese Help Center search.
 */
describePostgresIntegration()(
  'OR4 Orion ledger and help search (PostgreSQL)',
  () => {
    let runner: QueryRunner, schema: string;
    const migration = new CreateOrionTurnsAndHelpSearch1800700000000();

    /** Every statement in its own transaction, with a transaction-local search_path. */
    const scoped = (): DataSource => {
      const transaction = async <T>(
        work: (manager: EntityManager) => Promise<T>,
      ) => {
        const conn = AgencyDataSource.createQueryRunner();
        await conn.connect();
        await conn.startTransaction();
        try {
          await conn.query(`SET LOCAL search_path TO "${schema}",public`);
          const result = await work(conn.manager);
          await conn.commitTransaction();
          return result;
        } catch (error) {
          await conn.rollbackTransaction();
          throw error;
        } finally {
          await conn.release();
        }
      };
      return {
        transaction,
        query: (sql: string, params?: unknown[]) =>
          transaction((manager) => manager.query(sql, params)),
      } as unknown as DataSource;
    };

    const budget = (overrides: Partial<OrionConfigService> = {}) =>
      new OrionBudgetService(
        scoped(),
        {
          turnReserveUsd: 0.08,
          tenantMonthlyBudgetUsd: 0.1,
          userHourlyLimit: 30,
          prices: () => null,
          pricingVersion: () => null,
          ...overrides,
        } as unknown as OrionConfigService,
        { record: jest.fn() } as unknown as AiCostLedgerService,
      );

    const scope = (
      tenantId: string,
      userId = randomUUID(),
    ): OrionTurnScope => ({
      tenantId,
      workspaceId: randomUUID(),
      agencyClientId: null,
      companyContextId: null,
      userId,
      principal: 'agency',
      surface: 'operations_room',
    });
    const reserveInput = (s: OrionTurnScope, key: string = randomUUID()) => ({
      scope: s,
      idempotencyKey: key,
      provider: 'mock',
      model: 'mock-orion-v1',
      promptVersion: 'orion-v1',
    });
    const columns = async (table: string) =>
      (
        (await runner.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
          [schema, table],
        )) as Array<{ column_name: string }>
      ).map((row) => row.column_name);

    beforeAll(async () => {
      if (
        AgencyDataSource.options.type !== 'postgres' ||
        AgencyDataSource.options.database !== 'lyra_agency_test'
      )
        throw new Error('OR4 requires lyra_agency_test');
      if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    });
    afterAll(async () => {
      await AgencyDataSource.destroy();
    });
    beforeEach(async () => {
      runner = AgencyDataSource.createQueryRunner();
      await runner.connect();
      schema = `or4_orion_${randomUUID().replaceAll('-', '')}`;
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}",public`);
      await runner.createTable(
        Table.create(
          AgencyDataSource.getMetadata(HelpArticle),
          AgencyDataSource.driver,
        ),
        false,
        false,
        false,
      );
      const article = (
        systemKey: string,
        title: string,
        content: string,
        extra = '',
      ) =>
        runner.query(
          `INSERT INTO help_articles (system_key, slug, title, summary, content, content_format, locale, status, searchable)
         VALUES ($1, $1, $2, $3, $4, 'markdown', 'pt-BR', ${extra || `'published', true`})`,
          [systemKey, title, `Resumo de ${title}`, content],
        );
      await article(
        'channel-whatsapp',
        'Conectar o WhatsApp Business',
        'Abra LeadFlow → Canais → WhatsApp e conecte o número da empresa pelo cadastro incorporado.',
      );
      await article(
        'crm-pipelines',
        'Funis e etapas do CRM',
        'Em LeadFlow → CRM → Configurações você cria funis e etapas para as oportunidades.',
      );
      await article(
        'draft-whatsapp',
        'Rascunho sobre WhatsApp',
        'WhatsApp em rascunho.',
        `'draft', true`,
      );
      await article(
        'hidden-whatsapp',
        'WhatsApp oculto',
        'WhatsApp fora da busca.',
        `'published', false`,
      );
      await migration.up(runner);
    });
    afterEach(async () => {
      await runner.query('RESET search_path');
      await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
      await runner.release();
    });

    it('migrates up, down and up again, and re-runs up idempotently', async () => {
      expect(await columns('orion_turns')).toEqual(
        expect.arrayContaining([
          'tenant_id',
          'reserved_cost_usd',
          'tool_calls',
          'idempotency_key',
        ]),
      );
      expect(await columns('help_articles')).toContain('search_vector');
      await migration.up(runner);
      await migration.down(runner);
      expect(await columns('orion_turns')).toEqual([]);
      expect(await columns('help_articles')).not.toContain('search_vector');
      await migration.up(runner);
      expect(await columns('help_articles')).toContain('search_vector');
      await expect(
        runner.query(
          `INSERT INTO orion_turns (tenant_id, workspace_id, user_id, principal, surface, status,
           idempotency_key, provider, model, prompt_version, reserved_cost_usd, agency_client_id)
         VALUES ($1,$1,$1,'agency','operations_room','reserved','k','mock','m','v',0.08,$1)`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/CHK_orion_turns_company_pair/);
    });

    it('lets only one of two concurrent turns pass a ceiling that fits one', async () => {
      const tenantId = randomUUID();
      const results = await Promise.allSettled([
        budget().reserve(reserveInput(scope(tenantId))),
        budget().reserve(reserveInput(scope(tenantId))),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'orion_budget_exhausted' });
      // Another tenant has its own month.
      await expect(
        budget().reserve(reserveInput(scope(randomUUID()))),
      ).resolves.toHaveProperty('id');
    });

    it('frees the reservation when a mock turn settles at zero; counts the hour and the idempotency key', async () => {
      const tenantId = randomUUID();
      const user = scope(tenantId);
      const service = budget({
        userHourlyLimit: 2,
      } as Partial<OrionConfigService>);
      const first = await service.reserve(reserveInput(user, 'key-1'));
      await expect(
        service.reserve(reserveInput(user, 'key-1')),
      ).rejects.toMatchObject({
        code: 'orion_turn_in_progress',
      });
      await service.succeed(first, {
        usage: {},
        rounds: 1,
        attempts: 1,
        latencyMs: 5,
        toolCalls: [],
      });
      await expect(service.monthlyBudgetAvailable(tenantId)).resolves.toBe(
        true,
      );
      await expect(
        service.reserve(reserveInput(user, 'key-1')),
      ).rejects.toMatchObject({
        code: 'orion_turn_replayed',
      });
      await service.reserve(reserveInput(user, 'key-2'));
      await expect(
        service.reserve(reserveInput(user, 'key-3')),
      ).rejects.toMatchObject({
        code: 'orion_rate_limited',
      });
      const [row] = (await runner.query(
        `SELECT status, estimated_cost_usd::text AS cost, tool_calls FROM orion_turns WHERE id = $1`,
        [first.id],
      )) as Array<Record<string, unknown>>;
      expect(row).toEqual({
        status: 'succeeded',
        cost: '0.000000',
        tool_calls: [],
      });
    });

    it('finds published, searchable articles by a natural question, title first', async () => {
      const search = new OrionHelpSearchService(scoped());
      const hits = await search.search(
        'Como eu conecto o WhatsApp no LeadFlow?',
      );
      // Terms are OR-ed and ranked: the CRM article also mentions LeadFlow, but
      // ranks below; drafts and non-searchable articles never appear.
      expect(hits.map((hit) => hit.slug)).toEqual([
        'channel-whatsapp',
        'crm-pipelines',
      ]);
      expect(hits[0].excerpt.length).toBeGreaterThan(0);
      const funnel = await search.search('funil de vendas e etapas');
      expect(funnel[0]).toMatchObject({ slug: 'crm-pipelines' });
      expect(funnel.map((hit) => hit.slug)).not.toContain('draft-whatsapp');
      await expect(search.search('o e de')).resolves.toEqual([]);
      await expect(search.search("x' | !(\\")).resolves.toEqual([]);
    });
  },
);
