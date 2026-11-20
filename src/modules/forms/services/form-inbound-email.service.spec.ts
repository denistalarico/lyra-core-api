// AgencySettingsService pulls otplib (ESM) into Jest; nothing here needs it.
jest.mock('../../agency/agency-settings.service', () => ({
  AgencySettingsService: class {},
}));

import { BadRequestException, ConflictException } from '@nestjs/common';
import type { FormEntity } from '../entities/form.entity';
import type { FormSubmissionEntity } from '../entities/form-submission.entity';
import {
  DEFAULT_FORM_AFTER_SUBMIT,
  DEFAULT_FORM_DESTINATION,
  DEFAULT_FORM_GOOGLE_ADS_LEADS,
  DEFAULT_FORM_META_LEADS,
  DEFAULT_FORM_INBOUND_EMAIL,
  DEFAULT_FORM_PRESENTATION,
  DEFAULT_FORM_SECURITY,
  DEFAULT_FORM_TRACKING,
} from '../forms.types';
import type { ImapHeaderRow } from './form-email-imap.gateway';
import {
  FormInboundEmailService,
  imapErrorMessage,
} from './form-inbound-email.service';

const ADDRESS = 'leads+lp-ab12@agencia.com.br';

function makeForm(overrides: Partial<FormEntity> = {}): FormEntity {
  return {
    id: 'form-1',
    tenantId: 't-1',
    workspaceId: 'w-1',
    agencyClientId: null,
    companyContextId: null,
    type: 'lead_capture',
    name: 'LP',
    description: null,
    status: 'active',
    publicKey: 'f_0123456789abcdef01234567',
    schemaVersion: 1,
    fields: { fields: [] },
    presentation: structuredClone(DEFAULT_FORM_PRESENTATION),
    tracking: { ...DEFAULT_FORM_TRACKING },
    destination: { ...DEFAULT_FORM_DESTINATION },
    security: { ...DEFAULT_FORM_SECURITY },
    afterSubmit: { ...DEFAULT_FORM_AFTER_SUBMIT },
    capture: { formSelector: null, fieldMap: {} },
    inboundEmailAddress: ADDRESS,
    inboundEmail: { ...DEFAULT_FORM_INBOUND_EMAIL },
    googleAdsLeads: { ...DEFAULT_FORM_GOOGLE_ADS_LEADS },
    metaLeads: { ...DEFAULT_FORM_META_LEADS },
    createdByUserId: null,
    publishedAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function rawEmail(opts: {
  id: string;
  to: string;
  subject?: string;
  body: string;
  from?: string;
}) {
  return Buffer.from(
    [
      `From: ${opts.from ?? 'WordPress <wordpress@site.com.br>'}`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject ?? 'Novo contato'}`,
      `Message-ID: <${opts.id}@site.com.br>`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      opts.body,
      '',
    ].join('\r\n'),
  );
}

type Mail = { uid: number; to: string; buffer?: Buffer };

function setup(
  options: {
    form?: FormEntity;
    mails?: Mail[];
    state?: Record<string, unknown> | null;
    uidValidity?: string;
    imapConfigured?: boolean;
    aiResult?: unknown;
  } = {},
) {
  const form = options.form ?? makeForm();
  const mails = options.mails ?? [];
  const sourceCalls: number[] = [];
  const session = {
    uidValidity: options.uidValidity ?? '777',
    uidNext: (mails.at(-1)?.uid ?? 0) + 1,
    searchSince: jest.fn(() => Promise.resolve(mails.map((m) => m.uid))),
    headers: jest.fn((range: { after: number } | { uids: number[] }) =>
      Promise.resolve(
        mails
          .filter((m) =>
            'after' in range ? m.uid > range.after : range.uids.includes(m.uid),
          )
          .map<ImapHeaderRow>((m) => ({
            uid: m.uid,
            size: 1000,
            headers: `To: ${m.to}\r\nMessage-ID: <m${m.uid}@site.com.br>\r\n`,
          })),
      ),
    ),
    source: jest.fn((uid: number) => {
      sourceCalls.push(uid);
      return Promise.resolve(mails.find((m) => m.uid === uid)?.buffer ?? null);
    }),
    close: jest.fn(() => Promise.resolve()),
  };
  const gateway = { open: jest.fn(() => Promise.resolve(session)) };
  const runner = {
    connect: jest.fn(),
    query: jest.fn(() => Promise.resolve([{ locked: true }])),
    release: jest.fn(),
  };
  const dataSource = { query: jest.fn(), createQueryRunner: () => runner };
  const forms = {
    find: jest.fn(() => Promise.resolve([form])),
    findOne: jest.fn(() => Promise.resolve(null)),
    save: jest.fn((row: FormEntity) => Promise.resolve(row)),
  };
  const saved: Array<Partial<FormSubmissionEntity>> = [];
  const submissions = {
    exist: jest.fn(() => Promise.resolve(false)),
    create: jest.fn((row: Partial<FormSubmissionEntity>) => row),
    save: jest.fn((row: Partial<FormSubmissionEntity>) => {
      saved.push(structuredClone(row));
      return Promise.resolve({ id: 'sub-1', ...row });
    }),
  };
  const syncStates = {
    findOne: jest.fn(() =>
      Promise.resolve(options.state === undefined ? null : options.state),
    ),
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn((row: Record<string, unknown>) => Promise.resolve(row)),
  };
  const emailSettings = {
    findOne: jest.fn(() =>
      Promise.resolve(
        options.imapConfigured === false
          ? null
          : {
              imapHost: 'imap.hostinger.com',
              imapPort: 993,
              imapSecure: true,
              imapUser: 'leads@agencia.com.br',
              imapPasswordEncrypted: 'enc',
            },
      ),
    ),
  };
  const crypto = { decrypt: jest.fn(() => 'secret') };
  const mailer = { sendEmail: jest.fn(() => Promise.resolve()) };
  const ai = {
    enabled: true,
    extract: jest.fn(() => Promise.resolve(options.aiResult ?? null)),
  };
  const addon = {
    isEnabled: jest.fn(() => Promise.resolve(true)),
    assertEnabled: jest.fn(),
  };
  const ingestion = {
    process: jest.fn((_form: FormEntity, row: FormSubmissionEntity) =>
      Promise.resolve(row),
    ),
  };
  const service = new FormInboundEmailService(
    dataSource as never,
    forms as never,
    submissions as never,
    syncStates as never,
    emailSettings as never,
    crypto as never,
    gateway as never,
    mailer as never,
    ai as never,
    addon as never,
    ingestion as never,
  );
  return {
    service,
    form,
    session,
    sourceCalls,
    saved,
    syncStates,
    forms,
    submissions,
    ingestion,
    ai,
    mailer,
    runner,
  };
}

describe('FormInboundEmailService reader', () => {
  it('downloads only messages addressed to a form and turns them into e-mail leads', async () => {
    const ctx = setup({
      state: {
        tenantId: 't-1',
        workspaceId: 'w-1',
        uidValidity: '777',
        lastUid: 10,
      },
      mails: [
        {
          uid: 11,
          to: 'leads@agencia.com.br',
          buffer: rawEmail({
            id: 'a',
            to: 'leads@agencia.com.br',
            body: 'pessoal',
          }),
        },
        {
          uid: 12,
          to: `Leads <${ADDRESS.toUpperCase()}>`,
          buffer: rawEmail({
            id: 'b',
            to: ADDRESS,
            body: 'Nome: Ana\nE-mail: ana@cliente.com\nTelefone: 11 98888-7777',
          }),
        },
      ],
    });
    await ctx.service.pollWorkspace('t-1', 'w-1');
    expect(ctx.sourceCalls).toEqual([12]);
    expect(ctx.saved[0]).toMatchObject({
      source: 'email',
      emailMessageId: '<m12@site.com.br>',
      status: 'received',
    });
    expect(ctx.saved[0].normalized?.lead).toMatchObject({
      name: 'Ana',
      email: 'ana@cliente.com',
    });
    expect(ctx.ai.extract).not.toHaveBeenCalled();
    expect(ctx.ingestion.process).toHaveBeenCalledTimes(1);
    expect(ctx.syncStates.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUid: 12,
        uidValidity: '777',
        lastError: null,
      }),
    );
    expect(ctx.runner.release).toHaveBeenCalled();
  });

  it('a new UIDVALIDITY rescans the last days; Message-ID avoids duplicates', async () => {
    const ctx = setup({
      state: {
        tenantId: 't-1',
        workspaceId: 'w-1',
        uidValidity: '1',
        lastUid: 900,
      },
      uidValidity: '2',
      mails: [
        {
          uid: 3,
          to: ADDRESS,
          buffer: rawEmail({ id: 'c', to: ADDRESS, body: 'E-mail: x@y.com' }),
        },
      ],
    });
    ctx.submissions.exist.mockResolvedValue(true);
    await ctx.service.pollWorkspace('t-1', 'w-1');
    expect(ctx.session.searchSince).toHaveBeenCalled();
    expect(ctx.sourceCalls).toEqual([]);
    expect(ctx.syncStates.save).toHaveBeenCalledWith(
      expect.objectContaining({ uidValidity: '2', lastUid: 3 }),
    );
  });

  it('the test e-mail verifies the address and is not a lead', async () => {
    const form = makeForm({
      inboundEmail: {
        ...DEFAULT_FORM_INBOUND_EMAIL,
        pendingTest: { token: 'abc123', sentAt: new Date().toISOString() },
      },
    });
    const ctx = setup({
      form,
      state: {
        tenantId: 't-1',
        workspaceId: 'w-1',
        uidValidity: '777',
        lastUid: 0,
      },
      mails: [
        {
          uid: 1,
          to: ADDRESS,
          buffer: rawEmail({
            id: 't',
            to: ADDRESS,
            subject: 'Lyra Forms — teste [abc123]',
            body: 'x',
          }),
        },
      ],
    });
    await ctx.service.pollWorkspace('t-1', 'w-1');
    expect(ctx.saved).toHaveLength(0);
    expect(form.inboundEmail.verifiedAt).toEqual(expect.any(String));
    expect(form.inboundEmail.pendingTest).toBeNull();
  });

  it('senders outside the allow list are ignored', async () => {
    const ctx = setup({
      form: makeForm({
        inboundEmail: {
          ...DEFAULT_FORM_INBOUND_EMAIL,
          allowedSenders: ['@site.com.br'],
        },
      }),
      state: {
        tenantId: 't-1',
        workspaceId: 'w-1',
        uidValidity: '777',
        lastUid: 0,
      },
      mails: [
        {
          uid: 1,
          to: ADDRESS,
          buffer: rawEmail({
            id: 's',
            to: ADDRESS,
            from: 'spam@evil.com',
            body: 'E-mail: a@b.co',
          }),
        },
      ],
    });
    await ctx.service.pollWorkspace('t-1', 'w-1');
    expect(ctx.saved).toHaveLength(0);
  });

  it('AI fills the contact when the rules found no e-mail or phone', async () => {
    const ctx = setup({
      state: {
        tenantId: 't-1',
        workspaceId: 'w-1',
        uidValidity: '777',
        lastUid: 0,
      },
      mails: [
        {
          uid: 1,
          to: ADDRESS,
          buffer: rawEmail({
            id: 'i',
            to: ADDRESS,
            body: 'Oi, sou a Bia da ACME, me liga.',
          }),
        },
      ],
      aiResult: {
        lead: {
          name: 'Bia',
          email: null,
          phone: '+5511999990000',
          company: 'ACME',
          position: null,
        },
        message: 'me liga',
      },
    });
    await ctx.service.pollWorkspace('t-1', 'w-1');
    expect(ctx.ai.extract).toHaveBeenCalledWith(
      expect.stringContaining('Bia'),
      expect.any(Object),
      'sub-1',
    );
    expect(ctx.saved.at(-1)?.normalized).toMatchObject({
      extractedBy: 'ai',
      lead: { name: 'Bia', phone: '+5511999990000', company: 'ACME' },
    });
  });

  it('keeps progress and records the error when IMAP fails', async () => {
    const ctx = setup({
      state: {
        tenantId: 't-1',
        workspaceId: 'w-1',
        uidValidity: '777',
        lastUid: 5,
      },
    });
    ctx.session.headers.mockRejectedValue(
      Object.assign(new Error('x'), { authenticationFailed: true }),
    );
    await ctx.service.pollWorkspace('t-1', 'w-1');
    expect(ctx.syncStates.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUid: 5,
        lastError: 'Usuário ou senha IMAP recusados pelo servidor.',
      }),
    );
  });

  it('skips the workspace when another reader holds the lock', async () => {
    const ctx = setup();
    ctx.runner.query.mockResolvedValueOnce([{ locked: false }]);
    await ctx.service.pollWorkspace('t-1', 'w-1');
    expect(ctx.session.headers).not.toHaveBeenCalled();
  });
});

describe('FormInboundEmailService configure', () => {
  const CTX = { tenantId: 't-1', workspaceId: 'w-1', userId: 'u-1' } as never;

  it('plus: generates box+slug@domain and keeps it on later saves', async () => {
    const ctx = setup();
    const form = makeForm({ inboundEmailAddress: null });
    await ctx.service.configure(CTX, form, { enabled: true, kind: 'plus' });
    expect(form.inboundEmailAddress).toMatch(
      /^leads\+lp-[0-9a-f]{4}@agencia\.com\.br$/,
    );
    const first = form.inboundEmailAddress;
    await ctx.service.configure(CTX, form, {
      enabled: true,
      aiExtraction: false,
    });
    expect(form.inboundEmailAddress).toBe(first);
    expect(form.inboundEmail.aiExtraction).toBe(false);
  });

  it('alias: validates, refuses the box itself and addresses used by another form', async () => {
    const ctx = setup();
    const form = makeForm();
    await expect(
      ctx.service.configure(CTX, form, {
        enabled: true,
        kind: 'alias',
        address: 'leads@agencia.com.br',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    ctx.forms.findOne.mockResolvedValueOnce(
      makeForm({ id: 'other', name: 'Outro' }) as never,
    );
    await expect(
      ctx.service.configure(CTX, form, {
        enabled: true,
        kind: 'alias',
        address: 'lp@agencia.com.br',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await ctx.service.configure(CTX, form, {
      enabled: true,
      kind: 'alias',
      address: 'Site@Agencia.com.br',
      allowedSenders: ['@Site.com.br'],
    });
    expect(form.inboundEmailAddress).toBe('site@agencia.com.br');
    expect(form.inboundEmail).toMatchObject({
      kind: 'alias',
      verifiedAt: null,
      allowedSenders: ['@site.com.br'],
    });
  });

  it('requires the agency IMAP box', async () => {
    const ctx = setup({ imapConfigured: false });
    await expect(
      ctx.service.configure(CTX, makeForm({ inboundEmailAddress: null }), {
        enabled: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'FORMS_IMAP_NOT_CONFIGURED' },
    });
  });

  it('test e-mail goes to the form address with a token', async () => {
    const ctx = setup();
    const form = makeForm();
    await ctx.service.sendTest(form);
    const token = form.inboundEmail.pendingTest?.token;
    const [[sent]] = ctx.mailer.sendEmail.mock.calls as unknown as Array<
      [{ to: string; subject: string }]
    >;
    expect(sent.to).toBe(ADDRESS);
    expect(sent.subject).toContain(`[${token}]`);
  });
});

describe('imapErrorMessage', () => {
  it('explains provider-specific login failures', () => {
    const auth = Object.assign(new Error('x'), { authenticationFailed: true });
    expect(imapErrorMessage(auth, 'outlook.office365.com')).toContain('OAuth');
    expect(imapErrorMessage(auth, 'imap.gmail.com')).toContain('senha de app');
    expect(imapErrorMessage(auth, 'imap.hostinger.com')).toBe(
      'Usuário ou senha IMAP recusados pelo servidor.',
    );
  });
});
