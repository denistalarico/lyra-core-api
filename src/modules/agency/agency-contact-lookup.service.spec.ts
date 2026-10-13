import { HttpException, Logger } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { ANY_PERMISSION_KEYS_METADATA } from '../permissions/decorators/permissions.decorators';
import {
  AgencyContactLookupService,
  CONTACT_LOOKUP_ERROR_CODES,
  CONTACT_LOOKUP_RATE_LIMITS,
  CONTACT_LOOKUP_TIMEOUT_MS,
  isValidCnpj,
  normalizeBrazilianCep,
  normalizeCnpj,
  normalizeUsZip5,
} from './agency-contact-lookup.service';
import { AgencyContactsController } from './agency-contacts.controller';

/**
 * Offline: `fetch` is replaced per test with deterministic provider answers
 * (shapes captured from the real ViaCEP, Zippopotam.us and BrasilAPI on
 * 2026-10-13). No test reaches the network.
 */

const ctx: RequestContext = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

function jsonResponse(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        status: error.getStatus(),
        body: error.getResponse() as { code?: string; message?: string },
      };
    }
    throw error;
  }
  throw new Error('expected the lookup to fail');
}

describe('AgencyContactLookupService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock<Promise<Response>, [URL, RequestInit]>;
  let service: AgencyContactLookupService;
  let logSpy: jest.SpyInstance<void, [message: unknown, ...rest: unknown[]]>;

  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [URL, RequestInit]>();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new AgencyContactLookupService();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function calledUrl(index = 0) {
    return String(fetchMock.mock.calls[index][0]);
  }

  describe('BR CEP (ViaCEP)', () => {
    it('suggests street, district, city and UF — never number or the CEP range note', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          cep: '01001-000',
          logradouro: 'Praça da Sé',
          complemento: 'lado ímpar',
          bairro: 'Sé',
          localidade: 'São Paulo',
          uf: 'SP',
        }),
      );

      const result = await service.lookupPostal(ctx, {
        country: 'BR',
        postalCode: '01001-000',
      });

      expect(calledUrl()).toBe('https://viacep.com.br/ws/01001000/json/');
      expect(result).toMatchObject({
        status: 'found',
        country: 'BR',
        provider: 'viacep',
        localities: [
          {
            street: 'Praça da Sé',
            district: 'Sé',
            city: 'São Paulo',
            state: 'SP',
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain('lado ímpar');
      expect(typeof (result as { queriedAt: string }).queriedAt).toBe('string');
    });

    it('keeps a generic (city-wide) CEP partial instead of inventing a street', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          cep: '78175-000',
          logradouro: '',
          bairro: '',
          localidade: 'Poconé',
          uf: 'MT',
        }),
      );

      const result = await service.lookupPostal(ctx, {
        country: 'BR',
        postalCode: '78175000',
      });

      expect(result).toMatchObject({
        status: 'found',
        localities: [
          { street: null, district: null, city: 'Poconé', state: 'MT' },
        ],
      });
    });

    it('maps ViaCEP `erro` (HTTP 200) to not_found', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { erro: 'true' }));

      await expect(
        service.lookupPostal(ctx, { country: 'BR', postalCode: '99999-999' }),
      ).resolves.toMatchObject({ status: 'not_found', provider: 'viacep' });
    });

    it('rejects a malformed CEP before calling the provider', async () => {
      const failure = await errorOf(
        service.lookupPostal(ctx, { country: 'BR', postalCode: '1234567' }),
      );

      expect(failure.status).toBe(400);
      expect(failure.body.code).toBe(CONTACT_LOOKUP_ERROR_CODES.invalid);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('US ZIP (Zippopotam.us)', () => {
    it('queries ZIP5 for a ZIP+4 and returns every distinct locality', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          'post code': '12345',
          places: [
            {
              'place name': 'Schenectady',
              'state abbreviation': 'NY',
              state: 'New York',
            },
            {
              'place name': 'General Electric',
              'state abbreviation': 'NY',
              state: 'New York',
            },
            {
              'place name': 'Schenectady',
              'state abbreviation': 'NY',
              state: 'New York',
            },
          ],
        }),
      );

      const result = await service.lookupPostal(ctx, {
        country: 'US',
        postalCode: '12345-6789',
      });

      expect(calledUrl()).toBe('https://api.zippopotam.us/us/12345');
      expect(result).toMatchObject({
        status: 'found',
        provider: 'zippopotam',
        localities: [
          { street: null, district: null, city: 'Schenectady', state: 'NY' },
          {
            street: null,
            district: null,
            city: 'General Electric',
            state: 'NY',
          },
        ],
      });
    });

    it('maps 404 to not_found', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, {}));

      await expect(
        service.lookupPostal(ctx, { country: 'US', postalCode: '00000' }),
      ).resolves.toMatchObject({ status: 'not_found', country: 'US' });
    });

    it('treats a body without places as unavailable (malformed)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { 'post code': '90210' }));

      const failure = await errorOf(
        service.lookupPostal(ctx, { country: 'US', postalCode: '90210' }),
      );

      expect(failure.status).toBe(503);
      expect(failure.body.code).toBe(CONTACT_LOOKUP_ERROR_CODES.unavailable);
    });
  });

  describe('BR CNPJ (BrasilAPI)', () => {
    const brasilApiBody = {
      cnpj: '19131243000197',
      razao_social: 'OPEN KNOWLEDGE BRASIL',
      nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
      descricao_situacao_cadastral: 'ATIVA',
      descricao_tipo_de_logradouro: 'AVENIDA',
      logradouro: 'PAULISTA 37',
      numero: '37',
      complemento: 'ANDAR 4',
      bairro: 'BELA VISTA',
      municipio: 'SAO PAULO',
      uf: 'SP',
      cep: '01311902',
      email: null,
      ddd_telefone_1: '1123851939',
      qsa: [{ nome_socio: 'PESSOA SOCIA', cnpj_cpf_do_socio: '***112108**' }],
    };

    it('suggests company names and the registered address, never partners', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, brasilApiBody));

      const result = await service.lookupCompany(ctx, {
        country: 'BR',
        document: '19.131.243/0001-97',
      });

      expect(calledUrl()).toBe(
        'https://brasilapi.com.br/api/cnpj/v1/19131243000197',
      );
      expect(result).toEqual({
        status: 'found',
        country: 'BR',
        provider: 'brasilapi',
        queriedAt: expect.any(String) as unknown as string,
        suggestion: {
          legalName: 'OPEN KNOWLEDGE BRASIL',
          tradeName: 'REDE PELO CONHECIMENTO LIVRE',
          registrationStatus: 'ATIVA',
          address: {
            street: 'AVENIDA PAULISTA 37',
            number: '37',
            complement: 'ANDAR 4',
            district: 'BELA VISTA',
            city: 'SAO PAULO',
            state: 'SP',
            postalCode: '01311-902',
          },
          email: null,
          phone: '1123851939',
        },
      });
      expect(JSON.stringify(result)).not.toContain('PESSOA SOCIA');
    });

    it('sends an alphanumeric CNPJ with its letters intact', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { type: 'not_found' }));

      const result = await service.lookupCompany(ctx, {
        country: 'BR',
        document: '12.abc.345/01de-35',
      });

      expect(calledUrl()).toBe(
        'https://brasilapi.com.br/api/cnpj/v1/12ABC34501DE35',
      );
      expect(result).toMatchObject({
        status: 'not_found',
        provider: 'brasilapi',
      });
    });

    it('rejects a CNPJ with wrong check digits without calling the provider', async () => {
      const failure = await errorOf(
        service.lookupCompany(ctx, {
          country: 'BR',
          document: '12ABC34501DE36',
        }),
      );

      expect(failure.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps a provider 400 (format it does not accept) to invalid', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { type: 'bad_request' }));

      const failure = await errorOf(
        service.lookupCompany(ctx, {
          country: 'BR',
          document: '11222333000181',
        }),
      );

      expect(failure.status).toBe(400);
      expect(failure.body.code).toBe(CONTACT_LOOKUP_ERROR_CODES.invalid);
    });

    it('answers unsupported for a US company instead of pretending EIN discovery', async () => {
      await expect(
        service.lookupCompany(ctx, { country: 'US', document: '12-3456789' }),
      ).resolves.toEqual({
        status: 'unsupported',
        country: 'US',
        reason: 'us_company_lookup_unavailable',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats a body without razao_social as unavailable (malformed)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { cnpj: '11222333000181' }),
      );

      const failure = await errorOf(
        service.lookupCompany(ctx, {
          country: 'BR',
          document: '11222333000181',
        }),
      );

      expect(failure.status).toBe(503);
    });
  });

  describe('provider failures', () => {
    it.each([
      [429, 429, CONTACT_LOOKUP_ERROR_CODES.rateLimited],
      [500, 503, CONTACT_LOOKUP_ERROR_CODES.unavailable],
      [502, 503, CONTACT_LOOKUP_ERROR_CODES.unavailable],
    ])('maps HTTP %s to %s', async (upstream, expected, code) => {
      fetchMock.mockResolvedValue(jsonResponse(upstream, {}));

      const failure = await errorOf(
        service.lookupPostal(ctx, { country: 'BR', postalCode: '01001000' }),
      );

      expect(failure).toMatchObject({ status: expected, body: { code } });
    });

    it('maps a timeout to unavailable and bounds the call at 5 seconds', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
      fetchMock.mockRejectedValue(
        Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      );

      const failure = await errorOf(
        service.lookupPostal(ctx, { country: 'BR', postalCode: '01001000' }),
      );

      expect(failure.status).toBe(503);
      expect(timeoutSpy).toHaveBeenCalledWith(CONTACT_LOOKUP_TIMEOUT_MS);
      expect(CONTACT_LOOKUP_TIMEOUT_MS).toBe(5_000);
    });

    it('maps a network error and a non-JSON body to unavailable', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      expect(
        (
          await errorOf(
            service.lookupPostal(ctx, {
              country: 'BR',
              postalCode: '01001000',
            }),
          )
        ).status,
      ).toBe(503);

      fetchMock.mockResolvedValueOnce(
        new Response('<html>oops</html>', { status: 200 }),
      );
      expect(
        (
          await errorOf(
            service.lookupPostal(ctx, {
              country: 'BR',
              postalCode: '01001000',
            }),
          )
        ).status,
      ).toBe(503);
    });

    it('never follows redirects and sends no Lyra credentials', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { erro: 'true' }));

      await service.lookupPostal(ctx, {
        country: 'BR',
        postalCode: '01001000',
      });

      const init = fetchMock.mock.calls[0][1];
      expect(init.redirect).toBe('error');
      expect(init.headers).toEqual({
        Accept: 'application/json',
        'User-Agent': 'LyraPlatform/1.0 (contact assisted fill)',
      });
    });

    it('logs kind, provider, duration and outcome without the identifier', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, {}));

      await service.lookupCompany(ctx, {
        country: 'BR',
        document: '19131243000197',
      });

      const line = String(logSpy.mock.calls[0][0]);
      expect(line).toMatch(
        /kind=company provider=brasilapi durationMs=\d+ outcome=not_found/,
      );
      expect(line).not.toContain('19131243000197');
    });
  });

  describe('rate limit', () => {
    it('limits one user per workspace without spending on invalid input', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { erro: 'true' })),
      );

      await errorOf(
        service.lookupPostal(ctx, { country: 'BR', postalCode: 'x' }),
      );
      for (let i = 0; i < CONTACT_LOOKUP_RATE_LIMITS.user.limit; i += 1) {
        await service.lookupPostal(ctx, {
          country: 'BR',
          postalCode: '01001000',
        });
      }

      const failure = await errorOf(
        service.lookupPostal(ctx, { country: 'BR', postalCode: '01001000' }),
      );
      expect(failure).toMatchObject({
        status: 429,
        body: { code: CONTACT_LOOKUP_ERROR_CODES.rateLimited },
      });
      expect(fetchMock).toHaveBeenCalledTimes(
        CONTACT_LOOKUP_RATE_LIMITS.user.limit,
      );

      // Another user in the same workspace still has their own budget.
      await expect(
        service.lookupPostal(
          { ...ctx, userId: 'user-2' },
          { country: 'BR', postalCode: '01001000' },
        ),
      ).resolves.toMatchObject({ status: 'not_found' });
    });

    it('caps a whole workspace across users', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { erro: 'true' })),
      );
      const { limit: perUser } = CONTACT_LOOKUP_RATE_LIMITS.user;
      const { limit: perWorkspace } = CONTACT_LOOKUP_RATE_LIMITS.workspace;

      for (let i = 0; i < perWorkspace; i += 1) {
        const userId = `user-${Math.floor(i / perUser)}`;
        await service.lookupPostal(
          { ...ctx, userId },
          { country: 'BR', postalCode: '01001000' },
        );
      }

      const failure = await errorOf(
        service.lookupPostal(
          { ...ctx, userId: 'fresh-user' },
          { country: 'BR', postalCode: '01001000' },
        ),
      );
      expect(failure.status).toBe(429);

      // A different workspace is unaffected.
      await expect(
        service.lookupPostal(
          { ...ctx, workspaceId: 'workspace-2' },
          { country: 'BR', postalCode: '01001000' },
        ),
      ).resolves.toMatchObject({ status: 'not_found' });
    });
  });
});

describe('contact lookup identifiers', () => {
  it('normalizes CEP and ZIP without inventing digits', () => {
    expect(normalizeBrazilianCep('01.001-000')).toBe('01001000');
    expect(normalizeBrazilianCep('0100100')).toBeNull();
    expect(normalizeUsZip5('90210')).toBe('90210');
    expect(normalizeUsZip5('90210-1234')).toBe('90210');
    expect(normalizeUsZip5('9021')).toBeNull();
    expect(normalizeUsZip5('90210-12')).toBeNull();
  });

  it('keeps CNPJ letters and validates official check digits', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(normalizeCnpj('12ABC34501DEAB')).toBeNull();
    expect(isValidCnpj('12ABC34501DE35')).toBe(true);
    expect(isValidCnpj('19131243000197')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
});

describe('AgencyContactsController lookup routes', () => {
  it('reuse the contact view permissions of the façade', () => {
    const expected = [
      'shared.contacts.view.assigned',
      'shared.contacts.view.client',
      'shared.contacts.view.department',
      'shared.contacts.view.all',
    ];

    for (const handler of ['lookupPostal', 'lookupCompany'] as const) {
      expect(
        Reflect.getMetadata(
          ANY_PERMISSION_KEYS_METADATA,
          AgencyContactsController.prototype[handler],
        ),
      ).toEqual(expected);
    }
  });
});
