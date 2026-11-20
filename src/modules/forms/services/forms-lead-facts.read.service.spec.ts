import { FormsLeadFactsReadService } from './forms-lead-facts.read.service';

/**
 * AN-CRM (D-A1). Fixtures are fictitious and carry no lead PII: the port
 * never selects name, e-mail or phone, and its output has none either.
 */
const scope = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  agencyClientId: null,
  companyContextId: null,
};
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';
const OPP = (n: number) =>
  `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

type Tables = {
  /** Stage rows classified as qualified (any non-empty list = configured). */
  qualifiedStages?: Array<Record<string, unknown>>;
  cohort?: Array<{
    opportunityId: string;
    crm: string | null;
    campaignId: string | null;
    day: string;
  }>;
  own?: string[];
  agency?: Array<Record<string, unknown>>;
  leadflow?: Array<Record<string, unknown>>;
};

function harness(tables: Tables) {
  const route = (sql: string): unknown[] => {
    if (
      sql.includes('FROM "agency_sales_pipelines"') ||
      sql.includes('FROM "crm_pipelines"')
    )
      return tables.qualifiedStages ?? [];
    if (sql.includes('FROM "form_submissions"')) return tables.cohort ?? [];
    if (sql.includes('FROM "social_ad_entities"'))
      return (tables.own ?? []).map((externalId) => ({ externalId }));
    if (sql.includes('FROM "agency_sales_opportunities"'))
      return tables.agency ?? [];
    if (sql.includes('FROM "crm_opportunities"')) return tables.leadflow ?? [];
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  const query = jest.fn((sql: string, params: unknown[]) =>
    Promise.resolve(params ? route(sql) : []),
  );
  const service = new FormsLeadFactsReadService({ query } as never);
  return { service, query };
}

const base = {
  ...scope,
  provider: 'google_ads' as const,
  connectionId: CONNECTION,
  since: '2026-11-01',
  until: '2026-11-07',
  timezone: 'America/Sao_Paulo',
};

describe('FormsLeadFactsReadService', () => {
  it('reports qualified as null (never 0) when no stage is configured', async () => {
    const { service } = harness({
      cohort: [
        {
          opportunityId: OPP(1),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-02',
        },
      ],
      own: ['111'],
      agency: [
        {
          id: OPP(1),
          status: 'open',
          pipelineId: 'p1',
          reachedQualified: true,
          valueCents: '0',
        },
      ],
    });

    const result = await service.facts(base);

    expect(result.qualifiedConfigured).toBe(false);
    expect(result.facts).toEqual([
      {
        provider: 'google_ads',
        connectionId: CONNECTION,
        campaignExternalId: '111',
        day: '2026-11-02',
        leads: 1,
        qualified: null,
        won: 0,
        wonValue: '0.000000',
      },
    ]);
  });

  it('counts qualified by stage class (GA-CONV rule) and sums won value per campaign and day', async () => {
    const { service } = harness({
      qualifiedStages: [
        {
          pipelineId: 'p1',
          pipelineName: 'Vendas',
          id: 'sq',
          name: 'Qualificado',
          position: 2,
        },
      ],
      cohort: [
        {
          opportunityId: OPP(1),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-02',
        },
        {
          opportunityId: OPP(2),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-02',
        },
        {
          opportunityId: OPP(3),
          crm: 'leadflow_crm',
          campaignId: '111',
          day: '2026-11-02',
        },
        {
          opportunityId: OPP(4),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-02',
        },
      ],
      own: ['111'],
      agency: [
        {
          id: OPP(1),
          status: 'open',
          pipelineId: 'p1',
          reachedQualified: true,
          valueCents: '0',
        },
        {
          id: OPP(2),
          status: 'won',
          pipelineId: 'p1',
          reachedQualified: false,
          valueCents: '150050',
        },
        {
          id: OPP(4),
          status: 'open',
          pipelineId: 'p1',
          reachedQualified: false,
          valueCents: '0',
        },
      ],
      leadflow: [
        {
          id: OPP(3),
          status: 'open',
          pipelineId: 'p1',
          reachedQualified: false,
          valueCents: '0',
        },
      ],
    });

    const [fact] = (await service.facts(base)).facts;

    // 1 reached a qualified stage, 1 won (counts even if it skipped the
    // stage), 1 lost without qualifying, 1 not qualified yet.
    expect(fact).toMatchObject({
      leads: 4,
      qualified: 2,
      won: 1,
      wonValue: '1500.500000',
    });
  });

  it('keeps a lead whose opportunity was deleted, without qualifying it', async () => {
    const { service } = harness({
      qualifiedStages: [
        {
          pipelineId: 'p1',
          pipelineName: 'Vendas',
          id: 'sq',
          name: 'Qualificado',
          position: 2,
        },
      ],
      cohort: [
        {
          opportunityId: OPP(1),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-03',
        },
      ],
      own: ['111'],
      agency: [],
    });

    const [fact] = (await service.facts(base)).facts;

    expect(fact).toMatchObject({ leads: 1, qualified: 0, won: 0 });
  });

  it("drops leads of another connection's campaign and leads with no campaign", async () => {
    const { service } = harness({
      cohort: [
        {
          opportunityId: OPP(1),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-02',
        },
        {
          opportunityId: OPP(2),
          crm: 'agency_sales',
          campaignId: '999',
          day: '2026-11-02',
        },
        {
          opportunityId: OPP(3),
          crm: 'agency_sales',
          campaignId: null,
          day: '2026-11-02',
        },
      ],
      own: ['111'],
      agency: [],
    });

    const facts = (await service.facts(base)).facts;

    expect(facts.map((fact) => [fact.campaignExternalId, fact.leads])).toEqual([
      ['111', 1],
    ]);
  });

  it('reads every lead of the scope when no connection is given', async () => {
    const { service, query } = harness({
      cohort: [
        {
          opportunityId: OPP(1),
          crm: 'agency_sales',
          campaignId: null,
          day: '2026-11-02',
        },
      ],
      agency: [],
    });

    const facts = (await service.facts({ ...base, connectionId: null })).facts;

    expect(facts).toEqual([
      expect.objectContaining({
        connectionId: null,
        campaignExternalId: null,
        leads: 1,
      }),
    ]);
    expect(
      query.mock.calls.some(([sql]) => sql.includes('social_ad_entities')),
    ).toBe(false);
  });

  it('reads the Meta source for meta_ads, excludes test leads and falls back to UTC', async () => {
    const { service, query } = harness({});

    await service.facts({
      ...base,
      provider: 'meta_ads',
      timezone: "UTC'; DROP",
    });

    const [sql, params] = query.mock.calls.find(([text]) =>
      text.includes('FROM "form_submissions"'),
    )!;
    expect(params).toEqual([
      scope.tenantId,
      scope.workspaceId,
      null,
      null,
      'meta_lead_ads',
      'UTC',
      '2026-11-01',
      '2026-11-07',
    ]);
    expect(sql).toContain(
      `COALESCE(s."attribution"->>'isTest', 'false') <> 'true'`,
    );
    expect(sql).toContain('s."agency_client_id" IS NOT DISTINCT FROM $3::uuid');
  });

  it('reads "qualified" from the stage class and history, never from a setting or position', async () => {
    const { service, query } = harness({
      cohort: [
        {
          opportunityId: OPP(1),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-02',
        },
        {
          opportunityId: OPP(2),
          crm: 'leadflow_crm',
          campaignId: '111',
          day: '2026-11-02',
        },
      ],
      own: ['111'],
      agency: [],
      leadflow: [],
    });

    await service.facts(base);

    const sql = query.mock.calls.map(([text]) => text).join('\n');
    expect(sql).not.toContain('google_ads_conversion_upload_settings');
    expect(sql).toContain('"agency_sales_opportunity_events"');
    expect(sql).toContain('"crm_opportunity_events"');
    expect(sql).not.toContain('"stagePosition"');
  });

  it('selects no lead PII and returns none', async () => {
    const { service, query } = harness({
      cohort: [
        {
          opportunityId: OPP(1),
          crm: 'agency_sales',
          campaignId: '111',
          day: '2026-11-02',
        },
      ],
      own: ['111'],
      agency: [],
    });

    const result = await service.facts(base);

    const sql = query.mock.calls.map(([text]) => text).join('\n');
    for (const field of [
      'normalized',
      'payload',
      'contact_id',
      'email',
      'phone',
    ])
      expect(sql).not.toContain(field);
    expect(JSON.stringify(result)).not.toContain(OPP(1));
  });
});
