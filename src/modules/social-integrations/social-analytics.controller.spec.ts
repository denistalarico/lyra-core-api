import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import type { SocialAdBreakdownReadService } from './services/social-ad-breakdown.read.service';
import type { SocialAdCreativeThumbnailService } from './services/social-ad-creative-thumbnail.service';
import type { SocialAnalyticsReadService } from './services/social-analytics-read.service';
import { SocialAnalyticsController } from './social-analytics.controller';

/** Every handler on this controller carries the same guards. */
const GUARDED_HANDLERS = [
  'overview',
  'timeseries',
  'campaigns',
  'adSets',
  'ads',
  'adThumbnail',
  'breakdown',
  'freshness',
  'connections',
] as const;

/**
 * The handlers that take a connection id and a period.
 *
 * `connections` is excluded because it takes no query at all — it is the call a
 * client makes *before* it has an id to send. `adThumbnail` is excluded because
 * it takes a response object as well, and is covered on its own below.
 */
const CONNECTION_SCOPED_HANDLERS = [
  'overview',
  'timeseries',
  'campaigns',
  'adSets',
  'ads',
  'breakdown',
  'freshness',
] as const;

/** What the thumbnail service resolves to, by default. */
const thumbnailUrl = 'https://scontent.example/creative.jpg?oe=6ABCC3C4';

function createHarness() {
  const overviewInputs: Record<string, unknown>[] = [];
  const seriesInputs: Record<string, unknown>[] = [];
  const campaignInputs: Record<string, unknown>[] = [];
  const adSetInputs: Record<string, unknown>[] = [];
  const adInputs: Record<string, unknown>[] = [];
  const thumbnailInputs: Record<string, unknown>[] = [];
  const freshnessInputs: Record<string, unknown>[] = [];

  const record =
    (sink: Record<string, unknown>[]) => (input: Record<string, unknown>) => {
      sink.push(input);
      return Promise.resolve({ connectionId: input.connectionId });
    };

  const connectionInputs: Record<string, unknown>[] = [];

  const analytics = {
    overview: jest.fn(record(overviewInputs)),
    timeseries: jest.fn(record(seriesInputs)),
    campaigns: jest.fn(record(campaignInputs)),
    adSets: jest.fn(record(adSetInputs)),
    ads: jest.fn(record(adInputs)),
    freshness: jest.fn(record(freshnessInputs)),
    listConnections: jest.fn((input: Record<string, unknown>) => {
      connectionInputs.push(input);
      return Promise.resolve([]);
    }),
  };

  const breakdownInputs: Record<string, unknown>[] = [];

  const breakdowns = {
    breakdown: jest.fn(record(breakdownInputs)),
  };

  const thumbnails = {
    resolve: jest.fn(
      (input: Record<string, unknown>): Promise<string | null> => {
        thumbnailInputs.push(input);
        return Promise.resolve(thumbnailUrl);
      },
    ),
  };

  return {
    overviewInputs,
    seriesInputs,
    campaignInputs,
    adSetInputs,
    adInputs,
    thumbnailInputs,
    freshnessInputs,
    connectionInputs,
    breakdownInputs,
    analytics,
    breakdowns,
    thumbnails,
    response: createResponse(),
    controller: new SocialAnalyticsController(
      analytics as unknown as SocialAnalyticsReadService,
      breakdowns as unknown as SocialAdBreakdownReadService,
      thumbnails as unknown as SocialAdCreativeThumbnailService,
    ),
  };
}

/** What `adThumbnail` writes to, standing in for the Express response. */
function createResponse() {
  const headers: Record<string, string> = {};

  return {
    headers,
    statusCode: null as number | null,
    body: null as unknown,
    redirectedTo: null as string | null,
    redirectStatus: null as number | null,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    redirect(status: number, url: string) {
      this.redirectStatus = status;
      this.redirectedTo = url;
    },
  };
}

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  const managedContext = overrides.managedContext;
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    ...overrides,
    ...(managedContext?.operatingMode === 'client' && managedContext.clientId
      ? {
          managedContext: {
            ...managedContext,
            companyContextId: managedContext.companyContextId ?? 'company-a',
          },
        }
      : {}),
  } as RequestContext;
}

/**
 * One query shape for every handler.
 *
 * `kind` is only read by `breakdown`, `adId` only by `adThumbnail`, and
 * `sort`/`direction` only by `campaigns`; the rest ignore what they were not
 * given. Sharing one object keeps these tests about scope resolution and
 * guards — the two things every handler must get right — rather than about each
 * handler's own DTO, which its validator already covers.
 */
const query = {
  connectionId: '11111111-1111-4111-8111-111111111111',
  kind: 'age_gender',
  adId: '120250205947130411',
  since: '2026-08-01',
  until: '2026-08-27',
};

describe('SocialAnalyticsController metadata', () => {
  it.each(GUARDED_HANDLERS)(
    '%s requires the social entitlement and the operational read permission',
    (handler) => {
      const target = (
        SocialAnalyticsController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handler];

      expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target)).toBe(
        'social',
      );
      // Not the admin `settings.integrations.manage` key the integrations
      // controller uses: reading a report is not administering a credential, and
      // requiring admin here would push somebody to hand out admin.
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, target)).toBe(
        'social.analytics.reports.view.operational',
      );
    },
  );
});

describe('SocialAnalyticsController scope resolution', () => {
  it('reads under the tenant and workspace of the authenticated context', async () => {
    const harness = createHarness();

    await harness.controller.overview(context(), query);

    expect(harness.overviewInputs[0]).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      connectionId: query.connectionId,
      since: '2026-08-01',
      until: '2026-08-27',
    });
  });

  it('binds the read to the client of the resolved managed context', async () => {
    const harness = createHarness();

    await harness.controller.overview(
      context({
        managedContext: {
          operatingMode: 'client',
          clientId: 'client-a',
        },
      } as Partial<RequestContext>),
      query,
    );

    expect(harness.overviewInputs[0].agencyClientId).toBe('client-a');
  });

  it('reads the agency own connections when not in client mode', async () => {
    const harness = createHarness();

    await harness.controller.overview(context(), query);

    // NULL rather than "every client": agency mode is its own scope, not an
    // aggregate over the clients it manages.
    expect(harness.overviewInputs[0].agencyClientId).toBeNull();
  });

  it('refuses a client context that names no client', () => {
    const harness = createHarness();

    // Thrown synchronously, before the handler returns a promise: scope
    // resolution happens ahead of any read, so a scopeless request never
    // reaches the database at all.
    expect(() =>
      harness.controller.overview(
        context({
          managedContext: { operatingMode: 'client', clientId: null },
        } as Partial<RequestContext>),
        query,
      ),
    ).toThrow(BadRequestException);

    expect(harness.analytics.overview).not.toHaveBeenCalled();
  });

  it('refuses a context with no tenant', () => {
    const harness = createHarness();

    expect(() =>
      harness.controller.overview(
        context({ tenantId: undefined } as Partial<RequestContext>),
        query,
      ),
    ).toThrow(BadRequestException);

    expect(harness.analytics.overview).not.toHaveBeenCalled();
  });

  it.each(CONNECTION_SCOPED_HANDLERS)(
    '%s resolves scope from the context rather than the query',
    async (handler) => {
      const harness = createHarness();
      const handlers = harness.controller as unknown as Record<
        string,
        (ctx: RequestContext, query: unknown) => Promise<unknown>
      >;

      await handlers[handler](
        context({
          managedContext: { operatingMode: 'client', clientId: 'client-a' },
        } as Partial<RequestContext>),
        query,
      );

      const sinks: Record<string, Record<string, unknown>[]> = {
        overview: harness.overviewInputs,
        timeseries: harness.seriesInputs,
        campaigns: harness.campaignInputs,
        adSets: harness.adSetInputs,
        ads: harness.adInputs,
        breakdown: harness.breakdownInputs,
        freshness: harness.freshnessInputs,
      };

      expect(sinks[handler][0]).toMatchObject({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        connectionId: query.connectionId,
      });
    },
  );

  it.each(GUARDED_HANDLERS)(
    '%s refuses a context with no tenant before reading anything',
    async (handler) => {
      const harness = createHarness();
      const handlers = harness.controller as unknown as Record<
        string,
        (ctx: RequestContext, query: unknown, response?: unknown) => unknown
      >;

      // `connections` is declared `async`, so its rejection arrives as a
      // promise while the other four throw synchronously. Awaiting the call
      // inside the assertion covers both without asserting which one a given
      // handler is — that is an implementation detail, and a future `async`
      // added to any of them should not fail this test.
      await expect(
        (async () =>
          handlers[handler](
            context({ tenantId: undefined } as Partial<RequestContext>),
            query,
            // Ignored by every handler but `adThumbnail`, which takes it third.
            harness.response,
          ))(),
      ).rejects.toThrow(BadRequestException);

      // `connections` reads through a differently named service method,
      // `breakdown` and `adThumbnail` through different services altogether;
      // the rest share their handler's name on the analytics read service.
      const reads =
        handler === 'connections'
          ? harness.analytics.listConnections
          : handler === 'breakdown'
            ? harness.breakdowns.breakdown
            : handler === 'adThumbnail'
              ? harness.thumbnails.resolve
              : harness.analytics[handler];

      expect(reads).not.toHaveBeenCalled();
    },
  );

  /**
   * The thumbnail route, whose failure mode is different from every other
   * handler here: it can reach a provider, and it answers with a redirect.
   */
  describe('adThumbnail', () => {
    it('resolves the picture for the ad under the context scope', async () => {
      const harness = createHarness();

      await harness.controller.adThumbnail(
        context({
          managedContext: { operatingMode: 'client', clientId: 'client-a' },
        } as Partial<RequestContext>),
        query,
        harness.response as never,
      );

      // The ad id comes from the query; every scope field comes from the
      // context. A caller-supplied client id would let one agency member read
      // another client's creatives.
      expect(harness.thumbnailInputs[0]).toMatchObject({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        connectionId: query.connectionId,
        adExternalId: query.adId,
      });
    });

    it('redirects to the resolved URL rather than proxying the bytes', async () => {
      const harness = createHarness();

      await harness.controller.adThumbnail(
        context(),
        query,
        harness.response as never,
      );

      // The browser loads the CDN link itself, so the access token never leaves
      // the server and no image byte passes through this process.
      expect(harness.response.redirectStatus).toBe(302);
      expect(harness.response.redirectedTo).toBe(thumbnailUrl);
    });

    it('caches the redirect privately and briefly', async () => {
      const harness = createHarness();

      await harness.controller.adThumbnail(
        context(),
        query,
        harness.response as never,
      );

      // Private because the target was resolved under this viewer's credential
      // and a shared cache must not hand it to another tenant; short because
      // the signed URL behind it expires on Meta's own schedule.
      expect(harness.response.headers['Cache-Control']).toBe(
        'private, max-age=300',
      );
    });

    it('answers 404 when there is no picture, without failing the page', async () => {
      const harness = createHarness();
      harness.thumbnails.resolve.mockResolvedValueOnce(null);

      await harness.controller.adThumbnail(
        context(),
        query,
        harness.response as never,
      );

      // An unknown ad, an ad with no creative yet, and a provider that will not
      // answer all arrive here identically — the client draws a placeholder,
      // because the row is about the numbers beside it.
      expect(harness.response.statusCode).toBe(404);
      expect(harness.response.redirectedTo).toBeNull();
    });

    it('never puts a resolved URL in a cache other viewers could share', async () => {
      const harness = createHarness();

      await harness.controller.adThumbnail(
        context(),
        query,
        harness.response as never,
      );

      expect(harness.response.headers['Cache-Control']).not.toContain('public');
    });
  });

  it('lists connections for the resolved scope and asks for nothing else', async () => {
    const harness = createHarness();

    await harness.controller.connections(
      context({
        managedContext: { operatingMode: 'client', clientId: 'client-a' },
      } as Partial<RequestContext>),
    );

    // Exactly the scope, with no connection id and no period: this is the call
    // a client makes before it has an id to send.
    expect(harness.connectionInputs[0]).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      companyContextId: 'company-a',
    });
  });

  it('lists the agency own connections when not in client mode', async () => {
    const harness = createHarness();

    await harness.controller.connections(context());

    expect(harness.connectionInputs[0].agencyClientId).toBeNull();
  });

  it('passes the sort and direction through to the campaigns read', async () => {
    const harness = createHarness();

    await harness.controller.campaigns(context(), {
      ...query,
      sort: 'cpc',
      direction: 'asc',
    });

    expect(harness.campaignInputs[0]).toMatchObject({
      sort: 'cpc',
      direction: 'asc',
    });
  });

  it('leaves sort and direction undefined so the service picks the default', async () => {
    const harness = createHarness();

    await harness.controller.campaigns(context(), query);

    // The default lives in one place — the service — rather than being restated
    // here, where it could drift from what the response reports.
    expect(harness.campaignInputs[0].sort).toBeUndefined();
    expect(harness.campaignInputs[0].direction).toBeUndefined();
  });

  it('passes the sort and direction through to the ad-sets read', async () => {
    const harness = createHarness();

    await harness.controller.adSets(context(), {
      ...query,
      sort: 'cpc',
      direction: 'asc',
    });

    expect(harness.adSetInputs[0]).toMatchObject({
      sort: 'cpc',
      direction: 'asc',
    });
  });

  it('leaves the ad-sets sort and direction undefined so the service picks the default', async () => {
    const harness = createHarness();

    await harness.controller.adSets(context(), query);

    expect(harness.adSetInputs[0].sort).toBeUndefined();
    expect(harness.adSetInputs[0].direction).toBeUndefined();
  });

  it('asks freshness for a connection and nothing else', async () => {
    const harness = createHarness();

    await harness.controller.freshness(context(), {
      connectionId: query.connectionId,
    });

    // No period: the question is about the whole read model, and a window would
    // only limit the answer to something the caller already knows.
    expect(harness.freshnessInputs[0]).not.toHaveProperty('since');
    expect(harness.freshnessInputs[0]).not.toHaveProperty('until');
  });

  it('never lets the query contribute a scope', async () => {
    const harness = createHarness();

    await harness.controller.overview(context(), {
      ...query,
      // A caller that smuggled these past the validation pipe still must not
      // reach the service with them.
      tenantId: 'tenant-b',
      agencyClientId: 'client-b',
    } as typeof query);

    expect(harness.overviewInputs[0].tenantId).toBe('tenant-a');
    expect(harness.overviewInputs[0].agencyClientId).toBeNull();
  });
});
