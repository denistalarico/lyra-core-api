import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import type { SocialAnalyticsReadService } from './services/social-analytics-read.service';
import { SocialAnalyticsController } from './social-analytics.controller';

/** Every handler on this controller carries the same guards. */
const GUARDED_HANDLERS = [
  'overview',
  'timeseries',
  'campaigns',
  'freshness',
] as const;

function createHarness() {
  const overviewInputs: Record<string, unknown>[] = [];
  const seriesInputs: Record<string, unknown>[] = [];
  const campaignInputs: Record<string, unknown>[] = [];
  const freshnessInputs: Record<string, unknown>[] = [];

  const record =
    (sink: Record<string, unknown>[]) => (input: Record<string, unknown>) => {
      sink.push(input);
      return Promise.resolve({ connectionId: input.connectionId });
    };

  const analytics = {
    overview: jest.fn(record(overviewInputs)),
    timeseries: jest.fn(record(seriesInputs)),
    campaigns: jest.fn(record(campaignInputs)),
    freshness: jest.fn(record(freshnessInputs)),
  };

  return {
    overviewInputs,
    seriesInputs,
    campaignInputs,
    freshnessInputs,
    analytics,
    controller: new SocialAnalyticsController(
      analytics as unknown as SocialAnalyticsReadService,
    ),
  };
}

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    ...overrides,
  } as RequestContext;
}

const query = {
  connectionId: '11111111-1111-4111-8111-111111111111',
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

  it.each(GUARDED_HANDLERS)(
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
    (handler) => {
      const harness = createHarness();
      const handlers = harness.controller as unknown as Record<
        string,
        (ctx: RequestContext, query: unknown) => unknown
      >;

      expect(() =>
        handlers[handler](
          context({ tenantId: undefined } as Partial<RequestContext>),
          query,
        ),
      ).toThrow(BadRequestException);

      expect(harness.analytics[handler]).not.toHaveBeenCalled();
    },
  );

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
