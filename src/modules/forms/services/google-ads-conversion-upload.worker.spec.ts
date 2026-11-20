import { Logger } from '@nestjs/common';
import { GoogleDataManagerError } from '../../social-integrations/services/google-data-manager.client';
import type { GoogleAdsConversionUploadEntity } from '../entities/google-ads-conversion-upload.entity';
import { GoogleAdsConversionUploadWorker } from './google-ads-conversion-upload.worker';

const NOW = new Date('2026-11-20T12:00:00Z');
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';
const AGENCY_OPP = '00000000-0000-4000-8000-0000000000a1';
const LEADFLOW_OPP = '00000000-0000-4000-8000-0000000000b1';
const FOREIGN_OPP = '00000000-0000-4000-8000-0000000000f1';
const GCLID = 'fictitious-gclid-123';

const settingsRow = {
  id: 's1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  companyContextId: null,
  connectionId: CONNECTION,
  enabled: true,
  qualifiedActionResource: 'customers/1112223334/conversionActions/11',
  wonActionResource: 'customers/1112223334/conversionActions/22',
  qualifiedStageIds: ['stage-q'],
  sendValue: true,
};

function setup(
  options: {
    existing?: string[];
    due?: Array<Partial<GoogleAdsConversionUploadEntity>>;
    ingest?: jest.Mock;
  } = {},
) {
  const inserted: Array<Record<string, unknown>> = [];
  const saved: Array<Partial<GoogleAdsConversionUploadEntity>> = [];
  const uploads = {
    find: jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'status' in args.where
          ? (options.due ?? [])
          : (options.existing ?? []).map((transactionId) => ({
              transactionId,
            })),
      ),
    ),
    save: jest.fn((row: Partial<GoogleAdsConversionUploadEntity>) => {
      saved.push({ ...row });
      return Promise.resolve(row);
    }),
    createQueryBuilder: jest.fn(() => {
      const chain = {
        insert: () => chain,
        into: () => chain,
        values: (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows);
          return chain;
        },
        orIgnore: () => chain,
        execute: () =>
          Promise.resolve({ identifiers: inserted.map(() => ({ id: 'x' })) }),
      };
      return chain;
    }),
  };
  const settings = { find: jest.fn().mockResolvedValue([settingsRow]) };
  const query = jest.fn((sql: string) => {
    if (sql.includes('pg_try_advisory_lock'))
      return Promise.resolve([{ locked: true }]);
    if (sql.includes('pg_advisory_unlock')) return Promise.resolve([]);
    if (sql.includes('FROM "form_submissions"'))
      return Promise.resolve([
        {
          submissionId: 'sub-a',
          opportunityId: AGENCY_OPP,
          gclid: GCLID,
          campaignId: '24460619718',
          target: 'agency_sales',
          createdAt: new Date('2026-11-10T10:00:00Z'),
        },
        {
          submissionId: 'sub-b',
          opportunityId: LEADFLOW_OPP,
          gclid: GCLID,
          campaignId: null,
          target: 'leadflow_crm',
          createdAt: new Date('2026-11-10T10:00:00Z'),
        },
        {
          submissionId: 'sub-f',
          opportunityId: FOREIGN_OPP,
          gclid: GCLID,
          campaignId: '999',
          target: 'agency_sales',
          createdAt: new Date('2026-11-10T10:00:00Z'),
        },
      ]);
    if (sql.includes('"social_ad_entities"'))
      return Promise.resolve([{ externalId: '24460619718' }]);
    if (sql.includes('UNION ALL'))
      return Promise.resolve([{ pipelineId: 'p-agency', position: 2 }]);
    if (sql.includes('"agency_sales_opportunities"'))
      return Promise.resolve([
        {
          id: AGENCY_OPP,
          status: 'open',
          pipelineId: 'p-agency',
          stagePosition: 3,
          stageIsLost: false,
          wonAt: null,
          valueAmount: 900,
          currency: 'BRL',
        },
        {
          id: FOREIGN_OPP,
          status: 'won',
          pipelineId: 'p-agency',
          stagePosition: 9,
          stageIsLost: false,
          wonAt: null,
          valueAmount: 900,
          currency: 'BRL',
        },
      ]);
    if (sql.includes('"crm_opportunities"'))
      return Promise.resolve([
        {
          id: LEADFLOW_OPP,
          status: 'won',
          pipelineId: 'p-lf',
          stagePosition: 7,
          stageIsLost: false,
          wonAt: new Date('2026-11-15T10:00:00Z'),
          valueAmount: '1500.50',
          currency: 'BRL',
        },
      ]);
    return Promise.resolve([]);
  });
  const runner = { connect: jest.fn(), release: jest.fn(), query };
  const dataSource = { query, createQueryRunner: () => runner };
  const connections = {
    listSchedulable: jest.fn().mockResolvedValue([
      {
        connectionId: CONNECTION,
        tenantId: 't1',
        workspaceId: 'w1',
        agencyClientId: null,
        companyContextId: null,
        provider: 'google_ads',
        timezone: 'America/Sao_Paulo',
      },
    ]),
  };
  const credentials = {
    resolve: jest.fn().mockResolvedValue({
      provider: 'google_ads',
      externalAccountId: '1112223334',
      accessToken: 'secret',
    }),
  };
  const googleAds = {
    search: jest.fn().mockResolvedValue([
      {
        customer: {
          conversionTrackingSetting: {
            googleAdsConversionCustomer: 'customers/5556667778',
          },
        },
      },
    ]),
  };
  const ingest =
    options.ingest ?? jest.fn().mockResolvedValue({ requestId: 'req-1' });
  const worker = new GoogleAdsConversionUploadWorker(
    settings as never,
    uploads as never,
    dataSource as never,
    connections as never,
    credentials as never,
    googleAds as never,
    { ingestClickConversion: ingest } as never,
  );
  return { worker, inserted, saved, query, ingest, settings };
}

const pendingRow = (over: Partial<GoogleAdsConversionUploadEntity> = {}) => ({
  id: 'u1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  companyContextId: null,
  connectionId: CONNECTION,
  transactionId: `${AGENCY_OPP}:qualified`,
  gclid: GCLID,
  conversionAction: 'customers/1112223334/conversionActions/11',
  conversionAt: NOW,
  conversionValue: null,
  currencyCode: null,
  status: 'pending' as const,
  attempts: 0,
  nextAttemptAt: NOW,
  ...over,
});

describe('GoogleAdsConversionUploadWorker (GA-CONV)', () => {
  const env = process.env.SOCIAL_GOOGLE_ADS_CONVERSION_UPLOAD_ENABLED;
  beforeEach(() => {
    process.env.SOCIAL_GOOGLE_ADS_CONVERSION_UPLOAD_ENABLED = 'true';
  });
  afterAll(() => {
    process.env.SOCIAL_GOOGLE_ADS_CONVERSION_UPLOAD_ENABLED = env;
  });

  it('does nothing while the brake is off', async () => {
    process.env.SOCIAL_GOOGLE_ADS_CONVERSION_UPLOAD_ENABLED = 'false';
    const { worker, query, settings } = setup();
    await worker.sweep(NOW);
    expect(query).not.toHaveBeenCalled();
    expect(settings.find).not.toHaveBeenCalled();
  });

  it('queues qualified for a deal past the stage and qualified+won for a won deal', async () => {
    const { worker, inserted } = setup();
    await worker.run(NOW);
    expect(
      inserted.map((row) => [
        row.transactionId,
        row.conversionAction,
        row.conversionValue,
      ]),
    ).toEqual([
      [`${AGENCY_OPP}:qualified`, settingsRow.qualifiedActionResource, null],
      [`${LEADFLOW_OPP}:qualified`, settingsRow.qualifiedActionResource, null],
      [`${LEADFLOW_OPP}:won`, settingsRow.wonActionResource, '1500.50'],
    ]);
    expect(inserted[2].conversionAt).toEqual(new Date('2026-11-15T10:00:00Z'));
  });

  it('skips a lead whose campaign belongs to another connection', async () => {
    const { worker, inserted } = setup();
    await worker.run(NOW);
    expect(inserted.some((row) => row.opportunityId === FOREIGN_OPP)).toBe(
      false,
    );
  });

  it('does not queue a transaction already recorded', async () => {
    const { worker, inserted } = setup({ existing: [`${LEADFLOW_OPP}:won`] });
    await worker.run(NOW);
    expect(
      inserted.some((row) => row.transactionId === `${LEADFLOW_OPP}:won`),
    ).toBe(false);
  });

  it('reads only real, recent Google-click leads of the exact scope', async () => {
    const { worker, query } = setup();
    await worker.run(NOW);
    const sql = String(
      query.mock.calls.find(([s]) =>
        String(s).includes('form_submissions'),
      )?.[0],
    );
    expect(sql).toContain(
      `COALESCE("attribution"->>'isTest', 'false') <> 'true'`,
    );
    expect(sql).toContain('"agency_client_id" IS NOT DISTINCT FROM');
    expect(sql).toContain('"company_context_id" IS NOT DISTINCT FROM');
  });

  it('uploads a due row to the conversion customer and marks it uploaded', async () => {
    const { worker, ingest, saved } = setup({ due: [pendingRow()] });
    await worker.run(NOW);
    expect(ingest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversionCustomerId: '5556667778',
        conversionActionId: '11',
        transactionId: `${AGENCY_OPP}:qualified`,
      }),
      { validateOnly: false },
    );
    expect(saved.at(-1)).toMatchObject({
      status: 'uploaded',
      attempts: 1,
      requestId: 'req-1',
    });
  });

  it('retries a transient failure and gives up on a refusal', async () => {
    const transient = setup({
      due: [pendingRow()],
      ingest: jest
        .fn()
        .mockRejectedValue(
          new GoogleDataManagerError(
            'transient',
            'google_data_manager_transient',
          ),
        ),
    });
    await transient.worker.run(NOW);
    expect(transient.saved.at(-1)).toMatchObject({
      status: 'pending',
      attempts: 1,
    });
    expect(transient.saved.at(-1)?.nextAttemptAt?.getTime()).toBeGreaterThan(
      NOW.getTime(),
    );

    const refused = setup({
      due: [pendingRow()],
      ingest: jest
        .fn()
        .mockRejectedValue(
          new GoogleDataManagerError(
            'permanent',
            'google_data_manager_bad_request',
            'INVALID_AD_IDENTIFIER_FOR_ACCOUNT',
          ),
        ),
    });
    await refused.worker.run(NOW);
    expect(refused.saved.at(-1)).toMatchObject({
      status: 'failed',
      errorCode:
        'google_data_manager_bad_request:INVALID_AD_IDENTIFIER_FOR_ACCOUNT',
    });
  });

  it('fails a row after the fifth retry', async () => {
    const { worker, saved } = setup({
      due: [pendingRow({ attempts: 5 })],
      ingest: jest
        .fn()
        .mockRejectedValue(
          new GoogleDataManagerError(
            'auth',
            'google_data_manager_scope_missing',
          ),
        ),
    });
    await worker.run(NOW);
    expect(saved.at(-1)).toMatchObject({ status: 'failed', attempts: 6 });
  });

  it('never logs the click id', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { worker } = setup({
      due: [pendingRow()],
      ingest: jest
        .fn()
        .mockRejectedValue(
          new GoogleDataManagerError(
            'transient',
            'google_data_manager_transient',
          ),
        ),
    });
    await worker.run(NOW);
    const lines = [...warn.mock.calls, ...log.mock.calls].flat().map(String);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes(GCLID))).toBe(false);
    warn.mockRestore();
    log.mockRestore();
  });
});
