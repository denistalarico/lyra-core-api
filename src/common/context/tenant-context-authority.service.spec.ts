import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { JwtStrategy } from '../../modules/auth/strategies/jwt.strategy';
import type { AuthTokenPayload } from '../../modules/auth/types/auth-token-payload.type';
import {
  AuthorizedContext,
  getAuthorizedContext,
} from './authorized-context.decorator';
import {
  readRequestedTenantContext,
  TenantContextAuthority,
} from './tenant-context-authority.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OTHER_TENANT = '44444444-4444-4444-8444-444444444444';
const OTHER_WORKSPACE = '55555555-5555-4555-8555-555555555555';
const OTHER_USER = '66666666-6666-4666-8666-666666666666';

const payload = (overrides: Partial<AuthTokenPayload> = {}) => ({
  sub: USER,
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  role: 'owner',
  sessionId: 'session-1',
  email: 'owner@example.com',
  ...overrides,
});

function build(
  membership: { id: string; role: string } | null = {
    id: 'membership-1',
    role: 'owner',
  },
) {
  const findOne = jest.fn().mockResolvedValue(membership);
  const authority = new TenantContextAuthority({
    getRepository: () => ({ findOne }),
  } as never);
  return { authority, findOne };
}

describe('TenantContextAuthority (SEC-A1)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it('authorizes a token with an active membership and no headers', async () => {
    const { authority, findOne } = build();

    await expect(authority.authorize(payload())).resolves.toMatchObject({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      sub: USER,
    });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          workspaceId: WORKSPACE,
          userId: USER,
          status: 'active',
        },
      }),
    );
  });

  it('accepts headers equal to the token, ignoring case and whitespace', async () => {
    const { authority } = build();
    const requested = readRequestedTenantContext({
      'x-tenant-id': ` ${TENANT.toUpperCase()} `,
      'x-workspace-id': [WORKSPACE],
      'x-user-id': USER,
    });

    await expect(
      authority.authorize(payload(), requested),
    ).resolves.toBeTruthy();
  });

  it.each([
    ['tenant', { tenantId: OTHER_TENANT }],
    ['workspace', { workspaceId: OTHER_WORKSPACE }],
    ['user', { userId: OTHER_USER }],
  ])(
    'refuses a %s header that differs from the token, before any lookup',
    async (_label, requested) => {
      const { authority, findOne } = build();

      await expect(
        authority.authorize(payload(), requested),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(findOne).not.toHaveBeenCalled();
    },
  );

  it('refuses a token without an active membership', async () => {
    const { authority } = build(null);

    await expect(authority.authorize(payload())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a token missing tenant, workspace or subject with 401', async () => {
    const { authority, findOne } = build();

    for (const broken of [
      payload({ tenantId: '' }),
      payload({ workspaceId: '' }),
      payload({ sub: '' }),
    ]) {
      await expect(authority.authorize(broken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns the live membership role, not the role in the token', async () => {
    const { authority } = build({ id: 'membership-1', role: 'member' });

    await expect(
      authority.authorize(payload({ role: 'owner' })),
    ).resolves.toMatchObject({ role: 'member' });
  });

  it('uses one generic message that names no tenant, workspace or membership', async () => {
    const { authority } = build();

    const error = await authority
      .authorize(payload(), { tenantId: OTHER_TENANT })
      .catch((e: ForbiddenException) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    const body = JSON.stringify((error as ForbiddenException).getResponse());
    expect(body).not.toContain(TENANT);
    expect(body).not.toContain(OTHER_TENANT);
    expect(body).not.toContain(WORKSPACE);
  });

  it('logs a structured context_mismatch without raw header text or token', async () => {
    const { authority } = build();

    await authority
      .authorize(payload(), {
        tenantId: OTHER_TENANT,
        workspaceId: '<script>alert(1)</script>',
      })
      .catch(() => undefined);

    expect(warn).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(
      String((warn.mock.calls as unknown[][])[0]?.[0]),
    ) as Record<string, unknown>;
    expect(entry).toEqual({
      event: 'tenant_context_rejected',
      reason: 'context_mismatch',
      channel: 'http',
      userId: USER,
      authenticatedTenantId: TENANT,
      authenticatedWorkspaceId: WORKSPACE,
      requestedTenantId: OTHER_TENANT,
      requestedWorkspaceId: '[not-a-uuid]',
      requestedUserId: null,
    });
  });

  it('logs no_active_membership for a socket handshake', async () => {
    const { authority } = build(null);

    await authority.authorize(payload(), {}, 'socket').catch(() => undefined);

    const entry = JSON.parse(
      String((warn.mock.calls as unknown[][])[0]?.[0]),
    ) as Record<string, unknown>;
    expect(entry).toMatchObject({
      reason: 'no_active_membership',
      channel: 'socket',
    });
  });
});

describe('JwtStrategy runs every verified token through the authority', () => {
  const config = {
    get: () => 'secret-for-unit-tests-only',
  } as unknown as ConfigService;

  it('passes the request headers as the requested context', async () => {
    const { authority } = build();
    const authorize = jest.spyOn(authority, 'authorize');
    const strategy = new JwtStrategy(config, authority);

    await strategy.validate(
      { headers: { 'x-tenant-id': TENANT } } as unknown as Request,
      payload(),
    );

    expect(authorize).toHaveBeenCalledWith(payload(), {
      tenantId: TENANT,
      workspaceId: null,
      userId: null,
    });
  });

  it('refuses a mismatched header with 403', async () => {
    const { authority } = build();
    const strategy = new JwtStrategy(config, authority);

    await expect(
      strategy.validate(
        { headers: { 'x-tenant-id': OTHER_TENANT } } as unknown as Request,
        payload(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still refuses Client Area and 2FA tokens before any lookup', async () => {
    const { authority, findOne } = build();
    const strategy = new JwtStrategy(config, authority);

    for (const claim of [{ typ: 'client_area' }, { type: 'agency-2fa' }]) {
      await expect(
        strategy.validate({ headers: {} } as unknown as Request, {
          ...payload(),
          ...claim,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(findOne).not.toHaveBeenCalled();
  });
});

describe('@AuthorizedContext()', () => {
  function decoratorFactory() {
    class Probe {
      handler(@AuthorizedContext() context: unknown) {
        return context;
      }
    }
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      Probe,
      'handler',
    ) as Record<
      string,
      { factory: (data: unknown, ctx: ExecutionContext) => unknown }
    >;
    return Object.values(args)[0].factory;
  }

  const executionContext = (request: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  it('reads the authorized user and ignores identity headers entirely', () => {
    const factory = decoratorFactory();
    const request = {
      user: payload({ role: 'member' }),
      headers: {
        'x-tenant-id': OTHER_TENANT,
        'x-workspace-id': OTHER_WORKSPACE,
        'x-user-id': OTHER_USER,
        'x-user-role': 'owner',
        'x-role': 'owner',
      },
    };

    expect(factory(undefined, executionContext(request))).toEqual({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      userId: USER,
      role: 'member',
      sessionId: 'session-1',
    });
  });

  it('fails closed with 401 when no verified user is present', () => {
    expect(() =>
      getAuthorizedContext({
        headers: { 'x-tenant-id': TENANT, 'x-workspace-id': WORKSPACE },
      } as unknown as Request),
    ).toThrow(UnauthorizedException);
  });
});
