import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agencyEntities } from '../../../config/typeorm.config';
import { GoogleAdsConversionUploadEntity } from '../entities/google-ads-conversion-upload.entity';
import { GoogleAdsConversionUploadSettingsEntity } from '../entities/google-ads-conversion-upload-settings.entity';
import { GoogleAdsConversionUploadService } from './google-ads-conversion-upload.service';

const scope = {
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  companyContextId: null,
};
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';
const ACTION_Q = 'customers/1112223334/conversionActions/11';
const ACTION_W = 'customers/1112223334/conversionActions/22';

function setup(
  current: Record<string, unknown> | null = null,
  options: { classified?: boolean } = {},
) {
  const classified = options.classified ?? true;
  const settings = {
    findOne: jest.fn().mockResolvedValue(current),
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn((row: Record<string, unknown>) =>
      Promise.resolve({ ...row, updatedAt: new Date('2026-11-20T12:00:00Z') }),
    ),
  };
  const uploads = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'u1',
        crm: 'agency_sales',
        opportunityId: 'o1',
        kind: 'won',
        status: 'uploaded',
        attempts: 1,
        gclid: 'fictitious-gclid',
        conversionAction: ACTION_W,
        conversionAt: new Date('2026-11-20T10:00:00Z'),
        conversionValue: '900.00',
        currencyCode: 'BRL',
        errorCode: null,
        nextAttemptAt: new Date('2026-11-20T10:00:00Z'),
        uploadedAt: new Date('2026-11-20T10:05:00Z'),
        createdAt: new Date('2026-11-20T10:00:00Z'),
      },
    ]),
  };
  const dataSource = {
    query: jest.fn((sql: string) =>
      Promise.resolve(
        !classified
          ? []
          : sql.includes('agency_sales_pipelines')
            ? [
                {
                  pipelineId: 'pa',
                  pipelineName: 'Vendas',
                  id: 'sa1',
                  name: 'Qualificado',
                  position: 2,
                },
                {
                  pipelineId: 'pa',
                  pipelineName: 'Vendas',
                  id: 'sa2',
                  name: 'Proposta',
                  position: 3,
                },
              ]
            : [
                {
                  pipelineId: 'pl',
                  pipelineName: 'LeadFlow',
                  id: 'sl1',
                  name: 'Qualificado',
                  position: 1,
                },
              ],
      ),
    ),
  };
  const connections = {
    list: jest
      .fn()
      .mockResolvedValue([{ id: CONNECTION, provider: 'google_ads' }]),
  };
  const credentials = {
    resolve: jest.fn().mockResolvedValue({ provider: 'google_ads' }),
  };
  const googleAds = {
    search: jest.fn().mockResolvedValue([
      {
        conversionAction: {
          resourceName: ACTION_W,
          id: '22',
          name: 'Lead convertido',
          category: 'CONVERTED_LEAD',
          primaryForGoal: true,
          valueSettings: {
            defaultValue: 0,
            alwaysUseDefaultValue: true,
            defaultCurrencyCode: 'BRL',
          },
        },
      },
    ]),
  };
  const service = new GoogleAdsConversionUploadService(
    settings as never,
    uploads as never,
    dataSource as never,
    connections as never,
    credentials as never,
    googleAds as never,
  );
  return { service, settings, googleAds, dataSource };
}

describe('GoogleAdsConversionUploadService (GA-CONV §5.4)', () => {
  it('answers the contract defaults when nothing is configured', async () => {
    const { service } = setup();
    expect(await service.get(scope, CONNECTION)).toMatchObject({
      enabled: false,
      qualifiedActionResource: null,
      wonActionResource: null,
      sendValue: true,
    });
    expect(await service.get(scope, CONNECTION)).not.toHaveProperty(
      'qualifiedStageIds',
    );
  });

  it('refuses a connection outside the scope or of another provider', async () => {
    const { service } = setup();
    await expect(
      service.get(scope, '00000000-0000-4000-8000-000000000999'),
    ).rejects.toThrow('connection_not_found');
  });

  it('refuses enabling without any action', async () => {
    const { service } = setup();
    await expect(
      service.update(scope, 'u1', { connectionId: CONNECTION, enabled: true }),
    ).rejects.toThrow('conversion_action_required');
  });

  it('requires a stage classified as qualified with the qualified action', async () => {
    const { service } = setup(null, { classified: false });
    await expect(
      service.update(scope, 'u1', {
        connectionId: CONNECTION,
        qualifiedActionResource: ACTION_Q,
      }),
    ).rejects.toThrow('qualified_stage_required');
  });

  it('saves the actions when some stage is classified as qualified', async () => {
    const { service } = setup();
    const view = await service.update(scope, 'u1', {
      connectionId: CONNECTION,
      enabled: true,
      qualifiedActionResource: ACTION_Q,
      wonActionResource: ACTION_W,
    });
    expect(view).toMatchObject({
      enabled: true,
      qualifiedActionResource: ACTION_Q,
    });
  });

  it('lists the classified stages of both CRMs, by class and never by position', async () => {
    const { service, dataSource } = setup();
    const groups = await service.stages(scope);
    expect(groups.map((group) => [group.crm, group.stages.length])).toEqual([
      ['agency_sales', 2],
      ['leadflow_crm', 1],
    ]);
    const [agencySql, leadflowSql] = dataSource.query.mock.calls.map(
      ([sql]) => sql,
    );
    expect(agencySql).toContain(
      `s."type" IN ('qualified', 'proposal', 'negotiation')`,
    );
    expect(leadflowSql).toContain(`s."role" = 'qualified'`);
  });

  it('skips the Agency CRM in a client context', async () => {
    const { service, dataSource } = setup();
    await service.stages({
      ...scope,
      agencyClientId: '00000000-0000-4000-8000-0000000000a1',
    });
    expect(
      dataSource.query.mock.calls.some(([sql]) =>
        sql.includes('agency_sales_stages'),
      ),
    ).toBe(false);
  });

  it('keeps absent fields and clears with null', async () => {
    const { service } = setup({
      connectionId: CONNECTION,
      enabled: true,
      qualifiedActionResource: ACTION_Q,
      wonActionResource: ACTION_W,
      sendValue: false,
    });
    const view = await service.update(scope, 'u1', {
      connectionId: CONNECTION,
      wonActionResource: null,
    });
    expect(view).toMatchObject({
      qualifiedActionResource: ACTION_Q,
      wonActionResource: null,
      sendValue: false,
    });
  });

  it('lists live actions with the value setting the FE must warn about', async () => {
    const { service, googleAds } = setup();
    const actions = await service.conversionActions(scope, CONNECTION);
    expect(actions).toEqual([
      expect.objectContaining({
        resourceName: ACTION_W,
        alwaysUseDefaultValue: true,
      }),
    ]);
    const [[, gaql]] = googleAds.search.mock.calls as Array<[unknown, string]>;
    expect(gaql).toContain("conversion_action.type = 'UPLOAD_CLICKS'");
  });

  it('keeps the click id out of the history', async () => {
    const { service } = setup();
    const [row] = await service.history(scope, CONNECTION, 20);
    expect(row).not.toHaveProperty('gclid');
    expect(row).toMatchObject({ conversionValue: 900, status: 'uploaded' });
  });
});

describe('GA-CONV boundaries', () => {
  const read = (path: string) => readFileSync(join(__dirname, path), 'utf8');

  it('registers both entities in agencyEntities', () => {
    expect(agencyEntities).toEqual(
      expect.arrayContaining([
        GoogleAdsConversionUploadEntity,
        GoogleAdsConversionUploadSettingsEntity,
      ]),
    );
  });

  it('guards every route with the integrations permission and never exposes it to the Client Area', () => {
    const source = read('../google-ads-conversion-upload.controller.ts');
    const routes = source.match(/@(Get|Patch|Post|Delete|Put)\(/g) ?? [];
    expect(routes.length).toBe(5);
    expect(
      source.match(/@RequirePermission\(SOCIAL_INTEGRATIONS_PERMISSION\)/g),
    ).toHaveLength(5);
    expect(source).not.toContain('ClientAreaExposed');
  });

  it('uploads only through the Data Manager API, never UploadClickConversions', () => {
    for (const path of [
      './google-ads-conversion-upload.worker.ts',
      './google-ads-conversion-upload.service.ts',
      '../../social-integrations/services/google-data-manager.client.ts',
      '../../social-integrations/services/google-ads-mutation.client.ts',
    ])
      expect(read(path)).not.toMatch(/uploadClickConversions/);
  });
});
