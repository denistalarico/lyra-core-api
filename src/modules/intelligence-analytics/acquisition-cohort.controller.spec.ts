import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { AcquisitionCohortController } from './acquisition-cohort.controller';

/**
 * The entitlement and scope policy of a cross-product endpoint.
 *
 * This is the security-critical half of I3. The response body puts one
 * product's numbers beside another's, so a caller entitled to only one of them
 * must not be able to read the other here — and the ordinary Nest decorators
 * cannot express that, because both `RequirePermission` and
 * `RequireProductEntitlement` are `SetMetadata` under a single key and the
 * second call would overwrite the first rather than compose with it. The policy
 * therefore lives in code, which means it needs a test.
 */
const CONTEXT: RequestContext = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'manager',
} as RequestContext;

const QUERY = {
  connectionId: '33333333-3333-4333-8333-333333333333',
  since: '2026-07-01',
  until: '2026-07-31',
};

function build(
  options: {
    products?: Record<string, boolean>;
    permissionFails?: string;
  } = {},
) {
  const products = options.products ?? { social: true, leadflow: true };

  const cohortService = {
    cohort: jest.fn().mockResolvedValue({ kind: 'cohort_correlation' }),
  };

  const permissionService = {
    canAccessProduct: jest
      .fn()
      .mockImplementation((_ctx: unknown, key: string) =>
        Promise.resolve(products[key] ?? false),
      ),
    assertCan: jest.fn().mockImplementation((_ctx: unknown, key: string) => {
      if (options.permissionFails === key) {
        return Promise.reject(new ForbiddenException('denied'));
      }
      return Promise.resolve();
    }),
  };

  const controller = new AcquisitionCohortController(
    cohortService as never,
    permissionService as never,
  );

  return { controller, cohortService, permissionService };
}

describe('AcquisitionCohortController', () => {
  describe('entitlement', () => {
    it('requires both products before reading either domain', async () => {
      const { controller, permissionService, cohortService } = build();

      await controller.acquisitionFunnel(CONTEXT, QUERY);

      expect(permissionService.canAccessProduct).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
        'social',
      );
      expect(permissionService.canAccessProduct).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
        'leadflow',
      );
      expect(cohortService.cohort).toHaveBeenCalled();
    });

    /**
     * A Social-only tenant must not learn its opportunity count from an
     * endpoint whose path never mentions LeadFlow.
     */
    it('refuses a tenant without the LeadFlow entitlement', async () => {
      const { controller, cohortService } = build({
        products: { social: true, leadflow: false },
      });

      await expect(
        controller.acquisitionFunnel(CONTEXT, QUERY),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // And no domain was read before the refusal.
      expect(cohortService.cohort).not.toHaveBeenCalled();
    });

    it('refuses a tenant without the Social entitlement', async () => {
      const { controller, cohortService } = build({
        products: { social: false, leadflow: true },
      });

      await expect(
        controller.acquisitionFunnel(CONTEXT, QUERY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cohortService.cohort).not.toHaveBeenCalled();
    });
  });

  describe('permission', () => {
    /**
     * The guard checks the Social key from metadata; this asserts the LeadFlow
     * key is checked too, which is the half a decorator could not express.
     */
    it('requires the LeadFlow analytics permission as well', async () => {
      const { controller, permissionService } = build();

      await controller.acquisitionFunnel(CONTEXT, QUERY);

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'leadflow.analytics.reports.view.operational',
      );
    });

    it('refuses a caller who may read media but not the funnel', async () => {
      const { controller, cohortService } = build({
        permissionFails: 'leadflow.analytics.reports.view.operational',
      });

      await expect(
        controller.acquisitionFunnel(CONTEXT, QUERY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cohortService.cohort).not.toHaveBeenCalled();
    });
  });

  describe('scope', () => {
    /**
     * The client comes from the managed context and nowhere else. There is no
     * `agencyClientId` field on the DTO, and this proves the controller does
     * not invent one from anything the caller sent.
     */
    it('resolves the client from the managed context', async () => {
      const { controller, cohortService } = build();
      const clientContext = {
        ...CONTEXT,
        managedContext: { operatingMode: 'client', clientId: 'client-9' },
      } as RequestContext;

      await controller.acquisitionFunnel(clientContext, QUERY);

      expect(cohortService.cohort).toHaveBeenCalledWith(
        expect.objectContaining({ agencyClientId: 'client-9' }),
        expect.anything(),
        QUERY.connectionId,
      );
    });

    it('reads the agency context as no client', async () => {
      const { controller, cohortService } = build();

      await controller.acquisitionFunnel(CONTEXT, QUERY);

      expect(cohortService.cohort).toHaveBeenCalledWith(
        expect.objectContaining({ agencyClientId: null }),
        expect.anything(),
        QUERY.connectionId,
      );
    });

    it('refuses a client context with no client resolved', async () => {
      const { controller } = build();
      const broken = {
        ...CONTEXT,
        managedContext: { operatingMode: 'client', clientId: null },
      } as RequestContext;

      await expect(
        controller.acquisitionFunnel(broken, QUERY),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a request with no tenant or workspace', async () => {
      const { controller } = build();

      await expect(
        controller.acquisitionFunnel({ userId: 'u' } as RequestContext, QUERY),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('window', () => {
    it('rejects a reversed range rather than swapping it', async () => {
      const { controller } = build();

      await expect(
        controller.acquisitionFunnel(CONTEXT, {
          ...QUERY,
          since: '2026-07-31',
          until: '2026-07-01',
        }),
      ).rejects.toThrow();
    });

    it('rejects a date that does not exist', async () => {
      const { controller } = build();

      await expect(
        controller.acquisitionFunnel(CONTEXT, {
          ...QUERY,
          since: '2026-02-30',
        }),
      ).rejects.toThrow();
    });
  });
});
