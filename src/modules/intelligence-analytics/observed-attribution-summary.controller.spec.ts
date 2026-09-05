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

  /**
   * I4.3 §2/§25: the new axis is the same route under the same authorization.
   */
  describe('the destination axis', () => {
    it('accepts groupBy=destination', async () => {
      const { controller, summaryService } = build();

      await controller.observedSummary(
        context(),
        query({ groupBy: 'destination' }),
      );

      expect(summaryService.summary).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        CONNECTION_ID,
        'destination',
      );
    });

    it.each(['account', 'campaign', 'adset', 'ad'] as const)(
      'still accepts groupBy=%s',
      async (groupBy) => {
        const { controller, summaryService } = build();

        await controller.observedSummary(context(), query({ groupBy }));

        expect(summaryService.summary).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          CONNECTION_ID,
          groupBy,
        );
      },
    );

    /**
     * Destination changes nothing about who may read this. The commercial
     * figures are in every group at every axis, so the CRM permission is
     * required here exactly as it is elsewhere.
     */
    it('requires the CRM permission on the destination axis too', async () => {
      const { controller, summaryService } = build({
        deniedPermission: 'leadflow.crm.records.view.client',
      });

      await expect(
        controller.observedSummary(
          context(),
          query({ groupBy: 'destination' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(summaryService.summary).not.toHaveBeenCalled();
    });

    it.each(['social', 'leadflow'])(
      'requires the %s entitlement on the destination axis',
      async (missing) => {
        const { controller } = build({
          allowedProducts: ['social', 'leadflow'].filter((p) => p !== missing),
        });

        await expect(
          controller.observedSummary(
            context(),
            query({ groupBy: 'destination' }),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    /** The caller still cannot name a client on the new axis. */
    it('reads the client from context on the destination axis', async () => {
      const { controller, summaryService } = build();

      await controller.observedSummary(
        context({
          managedContext: { operatingMode: 'client', clientId: 'client-9' },
        } as Partial<RequestContext>),
        query({ groupBy: 'destination' }),
      );

      expect(summaryService.summary).toHaveBeenCalledWith(
        expect.objectContaining({ agencyClientId: 'client-9' }),
        expect.anything(),
        CONNECTION_ID,
        'destination',
      );
    });
  });
  /**
   * I5 §18/§19 — the dimension changes nothing about authorization.
   *
   * The claim being defended is narrow and easy to break by accident: reading a
   * Business Mode must not add a requirement, and must not remove one either. A
   * future author "fixing" the Social-only case by making LeadFlow optional
   * here would open the funnel numbers to a caller who never earned them, and
   * an author making the mode mandatory would lock a Social-only tenant out of
   * its own paid-media analytics.
   */
  describe('business mode does not affect authorization (I5)', () => {
    it('still requires both products', async () => {
      const { controller, permissionService } = build();

      await controller.observedSummary(context(), query());

      expect(permissionService.canAccessProduct).toHaveBeenCalledWith(
        expect.anything(),
        'social',
      );
      expect(permissionService.canAccessProduct).toHaveBeenCalledWith(
        expect.anything(),
        'leadflow',
      );
    });

    it('still requires the CRM records permission', async () => {
      const { controller, permissionService } = build();

      await controller.observedSummary(context(), query());

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.anything(),
        'leadflow.crm.records.view.client',
      );
    });

    /**
     * No new permission was introduced for the dimension.
     *
     * Asserted on the exact set rather than on the absence of one name, so an
     * added key of any spelling fails here and has to be defended on purpose.
     */
    it('asks for no permission beyond the three the endpoint already required', async () => {
      const { controller, permissionService } = build();

      await controller.observedSummary(context(), query());

      const asked = permissionService.assertCan.mock.calls.map(
        (call: unknown[]) => call[1],
      );

      expect(asked).toEqual([
        'leadflow.analytics.reports.view.operational',
        'leadflow.crm.records.view.client',
      ]);
    });
  });
});
