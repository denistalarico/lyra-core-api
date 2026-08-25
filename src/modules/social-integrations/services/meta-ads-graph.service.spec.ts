import { BadRequestException } from '@nestjs/common';
import { MetaAdsGraphService } from './meta-ads-graph.service';

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('MetaAdsGraphService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: MetaAdsGraphService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_APP_ID: 'meta-app-id',
      META_APP_SECRET: 'meta-app-secret',
      META_GRAPH_API_VERSION: 'v25.0',
      SOCIAL_META_ADS_LOGIN_CONFIG_ID: 'social-ads-config-id',
    };
    service = new MetaAdsGraphService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getLoginConfig', () => {
    it('returns the Social Ads login configuration', () => {
      expect(service.getLoginConfig()).toEqual({
        appId: 'meta-app-id',
        configId: 'social-ads-config-id',
        authorizationEndpoint: 'https://www.facebook.com/v25.0/dialog/oauth',
      });
    });

    it('refuses to build a URL without its own config id', () => {
      // Falling back to META_FACEBOOK_LOGIN_CONFIG_ID would request the
      // Inbox's messaging permissions instead of ads_read.
      delete process.env.SOCIAL_META_ADS_LOGIN_CONFIG_ID;

      expect(() => new MetaAdsGraphService().getLoginConfig()).toThrow(
        BadRequestException,
      );
    });

    it('requires the app secret even though it never returns it', () => {
      delete process.env.META_APP_SECRET;

      expect(() => new MetaAdsGraphService().getLoginConfig()).toThrow(
        BadRequestException,
      );
    });
  });

  describe('exchangeOAuthCode', () => {
    it('posts the code and returns the token', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({ access_token: 'token-value', expires_in: 3600 }),
      ) as never;

      await expect(
        service.exchangeOAuthCode({
          code: 'code-value',
          redirectUri: 'https://api.example.com/cb',
        }),
      ).resolves.toEqual({ accessToken: 'token-value', expiresIn: 3600 });
    });

    it('rejects a response without a token', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({ error: { message: 'bad code' } }, false),
      ) as never;

      await expect(
        service.exchangeOAuthCode({
          code: 'code-value',
          redirectUri: 'https://api.example.com/cb',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not leak the app secret in the failure', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse(
          { error: { message: 'meta-app-secret is invalid' } },
          false,
        ),
      ) as never;

      await expect(
        service.exchangeOAuthCode({
          code: 'code-value',
          redirectUri: 'https://api.example.com/cb',
        }),
      ).rejects.toThrow('Meta Ads OAuth token exchange failed.');
    });
  });

  describe('exchangeLongLivedToken', () => {
    it('returns null instead of throwing when Meta refuses', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({ error: { message: 'nope' } }, false),
      ) as never;

      await expect(
        service.exchangeLongLivedToken('short-lived'),
      ).resolves.toBeNull();
    });
  });

  describe('listAdAccounts', () => {
    it('parses the accounts a user can read', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({
          data: [
            {
              id: 'act_1234567890',
              account_id: '1234567890',
              name: 'Alfa',
              currency: 'brl',
              timezone_name: 'America/Sao_Paulo',
              account_status: 1,
              business: { id: 'biz_1', name: 'Alfa Holding' },
            },
          ],
        }),
      ) as never;

      await expect(service.listAdAccounts('token')).resolves.toEqual([
        {
          externalAccountId: 'act_1234567890',
          accountName: 'Alfa',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          accountStatus: '1',
          businessId: 'biz_1',
          businessName: 'Alfa Holding',
        },
      ]);
    });

    it('requests only read fields', async () => {
      const requestedUrls: URL[] = [];
      global.fetch = ((url: URL) => {
        requestedUrls.push(url);
        return jsonResponse({ data: [] });
      }) as never;

      await service.listAdAccounts('token');

      const url = requestedUrls[0];
      expect(url.pathname).toBe('/v25.0/me/adaccounts');
      expect(url.searchParams.get('fields')).toBe(
        'id,account_id,name,currency,timezone_name,account_status,business{id,name}',
      );
    });

    it('rebuilds the id when Meta returns only account_id', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({ data: [{ account_id: '999', name: 'Beta' }] }),
      ) as never;

      const accounts = await service.listAdAccounts('token');

      expect(accounts[0].externalAccountId).toBe('act_999');
    });

    it('drops entries with no usable id rather than inventing one', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({ data: [{ name: 'Sem id' }, { id: 'act_1' }] }),
      ) as never;

      const accounts = await service.listAdAccounts('token');

      expect(accounts).toHaveLength(1);
      expect(accounts[0].externalAccountId).toBe('act_1');
    });

    it('fails on an error response', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({ error: { message: 'permission denied' } }, false),
      ) as never;

      await expect(service.listAdAccounts('token')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('follows pagination only back to the Graph origin', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ id: 'act_1' }],
            paging: { next: 'https://evil.example.com/steal?after=abc' },
          }),
        )
        .mockResolvedValue(jsonResponse({ data: [] }));
      global.fetch = fetchMock as never;

      const accounts = await service.listAdAccounts('token');

      expect(accounts).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops when a cursor repeats', async () => {
      const looping = jsonResponse({
        data: [{ id: 'act_1' }],
        paging: {
          next: 'https://graph.facebook.com/v25.0/me/adaccounts?after=same',
        },
      });
      const fetchMock = jest.fn(() => looping);
      global.fetch = fetchMock as never;

      await service.listAdAccounts('token');

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('turns a network failure into a safe error', async () => {
      global.fetch = jest.fn(() => {
        throw new Error('ECONNRESET at https://graph.facebook.com?token=EAAG');
      }) as never;

      await expect(service.listAdAccounts('token')).rejects.toThrow(
        'Meta Graph API request failed.',
      );
    });
  });

  describe('sanitizeMetaErrorMessage', () => {
    it('redacts a token echoed back by the provider', () => {
      expect(
        service.sanitizeMetaErrorMessage(
          'Invalid access_token=EAAGm0PX4ZCpsBO please retry',
        ),
      ).toBe('Invalid [REDACTED] please retry');
    });

    it('redacts the app secret even when it is not labelled', () => {
      expect(
        service.sanitizeMetaErrorMessage('failed for meta-app-secret'),
      ).toBe('failed for [REDACTED]');
    });

    it('redacts URLs, which routinely carry the token in a query string', () => {
      expect(
        service.sanitizeMetaErrorMessage(
          'see https://graph.facebook.com/x?access_token=EAAG',
        ),
      ).toBe('see [REDACTED_URL]');
    });

    it('caps the length so a provider cannot fill the column', () => {
      const sanitized = service.sanitizeMetaErrorMessage('a'.repeat(1000));

      expect(sanitized).toHaveLength(240);
    });

    it('returns null for a non-string', () => {
      expect(service.sanitizeMetaErrorMessage({ message: 'x' })).toBeNull();
    });
  });
});
