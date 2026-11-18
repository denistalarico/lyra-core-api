import { BadRequestException } from '@nestjs/common';

/**
 * Forms addon F5 — accountant fiscal intake (§8.2). The schema is fixed (not
 * editable in the builder) and versioned through `version`, so the future NF
 * integration can map it without guessing.
 */
export const FISCAL_INTAKE_SCOPES = ['full', 'certificate'] as const;
export type FiscalIntakeScope = (typeof FISCAL_INTAKE_SCOPES)[number];

export type FiscalIntakeStatus =
  | 'open'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'expired';

export const FISCAL_TAX_REGIMES = [
  'mei',
  'simples_nacional',
  'lucro_presumido',
  'lucro_real',
] as const;
export type FiscalTaxRegime = (typeof FISCAL_TAX_REGIMES)[number];

export const FISCAL_WITHHOLDINGS = [
  'iss',
  'ir',
  'pis',
  'cofins',
  'csll',
  'inss',
] as const;
export type FiscalWithholding = (typeof FISCAL_WITHHOLDINGS)[number];

export type FiscalServiceItem = {
  lc116Code: string;
  municipalTaxCode: string | null;
  nbsCode: string | null;
  issRate: string;
  incidence: 'provider' | 'customer';
  withholdings: FiscalWithholding[];
  description: string | null;
  /** Reform fields (IBS/CBS): optional until the NF provider confirms them. */
  ibsCbsCst: string | null;
  ibsCbsClass: string | null;
};

export type FiscalIntakeData = {
  version: 1;
  company: {
    cnpj: string;
    legalName: string;
    tradeName: string | null;
    address: {
      zipCode: string;
      street: string;
      number: string;
      complement: string | null;
      district: string;
      city: string;
      state: string;
      ibgeCode: string;
    };
    municipalRegistration: string | null;
    stateRegistration: string | null;
    fiscalEmail: string;
    fiscalPhone: string | null;
  };
  taxation: {
    regime: FiscalTaxRegime;
    specialRegime: string | null;
    taxIncentive: boolean;
    mainCnae: string;
    secondaryCnaes: string[];
  };
  services: FiscalServiceItem[];
  issuance: {
    issuer: 'municipal' | 'national';
    series: string | null;
    nextNumber: number | null;
    portalLogin: string | null;
  };
  accountant: {
    name: string;
    crc: string | null;
    email: string;
    phone: string | null;
  };
  confirmation: { responsibleName: string };
};

export type FiscalCertificateMeta = {
  holder: string;
  cnpj: string | null;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  fingerprintSha256: string;
  fileName: string | null;
  sizeBytes: number;
};

export const FISCAL_CERTIFICATE_MAX_BYTES = 50 * 1024;
export const FISCAL_INTAKE_MAX_ATTEMPTS = 30;
export const FISCAL_INTAKE_DEFAULT_DAYS = 7;
export const FISCAL_CERTIFICATE_ALERT_DAYS = [30, 7] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

export function onlyDigits(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\D/g, '')
    : '';
}

/** CNPJ with valid check digits (numeric CNPJ; the 2026 alphanumeric one is not issued yet). */
export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (base: string) => {
    let weight = base.length - 7;
    let sum = 0;
    for (const char of base) {
      sum += Number(char) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(cnpj.slice(0, 12));
  const second = digit(cnpj.slice(0, 12) + String(first));
  return cnpj.endsWith(`${first}${second}`);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class Reader {
  readonly errors: string[] = [];

  obj(value: unknown, label: string): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
    this.errors.push(`${label}: bloco ausente.`);
    return {};
  }

  text(
    value: unknown,
    label: string,
    max: number,
    required: boolean,
  ): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
      if (required) this.errors.push(`${label}: obrigatório.`);
      return null;
    }
    if (text.length > max) {
      this.errors.push(`${label}: até ${max} caracteres.`);
      return text.slice(0, max);
    }
    return text;
  }

  req(value: unknown, label: string, max: number): string {
    return this.text(value, label, max, true) ?? '';
  }

  digits(
    value: unknown,
    label: string,
    length: number[],
    required: boolean,
  ): string | null {
    const digits = onlyDigits(value);
    if (!digits) {
      if (required) this.errors.push(`${label}: obrigatório.`);
      return null;
    }
    if (!length.includes(digits.length)) {
      this.errors.push(`${label}: formato inválido.`);
      return null;
    }
    return digits;
  }

  email(value: unknown, label: string, required: boolean): string | null {
    const email = this.text(value, label, 254, required)?.toLowerCase() ?? null;
    if (email && !EMAIL.test(email)) {
      this.errors.push(`${label}: e-mail inválido.`);
      return null;
    }
    return email;
  }

  oneOf<T extends string>(
    value: unknown,
    options: readonly T[],
    label: string,
  ): T {
    if (
      typeof value === 'string' &&
      (options as readonly string[]).includes(value)
    )
      return value as T;
    this.errors.push(`${label}: opção inválida.`);
    return options[0];
  }
}

function normalizeCnae(value: unknown): string | null {
  const digits = onlyDigits(value);
  return digits.length === 7 ? digits : null;
}

function normalizeRate(reader: Reader, value: unknown, label: string): string {
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim().replace(',', '.')
        : '';
  const rate = Number(raw);
  if (!raw || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    reader.errors.push(`${label}: informe um percentual entre 0 e 100.`);
    return '0';
  }
  return String(Math.round(rate * 10000) / 10000);
}

/**
 * Validates and normalizes what the accountant sent. Unknown keys are dropped
 * (only what is read below is kept), so the stored jsonb never carries
 * free-form data or secrets that slipped into the payload.
 */
export function parseFiscalIntakeData(input: unknown): FiscalIntakeData {
  const r = new Reader();
  const root = r.obj(input, 'Dados');
  const company = r.obj(root.company, 'Empresa');
  const address = r.obj(company.address, 'Endereço fiscal');
  const taxation = r.obj(root.taxation, 'Tributação');
  const issuance = r.obj(root.issuance, 'Emissão');
  const accountant = r.obj(root.accountant, 'Contador');
  const confirmation = r.obj(root.confirmation, 'Confirmação');

  const cnpj = r.digits(company.cnpj, 'CNPJ', [14], true) ?? '';
  if (cnpj && !isValidCnpj(cnpj))
    r.errors.push('CNPJ: dígitos verificadores inválidos.');

  const mainCnae = normalizeCnae(taxation.mainCnae);
  if (!mainCnae) r.errors.push('CNAE principal: informe os 7 dígitos.');
  const secondaryRaw = Array.isArray(taxation.secondaryCnaes)
    ? taxation.secondaryCnaes
    : [];
  const secondaryCnaes = [
    ...new Set(
      secondaryRaw
        .slice(0, 40)
        .map(normalizeCnae)
        .filter((c): c is string => Boolean(c)),
    ),
  ].filter((c) => c !== mainCnae);

  const servicesRaw = Array.isArray(root.services)
    ? root.services.slice(0, 20)
    : [];
  if (servicesRaw.length === 0)
    r.errors.push('Serviços: informe ao menos um serviço.');
  const services: FiscalServiceItem[] = servicesRaw.map((raw, index) => {
    const item = r.obj(raw, `Serviço ${index + 1}`);
    const label = `Serviço ${index + 1}`;
    const withholdings = Array.isArray(item.withholdings)
      ? FISCAL_WITHHOLDINGS.filter((w) =>
          (item.withholdings as unknown[]).includes(w),
        )
      : [];
    return {
      lc116Code: r.req(item.lc116Code, `${label} — código LC 116`, 20),
      municipalTaxCode: r.text(
        item.municipalTaxCode,
        `${label} — código municipal`,
        40,
        false,
      ),
      nbsCode: r.text(item.nbsCode, `${label} — NBS`, 20, false),
      issRate: normalizeRate(r, item.issRate, `${label} — alíquota de ISS`),
      incidence: r.oneOf(
        item.incidence ?? 'provider',
        ['provider', 'customer'] as const,
        `${label} — local de incidência`,
      ),
      withholdings,
      description: r.text(
        item.description,
        `${label} — descrição`,
        2000,
        false,
      ),
      ibsCbsCst: r.text(item.ibsCbsCst, `${label} — CST IBS/CBS`, 10, false),
      ibsCbsClass: r.text(
        item.ibsCbsClass,
        `${label} — classificação IBS/CBS`,
        20,
        false,
      ),
    };
  });

  const nextNumberRaw = onlyDigits(issuance.nextNumber);
  const nextNumber = nextNumberRaw ? Number(nextNumberRaw.slice(0, 12)) : null;

  const data: FiscalIntakeData = {
    version: 1,
    company: {
      cnpj,
      legalName: r.req(company.legalName, 'Razão social', 200),
      tradeName: r.text(company.tradeName, 'Nome fantasia', 200, false),
      address: {
        zipCode: r.digits(address.zipCode, 'CEP', [8], true) ?? '',
        street: r.req(address.street, 'Logradouro', 200),
        number: r.req(address.number, 'Número', 20),
        complement: r.text(address.complement, 'Complemento', 120, false),
        district: r.req(address.district, 'Bairro', 120),
        city: r.req(address.city, 'Município', 120),
        state: r.req(address.state, 'UF', 2).toUpperCase(),
        ibgeCode:
          r.digits(address.ibgeCode, 'Código IBGE do município', [7], true) ??
          '',
      },
      municipalRegistration: r.text(
        company.municipalRegistration,
        'Inscrição municipal',
        40,
        false,
      ),
      stateRegistration: r.text(
        company.stateRegistration,
        'Inscrição estadual',
        40,
        false,
      ),
      fiscalEmail: r.email(company.fiscalEmail, 'E-mail fiscal', true) ?? '',
      fiscalPhone: r.text(company.fiscalPhone, 'Telefone fiscal', 30, false),
    },
    taxation: {
      regime: r.oneOf(taxation.regime, FISCAL_TAX_REGIMES, 'Regime tributário'),
      specialRegime: r.text(
        taxation.specialRegime,
        'Regime especial',
        80,
        false,
      ),
      taxIncentive: taxation.taxIncentive === true,
      mainCnae: mainCnae ?? '',
      secondaryCnaes,
    },
    services,
    issuance: {
      issuer: r.oneOf(
        issuance.issuer ?? 'municipal',
        ['municipal', 'national'] as const,
        'Emissor',
      ),
      series: r.text(issuance.series, 'Série', 20, false),
      nextNumber: nextNumber && nextNumber > 0 ? nextNumber : null,
      portalLogin: r.text(issuance.portalLogin, 'Login do portal', 120, false),
    },
    accountant: {
      name: r.req(accountant.name, 'Nome do contador', 160),
      crc: r.text(accountant.crc, 'CRC', 40, false),
      email: r.email(accountant.email, 'E-mail do contador', true) ?? '',
      phone: r.text(accountant.phone, 'Telefone do contador', 30, false),
    },
    confirmation: {
      responsibleName: r.req(
        confirmation.responsibleName,
        'Confirmação do responsável',
        160,
      ),
    },
  };

  if (r.errors.length) throw new BadRequestException(r.errors.slice(0, 12));
  return data;
}
