import { BadRequestException } from '@nestjs/common';
import { MetaAdsGraphService } from './meta-ads-graph.service';
import { MetaGraphError } from './meta-graph-error';

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

  describe('hardening', () => {
    /** Like `jsonResponse`, but able to carry a status and rate-limit headers. */
    function graphResponse(
      body: unknown,
      init: {
        ok?: boolean;
        status?: number;
        headers?: Record<string, string>;
      } = {},
    ) {
      const values = init.headers ?? {};

      return {
        ok: init.ok ?? true,
        status: init.status ?? (init.ok === false ? 400 : 200),
        headers: { get: (name: string) => values[name.toLowerCase()] ?? null },
        json: () => Promise.resolve(body),
      } as unknown as Response;
    }

    function errorResponse(
      code: number,
      init: { status?: number; subcode?: number } = {},
    ) {
      return graphResponse(
        {
          error: {
            message: 'provider said something',
            code,
            error_subcode: init.subcode,
          },
        },
        { ok: false, status: init.status ?? 400 },
      );
    }

    async function kindOf(response: Response) {
      global.fetch = jest.fn(() => response) as never;

      return service
        .listAdAccounts('token')
        .then(() => null)
        .catch((error: MetaGraphError) => error.kind);
    }

    it('bounds every request with a timeout', async () => {
      const init: RequestInit[] = [];
      global.fetch = ((_url: URL, options: RequestInit) => {
        init.push(options);
        return graphResponse({ data: [] });
      }) as never;

      await service.listAdAccounts('token');

      // Without this, a provider that accepts the connection and then stops
      // answering holds a worker open on a claimed job indefinitely.
      expect(init[0].signal).toBeInstanceOf(AbortSignal);
    });

    it('classifies a rate limit as rate_limited', async () => {
      await expect(kindOf(errorResponse(80000))).resolves.toBe('rate_limited');
    });

    it('classifies an invalid token as auth', async () => {
      await expect(kindOf(errorResponse(190, { subcode: 463 }))).resolves.toBe(
        'auth',
      );
    });

    it('carries why the credential was refused, not just that it was', async () => {
      // Both are `auth`, and a scheduler must act differently on each: 190/463
      // is a dead token, 200 is a live token missing a role. Asserted through
      // the service so the subcode is really read off the response body.
      const reasonOf = (response: Response) => {
        global.fetch = jest.fn(() => response) as never;

        return service
          .listAdAccounts('token')
          .then(() => null)
          .catch((error: MetaGraphError) => error.authReason);
      };

      await expect(
        reasonOf(errorResponse(190, { subcode: 463 })),
      ).resolves.toBe('credential_invalid');
      await expect(reasonOf(errorResponse(200))).resolves.toBe(
        'permission_denied',
      );
    });

    it('classifies a provider outage as transient', async () => {
      await expect(
        kindOf(graphResponse({}, { ok: false, status: 503 })),
      ).resolves.toBe('transient');
    });

    it('classifies a bad request as permanent', async () => {
      await expect(kindOf(errorResponse(100))).resolves.toBe('permanent');
    });

    it('classifies a timeout as transient without echoing the URL', async () => {
      global.fetch = jest.fn(() => {
        const error = new Error(
          'timed out https://graph.facebook.com/v25.0/me?access_token=EAAG',
        );
        error.name = 'TimeoutError';
        throw error;
      }) as never;

      const error = await service
        .listAdAccounts('token')
        .catch((thrown: MetaGraphError) => thrown);

      expect(error).toBeInstanceOf(MetaGraphError);
      expect((error as MetaGraphError).kind).toBe('transient');
      expect((error as MetaGraphError).message).toBe(
        'Meta Graph API request timed out.',
      );
      expect((error as MetaGraphError).message).not.toContain('EAAG');
    });

    it('carries the rate-limit headers on the failure', async () => {
      global.fetch = jest.fn(() =>
        graphResponse(
          { error: { message: 'slow down', code: 80000 } },
          {
            ok: false,
            headers: {
              'x-business-use-case-usage': JSON.stringify({
                biz: [{ call_count: 100, estimated_time_to_regain_access: 4 }],
              }),
              'retry-after': '90',
            },
          },
        ),
      ) as never;

      const error = await service
        .listAdAccounts('token')
        .catch((thrown: MetaGraphError) => thrown);

      expect((error as MetaGraphError).usage.businessUseCasePercent).toBe(100);
      expect((error as MetaGraphError).retryAfterMs).toBe(90_000);
    });

    it('reports usage from a successful read', async () => {
      global.fetch = jest.fn(() =>
        graphResponse(
          { data: [{ id: 'act_1' }] },
          {
            headers: {
              'x-business-use-case-usage': JSON.stringify({
                biz: [{ call_count: 42 }],
              }),
            },
          },
        ),
      ) as never;

      const page = await service.listAdAccountsWithUsage('token');

      expect(page.rows).toHaveLength(1);
      expect(page.usage.businessUseCasePercent).toBe(42);
      // Meta did not send the ad-account header here, as observed in
      // production on the insights edge. Absent is not zero.
      expect(page.usage.adAccountPercent).toBeNull();
    });

    it('survives a response with no headers', async () => {
      // Every S1 test builds a response without them; usage parsing must not
      // be the thing that breaks the connection flow.
      global.fetch = jest.fn(() =>
        jsonResponse({ data: [{ id: 'act_1' }] }),
      ) as never;

      await expect(service.listAdAccounts('token')).resolves.toHaveLength(1);
    });

    it('refuses a paging.next that points at a different edge', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          graphResponse({
            data: [{ id: 'act_1' }],
            paging: {
              // Same origin, same version, another edge: not pagination.
              next: 'https://graph.facebook.com/v25.0/me/accounts?after=abc',
            },
          }),
        )
        .mockResolvedValue(graphResponse({ data: [] }));
      global.fetch = fetchMock as never;

      await service.listAdAccounts('token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('follows a cursor without reusing the provider URL', async () => {
      const requested: URL[] = [];
      const fetchMock = jest.fn((url: URL) => {
        requested.push(url);

        return requested.length === 1
          ? graphResponse({
              data: [{ id: 'act_1' }],
              paging: {
                next: `https://graph.facebook.com/v25.0/me/adaccounts?after=cursor-2&access_token=${'stolen'}`,
              },
            })
          : graphResponse({ data: [{ id: 'act_2' }] });
      });
      global.fetch = fetchMock as never;

      const accounts = await service.listAdAccounts('token');

      expect(accounts).toHaveLength(2);
      // The cursor is taken; the URL is rebuilt with our own credentials, so a
      // token planted in `next` is never sent anywhere.
      expect(requested[1].searchParams.get('after')).toBe('cursor-2');
      expect(requested[1].searchParams.get('access_token')).toBe('token');
    });
  });

  describe('readNode and readEdge', () => {
    it('addresses a node under the configured Graph version', async () => {
      const requested = captureFetch({ id: 'act_1234567890', currency: 'BRL' });

      await service.readNode({
        accessToken: 'token',
        path: 'act_1234567890',
        fields: 'id,currency',
        failureMessage: 'Meta Ads account read failed.',
      });

      expect(requested[0].pathname).toBe('/v25.0/act_1234567890');
      expect(requested[0].searchParams.get('fields')).toBe('id,currency');
      expect(requested[0].searchParams.get('access_token')).toBe('token');
    });

    it('pages an edge with the same walker the account list uses', async () => {
      const requested: URL[] = [];
      global.fetch = ((url: URL) => {
        requested.push(url);

        return requested.length === 1
          ? jsonResponse({
              data: [{ id: '1' }, { id: '2' }],
              paging: {
                next: 'https://graph.facebook.com/v25.0/act_1/campaigns?after=cursor-2&access_token=stolen',
              },
            })
          : jsonResponse({ data: [{ id: '3' }] });
      }) as never;

      const page = await service.readEdge({
        accessToken: 'token',
        path: 'act_1/campaigns',
        fields: 'id',
        limit: 200,
        maxPages: 5,
        failureMessage: 'Meta Ads campaigns read failed.',
      });

      expect(page.rows).toHaveLength(3);
      expect(page.truncated).toBe(false);
      // The cursor is taken and the URL rebuilt with our own credentials, so a
      // token planted in `next` never leaves this process.
      expect(requested[1].searchParams.get('after')).toBe('cursor-2');
      expect(requested[1].searchParams.get('access_token')).toBe('token');
    });

    it('reports truncation instead of presenting a prefix as the edge', async () => {
      // The distinction the sync depends on: a truncated read and a complete
      // one look identical from the row list, and treating the first as
      // complete is how ten thousand objects get archived as "disappeared".
      let calls = 0;
      global.fetch = (() => {
        calls += 1;

        return jsonResponse({
          data: [{ id: String(calls) }],
          paging: {
            next: `https://graph.facebook.com/v25.0/act_1/ads?after=cursor-${calls + 1}`,
          },
        });
      }) as never;

      const page = await service.readEdge({
        accessToken: 'token',
        path: 'act_1/ads',
        fields: 'id',
        limit: 200,
        maxPages: 3,
        failureMessage: 'Meta Ads ads read failed.',
      });

      expect(calls).toBe(3);
      expect(page.rows).toHaveLength(3);
      expect(page.truncated).toBe(true);
    });

    it('refuses a path that is not a Graph node or edge', async () => {
      const requested = captureFetch({ data: [] });

      // The path is assembled by callers, so it is validated rather than
      // trusted: a value carrying a second host or a query string would turn
      // this client into a fetcher with our token attached.
      for (const path of [
        '../me',
        'act_1/campaigns?access_token=x',
        'https://evil.example.com/x',
        'act_1/campaigns/extra',
      ]) {
        await expect(
          service.readEdge({
            accessToken: 'token',
            path,
            fields: 'id',
            limit: 10,
            maxPages: 1,
            failureMessage: 'nope',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }

      expect(requested).toHaveLength(0);
    });

    it('follows a cursor Meta rolled forward to a newer API version', async () => {
      // Observed in production: a request against v25.0 answers with
      // `paging.next` on v26.0. Demanding our exact version made every walk
      // stop after page one *and* report nothing wrong — a prefix that looks
      // like a complete edge, which is what makes a sync archive everything
      // past it as deleted.
      const requested: URL[] = [];
      global.fetch = ((url: URL) => {
        requested.push(url);

        return requested.length === 1
          ? jsonResponse({
              data: [{ id: '1' }],
              paging: {
                next: 'https://graph.facebook.com/v26.0/act_1/ads?after=cursor-2&limit=200',
              },
            })
          : jsonResponse({ data: [{ id: '2' }] });
      }) as never;

      const page = await service.readEdge({
        accessToken: 'token',
        path: 'act_1/ads',
        fields: 'id',
        limit: 200,
        maxPages: 5,
        failureMessage: 'Meta Ads ads read failed.',
      });

      expect(page.rows).toHaveLength(2);
      // Still our own version and our own token on the wire: only the cursor
      // was taken from that URL.
      expect(requested[1].pathname).toBe('/v25.0/act_1/ads');
      expect(requested[1].searchParams.get('access_token')).toBe('token');
    });

    it('still refuses another edge, whatever version it claims', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ id: '1' }],
            paging: {
              next: 'https://graph.facebook.com/v26.0/act_1/campaigns?after=abc',
            },
          }),
        )
        .mockResolvedValue(jsonResponse({ data: [] }));
      global.fetch = fetchMock as never;

      await service.readEdge({
        accessToken: 'token',
        path: 'act_1/ads',
        fields: 'id',
        limit: 200,
        maxPages: 5,
        failureMessage: 'Meta Ads ads read failed.',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('classifies an edge failure like every other Graph call', async () => {
      global.fetch = (() =>
        jsonResponse(
          { error: { message: 'slow down', code: 17 } },
          false,
        )) as never;

      await expect(
        service.readEdge({
          accessToken: 'token',
          path: 'act_1/campaigns',
          fields: 'id',
          limit: 10,
          maxPages: 1,
          failureMessage: 'Meta Ads campaigns read failed.',
        }),
      ).rejects.toMatchObject({ kind: 'rate_limited' });
    });
  });
});
