// AgencySettingsService pulls otplib (ESM) into Jest; the addon only needs its getApps/patchApps.
jest.mock('../../agency/agency-settings.service', () => ({
  AgencySettingsService: class {},
}));

import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FormEntity } from '../entities/form.entity';
import type { FormSubmissionEntity } from '../entities/form-submission.entity';
import {
  DEFAULT_FORM_AFTER_SUBMIT,
  DEFAULT_FORM_DESTINATION,
  DEFAULT_FORM_GOOGLE_ADS_LEADS,
  DEFAULT_FORM_INBOUND_EMAIL,
  DEFAULT_FORM_SECURITY,
} from '../forms.types';
import { FormsAddonService } from './forms-addon.service';
import {
  FormsService,
  generatePublicKey,
  hashVisitorIp,
} from './forms.service';

const KEY = 'f_0123456789abcdef01234567';
const CTX = { tenantId: 't-1', workspaceId: 'w-1', userId: 'u-1' };

function activeForm(overrides: Partial<FormEntity> = {}): FormEntity {
  return {
    id: 'form-1',
    tenantId: 't-1',
    workspaceId: 'w-1',
    agencyClientId: null,
    companyContextId: null,
    type: 'lead_capture',
    name: 'Contato',
    description: null,
    status: 'active',
    publicKey: KEY,
    schemaVersion: 3,
    fields: {
      fields: [
        {
          key: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          target: 'contact.name',
        },
        {
          key: 'email',
          label: 'E-mail',
          type: 'email',
          target: 'contact.email',
        },
      ],
    },
    // Simulates a row saved before F2 typed these columns.
    presentation: {} as FormEntity['presentation'],
    tracking: { gtmId: 'GTM-ABC123' } as FormEntity['tracking'],
    destination: { ...DEFAULT_FORM_DESTINATION },
    security: { ...DEFAULT_FORM_SECURITY, minFillSeconds: 2 },
    afterSubmit: { ...DEFAULT_FORM_AFTER_SUBMIT },
    capture: { formSelector: null, fieldMap: {} },
    inboundEmailAddress: null,
    inboundEmail: { ...DEFAULT_FORM_INBOUND_EMAIL },
    googleAdsLeads: { ...DEFAULT_FORM_GOOGLE_ADS_LEADS },
    createdByUserId: null,
    publishedAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

type Row<T> = Partial<T> & Record<string, unknown>;

function setup(form: FormEntity | null = activeForm(), enabled = true) {
  const forms = {
    findOne: jest.fn().mockResolvedValue(form),
    create: jest.fn((row: Row<FormEntity>) => row),
    save: jest.fn((row: Row<FormEntity>) =>
      Promise.resolve({ id: 'form-new', ...row }),
    ),
  };
  const submissions = {
    count: jest.fn().mockResolvedValue(0),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((row: Row<FormSubmissionEntity>) => row),
    save: jest.fn((row: Row<FormSubmissionEntity>) =>
      Promise.resolve({ id: 'sub-1', ...row }),
    ),
  };
  const addon = {
    isEnabled: jest.fn().mockResolvedValue(enabled),
    assertEnabled: jest.fn(),
  };
  const ingestion = {
    process: jest.fn((_form: FormEntity, row: FormSubmissionEntity) =>
      Promise.resolve(row),
    ),
  };
  const service = new FormsService(
    forms as never,
    submissions as never,
    {} as never,
    {} as never,
    {} as never,
    addon as never,
    ingestion as never,
  );
  return { service, forms, submissions, addon, ingestion };
}

const META = { ip: '203.0.113.9', userAgent: 'jest' };

describe('FormsService public submit', () => {
  it('stores declared keys only, then runs ingestion', async () => {
    const { service, submissions, ingestion } = setup();
    const result = await service.submitPublic(
      KEY,
      {
        values: { nome: 'Ana', email: 'ANA@x.com', extra: 'drop' },
        elapsedMs: 5000,
        attribution: { utm_source: 'g' },
      },
      META,
    );
    const stored = submissions.save.mock.calls[0][0];
    expect(stored.payload).toEqual({ nome: 'Ana', email: 'ANA@x.com' });
    expect(stored.normalized?.lead.email).toBe('ana@x.com');
    expect(stored).toMatchObject({
      status: 'received',
      source: 'page',
      schemaVersion: 3,
      attribution: { utm_source: 'g' },
    });
    expect(stored.ipHash).toBe(hashVisitorIp('form-1', META.ip));
    expect(ingestion.process).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, submissionId: 'sub-1' });
  });

  it('honeypot or too-fast submit is stored as spam with the same answer and no CRM write', async () => {
    for (const dto of [
      { values: { nome: 'Bot' }, hp: 'http://spam', elapsedMs: 9000 },
      { values: { nome: 'Bot' }, elapsedMs: 300 },
    ]) {
      const { service, submissions, ingestion } = setup();
      const result = await service.submitPublic(KEY, dto, META);
      expect(submissions.save.mock.calls[0][0]).toMatchObject({
        status: 'spam',
        normalized: null,
      });
      expect(ingestion.process).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    }
  });

  it('answers 422 with field errors', async () => {
    const { service, submissions } = setup();
    await expect(
      service.submitPublic(
        KEY,
        { values: { email: 'x' }, elapsedMs: 5000 },
        META,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(submissions.save).not.toHaveBeenCalled();
  });

  it('caps submissions per form and visitor (429)', async () => {
    const { service, submissions } = setup();
    submissions.count.mockResolvedValue(5);
    await expect(
      service.submitPublic(
        KEY,
        { values: { nome: 'Ana' }, elapsedMs: 5000 },
        META,
      ),
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(HttpException).toBeDefined();
  });

  it('a retried nonce returns the first submission', async () => {
    const { service, submissions, ingestion } = setup();
    submissions.findOne.mockResolvedValue({ id: 'sub-first' });
    const result = await service.submitPublic(
      KEY,
      { values: { nome: 'Ana' }, nonce: 'abcdefgh12', elapsedMs: 5000 },
      META,
    );
    expect(result.submissionId).toBe('sub-first');
    expect(submissions.save).not.toHaveBeenCalled();
    expect(ingestion.process).not.toHaveBeenCalled();
  });

  it('404 for malformed key, unknown form or disabled addon — without saying which', async () => {
    await expect(
      setup().service.getPublicConfig('not-a-key'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup(null).service.getPublicConfig(KEY),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup(activeForm(), false).service.getPublicConfig(KEY),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('public config exposes rendering data, never destination or security internals', async () => {
    const config = await setup().service.getPublicConfig(KEY);
    expect(config).not.toHaveProperty('destination');
    expect(config).not.toHaveProperty('tenantId');
    expect(config).toMatchObject({
      publicKey: KEY,
      tracking: { gtmId: 'GTM-ABC123', fireParentEvents: true },
      // rows saved before F2 get the defaults
      presentation: { container: 'inline', submitLabel: 'Enviar' },
      consentText: null,
      allowedOrigins: [],
      minFillSeconds: 2,
    });
  });
});

describe('FormsService admin', () => {
  it('creates a draft with a fresh public key and validated config', async () => {
    const { service, forms } = setup();
    await service.create(CTX, {
      type: 'lead_capture',
      name: ' LP Black Friday ',
      fields: { fields: [{ key: 'nome', label: 'Nome', type: 'text' }] },
    });
    const saved = forms.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      tenantId: 't-1',
      workspaceId: 'w-1',
      name: 'LP Black Friday',
      status: 'draft',
      createdByUserId: 'u-1',
      destination: { target: 'agency_sales', duplicateWindowDays: 30 },
    });
    expect(saved.publicKey).toMatch(/^f_[0-9a-f]{24}$/);
  });

  it('refuses fiscal forms until F5, half client scope and client forms pointing to the Agency CRM', async () => {
    const { service } = setup();
    await expect(
      service.create(CTX, { type: 'fiscal_intake', name: 'NF' }),
    ).rejects.toThrow(/lead_capture/);
    await expect(
      service.create(CTX, {
        type: 'lead_capture',
        name: 'x',
        agencyClientId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toThrow(/go together/);
    await expect(
      service.create(CTX, {
        type: 'lead_capture',
        name: 'x',
        agencyClientId: '33333333-3333-4333-8333-333333333333',
        companyContextId: '44444444-4444-4444-8444-444444444444',
        destination: { target: 'agency_sales' },
      }),
    ).rejects.toThrow(/LeadFlow CRM/);
  });

  it('bumps schemaVersion when a published form changes its fields', async () => {
    const { service, forms } = setup(activeForm({ status: 'inactive' }));
    await service.patch(CTX, 'form-1', {
      fields: { fields: [{ key: 'nome', label: 'Nome', type: 'text' }] },
    });
    expect(forms.save.mock.calls[0][0].schemaVersion).toBe(4);
  });

  it('publishes a form with no fields only when the Google Ads lead channel is on (D-L2)', async () => {
    const empty = { fields: [] } as FormEntity['fields'];
    await expect(
      setup(activeForm({ status: 'draft', fields: empty })).service.publish(
        CTX,
        'form-1',
      ),
    ).rejects.toThrow(/visible field/);
    const { service, forms } = setup(
      activeForm({
        status: 'draft',
        fields: empty,
        googleAdsLeads: { ...DEFAULT_FORM_GOOGLE_ADS_LEADS, enabled: true },
      }),
    );
    // The destination lookup has its own tests; here only the fields rule matters.
    jest
      .spyOn(service as never, 'assertDestinationExists')
      .mockResolvedValue(undefined as never);
    await service.publish(CTX, 'form-1');
    expect(forms.save.mock.calls[0][0].status).toBe('active');
  });

  it('a fieldless form never answers on the public page, embed or capture', async () => {
    const { service } = setup(
      activeForm({ fields: { fields: [] } as FormEntity['fields'] }),
    );
    await expect(service.getPublicConfig(KEY)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.submitPublic(KEY, { values: {} }, META),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('generatePublicKey is random and well-formed', () => {
    const a = generatePublicKey();
    expect(a).toMatch(/^f_[0-9a-f]{24}$/);
    expect(generatePublicKey()).not.toBe(a);
  });
});

describe('FormsAddonService', () => {
  it('reads the forms entry and merges it without touching other apps', async () => {
    const agencySettings = {
      getApps: jest.fn().mockResolvedValue({
        apps: [
          {
            appKey: 'sales',
            enabled: true,
            permissionsByRole: { member: 'partial' },
          },
          { appKey: 'forms', enabled: false, note: 'kept' },
        ],
      }),
      patchApps: jest.fn(),
    };
    const addon = new FormsAddonService(agencySettings as never);
    expect(await addon.isEnabled('t', 'w')).toBe(false);
    await expect(addon.assertEnabled('t', 'w')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await addon.setEnabled('t', 'w', true);
    expect(agencySettings.patchApps).toHaveBeenCalledWith('t', 'w', {
      apps: [
        {
          appKey: 'sales',
          enabled: true,
          permissionsByRole: { member: 'partial' },
        },
        { appKey: 'forms', enabled: true, note: 'kept' },
      ],
    });
  });

  it('is off for a workspace without saved apps (defaults do not include forms)', async () => {
    const addon = new FormsAddonService({
      getApps: jest
        .fn()
        .mockResolvedValue({ apps: [{ appKey: 'dashboard', enabled: true }] }),
    } as never);
    expect(await addon.isEnabled('t', 'w')).toBe(false);
  });
});

describe('FormsService capture script (F3)', () => {
  const CAPTURE_META = {
    ...META,
    origin: 'https://lp.cliente.com.br',
    referer: null,
  };
  const payload = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      fields: [
        { key: 'your-name', type: 'text', value: 'Ana Souza' },
        { key: 'your-email', type: 'email', value: 'ANA@x.com' },
        { key: 'senha', type: 'password', value: 'secret' },
      ],
      nonce: 'cap_abcdefgh12',
      attribution: { utm_source: 'meta' },
      elapsedMs: 8000,
      ...extra,
    });

  it('stores the site fields as a script submission and runs ingestion', async () => {
    const { service, submissions, ingestion } = setup();
    await service.capturePublic(KEY, { payload: payload() }, CAPTURE_META);
    const stored = submissions.save.mock.calls[0][0];
    expect(stored).toMatchObject({
      source: 'script',
      status: 'received',
      clientNonce: 'cap_abcdefgh12',
      attribution: { utm_source: 'meta' },
    });
    expect(JSON.stringify(stored.payload)).not.toContain('secret');
    expect(stored.normalized?.lead).toMatchObject({
      name: 'Ana Souza',
      email: 'ana@x.com',
    });
    expect(ingestion.process).toHaveBeenCalledTimes(1);
  });

  it('refuses sites outside allowedOrigins and accepts subdomains of *.domain', async () => {
    const form = activeForm({
      security: {
        ...DEFAULT_FORM_SECURITY,
        allowedOrigins: ['*.cliente.com.br'],
      },
    });
    const ok = setup(form);
    await ok.service.capturePublic(KEY, { payload: payload() }, CAPTURE_META);
    expect(ok.submissions.save).toHaveBeenCalledTimes(1);

    const blocked = setup(form);
    await expect(
      blocked.service.capturePublic(
        KEY,
        { payload: payload() },
        { ...CAPTURE_META, origin: 'https://evil.example' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(blocked.submissions.save).not.toHaveBeenCalled();
  });

  it('a repeated nonce is ignored; too fast after page load is spam', async () => {
    const replay = setup();
    replay.submissions.findOne.mockResolvedValue({ id: 'sub-first' });
    await replay.service.capturePublic(
      KEY,
      { payload: payload() },
      CAPTURE_META,
    );
    expect(replay.submissions.save).not.toHaveBeenCalled();

    const fast = setup();
    await fast.service.capturePublic(
      KEY,
      { payload: payload({ elapsedMs: 200 }) },
      CAPTURE_META,
    );
    expect(fast.submissions.save.mock.calls[0][0].status).toBe('spam');
    expect(fast.ingestion.process).not.toHaveBeenCalled();
  });

  it('rejects a payload that is not JSON', async () => {
    const { service } = setup();
    await expect(
      service.capturePublic(KEY, { payload: '{nope' }, CAPTURE_META),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('FormsService reprocess e-mail lead (F4)', () => {
  it('re-maps stored pairs with the current mapping and keeps AI-found contact data', async () => {
    const form = activeForm({
      capture: { formSelector: null, fieldMap: { 'Campo 1': 'contact.name' } },
    });
    const { service, submissions, ingestion } = setup(form);
    submissions.findOne.mockResolvedValue({
      id: 'sub-9',
      formId: 'form-1',
      source: 'email',
      status: 'needs_review',
      opportunityId: null,
      payload: {
        subject: 'Contato',
        text: 'Campo 1: Rita',
        fields: [
          {
            key: 'Campo 1',
            label: 'Campo 1',
            type: 'text',
            autocomplete: null,
            hint: null,
            value: 'Rita',
          },
        ],
      },
      normalized: {
        values: {},
        lead: {
          name: null,
          email: null,
          phone: '+5511999990000',
          company: null,
          position: null,
        },
        opportunity: { title: null, valueAmount: null, notes: null },
        summaryLines: [],
        extractedBy: 'ai',
      },
    });
    await service.reprocessSubmission(CTX as never, 'sub-9');
    const row = ingestion.process.mock.calls[0][1];
    expect(row.normalized?.lead).toMatchObject({
      name: 'Rita',
      phone: '+5511999990000',
    });
    expect(row.normalized?.extractedBy).toBe('ai');
  });
});
