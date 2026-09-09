import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../permissions/decorators/permissions.decorators';
import type { SocialPublisherRegistry } from '../providers';
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
    listPublishTargets: jest.fn(),
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

  /**
   * A registry double rather than the real class: this spec is about the
   * controller's contract, and the registry's own behaviour has its own spec.
   * The shape mirrors what `capabilities()` actually calls.
   */
  const registry = {
    registeredPairs: [] as { provider: string; assetType: string }[],
    resolve: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registry.registeredPairs = [];
    controller = new SocialPublicationController(
      service as unknown as SocialPublicationService,
      registry as unknown as SocialPublisherRegistry,
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

  describe('capabilities', () => {
    const facebookCapabilities = {
      provider: 'meta',
      assetType: 'facebook_page',
      placements: ['feed', 'reel', 'carousel'],
      media: {
        feed: { acceptedMimeTypes: ['image/jpeg'], maxBytes: 4 },
        reel: {
          acceptedMimeTypes: ['video/mp4'],
          maxBytes: 300,
          minDurationSeconds: 3,
          maxDurationSeconds: 90,
          aspectRatios: ['9:16'],
        },
        // `carousel` is declared as a placement but has no media block —
        // exactly the disagreement `resolveMediaRequirements` fails closed on.
      },
      supportsScheduling: true,
      supportsCaption: true,
      supportsFirstComment: false,
      supportsHashtags: false,
      requiresReconciliation: true,
      supportsRemoval: true,
    };

    it('requires only view permission, so a reader can render the composer', () => {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY_METADATA,
          SocialPublicationController.prototype.capabilities,
        ),
      ).toBe('social.publishing.publication.view.assigned');
    });

    it('reads every registered pair through the registry', () => {
      registry.registeredPairs = [
        { provider: 'meta', assetType: 'facebook_page' },
      ];
      registry.resolve.mockReturnValue({
        capabilities: () => facebookCapabilities,
      });

      const result = controller.capabilities();

      expect(registry.resolve).toHaveBeenCalledWith('meta', 'facebook_page');
      expect(result.total).toBe(1);
      expect(result.items[0].provider).toBe('meta');
      expect(result.items[0].assetType).toBe('facebook_page');
    });

    it('drops a placement that has no declared media block', () => {
      registry.registeredPairs = [
        { provider: 'meta', assetType: 'facebook_page' },
      ];
      registry.resolve.mockReturnValue({
        capabilities: () => facebookCapabilities,
      });

      const placements = controller
        .capabilities()
        .items[0].placements.map((entry) => entry.placement);

      expect(placements).toEqual(['feed', 'reel']);
      expect(placements).not.toContain('carousel');
    });

    it('preserves the difference between an absent and an empty aspect-ratio list', () => {
      registry.registeredPairs = [
        { provider: 'meta', assetType: 'facebook_page' },
      ];
      registry.resolve.mockReturnValue({
        capabilities: () => facebookCapabilities,
      });

      const [feed, reel] = controller.capabilities().items[0].placements;

      // Absent means "no constraint", and must not arrive as [] — which a
      // client would read as "no ratio is acceptable".
      expect(feed.aspectRatios).toBeNull();
      expect(reel.aspectRatios).toEqual(['9:16']);
    });

    it('answers an empty matrix when nothing is registered', () => {
      registry.registeredPairs = [];

      expect(controller.capabilities()).toEqual({ items: [], total: 0 });
      expect(registry.resolve).not.toHaveBeenCalled();
    });
  });

  describe('targets', () => {
    it('requires only view permission, not the integrations admin key', () => {
      // The composer must work for someone who publishes without
      // administering integrations.
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY_METADATA,
          SocialPublicationController.prototype.targets,
        ),
      ).toBe('social.publishing.publication.view.assigned');
    });

    it('lists using only the server-resolved scope', async () => {
      service.listPublishTargets.mockResolvedValue([]);

      await controller.targets(clientCtx);

      expect(service.listPublishTargets).toHaveBeenCalledWith({
        tenantId: clientCtx.tenantId,
        workspaceId: clientCtx.workspaceId,
        agencyClientId: '33333333-3333-4333-8333-333333333333',
      });
    });

    it('masks the provider account id and keeps the timezone unfabricated', async () => {
      service.listPublishTargets.mockResolvedValue([
        {
          id: 'asset-1',
          provider: 'meta',
          assetType: 'instagram_professional',
          externalAssetId: '17841400000000000',
          displayName: 'Marca',
          username: 'marca',
          avatarUrl: null,
          assetTimezone: null,
        },
      ]);

      const result = await controller.targets(agencyCtx);

      expect(result.items[0].maskedExternalAssetId).not.toContain(
        '17841400000000000',
      );
      expect(result.items[0].maskedExternalAssetId).toContain('0000');
      // Null, never a silent UTC stand-in.
      expect(result.items[0].assetTimezone).toBeNull();
      expect(JSON.stringify(result)).not.toContain('17841400000000000');
    });
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
