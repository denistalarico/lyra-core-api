// AgencySettingsService pulls otplib (ESM) into Jest; the addon is mocked in these tests.
jest.mock('../../agency/agency-settings.service', () => ({
  AgencySettingsService: class {},
}));

import {
  ConflictException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SocialAdCredentialError } from '../../social-integrations/credentials/social-ad-credential.error';
import type { FormEntity } from '../entities/form.entity';
import type { FormSubmissionEntity } from '../entities/form-submission.entity';
import { DEFAULT_FORM_GOOGLE_ADS_LEADS } from '../forms.types';
import { FormGoogleAdsLeadsImportService } from './form-google-ads-leads-import.service';

// Fictional lead data only.
const EMAIL = 'lead.ficticio@example.com';
const NAME = 'Pessoa Fictícia';
const TZ = 'America/Sao_Paulo';

function makeForm(overrides: Partial<FormEntity> = {}): FormEntity {
  return {
    id: 'form-1',
    tenantId: 'tenant-1',
    workspaceId: 'ws-1',
    agencyClientId: null,
    companyContextId: null,
    type: 'lead_capture',
    status: 'active',
    googleAdsLeads: { ...DEFAULT_FORM_GOOGLE_ADS_LEADS, enabled: true },
    ...overrides,
  } as FormEntity;
}

const apiRow = (id: string, assetId = '10', gclid: string | null = null) => ({
  leadFormSubmissionData: {
    id,
    ...(gclid ? { gclid } : {}),
    submissionDateTime: '2026-11-10 09:30:00-03:00',
    leadFormSubmissionFields: [
      { fieldType: 'FULL_NAME', fieldValue: NAME },
      { fieldType: 'EMAIL', fieldValue: EMAIL },
    ],
  },
  campaign: { id: '20' },
  asset: { id: assetId },
});

type Existing = { externalLeadId: string; origin: string | null };

function setup(
  options: {
    rows?: unknown[];
    known?: Array<{ formId: string; providerFormId: string }>;
    existing?: (leadId: string, gclid: string | null) => Existing | null;
    locked?: boolean;
    provider?: string;
    form?: FormEntity;
  } = {},
) {
  const form = options.form ?? makeForm();
  const forms = {
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('GROUP BY')) return Promise.resolve(options.known ?? []);
      if (sql.includes('LIMIT 1')) {
        const hit = options.existing?.(
          params[1] as string,
          params[2] as string | null,
        );
        return Promise.resolve(hit ? [hit] : []);
      }
      return Promise.resolve(undefined);
    }),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([form]),
    })),
  };
  const runner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('pg_try_advisory_lock')
          ? [{ locked: options.locked ?? true }]
          : [{}],
      ),
    ),
  };
  const dataSource = { createQueryRunner: jest.fn(() => runner) };
  const connections = {
    list: jest.fn().mockResolvedValue([
      {
        id: 'conn-1',
        provider: options.provider ?? 'google_ads',
        accountName: 'Conta Fictícia',
        maskedAccountId: '•••1234',
        status: 'connected',
        timezone: TZ,
      },
    ]),
  };
  const credentials = {
    resolve: jest.fn().mockResolvedValue({
      connectionId: 'conn-1',
      provider: 'google_ads',
      timezone: TZ,
    }),
  };
  const reader = {
    readLeadSubmissions: jest
      .fn()
      .mockResolvedValue({ rows: options.rows ?? [], truncated: false }),
  };
  let n = 0;
  const leads = {
    store: jest.fn(() =>
      Promise.resolve({ id: `sub-${++n}` } as FormSubmissionEntity),
    ),
  };
  const ingestion = {
    process: jest.fn().mockResolvedValue({ status: 'accepted' }),
  };
  const addon = { isEnabled: jest.fn().mockResolvedValue(true) };
  const service = new FormGoogleAdsLeadsImportService(
    forms as never,
    dataSource as never,
    connections as never,
    credentials as never,
    reader as never,
    leads as never,
    ingestion as never,
    addon as never,
  );
  const patches = () =>
    forms.query.mock.calls
      .filter(([sql]) => String(sql).startsWith('UPDATE'))
      .map(
        ([, params]) =>
          JSON.parse((params as string[])[1]) as Record<string, unknown>,
      );
  return {
    service,
    form,
    forms,
    runner,
    connections,
    credentials,
    reader,
    leads,
    ingestion,
    patches,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('FormGoogleAdsLeadsImportService.importLeads', () => {
  it('stores new leads with origin api, sends them to the CRM and returns the contract', async () => {
    const t = setup({ rows: [apiRow('a-1'), apiRow('a-2')] });
    const result = await t.service.importLeads(t.form, 'conn-1');
    expect(result).toEqual({
      read: 2,
      created: 2,
      duplicates: 0,
      skipped: 0,
      oldestSubmittedAt: '2026-11-10T12:30:00.000Z',
    });
    expect(t.leads.store).toHaveBeenCalledWith(
      t.form,
      expect.objectContaining({ leadId: 'a-1', formId: '10' }),
      'api',
    );
    expect(t.ingestion.process).toHaveBeenCalledTimes(2);
  });

  it('remembers the connection and the summary for the daily reconciliation', async () => {
    const t = setup({ rows: [apiRow('a-1')] });
    await t.service.importLeads(t.form, 'conn-1');
    expect(t.patches()[0]).toMatchObject({
      importConnectionId: 'conn-1',
      lastImportError: null,
      lastImport: { created: 1, trigger: 'manual' },
    });
  });

  it('reads 30 days back from the account day', async () => {
    const t = setup();
    await t.service.importLeads(t.form, 'conn-1');
    const since = (t.reader.readLeadSubmissions.mock.calls[0] as unknown[])[1];
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('D-L3 layer 1: a lead the webhook already stored with the same id is a duplicate', async () => {
    const t = setup({
      rows: [apiRow('a-1')],
      existing: (id) => ({ externalLeadId: id, origin: null }),
    });
    const result = await t.service.importLeads(t.form, 'conn-1');
    expect(result.duplicates).toBe(1);
    expect(t.leads.store).not.toHaveBeenCalled();
    expect(t.patches()[0].lastImport).toMatchObject({ idMatchesWebhook: 1 });
  });

  it('D-L3 layer 2: the same gclid with a different id is a duplicate', async () => {
    const t = setup({
      rows: [apiRow('a-1', '10', 'gclid-1')],
      existing: (_id, gclid) =>
        gclid === 'gclid-1'
          ? { externalLeadId: 'webhook-lead-9', origin: null }
          : null,
    });
    const result = await t.service.importLeads(t.form, 'conn-1');
    expect(result.duplicates).toBe(1);
    expect(t.patches()[0].lastImport).toMatchObject({
      idDiffersFromWebhook: 1,
    });
  });

  it('counts a lost insert race with the webhook as a duplicate', async () => {
    const t = setup({ rows: [apiRow('a-1')] });
    t.leads.store.mockResolvedValueOnce(null as never);
    const result = await t.service.importLeads(t.form, 'conn-1');
    expect(result).toMatchObject({ created: 0, duplicates: 1 });
    expect(t.ingestion.process).not.toHaveBeenCalled();
  });

  it('skips leads of a Google form that the webhook tied to another Lyra form', async () => {
    const t = setup({
      rows: [apiRow('a-1', '10'), apiRow('a-2', '11')],
      known: [
        { formId: 'form-1', providerFormId: '10' },
        { formId: 'form-2', providerFormId: '11' },
      ],
    });
    const result = await t.service.importLeads(t.form, 'conn-1');
    expect(result).toMatchObject({ created: 1, skipped: 1 });
  });

  it('takes every lead of the account when the webhook ids do not match any asset', async () => {
    const t = setup({
      rows: [apiRow('a-1', '10'), apiRow('a-2', '11')],
      known: [{ formId: 'form-1', providerFormId: '999' }],
    });
    const result = await t.service.importLeads(t.form, 'conn-1');
    expect(result.created).toBe(2);
  });

  it('skips rows without an id', async () => {
    const t = setup({ rows: [{ campaign: { id: '1' } }] });
    const result = await t.service.importLeads(t.form, 'conn-1');
    expect(result).toMatchObject({ read: 1, skipped: 1, created: 0 });
  });

  it('answers 409 import_in_progress when another import holds the lock', async () => {
    const t = setup({ locked: false });
    await expect(t.service.importLeads(t.form, 'conn-1')).rejects.toThrow(
      new ConflictException('import_in_progress'),
    );
    expect(t.reader.readLeadSubmissions).not.toHaveBeenCalled();
    expect(t.runner.release).toHaveBeenCalled();
  });

  it('answers 422 connection_not_google_ads for a Meta connection', async () => {
    const t = setup({ provider: 'meta_ads' });
    await expect(t.service.importLeads(t.form, 'conn-1')).rejects.toThrow(
      new UnprocessableEntityException('connection_not_google_ads'),
    );
    expect(t.credentials.resolve).not.toHaveBeenCalled();
  });

  it('answers 404 for a connection outside the form scope', async () => {
    const t = setup();
    await expect(t.service.importLeads(t.form, 'conn-x')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses a form without the Google Ads channel on', async () => {
    const t = setup({
      form: makeForm({ googleAdsLeads: DEFAULT_FORM_GOOGLE_ADS_LEADS }),
    });
    await expect(t.service.importLeads(t.form, 'conn-1')).rejects.toThrow(
      new UnprocessableEntityException('google_ads_leads_disabled'),
    );
  });

  it('maps an expired Google authorization to 422 and records only the code', async () => {
    const t = setup();
    t.credentials.resolve.mockRejectedValueOnce(
      new SocialAdCredentialError('token_expired'),
    );
    await expect(t.service.importLeads(t.form, 'conn-1')).rejects.toThrow(
      new UnprocessableEntityException('token_expired'),
    );
    expect(t.patches()).toEqual([{ lastImportError: 'token_expired' }]);
  });

  it('keeps lead PII out of the logs', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const t = setup({ rows: [apiRow('a-1'), apiRow('a-2')] });
    t.ingestion.process.mockRejectedValueOnce(new Error(`boom ${EMAIL}`));
    await t.service.importLeads(t.form, 'conn-1');
    const lines = [...log.mock.calls, ...warn.mock.calls].flat().join('\n');
    expect(lines).not.toContain(EMAIL);
    expect(lines).not.toContain(NAME);
    expect(warn).toHaveBeenCalled();
  });
});

describe('FormGoogleAdsLeadsImportService.reconcileAll', () => {
  const withConnection = (lastReconciledDay: string | null = null) =>
    makeForm({
      googleAdsLeads: {
        ...DEFAULT_FORM_GOOGLE_ADS_LEADS,
        enabled: true,
        importConnectionId: 'conn-1',
        lastReconciledDay,
      },
    });
  // 08:20 UTC = 05:20 in São Paulo (UTC-3).
  const fiveAm = new Date('2026-11-19T08:20:00Z');

  it('runs in the 05:00 hour of the account and marks the account day', async () => {
    const t = setup({ form: withConnection(), rows: [apiRow('a-1')] });
    await t.service.reconcileAll(fiveAm);
    expect(t.reader.readLeadSubmissions).toHaveBeenCalledTimes(1);
    expect(t.patches()[0]).toMatchObject({
      lastImport: { trigger: 'daily' },
    });
    expect(t.patches()[0].lastReconciledDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does nothing outside the 05:00 hour', async () => {
    const t = setup({ form: withConnection() });
    await t.service.reconcileAll(new Date('2026-11-19T12:20:00Z'));
    expect(t.reader.readLeadSubmissions).not.toHaveBeenCalled();
  });

  it('runs once per account day', async () => {
    const t = setup({ form: withConnection('2026-11-19') });
    await t.service.reconcileAll(fiveAm);
    expect(t.reader.readLeadSubmissions).not.toHaveBeenCalled();
  });

  it('is off with FORMS_GOOGLE_ADS_LEADS_ENABLED=false', async () => {
    const t = setup({ form: withConnection() });
    process.env.FORMS_GOOGLE_ADS_LEADS_ENABLED = 'false';
    try {
      await t.service.reconcileAll(fiveAm);
    } finally {
      delete process.env.FORMS_GOOGLE_ADS_LEADS_ENABLED;
    }
    expect(t.forms.createQueryBuilder).not.toHaveBeenCalled();
  });
});
