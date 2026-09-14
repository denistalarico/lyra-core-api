import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { SocialBoostTemplateEntity } from '../entities';
import { SocialBoostTemplateService } from './social-boost-template.service';

const scope = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  agencyClientId: null,
};

function buildService() {
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn((value: Record<string, unknown>) => ({
      ...value,
      id: '00000000-0000-4000-8000-000000000010',
      createdAt: new Date('2026-09-14T00:00:00Z'),
      updatedAt: new Date('2026-09-14T00:00:00Z'),
    })),
    update: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((run: (manager: { getRepository: () => typeof repository }) => unknown) =>
      run({ getRepository: () => repository }),
    ),
  };

  return {
    repository,
    dataSource,
    service: new SocialBoostTemplateService(
      repository as unknown as Repository<SocialBoostTemplateEntity>,
      dataSource as unknown as DataSource,
    ),
  };
}

const validDto = {
  name: 'Engajamento local',
  provider: 'meta' as const,
  objective: 'engagement' as const,
  budgetType: 'lifetime' as const,
  budgetAmountMinor: 5000,
  currency: 'BRL',
  durationDays: 5,
  audienceMode: 'automatic' as const,
  audience: { countries: ['br'] },
  placements: ['automatic'],
  specialAdCategories: [],
};

describe('SocialBoostTemplateService', () => {
  it('makes the first active template the context default', async () => {
    const { repository, service } = buildService();
    repository.findOne.mockResolvedValue(null);
    repository.count.mockResolvedValue(0);
    repository.update.mockResolvedValue({ affected: 0 });

    const result = await service.create(scope, null, validDto);

    expect(result.isDefault).toBe(true);
    expect(result.budgetAmountMinor).toBe('5000');
    expect(result.audience.countries).toEqual(['BR']);
  });

  it('rejects a custom audience without a country', async () => {
    const { repository, dataSource, service } = buildService();
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.create(scope, null, {
        ...validDto,
        audienceMode: 'custom',
        audience: { countries: [] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not reveal a template outside the resolved context', async () => {
    const { repository, service } = buildService();
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.update(
        { ...scope, agencyClientId: '00000000-0000-4000-8000-000000000099' },
        '00000000-0000-4000-8000-000000000010',
        null,
        { isActive: false },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
