import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { ObservedAttributionSummaryController } from './observed-attribution-summary.controller';

const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    role: 'owner',
    ...overrides,
  } as RequestContext;
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: CONNECTION_ID,
    from: '2026-09-01',
    until: '2026-09-30',
    groupBy: 'campaign' as const,
    ...overrides,
  } as never;
}

function build(
  options: {
    allowedProducts?: string[];
    deniedPermission?: string;
  } = {},
) {
  const allowed = options.allowedProducts ?? ['social', 'leadflow'];

  const permissionService = {
    canAccessProduct: jest
      .fn()
      .mockImplementation((_ctx, product: string) =>
        Promise.resolve(allowed.includes(product)),
      ),
    assertCan: jest.fn().mockImplementation((_ctx, permission: string) => {
      if (permission === options.deniedPermission) {
        throw new ForbiddenException('denied');
      }
      return Promise.resolve();
    }),
  };

  const summaryService = {
    summary: jest
      .fn()
      .mockResolvedValue({ kind: 'observed_attribution_summary' }),
  };

  return {
    controller: new ObservedAttributionSummaryController(
      summaryService as never,
      permissionService as never,
    ),
    summaryService,
    permissionService,
  };
}

describe('ObservedAttributionSummaryController', () => {
  it('returns the summary for an authorised caller', async () => {
    const { controller } = build();

    await expect(
      controller.observedSummary(context(), query()),
    ).resolves.toMatchObject({ kind: 'observed_attribution_summary' });
  });

  it.each(['social', 'leadflow'])(
    'refuses a tenant without the %s entitlement',
    async (missing) => {
      const { controller } = build({
        allowedProducts: ['social', 'leadflow'].filter((p) => p !== missing),
      });

      await expect(
        controller.observedSummary(context(), query()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  /**
   * §24, and the reason this endpoint asks for more than I4 does.
   *
   * `wonOpportunities` and `wonOpportunityValue` aggregated per campaign are
   * commercial pipeline figures. A user granted media reporting must not obtain
   * the sales pipeline by asking a reporting endpoint for it.
   */
  it('refuses a user without the CRM read permission', async () => {
    const { controller, summaryService } = build({
      deniedPermission: 'leadflow.crm.records.view.client',
    });

    await expect(
      controller.observedSummary(context(), query()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(summaryService.summary).not.toHaveBeenCalled();
  });

  it('refuses a user without the LeadFlow analytics permission', async () => {
    const { controller } = build({
      deniedPermission: 'leadflow.analytics.reports.view.operational',
    });

    await expect(
      controller.observedSummary(context(), query()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('asserts every permission the decorator cannot express', async () => {
    const { controller, permissionService } = build();

    await controller.observedSummary(context(), query());

    const asserted = permissionService.assertCan.mock.calls.map(
      (call: unknown[]) => call[1],
    );

    expect(asserted).toEqual([
      'leadflow.analytics.reports.view.operational',
      'leadflow.crm.records.view.client',
    ]);
  });

  /**
   * Access is settled before any domain is read: a caller who may not use the
   * product must not learn how many conversations exist.
   */
  it('checks access before reading either domain', async () => {
    const { controller, summaryService } = build({
      allowedProducts: ['social'],
    });

    await expect(
      controller.observedSummary(context(), query()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(summaryService.summary).not.toHaveBeenCalled();
  });

  describe('the window', () => {
    it('refuses a reversed range rather than swapping it', async () => {
      const { controller } = build();

      await expect(
        controller.observedSummary(
          context(),
          query({ from: '2026-09-30', until: '2026-09-01' }),
        ),
      ).rejects.toThrow();
    });

    it('refuses a date that is not a real day', async () => {
      const { controller } = build();

      await expect(
        controller.observedSummary(context(), query({ from: '2026-02-30' })),
      ).rejects.toThrow();
    });

    it('passes the window through as calendar days', async () => {
      const { controller, summaryService } = build();

      await controller.observedSummary(context(), query());

      expect(summaryService.summary).toHaveBeenCalledWith(
        expect.anything(),
        { since: '2026-09-01', until: '2026-09-30' },
        CONNECTION_ID,
        'campaign',
      );
    });
  });

  describe('the scope', () => {
    it('reads the managed client from context, never from the caller', async () => {
      const { controller, summaryService } = build();

      await controller.observedSummary(
        context({
          managedContext: { operatingMode: 'client', clientId: 'client-9' },
        } as Partial<RequestContext>),
        query(),
      );

      expect(summaryService.summary).toHaveBeenCalledWith(
        {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          agencyClientId: 'client-9',
        },
        expect.anything(),
        CONNECTION_ID,
        'campaign',
      );
    });

    it('uses agency context when no client is selected', async () => {
      const { controller, summaryService } = build();

      await controller.observedSummary(context(), query());

      expect(summaryService.summary).toHaveBeenCalledWith(
        expect.objectContaining({ agencyClientId: null }),
        expect.anything(),
        CONNECTION_ID,
        'campaign',
      );
    });

    /** Client mode with no client is a broken context, not "every client". */
    it('refuses client mode with no client id', async () => {
      const { controller } = build();

      await expect(
        controller.observedSummary(
          context({
            managedContext: { operatingMode: 'client', clientId: null },
          } as Partial<RequestContext>),
          query(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a context with no workspace', async () => {
      const { controller } = build();

      await expect(
        controller.observedSummary(
          context({ workspaceId: undefined }),
          query(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
