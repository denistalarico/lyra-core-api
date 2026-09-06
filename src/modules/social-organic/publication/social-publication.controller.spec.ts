import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../permissions/decorators/permissions.decorators';
import { SocialPublicationController } from './social-publication.controller';
import type { SocialPublicationService } from './social-publication.service';

describe('SocialPublicationController', () => {
  let controller: SocialPublicationController;

  const service = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    publishNow: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
  };

  const agencyCtx: RequestContext = {
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

  const clientCtx: RequestContext = {
    ...agencyCtx,
    managedContext: {
      productKey: 'social',
      operatingMode: 'client',
      clientId: '33333333-3333-4333-8333-333333333333',
      managedTenantId: '88888888-8888-4888-8888-888888888888',
    },
  };

  const dto = {
    contentItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    destinationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    assetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SocialPublicationController(
      service as unknown as SocialPublicationService,
    );
  });

  it('binds the controller to the Social entitlement', () => {
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        SocialPublicationController,
      ),
    ).toBe('social');
  });

  it('requires view permission for listing', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPublicationController.prototype.list,
      ),
    ).toBe('social.publishing.publication.view.assigned');
  });

  it('requires view permission for reading one publication', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPublicationController.prototype.get,
      ),
    ).toBe('social.publishing.publication.view.assigned');
  });

  it('requires manager create permission for scheduling', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPublicationController.prototype.create,
      ),
    ).toBe('social.publishing.publication.create.manager');
  });

  it('requires manager publish_now permission for immediate publish', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPublicationController.prototype.publishNow,
      ),
    ).toBe('social.publishing.publication.publish_now.manager');
  });

  it('requires manager cancel permission for cancelling', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPublicationController.prototype.cancel,
      ),
    ).toBe('social.publishing.publication.cancel.manager');
  });

  it('requires manager create permission for retrying', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPublicationController.prototype.retry,
      ),
    ).toBe('social.publishing.publication.create.manager');
  });

  it('lists using only server-resolved scope', async () => {
    service.list.mockResolvedValue({ items: [], total: 0 });

    await controller.list(agencyCtx, {});

    expect(service.list).toHaveBeenCalledWith(
      {
        tenantId: agencyCtx.tenantId,
        workspaceId: agencyCtx.workspaceId,
        agencyClientId: null,
      },
      {},
    );
  });

  it('maps managed client mode to the server-resolved client id', async () => {
    service.list.mockResolvedValue({ items: [], total: 0 });

    await controller.list(clientCtx, {});

    expect(service.list).toHaveBeenCalledWith(
      {
        tenantId: clientCtx.tenantId,
        workspaceId: clientCtx.workspaceId,
        agencyClientId: '33333333-3333-4333-8333-333333333333',
      },
      {},
    );
  });

  it('ignores any agencyClientId a caller could smuggle in and uses the request-context scope', async () => {
    service.create.mockResolvedValue({});

    const dtoWithForeignScope = {
      ...dto,
      agencyClientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    };

    await controller.create(agencyCtx, dtoWithForeignScope as never);

    expect(service.create).toHaveBeenCalledWith(
      {
        tenantId: agencyCtx.tenantId,
        workspaceId: agencyCtx.workspaceId,
        agencyClientId: null,
      },
      agencyCtx.userId,
      dtoWithForeignScope,
    );
  });

  it('rejects requests without workspace context', async () => {
    const ctx: RequestContext = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: '55555555-5555-4555-8555-555555555555',
    };

    await expect(controller.list(ctx, {})).rejects.toThrow(BadRequestException);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('rejects client mode without a resolved client id', async () => {
    const ctx: RequestContext = {
      ...agencyCtx,
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: null,
        managedTenantId: null,
      },
    };

    await expect(controller.list(ctx, {})).rejects.toThrow(BadRequestException);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('cancels using the server-resolved scope and actor', async () => {
    service.cancel.mockResolvedValue({});

    await controller.cancel(agencyCtx, 'pub-1');

    expect(service.cancel).toHaveBeenCalledWith(
      {
        tenantId: agencyCtx.tenantId,
        workspaceId: agencyCtx.workspaceId,
        agencyClientId: null,
      },
      agencyCtx.userId,
      'pub-1',
    );
  });

  it('retries using the server-resolved scope and actor', async () => {
    service.retry.mockResolvedValue({});

    await controller.retry(agencyCtx, 'pub-1');

    expect(service.retry).toHaveBeenCalledWith(
      {
        tenantId: agencyCtx.tenantId,
        workspaceId: agencyCtx.workspaceId,
        agencyClientId: null,
      },
      agencyCtx.userId,
      'pub-1',
    );
  });

  it('publishes now using only the server-resolved scope', async () => {
    service.publishNow.mockResolvedValue({});

    await controller.publishNow(agencyCtx, 'pub-1');

    expect(service.publishNow).toHaveBeenCalledWith(
      {
        tenantId: agencyCtx.tenantId,
        workspaceId: agencyCtx.workspaceId,
        agencyClientId: null,
      },
      'pub-1',
    );
  });
});
