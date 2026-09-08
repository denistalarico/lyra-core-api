import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSocialOrganicAssetTimezoneDto } from './update-social-organic-asset-timezone.dto';

describe('UpdateSocialOrganicAssetTimezoneDto', () => {
  it('accepts a timezone string', async () => {
    const dto = plainToInstance(UpdateSocialOrganicAssetTimezoneDto, {
      timezone: 'America/Sao_Paulo',
    });
    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
  });

  it('accepts explicit null to clear the timezone', async () => {
    const dto = plainToInstance(UpdateSocialOrganicAssetTimezoneDto, {
      timezone: null,
    });
    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
  });

  it('rejects an omitted field', async () => {
    const dto = plainToInstance(UpdateSocialOrganicAssetTimezoneDto, {});
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'timezone')).toBe(true);
  });

  it('rejects a non-string timezone', async () => {
    const dto = plainToInstance(UpdateSocialOrganicAssetTimezoneDto, {
      timezone: 42,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'timezone')).toBe(true);
  });

  it('rejects unknown fields such as scope identifiers', async () => {
    const dto = plainToInstance(UpdateSocialOrganicAssetTimezoneDto, {
      timezone: 'America/Sao_Paulo',
      tenantId: 'hostile-tenant',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'tenantId')).toBe(true);
  });
});
