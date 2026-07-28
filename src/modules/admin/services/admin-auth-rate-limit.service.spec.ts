import { HttpException } from '@nestjs/common';
import { AdminAuthRateLimitService } from './admin-auth-rate-limit.service';

describe('AdminAuthRateLimitService', () => {
  it('limits repeated login attempts without retaining the raw discriminator', () => {
    const service = new AdminAuthRateLimitService();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(() =>
        service.assertAllowed('login', '127.0.0.1:admin@example.com'),
      ).not.toThrow();
    }
    expect(() =>
      service.assertAllowed('login', '127.0.0.1:admin@example.com'),
    ).toThrow(HttpException);
  });

  it('uses independent limits for refresh and 2FA e-mail', () => {
    const service = new AdminAuthRateLimitService();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      service.assertAllowed('two_factor_email', 'device');
    }
    expect(() => service.assertAllowed('two_factor_email', 'device')).toThrow(
      HttpException,
    );
    expect(() => service.assertAllowed('refresh', 'device')).not.toThrow();
  });
});
