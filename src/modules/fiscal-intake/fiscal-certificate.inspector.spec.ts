import {
  assertCertificateAcceptable,
  inspectCertificate,
} from './fiscal-certificate.inspector';
import { buildTestPfx } from './fiscal-certificate.test-utils';
import { FiscalCertificateCrypto } from './fiscal-certificate.crypto';
import { isValidCnpj, parseFiscalIntakeData } from './fiscal-intake.types';

describe('fiscal certificate inspector (F5 §8.3)', () => {
  const pfx = buildTestPfx({ password: 's3nha' });

  it('opens the PKCS#12 and reads holder, CNPJ (otherName 2.16.76.1.3.3), issuer and validity', () => {
    const { meta, icpBrasil } = inspectCertificate(pfx, 's3nha', 'empresa.pfx');
    expect(icpBrasil).toBe(true);
    expect(meta.cnpj).toBe('11222333000181');
    expect(meta.holder).toBe('EMPRESA TESTE LTDA');
    expect(meta.issuer).toBe('AC TESTE RFB v5');
    expect(meta.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.fileName).toBe('empresa.pfx');
    expect(
      assertCertificateAcceptable({ meta, icpBrasil }, '11.222.333/0001-81'),
    ).toBe(meta);
  });

  it('reads the CNPJ from subjectAltName even when the CN does not carry it', () => {
    const { meta } = inspectCertificate(
      buildTestPfx({
        password: 'a',
        cnpj: '11444777000161',
        cnpjInCommonName: false,
      }),
      'a',
    );
    expect(meta.cnpj).toBe('11444777000161');
    expect(meta.holder).toBe('EMPRESA TESTE LTDA');
  });

  it('rejects a wrong password without echoing it', () => {
    expect(() => inspectCertificate(pfx, 'errada')).toThrow(
      'Senha do certificado incorreta',
    );
  });

  it('rejects garbage and oversized files', () => {
    expect(() => inspectCertificate(Buffer.from('not a pfx'), 'x')).toThrow();
    expect(() => inspectCertificate(Buffer.alloc(60 * 1024, 1), 'x')).toThrow(
      'até 50 KB',
    );
  });

  it('enforces expiry, ICP-Brasil e-CNPJ and the informed CNPJ', () => {
    const expired = inspectCertificate(
      buildTestPfx({
        password: 'a',
        notBefore: new Date('2020-01-01'),
        notAfter: new Date('2021-01-01'),
      }),
      'a',
    );
    expect(() => assertCertificateAcceptable(expired, null)).toThrow('vencido');

    const foreign = inspectCertificate(
      buildTestPfx({ password: 'a', icpBrasil: false }),
      'a',
    );
    expect(() => assertCertificateAcceptable(foreign, null)).toThrow(
      'ICP-Brasil',
    );

    const ecpf = inspectCertificate(
      buildTestPfx({ password: 'a', cnpj: null }),
      'a',
    );
    expect(() => assertCertificateAcceptable(ecpf, null)).toThrow('e-CNPJ');

    const ok = inspectCertificate(pfx, 's3nha');
    expect(() => assertCertificateAcceptable(ok, '11444777000161')).toThrow(
      'CNPJ do certificado é diferente',
    );
  });
});

describe('FiscalCertificateCrypto (F5 §8.4)', () => {
  const previous = { ...process.env };
  afterEach(() => {
    process.env = { ...previous };
  });

  it('is fail-closed without a valid 32-byte base64 key', () => {
    delete process.env.FISCAL_CERT_ENCRYPTION_KEY;
    const crypto = new FiscalCertificateCrypto();
    expect(crypto.isAvailable()).toBe(false);
    expect(() => crypto.encrypt(Buffer.from('x'))).toThrow('desativado');
    process.env.FISCAL_CERT_ENCRYPTION_KEY = 'short';
    expect(crypto.isAvailable()).toBe(false);
  });

  it('round-trips with key versions, so a rotated key still reads old rows', () => {
    const v1 = Buffer.alloc(32, 1).toString('base64');
    const v2 = Buffer.alloc(32, 2).toString('base64');
    process.env.FISCAL_CERT_ENCRYPTION_KEY = v1;
    const crypto = new FiscalCertificateCrypto();
    const { payload, keyVersion } = crypto.encrypt(Buffer.from('pfx-bytes'));
    expect(keyVersion).toBe(1);
    expect(payload.includes(Buffer.from('pfx-bytes'))).toBe(false);

    process.env.FISCAL_CERT_ENCRYPTION_KEY = v2;
    process.env.FISCAL_CERT_ENCRYPTION_KEY_VERSION = '2';
    expect(() => crypto.decrypt(payload, 1)).toThrow('versão 1');
    process.env.FISCAL_CERT_ENCRYPTION_KEY_V1 = v1;
    expect(crypto.decrypt(payload, 1).toString()).toBe('pfx-bytes');
    expect(crypto.encrypt(Buffer.from('y')).keyVersion).toBe(2);
    const secret = crypto.encryptText('senha');
    expect(secret.startsWith('v2:')).toBe(true);
    expect(crypto.decryptText(secret)).toBe('senha');
  });
});

describe('parseFiscalIntakeData (F5 §8.2)', () => {
  const valid = {
    company: {
      cnpj: '11.222.333/0001-81',
      legalName: 'Empresa Teste Ltda',
      address: {
        zipCode: '01001-000',
        street: 'Praça da Sé',
        number: '1',
        district: 'Sé',
        city: 'São Paulo',
        state: 'sp',
        ibgeCode: '3550308',
      },
      fiscalEmail: 'Fiscal@Empresa.com.br',
      secret: 'dropped',
    },
    taxation: {
      regime: 'simples_nacional',
      mainCnae: '7311-4/00',
      secondaryCnaes: ['7319-0/02', '7311400'],
    },
    services: [
      { lc116Code: '17.06', issRate: '2,5', withholdings: ['iss', 'bogus'] },
    ],
    issuance: { issuer: 'national', nextNumber: '42' },
    accountant: { name: 'Contador', email: 'contador@x.com' },
    confirmation: { responsibleName: 'Fulano' },
  };

  it('normalizes digits, rates and drops unknown keys', () => {
    const data = parseFiscalIntakeData(valid);
    expect(data.company.cnpj).toBe('11222333000181');
    expect(data.company.address.state).toBe('SP');
    expect(data.company.fiscalEmail).toBe('fiscal@empresa.com.br');
    expect(data.taxation.mainCnae).toBe('7311400');
    expect(data.taxation.secondaryCnaes).toEqual(['7319002']);
    expect(data.services[0]).toMatchObject({
      issRate: '2.5',
      withholdings: ['iss'],
      incidence: 'provider',
    });
    expect(data.issuance).toMatchObject({ issuer: 'national', nextNumber: 42 });
    expect(JSON.stringify(data)).not.toContain('dropped');
  });

  it('lists what is missing or invalid', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    try {
      parseFiscalIntakeData({
        ...valid,
        company: { ...valid.company, cnpj: '11222333000182' },
        services: [],
      });
      throw new Error('should fail');
    } catch (error) {
      const response = (
        error as { getResponse?: () => { message: string[] } }
      ).getResponse?.();
      expect(response?.message).toEqual(
        expect.arrayContaining([
          'CNPJ: dígitos verificadores inválidos.',
          'Serviços: informe ao menos um serviço.',
        ]),
      );
    }
  });
});
