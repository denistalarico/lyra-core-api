// AgencySettingsService pulls otplib (ESM) into Jest; the addon is mocked in these tests.
jest.mock('../../agency/agency-settings.service', () => ({
  AgencySettingsService: class {},
}));

import { Logger, UnprocessableEntityException } from '@nestjs/common';
import { OrganicLeadAdsError } from '../../social-organic/lead-ads/social-organic-lead-ads.service';
import type { FormEntity } from '../entities/form.entity';
import type { FormSubmissionEntity } from '../entities/form-submission.entity';
import { DEFAULT_FORM_META_LEADS, type FormMetaLeads } from '../forms.types';
import { FormMetaLeadsService, routeLead } from './form-meta-leads.service';

// Fictional lead: no real data in fixtures.
const EMAIL = 'lead.ficticio@example.com';
const PAGE = '777';

function makeForm(
  id: string,
  meta: Partial<FormMetaLeads> = {},
  overrides: Partial<FormEntity> = {},
): FormEntity {
  return {
    id,
    tenantId: 'tenant-1',
    workspaceId: 'ws-1',
    agencyClientId: null,
    companyContextId: null,
    schemaVersion: 1,
    status: 'active',
    type: 'lead_capture',
    metaLeads: {
      ...DEFAULT_FORM_META_LEADS,
      enabled: true,
      pageIds: [PAGE],
      ...meta,
    },
    ...overrides,
  } as FormEntity;
}

const SCOPE = {
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  agencyClientId: null,
  companyContextId: null,
  assetId: 'asset-1',
};

const notification = (formId: string | null = '55') => ({
  leadgenId: '9001',
  pageId: PAGE,
  formId,
  adId: '301',
  adgroupId: '201',
  createdAt: null,
});

const graphLead = (extra: Record<string, unknown> = {}) => ({
  id: '9001',
  created_time: '2026-11-20T08:49:14+0000',
  campaign_id: '101',
  adset_id: '201',
  ad_id: '301',
  form_id: '55',
  field_data: [
    { name: 'full_name', values: ['Pessoa Fictícia'] },
    { name: 'email', values: [EMAIL] },
  ],
  ...extra,
});

const PAGE_ROW = {
  assetId: 'asset-1',
  pageId: PAGE,
  name: 'Página Fictícia',
  permission: 'ready' as const,
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  agencyClientId: null,
  companyContextId: null,
};

function setup(linked: FormEntity[] = [makeForm('form-1')]) {
  const formQuery = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(linked),
  };
  const forms = {
    createQueryBuilder: jest.fn(() => formQuery),
    query: jest.fn().mockResolvedValue(undefined),
    findOneByOrFail: jest.fn().mockResolvedValue(linked[0]),
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
  const runner = {
    connect: jest.fn(),
    release: jest.fn(),
    query: jest.fn().mockResolvedValue([{ locked: true }]),
  };
  const dataSource = { createQueryRunner: jest.fn(() => runner) };
  const addon = { isEnabled: jest.fn().mockResolvedValue(true) };
  const ingestion = {
    process: jest.fn((_form: FormEntity, row: FormSubmissionEntity) =>
      Promise.resolve({ ...row, status: 'accepted' }),
    ),
  };
  const leadAds = {
    listPages: jest.fn().mockResolvedValue([PAGE_ROW]),
    subscribe: jest.fn().mockResolvedValue('subscribed'),
    readLead: jest.fn().mockResolvedValue(graphLead()),
    listForms: jest.fn().mockResolvedValue([{ id: '55' }]),
    listFormLeads: jest
      .fn()
      .mockResolvedValue({ leads: [graphLead()], truncated: false }),
  };
  const relay = { register: jest.fn() };
  const service = new FormMetaLeadsService(
    forms as never,
    submissions as never,
    dataSource as never,
    addon as never,
    ingestion as never,
    leadAds as never,
    relay as never,
  );
  return {
    service,
    forms,
    formQuery,
    insert,
    submissions,
    ingestion,
    leadAds,
    relay,
    runner,
  };
}

const firstValues = (insert: { values: jest.Mock }) =>
  (insert.values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;

describe('FormMetaLeadsService.receive (ML1)', () => {
  afterEach(() => {
    delete process.env.FORMS_META_LEADS_ENABLED;
    jest.restoreAllMocks();
  });

  it('registers itself as the leadgen sink on init', () => {
    const { service, relay } = setup();
    service.onModuleInit();
    expect(relay.register).toHaveBeenCalledTimes(1);
  });

  it('stores the lead as meta_lead_ads keyed by leadgen_id and sends it to the CRM', async () => {
    const { service, insert, ingestion } = setup();
    await expect(service.receive(SCOPE, notification())).resolves.toEqual({
      kind: 'processed',
    });
    expect([
      firstValues(insert).source,
      firstValues(insert).externalLeadId,
      ingestion.process.mock.calls.length,
    ]).toEqual(['meta_lead_ads', '9001', 1]);
  });

  it('reads the lead with the Page scope the webhook resolved', async () => {
    const { service, leadAds } = setup();
    await service.receive(SCOPE, notification());
    expect(leadAds.readLead).toHaveBeenCalledWith(SCOPE, '9001');
  });

  it('D-L3: the same leadgen_id again settles processed without a second CRM call', async () => {
    const { service, insert, ingestion } = setup();
    insert.execute.mockResolvedValue({ raw: [] });
    await expect(service.receive(SCOPE, notification())).resolves.toEqual({
      kind: 'processed',
    });
    expect(ingestion.process).not.toHaveBeenCalled();
  });

  it('D-L7: a Page no form links is unrouted and never reaches a CRM', async () => {
    const { service, ingestion, leadAds } = setup([]);
    await expect(service.receive(SCOPE, notification())).resolves.toEqual({
      kind: 'unhandled',
      safeErrorCode: 'lead_unrouted',
    });
    expect([
      ingestion.process.mock.calls.length,
      leadAds.readLead.mock.calls.length,
    ]).toEqual([0, 0]);
  });

  it('D-L7: a Meta form outside formIds bumps unroutedCount on the linked form', async () => {
    const { service, forms } = setup([makeForm('form-1', { formIds: ['56'] })]);
    await service.receive(SCOPE, notification('55'));
    expect(String((forms.query.mock.calls[0] as unknown[])[0])).toContain(
      'unroutedCount',
    );
  });

  it('D-L4: a test lead with the toggle off is held, not sent to the CRM', async () => {
    const { service, ingestion, submissions, leadAds } = setup([
      makeForm('form-1', { sendTestLeadsToCrm: false }),
    ]);
    leadAds.readLead.mockResolvedValue(
      graphLead({
        field_data: [
          { name: 'email', values: ['<test lead: dummy data for email>'] },
        ],
      }),
    );
    await service.receive(SCOPE, notification());
    expect([
      ingestion.process.mock.calls.length,
      (submissions.save.mock.calls[0] as [FormSubmissionEntity])[0].status,
    ]).toEqual([0, 'needs_review']);
  });

  it('retries (failed) when Graph is temporarily unavailable', async () => {
    const { service, leadAds } = setup();
    leadAds.readLead.mockRejectedValue(
      new OrganicLeadAdsError('transient', 'meta_service_unavailable'),
    );
    await expect(service.receive(SCOPE, notification())).resolves.toEqual({
      kind: 'failed',
      safeErrorCode: 'lead_read_failed',
    });
  });

  it('settles a permission refusal as terminal and records only the code', async () => {
    const { service, leadAds, forms } = setup();
    leadAds.readLead.mockRejectedValue(
      new OrganicLeadAdsError('permission', 'meta_permission_denied'),
    );
    await expect(service.receive(SCOPE, notification())).resolves.toEqual({
      kind: 'unhandled',
      safeErrorCode: 'lead_read_denied',
    });
    expect((forms.query.mock.calls[0] as unknown[])[1]).toEqual([
      'form-1',
      JSON.stringify({ lastError: 'meta_permission_denied' }),
    ]);
  });

  it('does nothing while FORMS_META_LEADS_ENABLED=false', async () => {
    process.env.FORMS_META_LEADS_ENABLED = 'false';
    const { service, formQuery } = setup();
    await expect(service.receive(SCOPE, notification())).resolves.toEqual({
      kind: 'unhandled',
      safeErrorCode: 'meta_leads_disabled',
    });
    expect(formQuery.getMany).not.toHaveBeenCalled();
  });

  it('never writes lead data to the logs when the CRM step throws', async () => {
    const { service, ingestion } = setup();
    ingestion.process.mockRejectedValue(new Error(`boom ${EMAIL}`));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await service.receive(SCOPE, notification());
    expect(JSON.stringify(warn.mock.calls)).not.toContain(EMAIL);
  });
});

describe('FormMetaLeadsService admin (ML1)', () => {
  it('refuses a Page outside the form scope', async () => {
    const { service } = setup();
    await expect(
      service.updateSettings(makeForm('form-1'), { pageIds: ['888'] }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('subscribes every linked Page when the channel is on and stores the outcome', async () => {
    const { service, forms, leadAds } = setup();
    leadAds.subscribe.mockResolvedValue('missing_permission');
    await service.updateSettings(makeForm('form-1', { enabled: false }), {
      enabled: true,
      pageIds: [PAGE],
    });
    expect(
      JSON.parse(String((forms.query.mock.calls[0] as unknown[][])[1][1])),
    ).toMatchObject({
      enabled: true,
      pageIds: [PAGE],
      subscription: { [PAGE]: 'missing_permission' },
    });
  });

  it('imports earlier leads and counts the ones already stored as duplicates', async () => {
    const { service, insert, leadAds } = setup();
    leadAds.listFormLeads.mockResolvedValue({
      leads: [graphLead(), graphLead({ id: '9002' })],
      truncated: false,
    });
    insert.execute
      .mockResolvedValueOnce({ raw: [{ id: 'sub-1' }] })
      .mockResolvedValueOnce({ raw: [] });
    await expect(service.importLeads(makeForm('form-1'))).resolves.toEqual(
      expect.objectContaining({ read: 2, created: 1, duplicates: 1 }),
    );
  });

  it('refuses to import while the channel is off', async () => {
    const { service } = setup();
    await expect(
      service.importLeads(makeForm('form-1', { enabled: false })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('routeLead (D-L7)', () => {
  it('prefers the form that names the Meta form over a catch-all one', () => {
    const catchAll = makeForm('a', { formIds: null });
    const specific = makeForm('b', { formIds: ['55'] });
    expect(routeLead([catchAll, specific], '55')?.id).toBe('b');
  });

  it('falls back to a form that takes every Meta form of the Page', () => {
    const catchAll = makeForm('a', { formIds: null });
    expect(
      routeLead([catchAll, makeForm('b', { formIds: ['56'] })], '55')?.id,
    ).toBe('a');
  });
});
