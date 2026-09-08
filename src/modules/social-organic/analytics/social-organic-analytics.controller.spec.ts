import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../permissions/decorators/permissions.decorators';
import type { SocialConsolidatedAnalyticsService } from './social-consolidated-analytics.service';
import { SocialOrganicAnalyticsController } from './social-organic-analytics.controller';
import type { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';

/** Every handler on this controller carries the same guards. */
const GUARDED_HANDLERS = [
  'listAssets',
  'overview',
  'timeseries',
  'freshness',
  'consolidated',
] as const;

const ASSET_SCOPED_HANDLERS = ['overview', 'timeseries'] as const;

function createHarness() {
  const overviewInputs: Record<string, unknown>[] = [];
  const seriesInputs: Record<string, unknown>[] = [];
  const freshnessInputs: Record<string, unknown>[] = [];
  const listInputs: Record<string, unknown>[] = [];
  const consolidatedInputs: Record<string, unknown>[] = [];

  const record =
    (sink: Record<string, unknown>[]) => (input: Record<string, unknown>) => {
      sink.push(input);
      return Promise.resolve({ assetId: input.assetId });
    };

  const analyticsReadService = {
    listAssets: jest.fn((input: Record<string, unknown>) => {
      listInputs.push(input);
      return Promise.resolve([]);
    }),
    overview: jest.fn(record(overviewInputs)),
    timeseries: jest.fn(record(seriesInputs)),
    freshness: jest.fn(record(freshnessInputs)),
  };

  const consolidatedReadService = {
    overview: jest.fn((input: Record<string, unknown>) => {
      consolidatedInputs.push(input);
      return Promise.resolve({});
    }),
  };

  return {
    overviewInputs,
    seriesInputs,
    freshnessInputs,
    listInputs,
    consolidatedInputs,
    analyticsReadService,
    consolidatedReadService,
    controller: new SocialOrganicAnalyticsController(
      analyticsReadService as unknown as SocialOrganicAnalyticsReadService,
      consolidatedReadService as unknown as SocialConsolidatedAnalyticsService,
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
  assetId: '11111111-1111-4111-8111-111111111111',
  since: '2026-08-01',
  until: '2026-08-27',
};

const consolidatedQuery = {
  paidConnectionId: '22222222-2222-4222-8222-222222222222',
  organicAssetId: query.assetId,
  since: query.since,
  until: query.until,
};

describe('SocialOrganicAnalyticsController metadata', () => {
  it.each(GUARDED_HANDLERS)(
    '%s requires the social entitlement and the organic operational permission',
    (handler) => {
      const target = (
        SocialOrganicAnalyticsController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handler];

      expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target)).toBe(
        'social',
      );
      // The confirmed decision: A3 and A4 both reuse this same key verbatim
      // — no admin-tier key, no new "require both" primitive for A4.
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, target)).toBe(
        'social.analytics.organic.view.operational',
      );
    },
  );
});

describe('SocialOrganicAnalyticsController scope resolution', () => {
  it('reads under the tenant and workspace of the authenticated context', async () => {
    const harness = createHarness();

    await harness.controller.overview(context(), query);

    expect(harness.overviewInputs[0]).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      assetId: query.assetId,
      since: '2026-08-01',
      until: '2026-08-27',
    });
  });

  it('binds the read to the client of the resolved managed context', async () => {
    const harness = createHarness();

    await harness.controller.overview(
      context({
        managedContext: { operatingMode: 'client', clientId: 'client-a' },
      } as Partial<RequestContext>),
      query,
    );

    expect(harness.overviewInputs[0].agencyClientId).toBe('client-a');
  });

  it('reads the agency own assets when not in client mode', async () => {
    const harness = createHarness();

    await harness.controller.overview(context(), query);

    expect(harness.overviewInputs[0].agencyClientId).toBeNull();
  });

  it('refuses a client context that names no client', () => {
    const harness = createHarness();

    expect(() =>
      harness.controller.overview(
        context({
          managedContext: { operatingMode: 'client', clientId: null },
        } as Partial<RequestContext>),
        query,
      ),
    ).toThrow(BadRequestException);

    expect(harness.analyticsReadService.overview).not.toHaveBeenCalled();
  });

  it('refuses a context with no tenant', () => {
    const harness = createHarness();

    expect(() =>
      harness.controller.overview(
        context({ tenantId: undefined } as Partial<RequestContext>),
        query,
      ),
    ).toThrow(BadRequestException);

    expect(harness.analyticsReadService.overview).not.toHaveBeenCalled();
  });

  it.each(ASSET_SCOPED_HANDLERS)(
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
      };

      expect(sinks[handler][0]).toMatchObject({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        assetId: query.assetId,
      });
    },
  );

  it('asks freshness for an asset and nothing else', async () => {
    const harness = createHarness();

    await harness.controller.freshness(context(), { assetId: query.assetId });

    expect(harness.freshnessInputs[0]).not.toHaveProperty('since');
    expect(harness.freshnessInputs[0]).not.toHaveProperty('until');
  });

  it('lists assets for the resolved scope and asks for nothing else', async () => {
    const harness = createHarness();

    await harness.controller.listAssets(
      context({
        managedContext: { operatingMode: 'client', clientId: 'client-a' },
      } as Partial<RequestContext>),
    );

    expect(harness.listInputs[0]).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
    });
  });

  it('never lets the query contribute a scope', async () => {
    const harness = createHarness();

    await harness.controller.overview(context(), {
      ...query,
      tenantId: 'tenant-b',
      agencyClientId: 'client-b',
    } as typeof query);

    expect(harness.overviewInputs[0].tenantId).toBe('tenant-a');
    expect(harness.overviewInputs[0].agencyClientId).toBeNull();
  });

  it('maps the consolidated query into the two identifiers the A4 service expects', async () => {
    const harness = createHarness();

    await harness.controller.consolidated(context(), consolidatedQuery);

    expect(harness.consolidatedInputs[0]).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      paidConnectionId: consolidatedQuery.paidConnectionId,
      organicAssetId: consolidatedQuery.organicAssetId,
      since: consolidatedQuery.since,
      until: consolidatedQuery.until,
    });
  });

  it('refuses a scopeless consolidated request before reaching the service', () => {
    const harness = createHarness();

    expect(() =>
      harness.controller.consolidated(
        context({ tenantId: undefined } as Partial<RequestContext>),
        consolidatedQuery,
      ),
    ).toThrow(BadRequestException);

    expect(harness.consolidatedReadService.overview).not.toHaveBeenCalled();
  });
});
