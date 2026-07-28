import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  AdminEmptyBodyDto,
  AdminLoginDto,
  AdminTwoFactorVerifyDto,
} from './admin-auth.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

describe('Admin auth DTO validation', () => {
  it('accepts a valid login and rejects extra properties', async () => {
    await expect(
      pipe.transform(
        { email: 'admin@example.com', password: 'password' },
        { type: 'body', metatype: AdminLoginDto },
      ),
    ).resolves.toBeInstanceOf(AdminLoginDto);
    await expect(
      pipe.transform(
        {
          email: 'admin@example.com',
          password: 'password',
          workspaceId: 'commercial-workspace',
        },
        { type: 'body', metatype: AdminLoginDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires exactly six digits for a 2FA code', async () => {
    await expect(
      pipe.transform(
        { tempToken: 'admin-temp-token', code: '123456' },
        { type: 'body', metatype: AdminTwoFactorVerifyDto },
      ),
    ).resolves.toBeInstanceOf(AdminTwoFactorVerifyDto);
    await expect(
      pipe.transform(
        { tempToken: 'admin-temp-token', code: '12345a' },
        { type: 'body', metatype: AdminTwoFactorVerifyDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a refresh token or any other property in an empty body', async () => {
    await expect(
      pipe.transform(
        { refreshToken: 'must-not-be-accepted' },
        { type: 'body', metatype: AdminEmptyBodyDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
