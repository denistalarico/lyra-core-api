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
    transaction: jest.fn(
      (run: (manager: { getRepository: () => typeof repository }) => unknown) =>
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
  performanceGoal: 'post_engagement' as const,
  conversionLocation: 'on_ad' as const,
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
  it('lists templates only inside the selected company context', async () => {
    const { repository, service } = buildService();
    const companyContextId = '00000000-0000-4000-8000-000000000003';
    repository.find.mockResolvedValue([]);

    await service.list({ ...scope, companyContextId });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyContextId }),
      }),
    );
  });

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

  it('rejects a custom audience without any location', async () => {
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

  it('accepts cities and regions as reusable geography', async () => {
    const { repository, service } = buildService();
    repository.findOne.mockResolvedValue(null);
    repository.count.mockResolvedValue(0);
    repository.update.mockResolvedValue({ affected: 0 });

    const result = await service.create(scope, null, {
      ...validDto,
      audienceMode: 'custom',
      audience: { countries: [], regions: ['São Paulo'], cities: ['Campinas'] },
    });

    expect(result.audience.regions).toEqual(['São Paulo']);
    expect(result.audience.cities).toEqual(['Campinas']);
  });

  it('rejects an incompatible objective, goal and conversion location', async () => {
    const { repository, dataSource, service } = buildService();
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.create(scope, null, {
        ...validDto,
        objective: 'sales',
        performanceGoal: 'reach',
        conversionLocation: 'website',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('requires an event for website conversion goals', async () => {
    const { repository, service } = buildService();
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.create(scope, null, {
        ...validDto,
        objective: 'sales',
        performanceGoal: 'conversions',
        conversionLocation: 'website',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists the selected message destinations and WhatsApp number', async () => {
    const { repository, service } = buildService();
    repository.findOne.mockResolvedValue(null);
    repository.count.mockResolvedValue(0);
    repository.update.mockResolvedValue({ affected: 0 });

    const result = await service.create(scope, null, {
      ...validDto,
      performanceGoal: 'messaging_conversations_started',
      conversionLocation: 'messaging_apps',
      messageDestinations: {
        destinations: ['messenger', 'whatsapp'],
        whatsappPhoneNumber: '+5511999999999',
      },
    });

    expect(result.messageDestinations).toEqual({
      destinations: ['messenger', 'whatsapp'],
      whatsappPhoneNumber: '+5511999999999',
    });
  });

  it('requires a channel and a number whenever WhatsApp is selected', async () => {
    const { repository, dataSource, service } = buildService();
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.create(scope, null, {
        ...validDto,
        performanceGoal: 'messaging_conversations_started',
        conversionLocation: 'messaging_apps',
        messageDestinations: { destinations: [], whatsappPhoneNumber: null },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(scope, null, {
        ...validDto,
        performanceGoal: 'messaging_conversations_started',
        conversionLocation: 'messaging_apps',
        messageDestinations: {
          destinations: ['whatsapp'],
          whatsappPhoneNumber: null,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('keeps legacy message templates operable until their next configuration edit', async () => {
    const { repository, service } = buildService();
    repository.findOne.mockResolvedValue({
      ...validDto,
      id: '00000000-0000-4000-8000-000000000010',
      performanceGoal: 'messaging_conversations_started',
      conversionLocation: 'messaging_apps',
      messageDestinations: { destinations: [], whatsappPhoneNumber: null },
      isActive: true,
      isDefault: false,
    });

    await expect(
      service.update(scope, '00000000-0000-4000-8000-000000000010', null, {
        isActive: false,
      }),
    ).resolves.toMatchObject({ isActive: false });
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
