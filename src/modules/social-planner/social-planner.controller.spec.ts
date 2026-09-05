import { BadRequestException } from '@nestjs/common';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import type { RequestContext } from '../../common/context/request-context.interface';
import { SocialPlannerController } from './social-planner.controller';
import type { SocialPlannerService } from './services/social-planner.service';
import type { SocialPlannerSettingsService } from './services/social-planner-settings.service';
import type { SocialPublishingCadenceService } from './services/social-publishing-cadence.service';

describe('SocialPlannerController', () => {
  let controller: SocialPlannerController;

  const service = {
    listPlans: jest.fn(),
    createPlan: jest.fn(),
    getPlan: jest.fn(),
    updatePlan: jest.fn(),
    archivePlan: jest.fn(),
    listContent: jest.fn(),
    createContent: jest.fn(),
    getContent: jest.fn(),
    updateContent: jest.fn(),
    replaceDestinations: jest.fn(),
    listRevisions: jest.fn(),
    createRevision: jest.fn(),
    restoreRevision: jest.fn(),
  };

  const settingsService = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };

  const cadenceService = {
    getCadence: jest.fn(),
    updateCadence: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    controller = new SocialPlannerController(
      service as unknown as SocialPlannerService,
      settingsService as unknown as SocialPlannerSettingsService,
      cadenceService as unknown as SocialPublishingCadenceService,
    );
  });

  it('binds the controller to the Social entitlement', () => {
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        SocialPlannerController,
      ),
    ).toBe('social');
  });

  it('requires client-view permission for listing plans', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.listPlans,
      ),
    ).toBe('social.planner.calendar.view.client');
  });

  it('requires manager create permission for creating a plan', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.createPlan,
      ),
    ).toBe('social.planner.calendar.create.manager');
  });

  it('requires manager update permission for updating content', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.updateContent,
      ),
    ).toBe('social.planner.calendar.update.manager');
  });

  it('maps agency mode to agencyClientId null', async () => {
    service.listPlans.mockResolvedValue({ items: [], total: 0 });

    const ctx: RequestContext = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      userId: '55555555-5555-4555-8555-555555555555',
      managedContext: {
        productKey: 'social',
        operatingMode: 'agency',
        clientId: null,
        managedTenantId: null,
      },
    };

    await controller.listPlans(ctx);

    expect(service.listPlans).toHaveBeenCalledWith({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId: null,
    });
  });

  it('maps managed client mode to the server-resolved client id', async () => {
    service.listPlans.mockResolvedValue({ items: [], total: 0 });

    const ctx: RequestContext = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      userId: '55555555-5555-4555-8555-555555555555',
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: '33333333-3333-4333-8333-333333333333',
        managedTenantId: '88888888-8888-4888-8888-888888888888',
      },
    };

    await controller.listPlans(ctx);

    expect(service.listPlans).toHaveBeenCalledWith({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('rejects requests without workspace context', async () => {
    const ctx: RequestContext = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: '55555555-5555-4555-8555-555555555555',
    };

    expect(() => controller.listPlans(ctx)).toThrow(BadRequestException);

    expect(service.listPlans).not.toHaveBeenCalled();
  });

  it('rejects client mode without a resolved client id', async () => {
    const ctx: RequestContext = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      userId: '55555555-5555-4555-8555-555555555555',
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: null,
        managedTenantId: null,
      },
    };

    expect(() => controller.listPlans(ctx)).toThrow(BadRequestException);

    expect(service.listPlans).not.toHaveBeenCalled();
  });

  it('requires view permission for revision history', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.listRevisions,
      ),
    ).toBe('social.planner.calendar.view.client');
  });

  it('requires update permission for creating revisions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.createRevision,
      ),
    ).toBe('social.planner.calendar.update.manager');
  });

  it('requires update permission for restoring revisions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.restoreRevision,
      ),
    ).toBe('social.planner.calendar.update.manager');
  });

  it('requires view permission for cadence', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.getCadence,
      ),
    ).toBe('social.planner.calendar.view.client');
  });

  it('requires update permission for cadence changes', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.updateCadence,
      ),
    ).toBe('social.planner.calendar.update.manager');
  });
});
