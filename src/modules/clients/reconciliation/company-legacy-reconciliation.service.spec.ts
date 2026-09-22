import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AgencyClientCompanyContext } from '../entities';
import { CompanyContextReconciliationAudit } from '../entities/company-context-reconciliation-audit.entity';
import { COMPANY_LEGACY_DOMAINS } from './company-legacy-domains';
import { CompanyLegacyReconciliationService } from './company-legacy-reconciliation.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const workspaceId = '20000000-0000-4000-8000-000000000001';
const otherWorkspaceId = '20000000-0000-4000-8000-000000000009';
const clientXId = '30000000-0000-4000-8000-000000000001';
const clientYId = '30000000-0000-4000-8000-000000000002';
const companyAId = '40000000-0000-4000-8000-000000000001';
const companyBId = '40000000-0000-4000-8000-000000000002';
const companyOtherClientId = '40000000-0000-4000-8000-000000000003';
const actorUserId = '60000000-0000-4000-8000-000000000001';

const ctx = { tenantId, workspaceId, userId: actorUserId };

type Row = Record<string, unknown>;

/**
 * A tiny in-memory stand-in for the tables the service touches.
 *
 * The service speaks raw SQL by design (it addresses ~22 differently-shaped
 * tables), so the fake interprets the handful of statement shapes it emits
 * rather than trying to be a database. Anything the service asks for that the
 * fake does not understand throws, so an unnoticed query change fails loudly
 * instead of silently returning nothing.
 */
function makeFixture(options: { tables?: Record<string, Row[]> } = {}) {
  // Every registered domain must be queryable, so the inventory can sweep the
  // whole catalog exactly as it does in production.
  const tables: Record<string, Row[]> = Object.fromEntries(
    COMPANY_LEGACY_DOMAINS.map((domain) => [domain.table, [] as Row[]]),
  );
  Object.assign(tables, options.tables ?? {});

  const contexts: AgencyClientCompanyContext[] = [
    {
      id: companyAId,
      tenantId,
      workspaceId,
      agencyClientId: clientXId,
      companyContactId: 'contact-a',
      status: 'active',
      isPrimary: true,
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    },
    {
      id: companyBId,
      tenantId,
      workspaceId,
      agencyClientId: clientXId,
      companyContactId: 'contact-b',
      status: 'active',
      isPrimary: false,
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    },
    {
      id: companyOtherClientId,
      tenantId,
      workspaceId,
      agencyClientId: clientYId,
      companyContactId: 'contact-c',
      status: 'active',
      isPrimary: true,
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    },
  ] as AgencyClientCompanyContext[];

  const contactNames: Record<string, string> = {
    'contact-a': 'XP Saúde',
    'contact-b': 'XP Previdência',
    'contact-c': 'Outro Cliente',
  };

  const audits: CompanyContextReconciliationAudit[] = [];

  function tableOf(sql: string): { name: string; rows: Row[] } {
    // Legacy sweeps use the `legacy_row` alias; parent lookups query the table
    // directly.
    const match = sql.match(/FROM "([a-z_]+)"|UPDATE "([a-z_]+)"/);
    const name = match?.[1] ?? match?.[2];
    if (!name || !tables[name]) {
      throw new Error(`Unexpected table in SQL: ${sql}`);
    }
    return { name, rows: tables[name] };
  }

  /** Applies the service's legacy predicate the same way Postgres would. */
  function isLegacyRow(row: Row): boolean {
    if (row.company_context_id) return false;
    return 'scope_kind' in row
      ? row.scope_kind === 'legacy_unassigned'
      : Boolean(row.agency_client_id);
  }

  /**
   * Reads a `$n` placeholder's value back out of the statement by finding
   * which position the given SQL fragment binds. This keeps the fake honest
   * about parameter order instead of assuming a fixed layout.
   */
  function boundValue(
    sql: string,
    values: unknown[],
    fragment: RegExp,
  ): unknown {
    const match = sql.match(fragment);
    return match ? values[Number(match[1]) - 1] : undefined;
  }

  const query = jest.fn(async (sql: string, values: unknown[]) => {
    if (sql.includes('agency_client_company_contexts')) {
      const tenant = boundValue(sql, values, /"tenant_id" = \$(\d+)/);
      const workspace = boundValue(sql, values, /"workspace_id" = \$(\d+)/);
      const inList = sql.match(/IN \(([^)]*)\)/)?.[1] ?? '';
      const ids = [...inList.matchAll(/\$(\d+)/g)].map(
        (entry) => values[Number(entry[1]) - 1] as string,
      );
      return contexts
        .filter(
          (entry) =>
            ids.includes(entry.agencyClientId) &&
            entry.tenantId === tenant &&
            entry.workspaceId === workspace &&
            entry.status === 'active' &&
            !entry.archivedAt,
        )
        .map((entry) => ({
          id: entry.id,
          agency_client_id: entry.agencyClientId,
          display_name: contactNames[entry.companyContactId],
        }));
    }

    const { rows } = tableOf(sql);

    if (sql.startsWith('UPDATE')) {
      const rowId = boundValue(sql, values, /"id" = \$(\d+)/) as string;
      const target = rows.find((row) => row.id === rowId);
      if (!target || !isLegacyRow(target)) return [[], 0];
      const company = boundValue(
        sql,
        values,
        /"company_context_id" = \$(\d+)/,
      );
      if (sql.includes(`"scope_kind" = 'company'`)) {
        target.agency_client_id = boundValue(
          sql,
          values,
          /"agency_client_id" = \$(\d+)/,
        );
        target.company_context_id = company;
        target.scope_kind = 'company';
      } else {
        target.company_context_id = company;
      }
      return [[{ id: rowId }], 1];
    }

    const tenant = boundValue(sql, values, /"tenant_id" = \$(\d+)/);
    const workspace = boundValue(sql, values, /"workspace_id" = \$(\d+)/);
    const scoped = rows.filter(
      (row) => row.tenant_id === tenant && row.workspace_id === workspace,
    );

    // Parent lookups address specific ids and do not use the legacy alias.
    if (!sql.includes('legacy_row')) {
      const inList = sql.match(/IN \(([^)]*)\)/)?.[1];
      const ids = inList
        ? [...inList.matchAll(/\$(\d+)/g)].map(
            (entry) => values[Number(entry[1]) - 1] as string,
          )
        : [boundValue(sql, values, /"id" = \$(\d+)/) as string];
      return scoped
        .filter((row) => ids.includes(row.id as string))
        .map((row) => ({
          id: row.id,
          agency_client_id: row.agency_client_id ?? null,
          company_context_id: row.company_context_id ?? null,
        }));
    }

    if (sql.includes('FOR UPDATE')) {
      const rowId = boundValue(sql, values, /legacy_row\."id" = \$(\d+)/);
      const target = scoped.find((row) => row.id === rowId);
      return target
        ? [{ ...target, parent_id: target.pipeline_id ?? target.channel_id ?? null }]
        : [];
    }

    let matching = scoped.filter(isLegacyRow);
    if (sql.includes('AND FALSE')) matching = [];
    const clientFilter = boundValue(
      sql,
      values,
      /legacy_row\."agency_client_id" = \$(\d+)/,
    );
    if (clientFilter !== undefined) {
      matching = matching.filter((row) => row.agency_client_id === clientFilter);
    }
    if (sql.includes('count(*)')) {
      return [{ count: String(matching.length) }];
    }
    const byId = boundValue(sql, values, /legacy_row\."id" = \$(\d+)/);
    if (byId !== undefined) {
      matching = matching.filter((row) => row.id === byId);
    }
    return matching.map((row) => ({ ...row, created_at: new Date(0) }));
  });

  const manager = {
    query,
    getRepository: (entity: unknown) => {
      if (entity === AgencyClientCompanyContext) {
        return {
          findOne: async ({ where }: { where: Record<string, unknown> }) =>
            contexts.find(
              (entry) =>
                entry.id === where.id &&
                entry.tenantId === where.tenantId &&
                entry.workspaceId === where.workspaceId,
            ) ?? null,
        };
      }
      return {
        create: (input: Record<string, unknown>) => ({ ...input }),
        save: async (input: Record<string, unknown>) => {
          const saved = {
            ...input,
            id: `audit-${audits.length + 1}`,
          } as CompanyContextReconciliationAudit;
          audits.push(saved);
          return saved;
        },
      };
    },
  };

  const dataSource = {
    query,
    transaction: async (run: (manager: unknown) => Promise<unknown>) =>
      run(manager),
  } as unknown as DataSource;

  return {
    service: new CompanyLegacyReconciliationService(dataSource),
    tables,
    audits,
    query,
  };
}

function legacyPipeline(id: string) {
  return {
    id,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    agency_client_id: null,
    company_context_id: null,
    scope_kind: 'legacy_unassigned',
    name: 'Pipeline histórico',
    business_mode: 'general',
    is_default: false,
    deleted_at: null,
    created_at: new Date(0),
  };
}

function legacyAgent(id: string, agencyClientId: string = clientXId) {
  return {
    id,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    agency_client_id: agencyClientId,
    company_context_id: null,
    name: 'Agente histórico',
    business_mode_key: 'general',
    status: 'active',
    deleted_at: null,
    created_at: new Date(0),
  };
}

describe('CompanyLegacyReconciliationService — inventory', () => {
  it('counts legacy roots per domain and omits domains with no work', async () => {
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [legacyPipeline('pipeline-1'), legacyPipeline('pipeline-2')],
        crm_opportunities: [],
        inbox_conversations: [],
        leadflow_agents: [legacyAgent('agent-1')],
        social_plans: [],
      },
    });

    const summary = await fixture.service.summary(ctx);

    expect(summary.total).toBe(3);
    expect(summary.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domainKey: 'leadflow.crm.pipeline', count: 2 }),
        expect.objectContaining({ domainKey: 'leadflow.agent', count: 1 }),
      ]),
    );
    expect(
      summary.domains.some((entry) => entry.domainKey === 'social.planner.plan'),
    ).toBe(false);
  });

  it('excludes rows already assigned to a company and rows owned by agency', async () => {
    const assigned = {
      ...legacyPipeline('pipeline-assigned'),
      agency_client_id: clientXId,
      company_context_id: companyAId,
      scope_kind: 'company',
    };
    const agencyRow = {
      ...legacyPipeline('pipeline-agency'),
      scope_kind: 'agency',
    };
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [legacyPipeline('pipeline-legacy'), assigned, agencyRow],
      },
    });

    const { rows, total } = await fixture.service.list(ctx, {
      domainKey: 'leadflow.crm.pipeline',
    });

    expect(total).toBe(1);
    expect(rows.map((row) => row.rowId)).toEqual(['pipeline-legacy']);
  });

  it('filters by agency client, and a client filter never matches clientless legacy rows', async () => {
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [legacyPipeline('pipeline-1')],
        leadflow_agents: [
          legacyAgent('agent-x', clientXId),
          legacyAgent('agent-y', clientYId),
        ],
      },
    });

    const summary = await fixture.service.summary(ctx, {
      agencyClientId: clientXId,
    });

    // The agent carries the client; the `scope_kind` pipeline carries none, so
    // a client filter cannot claim it.
    expect(summary.total).toBe(1);
    expect(summary.domains).toEqual([
      expect.objectContaining({ domainKey: 'leadflow.agent', count: 1 }),
    ]);
  });

  it('projects only allowlisted columns, never secrets or message bodies', async () => {
    const conversation = {
      id: 'conversation-1',
      tenant_id: tenantId,
      workspace_id: workspaceId,
      agency_client_id: null,
      company_context_id: null,
      scope_kind: 'legacy_unassigned',
      title: 'Conversa histórica',
      status: 'open',
      last_message_at: new Date(0),
      last_message_preview: 'segredo que não pode vazar',
      channel_id: null,
      created_at: new Date(0),
    };
    const fixture = makeFixture({
      tables: { inbox_conversations: [conversation] },
    });

    const { rows } = await fixture.service.list(ctx, {
      domainKey: 'leadflow.inbox.conversation',
    });

    expect(rows[0].title).toBe('Conversa histórica');
    expect(Object.keys(rows[0].summary)).toEqual(['status', 'last_message_at']);
    expect(JSON.stringify(rows[0])).not.toContain('segredo');

    const selects = fixture.query.mock.calls
      .map(([sql]) => sql as string)
      .filter((sql) => sql.includes('inbox_conversations'));
    expect(selects.join('\n')).not.toContain('last_message_preview');
  });

  it('offers no companies for a clientless legacy row and flags manual research', async () => {
    const fixture = makeFixture({
      tables: { crm_pipelines: [legacyPipeline('pipeline-1')] },
    });

    const { rows } = await fixture.service.list(ctx, {
      domainKey: 'leadflow.crm.pipeline',
    });

    expect(rows[0].possibleCompanies).toEqual([]);
    expect(rows[0].resolution).toBe('requires_manual_research');
    expect(rows[0].automaticCandidate).toBeNull();
  });

  it('offers only the companies of the row own client', async () => {
    const fixture = makeFixture({
      tables: { leadflow_agents: [legacyAgent('agent-1', clientXId)] },
    });

    const { rows } = await fixture.service.list(ctx, {
      domainKey: 'leadflow.agent',
    });

    expect(rows[0].possibleCompanies.map((entry) => entry.companyContextId)).toEqual([
      companyAId,
      companyBId,
    ]);
    expect(rows[0].resolution).toBe('assignable');
  });
});

describe('CompanyLegacyReconciliationService — automatic candidates', () => {
  it('derives the company from a mandatory company-scoped parent', async () => {
    const pipeline = {
      ...legacyPipeline('pipeline-scoped'),
      agency_client_id: clientXId,
      company_context_id: companyBId,
      scope_kind: 'company',
    };
    const opportunity = {
      id: 'opportunity-1',
      tenant_id: tenantId,
      workspace_id: workspaceId,
      agency_client_id: null,
      company_context_id: null,
      scope_kind: 'legacy_unassigned',
      title: 'Oportunidade histórica',
      status: 'open',
      deleted_at: null,
      pipeline_id: 'pipeline-scoped',
      created_at: new Date(0),
    };
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [pipeline],
        crm_opportunities: [opportunity],
      },
    });

    const { rows } = await fixture.service.list(ctx, {
      domainKey: 'leadflow.crm.opportunity',
    });

    expect(rows[0].automaticCandidate).toEqual({
      companyContextId: companyBId,
      displayName: 'XP Previdência',
    });
    // The parent narrows the choice to exactly itself.
    expect(rows[0].possibleCompanies).toHaveLength(1);
    expect(rows[0].resolution).toBe('assignable');
  });

  it('leaves the row unresolved when the parent is itself still legacy', async () => {
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [legacyPipeline('pipeline-legacy')],
        crm_opportunities: [
          {
            id: 'opportunity-1',
            tenant_id: tenantId,
            workspace_id: workspaceId,
            agency_client_id: null,
            company_context_id: null,
            scope_kind: 'legacy_unassigned',
            title: 'Oportunidade histórica',
            status: 'open',
            deleted_at: null,
            pipeline_id: 'pipeline-legacy',
            created_at: new Date(0),
          },
        ],
      },
    });

    const { rows } = await fixture.service.list(ctx, {
      domainKey: 'leadflow.crm.opportunity',
    });

    expect(rows[0].automaticCandidate).toBeNull();
    expect(rows[0].resolution).toBe('requires_manual_research');
  });
});

describe('CompanyLegacyReconciliationService — assignment', () => {
  it('assigns a clientless legacy root, writing client, company and scope kind together', async () => {
    const fixture = makeFixture({
      tables: { crm_pipelines: [legacyPipeline('pipeline-1')] },
    });

    const result = await fixture.service.assign(
      ctx,
      'leadflow.crm.pipeline',
      'pipeline-1',
      { companyContextId: companyAId, reason: 'Confirmado com o cliente.' },
    );

    expect(result).toMatchObject({
      companyContextId: companyAId,
      agencyClientId: clientXId,
    });
    expect(fixture.tables.crm_pipelines[0]).toMatchObject({
      agency_client_id: clientXId,
      company_context_id: companyAId,
      scope_kind: 'company',
    });
  });

  it('assigns either company of the same client', async () => {
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [legacyPipeline('pipeline-1'), legacyPipeline('pipeline-2')],
      },
    });

    await fixture.service.assign(ctx, 'leadflow.crm.pipeline', 'pipeline-1', {
      companyContextId: companyAId,
      reason: 'Empresa A.',
    });
    await fixture.service.assign(ctx, 'leadflow.crm.pipeline', 'pipeline-2', {
      companyContextId: companyBId,
      reason: 'Empresa B.',
    });

    expect(fixture.tables.crm_pipelines[0].company_context_id).toBe(companyAId);
    expect(fixture.tables.crm_pipelines[1].company_context_id).toBe(companyBId);
  });

  it('rejects a company belonging to another commercial account', async () => {
    const fixture = makeFixture({
      tables: { leadflow_agents: [legacyAgent('agent-1', clientXId)] },
    });

    await expect(
      fixture.service.assign(ctx, 'leadflow.agent', 'agent-1', {
        companyContextId: companyOtherClientId,
        reason: 'Tentativa inválida.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.tables.leadflow_agents[0].company_context_id).toBeNull();
  });

  it('rejects an assignment that contradicts a company-scoped parent', async () => {
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [
          {
            ...legacyPipeline('pipeline-scoped'),
            agency_client_id: clientXId,
            company_context_id: companyBId,
            scope_kind: 'company',
          },
        ],
        crm_opportunities: [
          {
            id: 'opportunity-1',
            tenant_id: tenantId,
            workspace_id: workspaceId,
            agency_client_id: null,
            company_context_id: null,
            scope_kind: 'legacy_unassigned',
            title: 'Oportunidade histórica',
            status: 'open',
            deleted_at: null,
            pipeline_id: 'pipeline-scoped',
            created_at: new Date(0),
          },
        ],
      },
    });

    await expect(
      fixture.service.assign(ctx, 'leadflow.crm.opportunity', 'opportunity-1', {
        companyContextId: companyAId,
        reason: 'Empresa errada.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a workspace that does not own the company context', async () => {
    const fixture = makeFixture({
      tables: { crm_pipelines: [legacyPipeline('pipeline-1')] },
    });

    await expect(
      fixture.service.assign(
        { ...ctx, workspaceId: otherWorkspaceId },
        'leadflow.crm.pipeline',
        'pipeline-1',
        { companyContextId: companyAId, reason: 'Workspace errado.' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a row from another tenant', async () => {
    const fixture = makeFixture({
      tables: {
        crm_pipelines: [
          { ...legacyPipeline('pipeline-1'), tenant_id: 'other-tenant' },
        ],
      },
    });

    await expect(
      fixture.service.assign(ctx, 'leadflow.crm.pipeline', 'pipeline-1', {
        companyContextId: companyAId,
        reason: 'Tenant errado.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the first assignment win and reports a conflict to the second', async () => {
    const fixture = makeFixture({
      tables: { crm_pipelines: [legacyPipeline('pipeline-1')] },
    });

    await fixture.service.assign(ctx, 'leadflow.crm.pipeline', 'pipeline-1', {
      companyContextId: companyAId,
      reason: 'Primeiro admin.',
    });

    await expect(
      fixture.service.assign(ctx, 'leadflow.crm.pipeline', 'pipeline-1', {
        companyContextId: companyBId,
        reason: 'Segundo admin.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // The row keeps the first winner: this endpoint never moves a row.
    expect(fixture.tables.crm_pipelines[0].company_context_id).toBe(companyAId);
    expect(fixture.audits).toHaveLength(1);
  });

  it('requires a non-empty reason', async () => {
    const fixture = makeFixture({
      tables: { crm_pipelines: [legacyPipeline('pipeline-1')] },
    });

    await expect(
      fixture.service.assign(ctx, 'leadflow.crm.pipeline', 'pipeline-1', {
        companyContextId: companyAId,
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.audits).toHaveLength(0);
  });

  it('records a durable audit entry with the actor, reason and transition', async () => {
    const fixture = makeFixture({
      tables: { leadflow_agents: [legacyAgent('agent-1', clientXId)] },
    });

    await fixture.service.assign(ctx, 'leadflow.agent', 'agent-1', {
      companyContextId: companyBId,
      reason: 'Conferido no contrato.',
    });

    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0]).toMatchObject({
      tenantId,
      workspaceId,
      domainKey: 'leadflow.agent',
      rowId: 'agent-1',
      agencyClientId: clientXId,
      previousCompanyContextId: null,
      assignedCompanyContextId: companyBId,
      actorUserId,
      reason: 'Conferido no contrato.',
    });
  });

  it('rejects an unknown domain key', async () => {
    const fixture = makeFixture();

    await expect(
      fixture.service.assign(ctx, 'leadflow.not-a-domain', 'row-1', {
        companyContextId: companyAId,
        reason: 'Domínio inexistente.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
