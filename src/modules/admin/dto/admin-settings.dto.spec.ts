import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ConfirmAdminTwoFactorSetupDto,
  UpdateAdminPreferencesDto,
  UpdateAdminProfileDto,
} from './admin-settings.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

describe('Admin settings DTO validation', () => {
  it('rejects attempts to change protected identity and access fields', async () => {
    await expect(
      pipe.transform(
        { displayName: 'Dana', roleKey: 'super_admin', email: 'new@test.dev' },
        { type: 'body', metatype: UpdateAdminProfileDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts the complete preference contract and rejects unsupported values', async () => {
    await expect(
      pipe.transform(
        {
          locale: 'pt-BR',
          theme: 'system',
          timezone: 'America/Sao_Paulo',
          dateFormat: 'dd/MM/yyyy',
          timeFormat: '24h',
        },
        { type: 'body', metatype: UpdateAdminPreferencesDto },
      ),
    ).resolves.toBeInstanceOf(UpdateAdminPreferencesDto);
    await expect(
      pipe.transform(
        {
          locale: 'es',
          theme: 'neon',
          timezone: 'Mars/Olympus',
          dateFormat: 'relative',
          timeFormat: '25h',
        },
        { type: 'body', metatype: UpdateAdminPreferencesDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires exactly six numeric digits for 2FA confirmation', async () => {
    await expect(
      pipe.transform(
        { method: 'authenticator', code: '123456' },
        { type: 'body', metatype: ConfirmAdminTwoFactorSetupDto },
      ),
    ).resolves.toBeInstanceOf(ConfirmAdminTwoFactorSetupDto);
    await expect(
      pipe.transform(
        { method: 'authenticator', code: '12345x' },
        { type: 'body', metatype: ConfirmAdminTwoFactorSetupDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
