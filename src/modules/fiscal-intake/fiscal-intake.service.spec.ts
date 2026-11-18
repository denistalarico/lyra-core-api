// agency-settings.service pulls otplib (ESM); the spec only needs getCompany.
jest.mock('../agency/agency-settings.service', () => ({
  AgencySettingsService: class {},
}));

import { FinanceFiscalProfile } from '../finance/entities/finance-fiscal-profile.entity';
import { FinanceBrazilTaxRegime } from '../finance/enums';
import { FiscalIntakeRequestEntity } from './entities/fiscal-intake-request.entity';
import { FiscalCertificateCrypto } from './fiscal-certificate.crypto';
import { buildTestPfx } from './fiscal-certificate.test-utils';
import {
  FiscalIntakeService,
  FiscalProfileReader,
  hashFiscalToken,
} from './fiscal-intake.service';

const CTX = { tenantId: 't1', workspaceId: 'w1', userId: 'u1' };

const DATA = {
  company: {
    cnpj: '11222333000181',
    legalName: 'Empresa Teste Ltda',
    address: {
      zipCode: '01001000',
      street: 'Praça da Sé',
      number: '1',
      district: 'Sé',
      city: 'São Paulo',
      state: 'SP',
      ibgeCode: '3550308',
    },
    fiscalEmail: 'fiscal@empresa.com.br',
  },
  taxation: {
    regime: 'lucro_presumido',
    mainCnae: '7311400',
    secondaryCnaes: ['7319002'],
  },
  services: [
    {
      lc116Code: '17.06',
      issRate: '5',
      incidence: 'customer',
      description: 'Publicidade',
    },
  ],
  issuance: { issuer: 'municipal', series: '1', nextNumber: 10 },
  accountant: { name: 'Contador', email: 'contador@x.com' },
  confirmation: { responsibleName: 'Fulano' },
};

function setup() {
  const store: {
    request: FiscalIntakeRequestEntity | null;
    profile: FinanceFiscalProfile | null;
  } = {
    request: null,
    profile: null,
  };
  const requests = {
    create: jest.fn((v: Partial<FiscalIntakeRequestEntity>) => ({ ...v })),
    save: jest.fn((v: FiscalIntakeRequestEntity) => {
      store.request = { ...v, id: 'r1', createdAt: new Date() };
      return Promise.resolve(store.request);
    }),
    find: jest.fn(() => Promise.resolve(store.request ? [store.request] : [])),
    findOne: jest.fn(({ where }: { where: { tokenHash?: string } }) =>
      Promise.resolve(
        store.request && where.tokenHash === store.request.tokenHash
          ? store.request
          : null,
      ),
    ),
    update: jest.fn(
      (
        where: Record<string, unknown>,
        patch: Partial<FiscalIntakeRequestEntity>,
      ) => {
        const r = store.request;
        const matches =
          r &&
          Object.entries(where).every(
            ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
          );
        if (matches) Object.assign(r, patch);
        return Promise.resolve({ affected: matches ? 1 : 0 });
      },
    ),
    createQueryBuilder: jest.fn(() => {
      const qb = {
        addSelect: () => qb,
        where: () => qb,
        setLock: () => qb,
        getOne: () => Promise.resolve(store.request),
      };
      return qb;
    }),
  };
  const audit = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
    find: jest.fn(() => Promise.resolve([])),
  };
  const profiles = {
    findOne: jest.fn(() => Promise.resolve(store.profile)),
    create: jest.fn((v: Partial<FinanceFiscalProfile>) => ({
      id: 'p1',
      companyData: {},
      certificateMeta: null,
      ...v,
    })),
    save: jest.fn((v: FinanceFiscalProfile) => {
      store.profile = v;
      return Promise.resolve(v);
    }),
    update: jest.fn<Promise<{ affected: number }>, [unknown, unknown]>(() =>
      Promise.resolve({ affected: 1 }),
    ),
    createQueryBuilder: jest.fn(),
  };
  let attempts = 0;
  const dataSource = {
    query: jest.fn(() =>
      Promise.resolve(++attempts <= 30 ? [[{ id: 'r1' }], 1] : [[], 0]),
    ),
    transaction: jest.fn((fn: (m: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === FinanceFiscalProfile ? profiles : requests,
      }),
    ),
  };
  const mailer = { sendEmail: jest.fn(() => Promise.resolve()) };
  const settings = {
    getCompany: jest.fn(() =>
      Promise.resolve({
        tradeName: 'Agência X',
        workspaceName: '',
        legalName: '',
        taxId: '',
      }),
    ),
  };
  const notifications = { process: jest.fn(() => Promise.resolve({})) };
  const workspaceUsers = {
    find: jest.fn(() =>
      Promise.resolve([
        { userId: 'u1', role: 'owner' },
        { userId: 'u2', role: 'member' },
      ]),
    ),
  };
  const permissions = {
    can: jest.fn((c: { userId: string }) => Promise.resolve(c.userId === 'u1')),
  };
  const crypto = new FiscalCertificateCrypto();
  const service = new FiscalIntakeService(
    requests as never,
    audit as never,
    profiles as never,
    workspaceUsers as never,
    dataSource as never,
    crypto,
    mailer as never,
    settings as never,
    permissions as never,
    notifications as never,
  );
  return {
    service,
    store,
    requests,
    audit,
    profiles,
    mailer,
    notifications,
    crypto,
    dataSource,
  };
}

describe('FiscalIntakeService (F5)', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FISCAL_CERT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
    process.env.APP_FRONTEND_URL = 'https://app.example.com';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('creates one active link, keeps only the token hash and e-mails the accountant', async () => {
    const { service, store, requests, mailer } = setup();
    const out = await service.createRequest(CTX, {
      recipientName: 'Contador',
      recipientEmail: 'C@X.com',
      sendEmail: true,
    });
    expect(requests.update).toHaveBeenCalledWith(
      { tenantId: 't1', workspaceId: 'w1', status: 'open' },
      { status: 'revoked' },
    );
    expect(out.path).toBe(`/f/fiscal/${out.token}`);
    expect(store.request?.tokenHash).toBe(hashFiscalToken(out.token));
    expect(JSON.stringify(store.request)).not.toContain(out.token);
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'c@x.com' }),
    );
    expect(
      (mailer.sendEmail.mock.calls[0] as unknown as [{ html: string }])[0].html,
    ).toContain(`https://app.example.com/f/fiscal/${out.token}`);
  });

  it('refuses a certificate-only link without the key or without a CNPJ to compare', async () => {
    const { service } = setup();
    await expect(
      service.createRequest(CTX, { scope: 'certificate' }),
    ).rejects.toThrow('CNPJ');
    delete process.env.FISCAL_CERT_ENCRYPTION_KEY;
    await expect(
      service.createRequest(CTX, { scope: 'certificate' }),
    ).rejects.toThrow('FISCAL_CERT_ENCRYPTION_KEY');
  });

  it('accepts the submission, stores only ciphertext and locks the link', async () => {
    const { service, store, audit, notifications } = setup();
    const { token } = await service.createRequest(CTX, {});
    const pfx = buildTestPfx({ password: 'senha-do-a1' });

    await service.submitPublic(
      token,
      {
        data: JSON.stringify(DATA),
        certificatePassword: 'senha-do-a1',
        portalPassword: 'portal-123',
      },
      { buffer: pfx, originalname: 'a1.pfx', size: pfx.length },
    );

    const r = store.request!;
    expect(r.status).toBe('submitted');
    expect(r.certificateMeta?.cnpj).toBe('11222333000181');
    expect(r.certificateEncrypted?.includes(pfx.subarray(0, 64))).toBe(false);
    expect(r.certificatePasswordEncrypted).toMatch(/^v1:/);
    expect(JSON.stringify(r)).not.toContain('senha-do-a1');
    expect(JSON.stringify(r)).not.toContain('portal-123');
    expect(
      audit.save.mock.calls.map(
        (c) => (c as unknown as [{ action: string }])[0].action,
      ),
    ).toEqual([
      'intake_link_created',
      'intake_submitted',
      'certificate_uploaded',
    ]);
    expect(notifications.process).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'finance.fiscal_intake_submitted' }),
    );

    await expect(
      service.submitPublic(token, { data: JSON.stringify(DATA) }, undefined),
    ).rejects.toThrow('não aceita mais envios');
    const view = await service.publicView(token);
    expect(view).toMatchObject({
      status: 'submitted',
      summary: { cnpj: '11.***.***/0001-81' },
    });
    expect(JSON.stringify(view)).not.toMatch(/11222333000181|v1:/);
  });

  it('rejects a certificate whose CNPJ differs from the informed one', async () => {
    const { service, store } = setup();
    const { token } = await service.createRequest(CTX, {});
    const pfx = buildTestPfx({ password: 'a', cnpj: '11444777000161' });
    await expect(
      service.submitPublic(
        token,
        { data: JSON.stringify(DATA), certificatePassword: 'a' },
        { buffer: pfx, size: pfx.length },
      ),
    ).rejects.toThrow('CNPJ do certificado é diferente');
    expect(store.request?.status).toBe('open');
  });

  it('accepts data without a certificate when the key is missing, but never a certificate', async () => {
    const { service, store } = setup();
    const { token } = await service.createRequest(CTX, {});
    delete process.env.FISCAL_CERT_ENCRYPTION_KEY;
    const pfx = buildTestPfx({ password: 'a' });
    await expect(
      service.submitPublic(
        token,
        { data: JSON.stringify(DATA), certificatePassword: 'a' },
        { buffer: pfx, size: pfx.length },
      ),
    ).rejects.toThrow('desativado');
    await service.submitPublic(
      token,
      { data: JSON.stringify(DATA) },
      undefined,
    );
    expect(store.request).toMatchObject({
      status: 'submitted',
      certificateEncrypted: null,
    });
  });

  it('caps attempts per link', async () => {
    const { service, dataSource } = setup();
    const { token } = await service.createRequest(CTX, {});
    dataSource.query.mockResolvedValueOnce([[], 0]);
    await expect(service.inspectPublic(token, undefined, '')).rejects.toThrow(
      'Muitas tentativas',
    );
  });

  it('approval maps the data onto the existing fiscal profile and wipes the request ciphertext', async () => {
    const { service, store, crypto } = setup();
    const { token } = await service.createRequest(CTX, {});
    const pfx = buildTestPfx({ password: 'a' });
    await service.submitPublic(
      token,
      { data: JSON.stringify(DATA), certificatePassword: 'a' },
      { buffer: pfx, size: pfx.length },
    );
    const ciphertext = store.request!.certificateEncrypted!;

    await service.approve(CTX, 'r1');

    const p = store.profile!;
    expect(p.brazilTaxRegime).toBe(FinanceBrazilTaxRegime.NormalLucroPresumido);
    expect(p.isSimplesNacional).toBe(false);
    expect(p.cnae).toBe('7311400,7319002');
    expect(p).toMatchObject({
      cityServiceCode: '17.06',
      issRate: '5',
      serviceCityOrigin: 'customer',
      nfseSeries: '1',
      nextRpsNumber: 10,
    });
    expect(
      (p.companyData as { company: { legalName: string } }).company.legalName,
    ).toBe('Empresa Teste Ltda');
    expect(p.certificateEncrypted).toBe(ciphertext);
    expect(
      crypto
        .decrypt(p.certificateEncrypted!, p.certificateKeyVersion!)
        .equals(pfx),
    ).toBe(true);
    expect(p.certificateExpiresAt?.toISOString()).toBe(
      store.request!.certificateMeta!.validTo,
    );
    expect(store.request).toMatchObject({
      status: 'approved',
      certificateEncrypted: null,
      certificatePasswordEncrypted: null,
    });
    await expect(service.approve(CTX, 'r1')).rejects.toThrow(
      'aguardando revisão',
    );
  });

  it('expiry alerts fire once per level (30 → 7 → expired)', async () => {
    const { service, profiles, notifications } = setup();
    const now = new Date('2026-11-17T12:00:00Z');
    const profile = {
      id: 'p1',
      tenantId: 't1',
      workspaceId: 'w1',
      certificateMeta: { fingerprintSha256: 'ab' },
      certificateExpiresAt: new Date('2026-12-07T12:00:00Z'),
      certificateAlertLevel: null as number | null,
    };
    profiles.createQueryBuilder.mockImplementation(() => {
      const qb = {
        where: () => qb,
        andWhere: () => qb,
        getMany: () => Promise.resolve([profile]),
      };
      return qb;
    });
    profiles.update.mockImplementation(
      (_w: unknown, patch: { certificateAlertLevel: number }) => {
        profile.certificateAlertLevel = patch.certificateAlertLevel;
        return Promise.resolve({ affected: 1 });
      },
    );

    await service.certificateAlerts(now);
    await service.certificateAlerts(now);
    expect(notifications.process).toHaveBeenCalledTimes(1);
    expect(profile.certificateAlertLevel).toBe(30);
    expect(notifications.process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'finance.fiscal_certificate_expiring',
        recipients: [expect.objectContaining({ userId: 'u1' })],
      }),
    );

    await service.certificateAlerts(new Date('2026-12-02T12:00:00Z'));
    expect(profile.certificateAlertLevel).toBe(7);
    await service.certificateAlerts(new Date('2026-12-08T12:00:00Z'));
    expect(profile.certificateAlertLevel).toBe(0);
    expect(notifications.process).toHaveBeenCalledTimes(3);
  });

  it('FiscalProfileReader audits before returning the decrypted certificate', async () => {
    const crypto = new FiscalCertificateCrypto();
    const { payload, keyVersion } = crypto.encrypt(Buffer.from('pfx'));
    const profile = {
      certificateEncrypted: payload,
      certificateKeyVersion: keyVersion,
      certificatePasswordEncrypted: crypto.encryptText('pw'),
      certificateMeta: {},
    };
    const qb = {
      addSelect: () => qb,
      where: () => qb,
      getOne: () => Promise.resolve(profile),
    };
    const audit = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(() => Promise.resolve()),
    };
    const reader = new FiscalProfileReader(
      { createQueryBuilder: () => qb } as never,
      audit as never,
      crypto,
    );
    const out = await reader.readCertificate('t1', 'w1', 'nfse.emit');
    expect(out.pfx.toString()).toBe('pfx');
    expect(out.password).toBe('pw');
    expect(audit.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'certificate_decrypted',
        details: { purpose: 'nfse.emit' },
      }),
    );
  });
});
