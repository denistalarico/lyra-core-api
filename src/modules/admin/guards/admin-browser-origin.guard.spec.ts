import {
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AdminBrowserOriginGuard } from './admin-browser-origin.guard';

function createHarness(
  headers: Request['headers'],
  environment: Record<string, string | undefined> = {
    ADMIN_WEB_ORIGIN: 'https://admin.lyra.example',
    NODE_ENV: 'production',
  },
) {
  const request = { headers, method: 'POST' } as Request;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
  const configService = {
    get: jest.fn((key: string) => environment[key]),
  } as unknown as ConfigService;

  return {
    guard: new AdminBrowserOriginGuard(configService),
    context,
  };
}

describe('AdminBrowserOriginGuard', () => {
  it('allows the configured Admin browser origin', () => {
    const { guard, context } = createHarness({
      origin: 'https://admin.lyra.example',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('accepts a matching Referer when Origin is absent', () => {
    const { guard, context } = createHarness({
      referer: 'https://admin.lyra.example/login',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies an invalid browser origin', () => {
    const { guard, context } = createHarness({
      origin: 'https://attacker.example',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('fails closed without Origin or Referer in production', () => {
    const { guard, context } = createHarness({});

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows origin-less local test and development requests', () => {
    const { guard, context } = createHarness(
      {},
      {
        ADMIN_WEB_ORIGIN: 'http://localhost:3002',
        NODE_ENV: 'test',
      },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies an explicitly malformed origin in development', () => {
    const { guard, context } = createHarness(
      { origin: 'not-an-origin' },
      {
        ADMIN_WEB_ORIGIN: 'http://localhost:3002',
        NODE_ENV: 'development',
      },
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
