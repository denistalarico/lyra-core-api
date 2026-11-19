// AgencySettingsService pulls otplib (ESM) into Jest; the addon is mocked in these tests.
jest.mock('../../agency/agency-settings.service', () => ({
  AgencySettingsService: class {},
}));

import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FormEntity } from '../entities/form.entity';
import type { FormSubmissionEntity } from '../entities/form-submission.entity';
import { DEFAULT_FORM_GOOGLE_ADS_LEADS } from '../forms.types';
import {
  FormGoogleAdsLeadsService,
  googleAdsLeadsView,
  hashGoogleAdsLeadsKey,
} from './form-google-ads-leads.service';

const KEY = 'chave-de-teste-0123456789abcdef';
const PUBLIC_KEY = 'f_aaaaaaaaaaaaaaaaaaaaaaaa';
// Fictional lead: no real data in fixtures.
const EMAIL = 'lead.ficticio@example.com';

function makeForm(overrides: Partial<FormEntity> = {}): FormEntity {
  return {
    id: 'form-1',
    tenantId: 'tenant-1',
    workspaceId: 'ws-1',
    agencyClientId: null,
    companyContextId: null,
    schemaVersion: 1,
    publicKey: PUBLIC_KEY,
    googleAdsLeads: { ...DEFAULT_FORM_GOOGLE_ADS_LEADS, enabled: true },
    googleAdsKeyHash: hashGoogleAdsLeadsKey(KEY),
    ...overrides,
  } as FormEntity;
}

const body = (extra: Record<string, unknown> = {}) => ({
  lead_id: 'lead-1',
  google_key: KEY,
  form_id: 10,
  campaign_id: 20,
  gcl_id: 'gclid-fixture',
  is_test: false,
  lead_submit_time: '2026-11-19T10:00:00Z',
  user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Pessoa Fictícia' },
    { column_id: 'EMAIL', string_value: EMAIL },
  ],
  ...extra,
});

/** First call of a mock, typed (the mocks are loose on purpose). */
const firstCall = (fn: jest.Mock): unknown[] => fn.mock.calls[0] as unknown[];

function setup(form: FormEntity | null = makeForm()) {
  const formQuery = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(form),
  };
  const forms = {
    createQueryBuilder: jest.fn(() => formQuery),
    query: jest.fn().mockResolvedValue(undefined),
    findOneByOrFail: jest.fn().mockResolvedValue(form),
  };
  const insert = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ raw: [{ id: 'sub-1' }] }),
  };
  const stored = { id: 'sub-1', status: 'received' } as FormSubmissionEntity;
  const submissions = {
    createQueryBuilder: jest.fn(() => insert),
    findOneByOrFail: jest.fn().mockResolvedValue(stored),
    save: jest.fn((row: FormSubmissionEntity) => Promise.resolve(row)),
  };
  const addon = { isEnabled: jest.fn().mockResolvedValue(true) };
  const ingestion = {
    process: jest.fn((_form: FormEntity, row: FormSubmissionEntity) =>
      Promise.resolve({ ...row, status: 'accepted' }),
    ),
  };
  const service = new FormGoogleAdsLeadsService(
    forms as never,
    submissions as never,
    addon as never,
    ingestion as never,
  );
  return { service, forms, submissions, insert, addon, ingestion, stored };
}

describe('FormGoogleAdsLeadsService.receive', () => {
  afterEach(() => {
    delete process.env.FORMS_GOOGLE_ADS_LEADS_ENABLED;
    jest.restoreAllMocks();
  });

  it('stores the lead as source google_ads and sends it through the shared ingestion', async () => {
    const { service, insert, ingestion } = setup();
    await expect(service.receive(PUBLIC_KEY, body())).resolves.toEqual({});

    const values = firstCall(insert.values)[0] as Record<string, unknown>;
    expect(values).toMatchObject({
      formId: 'form-1',
      source: 'google_ads',
      externalLeadId: 'lead-1',
      status: 'received',
      attribution: {
        gclid: 'gclid-fixture',
        campaignId: '20',
        isTest: 'false',
      },
    });
    expect(JSON.stringify(values)).not.toContain(KEY);
    expect(insert.orIgnore).toHaveBeenCalledTimes(1);
    expect(ingestion.process).toHaveBeenCalledTimes(1);
  });

  it('wrong key → 403 and nothing is stored', async () => {
    const { service, submissions, ingestion } = setup();
    await expect(
      service.receive(PUBLIC_KEY, body({ google_key: 'outra-chave' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(submissions.createQueryBuilder).not.toHaveBeenCalled();
    expect(ingestion.process).not.toHaveBeenCalled();
  });

  it('missing key, or a form that never generated one → 403', async () => {
    const { service } = setup();
    const withoutKey = body();
    delete (withoutKey as Partial<ReturnType<typeof body>>).google_key;
    await expect(
      service.receive(PUBLIC_KEY, withoutKey),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const noHash = setup(makeForm({ googleAdsKeyHash: null }));
    await expect(
      noHash.service.receive(PUBLIC_KEY, body()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['unknown form', null, PUBLIC_KEY],
    ['malformed public key', makeForm(), 'nope'],
    [
      'channel switched off',
      makeForm({
        googleAdsLeads: { ...DEFAULT_FORM_GOOGLE_ADS_LEADS, enabled: false },
      }),
      PUBLIC_KEY,
    ],
  ])('%s → 404', async (_label, form, publicKey) => {
    const { service, submissions } = setup(form);
    await expect(service.receive(publicKey, body())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(submissions.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('forms addon off → 404', async () => {
    const { service, addon } = setup();
    addon.isEnabled.mockResolvedValue(false);
    await expect(service.receive(PUBLIC_KEY, body())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('the same lead_id twice → one submission, and the CRM is not called again', async () => {
    const { service, insert, ingestion } = setup();
    await service.receive(PUBLIC_KEY, body());
    insert.execute.mockResolvedValue({ raw: [] });
    await expect(service.receive(PUBLIC_KEY, body())).resolves.toEqual({});
    expect(ingestion.process).toHaveBeenCalledTimes(1);
  });

  it('test lead with sendTestLeadsToCrm off → stored for review, CRM not called, test time recorded', async () => {
    const { service, ingestion, submissions, forms } = setup(
      makeForm({
        googleAdsLeads: {
          ...DEFAULT_FORM_GOOGLE_ADS_LEADS,
          enabled: true,
          sendTestLeadsToCrm: false,
        },
      }),
    );
    await service.receive(PUBLIC_KEY, body({ is_test: true }));
    expect(ingestion.process).not.toHaveBeenCalled();
    expect(submissions.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'needs_review' }),
    );
    expect(String(firstCall(forms.query)[0])).toContain('lastTestAt');
  });

  it('test lead with the toggle on (default) goes to the CRM and does not count as received', async () => {
    const { service, ingestion, forms } = setup();
    await service.receive(PUBLIC_KEY, body({ is_test: true }));
    expect(ingestion.process).toHaveBeenCalledTimes(1);
    const sql = String(firstCall(forms.query)[0]);
    expect(sql).toContain('lastTestAt');
    expect(sql).not.toContain('receivedCount');
  });

  it('a real lead bumps the counters with one atomic jsonb_set UPDATE', async () => {
    const { service, forms } = setup();
    await service.receive(PUBLIC_KEY, body());
    expect(forms.query).toHaveBeenCalledTimes(1);
    const sql = String(firstCall(forms.query)[0]);
    expect(sql).toContain('jsonb_set');
    expect(sql).toContain('receivedCount');
    expect((firstCall(forms.query)[1] as unknown[])[2]).toBeNull();
  });

  it('CRM failure after the row is stored → still 200, with a generic last error', async () => {
    const { service, ingestion, forms } = setup();
    ingestion.process.mockResolvedValue({ status: 'failed' } as never);
    await expect(service.receive(PUBLIC_KEY, body())).resolves.toEqual({});
    expect((firstCall(forms.query)[1] as unknown[])[2]).toEqual(
      expect.any(String),
    );
  });

  it('a database error before the row is stored → 503 so Google retries', async () => {
    const { service, insert, ingestion } = setup();
    insert.execute.mockRejectedValue(new Error('connection lost'));
    await expect(service.receive(PUBLIC_KEY, body())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(ingestion.process).not.toHaveBeenCalled();
  });

  it('a database error on the form lookup → 503', async () => {
    const { service, forms } = setup();
    forms.createQueryBuilder.mockImplementation(() => {
      throw new Error('connection lost');
    });
    await expect(service.receive(PUBLIC_KEY, body())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('global switch FORMS_GOOGLE_ADS_LEADS_ENABLED=false → 503', async () => {
    process.env.FORMS_GOOGLE_ADS_LEADS_ENABLED = 'false';
    const { service } = setup();
    await expect(service.receive(PUBLIC_KEY, body())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('ignores fields it does not know', async () => {
    const { service, insert } = setup();
    await service.receive(
      PUBLIC_KEY,
      body({ novo_campo_do_google: { a: 1 }, api_version: '9.9' }),
    );
    expect(JSON.stringify(firstCall(insert.values)[0])).not.toContain(
      'novo_campo_do_google',
    );
  });

  it('rejects a body that is not an object (400), too large (413) or without lead_id (400)', async () => {
    const { service } = setup();
    await expect(service.receive(PUBLIC_KEY, 'x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.receive(PUBLIC_KEY, body({ padding: 'x'.repeat(70 * 1024) })),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(
      service.receive(PUBLIC_KEY, body({ lead_id: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never writes lead data or the key to any log level', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
    );
    // Failure paths that log: lookup, store, processing and counters.
    const pii = new Error(`boom ${EMAIL} Pessoa Fictícia ${KEY}`);
    const a = setup();
    a.insert.execute.mockRejectedValue(pii);
    await a.service.receive(PUBLIC_KEY, body()).catch(() => undefined);
    const b = setup();
    b.ingestion.process.mockRejectedValue(pii);
    b.forms.query.mockRejectedValue(pii);
    await b.service.receive(PUBLIC_KEY, body());
    const c = setup();
    c.forms.createQueryBuilder.mockImplementation(() => {
      throw pii;
    });
    await c.service.receive(PUBLIC_KEY, body()).catch(() => undefined);

    const logged = spies
      .flatMap((spy) => spy.mock.calls.flat() as unknown[])
      .join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('Pessoa Fictícia');
    expect(logged).not.toContain(KEY);
  });
});

describe('FormGoogleAdsLeadsService admin', () => {
  it('generateKey stores only the sha256 and returns the key once with its last 4 chars', async () => {
    const { service, forms } = setup();
    const { key, keyHint } = await service.generateKey(makeForm());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHint).toBe(key.slice(-4));
    const params = firstCall(forms.query)[1] as string[];
    expect(params[1]).toBe(hashGoogleAdsLeadsKey(key));
    expect(params).not.toContain(key);
  });

  it('updateSettings merges only the given flags', async () => {
    const { service, forms } = setup();
    await service.updateSettings(makeForm(), { sendTestLeadsToCrm: false });
    expect(firstCall(forms.query)[1]).toEqual([
      'form-1',
      JSON.stringify({ sendTestLeadsToCrm: false }),
    ]);
  });

  it('view fills defaults and builds the webhook URL, without any key material', () => {
    const view = googleAdsLeadsView(makeForm({ googleAdsLeads: {} as never }));
    expect(view).toEqual({
      ...DEFAULT_FORM_GOOGLE_ADS_LEADS,
      webhookUrl: `https://api.lyrasuite.com/api/public/forms/${PUBLIC_KEY}/google-ads-leads`,
    });
    expect(JSON.stringify(view)).not.toMatch(/hash/i);
  });
});
