import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAccessController } from './admin-access.controller';

function controller(environment: Record<string, string | undefined>) {
  return new AdminAccessController({
    get: (key: string) => environment[key],
  } as ConfigService);
}

describe('AdminAccessController', () => {
  it('exposes only static contract metadata outside production', () => {
    expect(controller({ NODE_ENV: 'test' }).getContract()).toEqual(
      expect.objectContaining({
        module: 'admin',
        sessionContext: 'admin',
        identitySource: 'agency-adapter',
        authRuntimeImplemented: false,
      }),
    );
  });

  it('returns 404 in production unless explicitly enabled', () => {
    expect(() => controller({ NODE_ENV: 'production' }).getContract()).toThrow(
      NotFoundException,
    );
    expect(() =>
      controller({
        NODE_ENV: 'production',
        ADMIN_CONTRACT_ENDPOINT_ENABLED: 'true',
      }).getContract(),
    ).not.toThrow();
  });
});
