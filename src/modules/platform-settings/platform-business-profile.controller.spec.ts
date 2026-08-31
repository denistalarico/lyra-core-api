import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { PlatformPermissionService } from '../permissions';
import { PlatformBusinessProfileController } from './platform-business-profile.controller';
import type { PlatformBusinessProfileService } from './services/platform-business-profile.service';
import type { LeadFlowBusinessModeTemplateService } from '../leadflow-settings/services/leadflow-business-mode-template.service';

/**
 * Product-permission binding (S1.4.0 pre-commit review, point 2): the
 * endpoint is neutral of product, but the permission it enforces at runtime
 * must match the caller's *own* declared `x-lyra-product-key`
 * (`ctx.managedContext.productKey`), never the other product's. These tests
 * exercise `assertProductPermission` through the public handlers with a
 * mocked `PlatformPermissionService`, asserting exactly which single
 * permission key was checked for each productKey — not just that *some*
 * permission passed.
 */
describe('PlatformBusinessProfileController RBAC binding', () => {
  function setup() {
    const businessProfileService = {
      getBusinessProfile: jest.fn().mockResolvedValue({}),
      updateBusinessProfile: jest.fn().mockResolvedValue({}),
      publishCompanyContext: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<PlatformBusinessProfileService>;

    const businessModeTemplateService = {
      listTemplates: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<LeadFlowBusinessModeTemplateService>;

    const permissionService = {
      assertCan: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PlatformPermissionService>;

    const controller = new PlatformBusinessProfileController(
      businessProfileService,
      businessModeTemplateService,
      permissionService,
    );

    return { controller, permissionService, businessProfileService };
  }

  function ctxFor(
    productKey?: 'agency' | 'leadflow' | 'social',
    operatingMode: 'agency' | 'client' = 'agency',
  ): RequestContext {
    return {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'member',
      managedContext: productKey
        ? {
            productKey,
            operatingMode,
            clientId: operatingMode === 'client' ? 'client-a' : null,
            managedTenantId: operatingMode === 'client' ? 'managed-a' : null,
          }
        : undefined,
    };
  }

  it('social context + only social permission → authorized, checks the social key', async () => {
    const { controller, permissionService } = setup();
    permissionService.assertCan.mockResolvedValue(undefined);

    await controller.getBusinessProfile(ctxFor('social'));

    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.anything(),
      'social.settings.general.view.admin',
    );
    expect(permissionService.assertCan).not.toHaveBeenCalledWith(
      expect.anything(),
      'leadflow.settings.general.view.admin',
    );
  });

  it('social context + only leadflow permission → 403 (assertCan rejects the social key)', async () => {
    const { controller, permissionService } = setup();
    permissionService.assertCan.mockRejectedValue(
      new ForbiddenException('missing social.settings.general.view.admin'),
    );

    await expect(
      controller.getBusinessProfile(ctxFor('social')),
    ).rejects.toThrow(ForbiddenException);

    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.anything(),
      'social.settings.general.view.admin',
    );
  });

  it('leadflow context + only leadflow permission → authorized, checks the leadflow key', async () => {
    const { controller, permissionService } = setup();
    permissionService.assertCan.mockResolvedValue(undefined);

    await controller.getBusinessProfile(ctxFor('leadflow'));

    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.anything(),
      'leadflow.settings.general.view.admin',
    );
    expect(permissionService.assertCan).not.toHaveBeenCalledWith(
      expect.anything(),
      'social.settings.general.view.admin',
    );
  });

  it('leadflow context + only social permission → 403 (assertCan rejects the leadflow key)', async () => {
    const { controller, permissionService } = setup();
    permissionService.assertCan.mockRejectedValue(
      new ForbiddenException('missing leadflow.settings.general.view.admin'),
    );

    await expect(
      controller.getBusinessProfile(ctxFor('leadflow')),
    ).rejects.toThrow(ForbiddenException);

    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.anything(),
      'leadflow.settings.general.view.admin',
    );
  });

  it('no matching permission at all → 403', async () => {
    const { controller, permissionService } = setup();
    permissionService.assertCan.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.getBusinessProfile(ctxFor('social')),
    ).rejects.toThrow(ForbiddenException);
  });

  it("productKey: 'agency' is rejected before any permission is checked — no product to bind to (NOT the same thing as operatingMode: 'agency', see the matrix below)", async () => {
    const { controller, permissionService } = setup();

    await expect(
      controller.getBusinessProfile(ctxFor('agency', 'agency')),
    ).rejects.toThrow(ForbiddenException);

    expect(permissionService.assertCan).not.toHaveBeenCalled();
  });

  it('missing managedContext is rejected before any permission is checked', async () => {
    const { controller, permissionService } = setup();

    await expect(
      controller.getBusinessProfile(ctxFor(undefined)),
    ).rejects.toThrow(ForbiddenException);

    expect(permissionService.assertCan).not.toHaveBeenCalled();
  });

  it('PATCH checks the update key, not the view key, for the caller product', async () => {
    const { controller, permissionService } = setup();

    await controller.updateBusinessProfile(ctxFor('social'), {});

    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.anything(),
      'social.settings.general.update.admin',
    );
  });

  it('business-modes checks the view key for the caller product', async () => {
    const { controller, permissionService } = setup();

    await controller.listBusinessModes(ctxFor('leadflow'));

    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.anything(),
      'leadflow.settings.general.view.admin',
    );
  });

  /**
   * S1.4.3a: publish binds to the same product-scoped update permission as
   * PATCH — not a separate "publish" permission, and not the view key.
   */
  describe('publishBusinessProfileCompanyContext', () => {
    it('social context checks the social update key, not the leadflow one', async () => {
      const { controller, permissionService } = setup();

      await controller.publishBusinessProfileCompanyContext(
        ctxFor('social'),
        {},
      );

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.anything(),
        'social.settings.general.update.admin',
      );
      expect(permissionService.assertCan).not.toHaveBeenCalledWith(
        expect.anything(),
        'leadflow.settings.general.update.admin',
      );
    });

    it('leadflow context checks the leadflow update key, not the social one', async () => {
      const { controller, permissionService } = setup();

      await controller.publishBusinessProfileCompanyContext(
        ctxFor('leadflow'),
        {},
      );

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.anything(),
        'leadflow.settings.general.update.admin',
      );
      expect(permissionService.assertCan).not.toHaveBeenCalledWith(
        expect.anything(),
        'social.settings.general.update.admin',
      );
    });

    it('social context + only leadflow permission → 403', async () => {
      const { controller, permissionService } = setup();
      permissionService.assertCan.mockRejectedValue(
        new ForbiddenException('missing social.settings.general.update.admin'),
      );

      await expect(
        controller.publishBusinessProfileCompanyContext(ctxFor('social'), {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it("productKey: 'agency' is rejected before any permission is checked", async () => {
      const { controller, permissionService } = setup();

      await expect(
        controller.publishBusinessProfileCompanyContext(
          ctxFor('agency', 'agency'),
          {},
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(permissionService.assertCan).not.toHaveBeenCalled();
    });

    it('forwards expectedDraftHash and the resolved client id to the service, untouched', async () => {
      const { controller, businessProfileService } = setup();
      const ctx = ctxFor('social', 'client');

      await controller.publishBusinessProfileCompanyContext(ctx, {
        expectedDraftHash: 'hash-1',
      });

      expect(businessProfileService.publishCompanyContext).toHaveBeenCalledWith(
        ctx,
        'client-a',
        'hash-1',
      );
    });

    it('resolves the agency row (clientId null) when operatingMode is agency', async () => {
      const { controller, businessProfileService } = setup();
      const ctx = ctxFor('social', 'agency');

      await controller.publishBusinessProfileCompanyContext(ctx, {});

      expect(businessProfileService.publishCompanyContext).toHaveBeenCalledWith(
        ctx,
        null,
        undefined,
      );
    });
  });

  /**
   * `productKey` and `operatingMode` are independent fields on
   * `ManagedContext` (see request-context.interface.ts). The Business
   * Profile must work in the agency's own context for both products —
   * `resolveBusinessProfilePermissionKey` reads only `productKey` and never
   * inspects `operatingMode`, so `operatingMode: 'agency'` is not, and must
   * never become, a rejection condition. This matrix pins the four valid
   * combinations plus the two rejected `productKey` cases side by side so a
   * future change that conflates the two fields fails loudly here.
   */
  describe('productKey × operatingMode matrix', () => {
    it('social + operatingMode agency → authorized, resolves the agency row (clientId null)', async () => {
      const { controller, permissionService } = setup();

      const ctx = ctxFor('social', 'agency');
      await controller.getBusinessProfile(ctx);

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.anything(),
        'social.settings.general.view.admin',
      );
      expect(ctx.managedContext?.clientId).toBeNull();
    });

    it('social + operatingMode client → authorized, resolves the client row', async () => {
      const { controller, permissionService, businessProfileService } = setup();

      const ctx = ctxFor('social', 'client');
      await controller.getBusinessProfile(ctx);

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.anything(),
        'social.settings.general.view.admin',
      );
      expect(businessProfileService.getBusinessProfile).toHaveBeenCalledWith(
        ctx,
        'client-a',
      );
    });

    it('leadflow + operatingMode agency → authorized, resolves the agency row (clientId null)', async () => {
      const { controller, permissionService } = setup();

      const ctx = ctxFor('leadflow', 'agency');
      await controller.getBusinessProfile(ctx);

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.anything(),
        'leadflow.settings.general.view.admin',
      );
      expect(ctx.managedContext?.clientId).toBeNull();
    });

    it('leadflow + operatingMode client → authorized, resolves the client row', async () => {
      const { controller, permissionService, businessProfileService } = setup();

      const ctx = ctxFor('leadflow', 'client');
      await controller.getBusinessProfile(ctx);

      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.anything(),
        'leadflow.settings.general.view.admin',
      );
      expect(businessProfileService.getBusinessProfile).toHaveBeenCalledWith(
        ctx,
        'client-a',
      );
    });

    it("productKey: 'agency' is rejected regardless of operatingMode", async () => {
      const { controller, permissionService } = setup();

      await expect(
        controller.getBusinessProfile(ctxFor('agency', 'agency')),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.getBusinessProfile(ctxFor('agency', 'client')),
      ).rejects.toThrow(ForbiddenException);

      expect(permissionService.assertCan).not.toHaveBeenCalled();
    });

    it('missing/invalid productKey is rejected regardless of operatingMode', async () => {
      const { controller, permissionService } = setup();

      await expect(
        controller.getBusinessProfile(ctxFor(undefined, 'agency')),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.getBusinessProfile(ctxFor(undefined, 'client')),
      ).rejects.toThrow(ForbiddenException);

      expect(permissionService.assertCan).not.toHaveBeenCalled();
    });
  });
});
