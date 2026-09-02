import 'reflect-metadata';
import { PERMISSION_KEY_METADATA } from '../../permissions/decorators/permissions.decorators';
import { ClientsController } from './clients.controller';

describe('ClientsController product authorization', () => {
  it('requires the Agency client product management permission for mutations', () => {
    const updateProductHandler = Object.getOwnPropertyDescriptor(
      ClientsController.prototype,
      'updateProduct',
    )?.value as (...args: never[]) => unknown;
    const permission = Reflect.getMetadata(
      PERMISSION_KEY_METADATA,
      updateProductHandler,
    ) as unknown;

    expect(permission).toBe('agency.clients.products.manage.admin');
  });

  it('scopes product mutations from the authenticated JWT, not request headers', async () => {
    const clientsService = {
      updateProduct: jest.fn().mockResolvedValue({ productKey: 'social' }),
    };
    const controller = new ClientsController(
      clientsService as never,
      {} as never,
    );
    const user = {
      sub: 'user-1',
      tenantId: 'trusted-tenant',
      workspaceId: 'trusted-workspace',
      role: 'admin',
      sessionId: 'session-1',
      email: 'admin@example.com',
    };

    await controller.updateProduct(user, 'client-1', 'social', {
      action: 'activate',
    });

    expect(clientsService.updateProduct).toHaveBeenCalledWith(
      {
        tenantId: 'trusted-tenant',
        workspaceId: 'trusted-workspace',
        userId: 'user-1',
      },
      'client-1',
      'social',
      { action: 'activate' },
    );
  });
});
