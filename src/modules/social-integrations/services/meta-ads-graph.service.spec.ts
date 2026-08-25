import { BadRequestException } from '@nestjs/common';
import { MetaAdsGraphService } from './meta-ads-graph.service';

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Records the URLs the service actually calls, so the credentials it sends can be asserted. */
function captureFetch(body: unknown, ok = true) {
  const requested: URL[] = [];

  global.fetch = ((url: URL) => {
    requested.push(url);
    return jsonResponse(body, ok);
  }) as never;

  return requested;
}

const SOCIAL_APP_ID = 'social-ads-app-id';
const SOCIAL_APP_SECRET = 'social-ads-app-secret';

// The Inbox credentials are present in every test on purpose: the guarantee is
// not "Social works when only Social is configured", it is "Social never
// reaches for the messaging app even when the messaging app is right there".
const INBOX_APP_ID = 'inbox-messaging-app-id';
const INBOX_APP_SECRET = 'inbox-messaging-app-secret';

describe('MetaAdsGraphService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: MetaAdsGraphService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_APP_ID: INBOX_APP_ID,
      META_APP_SECRET: INBOX_APP_SECRET,
      META_GRAPH_API_VERSION: 'v25.0',
      SOCIAL_META_ADS_APP_ID: SOCIAL_APP_ID,
      SOCIAL_META_ADS_APP_SECRET: SOCIAL_APP_SECRET,
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
        appId: SOCIAL_APP_ID,
        configId: 'social-ads-config-id',
        authorizationEndpoint: 'https://www.facebook.com/v25.0/dialog/oauth',
      });
    });

    it('authorizes as the Social app, never as the Inbox app', () => {
      // A login config resolves only against the app that owns it. Sending the
      // messaging app id with the Social config id is what makes Meta answer
      // "URL bloqueada" instead of showing the dialog.
      const config = service.getLoginConfig();

      expect(config.appId).toBe(SOCIAL_APP_ID);
      expect(config.appId).not.toBe(INBOX_APP_ID);
      expect(config.appId).not.toBe(process.env.META_APP_ID);
    });

    it('fails explicitly when the Social app id is missing', () => {
      delete process.env.SOCIAL_META_ADS_APP_ID;

      // Naming the variable is the point: the alternative is Meta refusing the
      // dialog for reasons the operator cannot see from our side.
      expect(() => new MetaAdsGraphService().getLoginConfig()).toThrow(
        'SOCIAL_META_ADS_APP_ID is not configured.',
      );
    });

    it('fails explicitly when the Social app id is present but empty', () => {
      process.env.SOCIAL_META_ADS_APP_ID = '   ';

      expect(() => new MetaAdsGraphService().getLoginConfig()).toThrow(
        BadRequestException,
      );
    });

    it('refuses to build a URL without its own config id', () => {
      // Falling back to META_FACEBOOK_LOGIN_CONFIG_ID would request the
      // Inbox's messaging permissions instead of ads_read.
      delete process.env.SOCIAL_META_ADS_LOGIN_CONFIG_ID;

      expect(() => new MetaAdsGraphService().getLoginConfig()).toThrow(
        BadRequestException,
      );
    });

    it('fails explicitly when the Social app secret is missing', () => {
      // Validated here, not at exchange time: a connection that cannot be
      // completed should never send the operator to Meta in the first place.
      delete process.env.SOCIAL_META_ADS_APP_SECRET;

      expect(() => new MetaAdsGraphService().getLoginConfig()).toThrow(
        'SOCIAL_META_ADS_APP_SECRET is not configured.',
      );
    });

    it('does not accept the Inbox credentials as a substitute', () => {
      delete process.env.SOCIAL_META_ADS_APP_ID;
      delete process.env.SOCIAL_META_ADS_APP_SECRET;

      // META_APP_ID and META_APP_SECRET are still set. Silently using them
      // would produce a working-looking URL that Meta then rejects.
      expect(() => new MetaAdsGraphService().getLoginConfig()).toThrow(
        BadRequestException,
      );
    });

    it('never returns the app secret it just validated', () => {
      expect(JSON.stringify(service.getLoginConfig())).not.toContain(
        SOCIAL_APP_SECRET,
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

    it('trades the code with the Social app credentials', async () => {
      const requested = captureFetch({ access_token: 'token-value' });

      await service.exchangeOAuthCode({
        code: 'code-value',
        redirectUri: 'https://api.example.com/cb',
      });

      const params = requested[0].searchParams;

      expect(params.get('client_id')).toBe(SOCIAL_APP_ID);
      expect(params.get('client_secret')).toBe(SOCIAL_APP_SECRET);
      // The redirect URI has to match the one the dialog was opened with,
      // byte for byte, or Meta rejects the exchange.
      expect(params.get('redirect_uri')).toBe('https://api.example.com/cb');
    });

    it('never sends the Inbox app credentials', async () => {
      const requested = captureFetch({ access_token: 'token-value' });

      await service.exchangeOAuthCode({
        code: 'code-value',
        redirectUri: 'https://api.example.com/cb',
      });

      const sent = requested[0].toString();

      expect(sent).not.toContain(INBOX_APP_ID);
      expect(sent).not.toContain(INBOX_APP_SECRET);
    });

    it('fails explicitly when the Social app secret is missing', async () => {
      delete process.env.SOCIAL_META_ADS_APP_SECRET;
      const requested = captureFetch({ access_token: 'token-value' });

      await expect(
        new MetaAdsGraphService().exchangeOAuthCode({
          code: 'code-value',
          redirectUri: 'https://api.example.com/cb',
        }),
      ).rejects.toThrow('SOCIAL_META_ADS_APP_SECRET is not configured.');

      // It must fail before the request, not authorize as somebody else.
      expect(requested).toHaveLength(0);
    });

    it('does not leak the app secret in the failure', async () => {
      global.fetch = jest.fn(() =>
        jsonResponse(
          { error: { message: `${SOCIAL_APP_SECRET} is invalid` } },
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
    it('extends the token with the Social app credentials', async () => {
      const requested = captureFetch({ access_token: 'long-lived' });

      await service.exchangeLongLivedToken('short-lived');

      const params = requested[0].searchParams;

      expect(params.get('client_id')).toBe(SOCIAL_APP_ID);
      expect(params.get('client_secret')).toBe(SOCIAL_APP_SECRET);
      expect(requested[0].toString()).not.toContain(INBOX_APP_SECRET);
    });

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
        service.sanitizeMetaErrorMessage(`failed for ${SOCIAL_APP_SECRET}`),
      ).toBe('failed for [REDACTED]');
    });

    it('redacts the Social secret, which is the one this client sends', () => {
      // `last_sync_error` is rendered by the settings screen. A provider that
      // echoes the secret back must not turn that column into a credential.
      const sanitized = service.sanitizeMetaErrorMessage(
        `Invalid client_secret ${SOCIAL_APP_SECRET} for app`,
      );

      expect(sanitized).not.toContain(SOCIAL_APP_SECRET);
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
