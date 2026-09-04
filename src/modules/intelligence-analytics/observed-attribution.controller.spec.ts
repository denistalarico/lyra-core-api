import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { ObservedAttributionController } from './observed-attribution.controller';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    role: 'owner',
    ...overrides,
  } as RequestContext;
}

function build(
  options: {
    allowedProducts?: string[];
    permitted?: boolean;
    view?: unknown;
  } = {},
) {
  const allowed = options.allowedProducts ?? ['social', 'leadflow'];

  const permissionService = {
    canAccessProduct: jest
      .fn()
      .mockImplementation((_ctx, product: string) =>
        Promise.resolve(allowed.includes(product)),
      ),
    assertCan: jest.fn().mockImplementation(() => {
      if (options.permitted === false) {
        throw new ForbiddenException('denied');
      }
      return Promise.resolve();
    }),
  };

  const attribution = {
    conversation: jest
      .fn()
      .mockResolvedValue(
        options.view === undefined
          ? { kind: 'observed_attribution' }
          : options.view,
      ),
  };

  return {
    controller: new ObservedAttributionController(
      attribution as never,
      permissionService as never,
    ),
    attribution,
    permissionService,
  };
}

describe('ObservedAttributionController', () => {
  it('returns the view for an authorised caller', async () => {
    const { controller } = build();

    await expect(
      controller.conversation(context(), CONVERSATION_ID),
    ).resolves.toMatchObject({ kind: 'observed_attribution' });
  });

  /**
   * Both entitlements, because the response puts one product's ad next to the
   * other's opportunity.
   */
  it.each(['social', 'leadflow'])(
    'refuses a tenant without the %s entitlement',
    async (missing) => {
      const { controller } = build({
        allowedProducts: ['social', 'leadflow'].filter((p) => p !== missing),
      });

      await expect(
        controller.conversation(context(), CONVERSATION_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('refuses a user without the second permission', async () => {
    const { controller } = build({ permitted: false });

    await expect(
      controller.conversation(context(), CONVERSATION_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /**
   * Entitlement is checked before any domain is read: a caller who may not use
   * the product must not be able to learn whether a conversation exists.
   */
  it('checks access before reading either domain', async () => {
    const { controller, attribution } = build({ allowedProducts: ['social'] });

    await expect(
      controller.conversation(context(), CONVERSATION_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attribution.conversation).not.toHaveBeenCalled();
  });

  it('404s a conversation the scope cannot see', async () => {
    const { controller } = build({ view: null });

    await expect(
      controller.conversation(context(), CONVERSATION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('the scope', () => {
    it('reads the managed client from context, never from the caller', async () => {
      const { controller, attribution } = build();

      await controller.conversation(
        context({
          managedContext: {
            operatingMode: 'client',
            clientId: 'client-9',
          },
        } as Partial<RequestContext>),
        CONVERSATION_ID,
      );

      expect(attribution.conversation).toHaveBeenCalledWith(
        {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          agencyClientId: 'client-9',
        },
        CONVERSATION_ID,
      );
    });

    it('uses agency context when no client is selected', async () => {
      const { controller, attribution } = build();

      await controller.conversation(context(), CONVERSATION_ID);

      expect(attribution.conversation).toHaveBeenCalledWith(
        expect.objectContaining({ agencyClientId: null }),
        CONVERSATION_ID,
      );
    });

    /**
     * Client mode with no client is a broken context, not "every client".
     */
    it('refuses client mode with no client id', async () => {
      const { controller } = build();

      await expect(
        controller.conversation(
          context({
            managedContext: { operatingMode: 'client', clientId: null },
          } as Partial<RequestContext>),
          CONVERSATION_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a context with no workspace', async () => {
      const { controller } = build();

      await expect(
        controller.conversation(
          context({ workspaceId: undefined }),
          CONVERSATION_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
