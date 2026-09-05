import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SocialPlannerSettingsEntity } from '../entities';
import { DEFAULT_SOCIAL_PLANNER_SETTINGS } from '../social-planner.defaults';
import { SocialPlannerSettingsService } from './social-planner-settings.service';
import type { SocialPlannerScope } from './social-planner.service';

describe('SocialPlannerSettingsService', () => {
  const scope: SocialPlannerScope = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
  };

  const repository = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({
      id: '33333333-3333-4333-8333-333333333333',
      ...value,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  };

  let service: SocialPlannerSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new SocialPlannerSettingsService(
      repository as unknown as Repository<SocialPlannerSettingsEntity>,
    );
  });

  it('returns official defaults without creating a database row', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.getSettings(scope);

    expect(result.persisted).toBe(false);
    expect(result.settings).toEqual(
      DEFAULT_SOCIAL_PLANNER_SETTINGS,
    );

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates settings only when the context is updated', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.updateSettings(
      scope,
      '44444444-4444-4444-8444-444444444444',
      {
        monthlyContentVolume: 12,
      },
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: null,
      }),
    );

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyContentVolume: 12,
      }),
    );

    expect(result.persisted).toBe(true);
  });

  it('preserves sections omitted from a partial update', async () => {
    repository.findOne.mockResolvedValue(null);

    await service.updateSettings(
      scope,
      null,
      {
        monthlyContentVolume: 20,
      },
    );

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyContentVolume: 20,
        funnelDistribution:
          DEFAULT_SOCIAL_PLANNER_SETTINGS.funnelDistribution,
        contentTypes:
          DEFAULT_SOCIAL_PLANNER_SETTINGS.contentTypes,
        milestones:
          DEFAULT_SOCIAL_PLANNER_SETTINGS.milestones,
      }),
    );
  });

  it('rejects a funnel distribution that does not total 100 percent', async () => {
    await expect(
      service.updateSettings(scope, null, {
        funnelDistribution: {
          discovery: 40,
          recognition: 30,
          consideration: 20,
          decision: 5,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects duplicate catalog keys', async () => {
    await expect(
      service.updateSettings(scope, null, {
        contentTypes: [
          {
            key: 'aida',
            label: 'AIDA',
            enabled: true,
          },
          {
            key: 'aida',
            label: 'AIDA duplicado',
            enabled: true,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
