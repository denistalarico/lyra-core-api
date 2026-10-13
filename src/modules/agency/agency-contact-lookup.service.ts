import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { RequestContext } from '../../common/context/request-context.interface';

/**
 * E1 (docs/sprints/agency/2026-10-13-sales-contacts-refinements-and-enrichment-audit.md)
 * — assisted fill for the contact drawer.
 *
 * Suggestions only: nothing here reads or writes contacts. The browser never
 * talks to a provider; this proxy owns validation, fixed hosts, timeout, the
 * per-user/workspace limit and error translation. The providers are public
 * and keyless, so no Lyra credential or secret ever leaves the API.
 *
 * Coverage is deliberately narrow: BR CEP (ViaCEP), US ZIP city/state
 * (Zippopotam.us) and BR CNPJ (BrasilAPI, which itself forwards to Minha
 * Receita — a second "fallback" to Minha Receita would share its outages).
 * There is no public, universal, keyless source for US companies by EIN, so
 * that combination answers `unsupported` instead of guessing.
 */

export type ContactLookupCountry = 'BR' | 'US';

export type ContactPostalLocality = {
  street: string | null;
  district: string | null;
  city: string;
  state: string;
};

export type ContactPostalLookupResult =
  | {
      status: 'found';
      country: ContactLookupCountry;
      provider: 'viacep' | 'zippopotam';
      queriedAt: string;
      /** One entry for a BR CEP; a US ZIP may span several localities. */
      localities: ContactPostalLocality[];
    }
  | {
      status: 'not_found';
      country: ContactLookupCountry;
      provider: 'viacep' | 'zippopotam';
      queriedAt: string;
    };

export type ContactCompanySuggestion = {
  legalName: string;
  tradeName: string | null;
  /** Receita's cadastral situation (e.g. ATIVA, BAIXADA), shown, never applied. */
  registrationStatus: string | null;
  address: {
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  email: string | null;
  phone: string | null;
};

export type ContactCompanyLookupResult =
  | {
      status: 'found';
      country: 'BR';
      provider: 'brasilapi';
      queriedAt: string;
      suggestion: ContactCompanySuggestion;
    }
  | {
      status: 'not_found';
      country: 'BR';
      provider: 'brasilapi';
      queriedAt: string;
    }
  | {
      status: 'unsupported';
      country: ContactLookupCountry;
      reason: 'us_company_lookup_unavailable';
    };

export const CONTACT_LOOKUP_ERROR_CODES = {
  invalid: 'contact_lookup_invalid',
  rateLimited: 'contact_lookup_rate_limited',
  unavailable: 'contact_lookup_unavailable',
} as const;

/** Hosts this proxy may call. Requests are built only from these bases. */
const PROVIDER_BASE_URLS = {
  viacep: 'https://viacep.com.br',
  zippopotam: 'https://api.zippopotam.us',
  brasilapi: 'https://brasilapi.com.br',
} as const;

type ContactLookupProvider = keyof typeof PROVIDER_BASE_URLS;

const ALLOWED_PROVIDER_HOSTS = new Set(
  Object.values(PROVIDER_BASE_URLS).map((base) => new URL(base).host),
);

export const CONTACT_LOOKUP_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_CHARS = 200_000;

/**
 * Only these headers leave the API — never a Lyra token. The User-Agent is
 * required: BrasilAPI's Cloudflare answers 403 to undici's default `node`
 * agent (seen live on 2026-10-13), and naming ourselves is fair to free APIs.
 */
export const CONTACT_LOOKUP_REQUEST_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'LyraPlatform/1.0 (contact assisted fill)',
} as const;

const MINUTE = 60 * 1000;

/**
 * Fixed-window, in-process counters (same model as
 * `ClientAreaRateLimitService`; per-process debt shared with it). The user
 * bucket stops one person from looping; the workspace bucket caps a whole
 * agency so it cannot get our server IP blocked by ViaCEP for bulk use.
 */
export const CONTACT_LOOKUP_RATE_LIMITS = {
  user: { limit: 20, windowMs: MINUTE },
  workspace: { limit: 120, windowMs: MINUTE },
} as const;

type RateLimitBucket = { count: number; resetsAt: number };

type ProviderResponse = { kind: 'ok'; body: unknown } | { kind: 'not_found' };

class ProviderFailure extends Error {
  constructor(
    readonly outcome:
      | 'timeout'
      | 'network'
      | 'rate_limited'
      | 'rejected'
      | 'http_error'
      | 'malformed',
  ) {
    super(outcome);
  }
}

@Injectable()
export class AgencyContactLookupService {
  private readonly logger = new Logger(AgencyContactLookupService.name);
  private readonly buckets = new Map<string, RateLimitBucket>();

  async lookupPostal(
    ctx: RequestContext,
    input: { country: ContactLookupCountry; postalCode: string },
  ): Promise<ContactPostalLookupResult> {
    if (input.country === 'BR') {
      const cep = normalizeBrazilianCep(input.postalCode);
      if (!cep) throw invalid('CEP deve ter 8 dígitos.');
      this.consumeRateLimit(ctx);

      const response = await this.call('postal', 'viacep', `/ws/${cep}/json/`);
      const queriedAt = new Date().toISOString();
      const body = record(response.kind === 'ok' ? response.body : null);

      if (response.kind === 'not_found' || body?.erro !== undefined) {
        return {
          status: 'not_found',
          country: 'BR',
          provider: 'viacep',
          queriedAt,
        };
      }

      const city = text(body?.localidade);
      const state = text(body?.uf);
      if (!city || !state) throw this.malformed('postal', 'viacep');

      return {
        status: 'found',
        country: 'BR',
        provider: 'viacep',
        queriedAt,
        localities: [
          {
            // A city-wide (generic) CEP comes back with empty street/district.
            street: text(body?.logradouro),
            district: text(body?.bairro),
            city,
            state,
          },
        ],
      };
    }

    const zip5 = normalizeUsZip5(input.postalCode);
    if (!zip5) throw invalid('ZIP deve ter 5 dígitos (ZIP+4 opcional).');
    this.consumeRateLimit(ctx);

    const response = await this.call('postal', 'zippopotam', `/us/${zip5}`);
    const queriedAt = new Date().toISOString();

    if (response.kind === 'not_found') {
      return {
        status: 'not_found',
        country: 'US',
        provider: 'zippopotam',
        queriedAt,
      };
    }

    const places = record(response.body)?.places;
    if (!Array.isArray(places)) throw this.malformed('postal', 'zippopotam');

    const localities: ContactPostalLocality[] = [];
    for (const place of places) {
      const city = text(record(place)?.['place name']);
      const state = text(record(place)?.['state abbreviation']);
      if (!city || !state) continue;
      if (localities.some((l) => l.city === city && l.state === state))
        continue;
      localities.push({ street: null, district: null, city, state });
    }

    if (localities.length === 0) {
      return {
        status: 'not_found',
        country: 'US',
        provider: 'zippopotam',
        queriedAt,
      };
    }

    return {
      status: 'found',
      country: 'US',
      provider: 'zippopotam',
      queriedAt,
      localities,
    };
  }

  async lookupCompany(
    ctx: RequestContext,
    input: { country: ContactLookupCountry; document: string },
  ): Promise<ContactCompanyLookupResult> {
    if (input.country === 'US') {
      return {
        status: 'unsupported',
        country: 'US',
        reason: 'us_company_lookup_unavailable',
      };
    }

    const cnpj = normalizeCnpj(input.document);
    if (!cnpj || !isValidCnpj(cnpj)) throw invalid('CNPJ inválido.');
    this.consumeRateLimit(ctx);

    const response = await this.call(
      'company',
      'brasilapi',
      `/api/cnpj/v1/${cnpj}`,
    );
    const queriedAt = new Date().toISOString();

    if (response.kind === 'not_found') {
      return {
        status: 'not_found',
        country: 'BR',
        provider: 'brasilapi',
        queriedAt,
      };
    }

    const body = record(response.body);
    const legalName = text(body?.razao_social);
    if (!body || !legalName) throw this.malformed('company', 'brasilapi');

    return {
      status: 'found',
      country: 'BR',
      provider: 'brasilapi',
      queriedAt,
      suggestion: {
        legalName,
        tradeName: text(body.nome_fantasia),
        registrationStatus: text(body.descricao_situacao_cadastral),
        address: {
          street: joinStreet(
            text(body.descricao_tipo_de_logradouro),
            text(body.logradouro),
          ),
          number: text(body.numero),
          complement: text(body.complemento),
          district: text(body.bairro),
          city: text(body.municipio),
          state: text(body.uf),
          postalCode: formatCep(text(body.cep)),
        },
        email: text(body.email)?.toLowerCase() ?? null,
        phone: text(body.ddd_telefone_1),
      },
    };
  }

  /** Test helper: forget every counter. */
  resetRateLimits(): void {
    this.buckets.clear();
  }

  private consumeRateLimit(ctx: RequestContext) {
    const workspace = `${ctx.tenantId}:${ctx.workspaceId ?? '-'}`;
    const userExceeded = this.spend(
      'user',
      `${workspace}:${ctx.userId ?? '-'}`,
    );
    const workspaceExceeded = this.spend('workspace', workspace);

    if (userExceeded || workspaceExceeded) {
      throw rateLimited(
        'Muitas consultas em pouco tempo. Aguarde um instante.',
      );
    }
  }

  private spend(rule: keyof typeof CONTACT_LOOKUP_RATE_LIMITS, key: string) {
    const now = Date.now();
    const { limit, windowMs } = CONTACT_LOOKUP_RATE_LIMITS[rule];
    const hashed = createHash('sha256').update(`${rule}:${key}`).digest('hex');
    const current = this.buckets.get(hashed);

    if (!current || current.resetsAt <= now) {
      this.buckets.set(hashed, { count: 1, resetsAt: now + windowMs });
      if (this.buckets.size > 10_000) {
        for (const [bucketKey, bucket] of this.buckets) {
          if (bucket.resetsAt <= now) this.buckets.delete(bucketKey);
        }
      }
      return false;
    }

    current.count += 1;
    return current.count > limit;
  }

  /**
   * One GET to a fixed provider. Logs kind, provider, duration and outcome —
   * never the identifier or the payload.
   */
  private async call(
    kind: 'postal' | 'company',
    provider: ContactLookupProvider,
    path: string,
  ): Promise<ProviderResponse> {
    const url = new URL(path, PROVIDER_BASE_URLS[provider]);
    if (url.protocol !== 'https:' || !ALLOWED_PROVIDER_HOSTS.has(url.host)) {
      throw new ServiceUnavailableException({
        message: 'Consulta indisponível.',
        code: CONTACT_LOOKUP_ERROR_CODES.unavailable,
      });
    }

    const startedAt = Date.now();
    let outcome = 'ok';

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: CONTACT_LOOKUP_REQUEST_HEADERS,
          redirect: 'error',
          signal: AbortSignal.timeout(CONTACT_LOOKUP_TIMEOUT_MS),
        });
      } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        throw new ProviderFailure(
          name === 'TimeoutError' || name === 'AbortError'
            ? 'timeout'
            : 'network',
        );
      }

      if (response.status === 404) {
        outcome = 'not_found';
        return { kind: 'not_found' };
      }
      if (response.status === 429) throw new ProviderFailure('rate_limited');
      // Input is validated before the call, so a 400 means the provider
      // disagrees with our validation (e.g. a format it does not support yet).
      if (response.status === 400) throw new ProviderFailure('rejected');
      if (!response.ok) throw new ProviderFailure('http_error');

      let raw: string;
      try {
        raw = await response.text();
      } catch {
        throw new ProviderFailure('network');
      }
      if (raw.length > MAX_RESPONSE_CHARS)
        throw new ProviderFailure('malformed');

      try {
        return { kind: 'ok', body: JSON.parse(raw) as unknown };
      } catch {
        throw new ProviderFailure('malformed');
      }
    } catch (error) {
      if (!(error instanceof ProviderFailure)) throw error;
      outcome = error.outcome;
      throw translateFailure(error);
    } finally {
      this.logger.log(
        `contact lookup kind=${kind} provider=${provider} durationMs=${
          Date.now() - startedAt
        } outcome=${outcome}`,
      );
    }
  }

  private malformed(
    kind: 'postal' | 'company',
    provider: ContactLookupProvider,
  ) {
    this.logger.warn(
      `contact lookup kind=${kind} provider=${provider} outcome=malformed_shape`,
    );
    return unavailable();
  }
}

function translateFailure(failure: ProviderFailure): HttpException {
  if (failure.outcome === 'rate_limited') {
    return rateLimited(
      'O serviço de consulta está limitando pedidos. Tente novamente em instantes.',
    );
  }
  if (failure.outcome === 'rejected') {
    return invalid('O serviço de consulta não aceitou este identificador.');
  }
  return unavailable();
}

function invalid(message: string) {
  return new BadRequestException({
    message,
    code: CONTACT_LOOKUP_ERROR_CODES.invalid,
  });
}

function rateLimited(message: string) {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message,
      code: CONTACT_LOOKUP_ERROR_CODES.rateLimited,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function unavailable() {
  return new ServiceUnavailableException({
    message:
      'Serviço de consulta indisponível agora. O preenchimento manual continua disponível.',
    code: CONTACT_LOOKUP_ERROR_CODES.unavailable,
  });
}

/** `01001-000`, `01001000` or `01.001-000` → `01001000`; anything else → null. */
export function normalizeBrazilianCep(value: string): string | null {
  const compact = value.trim().replace(/[\s.-]/g, '');
  return /^\d{8}$/.test(compact) ? compact : null;
}

/**
 * `90210`, `90210-1234` or `902101234` → `90210`. The extra four digits are
 * never invented and never needed: the provider answers per ZIP5.
 */
export function normalizeUsZip5(value: string): string | null {
  const compact = value.trim().replace(/\s/g, '');
  const match = /^(\d{5})(?:-?\d{4})?$/.exec(compact);
  return match ? match[1] : null;
}

/**
 * Keeps letters: since July 2026 new CNPJs are alphanumeric (12 chars in
 * [0-9A-Z] + 2 numeric check digits). Never normalize with `\D`.
 */
export function normalizeCnpj(value: string): string | null {
  const compact = value
    .trim()
    .toUpperCase()
    .replace(/[\s./-]/g, '');
  return /^[0-9A-Z]{12}\d{2}$/.test(compact) ? compact : null;
}

/** Receita Federal check digits; letters weigh their ASCII code minus 48. */
export function isValidCnpj(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) {
    return false;
  }

  const digit = (base: string, weights: number[]) => {
    const sum = [...base].reduce(
      (total, char, index) =>
        total + (char.charCodeAt(0) - 48) * weights[index],
      0,
    );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base = cnpj.slice(0, 12);
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(
    `${base}${first}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  return cnpj.slice(12) === `${first}${second}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A bounded, trimmed provider string; empty or non-string → null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 200) : null;
}

function joinStreet(type: string | null, name: string | null): string | null {
  if (!name) return null;
  if (!type || name.toUpperCase().startsWith(`${type.toUpperCase()} `)) {
    return name;
  }
  return `${type} ${name}`;
}

function formatCep(value: string | null): string | null {
  const cep = value ? normalizeBrazilianCep(value) : null;
  return cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : value;
}
