import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SocialPublishingCadenceEntity } from '../entities';
import { SocialPublishingCadenceService } from './social-publishing-cadence.service';
import type { SocialPlannerSettingsService } from './social-planner-settings.service';
import type { SocialPlannerScope } from './social-planner.service';

describe('SocialPublishingCadenceService', () => {
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

  const settingsService = {
    getSettings: jest.fn(),
  };

  let service: SocialPublishingCadenceService;

  beforeEach(() => {
    jest.clearAllMocks();

    settingsService.getSettings.mockResolvedValue({
      settings: {
        monthlyContentVolume: 8,
      },
      persisted: false,
      updatedAt: null,
    });

    service = new SocialPublishingCadenceService(
      repository as unknown as Repository<SocialPublishingCadenceEntity>,
      settingsService as unknown as SocialPlannerSettingsService,
    );
  });

  it('returns defaults without persisting a row', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.getCadence(scope);

    expect(result.persisted).toBe(false);
    expect(result.cadence.timezone).toBe('America/Sao_Paulo');
    expect(result.cadence.channels).toEqual([]);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('inherits Planner monthly volume when channel frequency is null', async () => {
    repository.findOne.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      ...scope,
      timezone: 'America/Sao_Paulo',
      autoDistributionEnabled: false,
      channels: [
        {
          channel: 'instagram',
          enabled: true,
          frequencyPerMonth: null,
          slots: [
            {
              dayOfWeek: 2,
              time: '08:00',
            },
          ],
        },
      ],
      createdById: null,
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.getCadence(scope);

    expect(result.effectiveChannels[0]).toEqual(
      expect.objectContaining({
        channel: 'instagram',
        frequencyPerMonth: null,
        effectiveFrequencyPerMonth: 8,
        frequencyInherited: true,
      }),
    );
  });

  it('uses explicit channel frequency instead of inherited volume', async () => {
    repository.findOne.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      ...scope,
      timezone: 'America/Sao_Paulo',
      autoDistributionEnabled: false,
      channels: [
        {
          channel: 'instagram',
          enabled: true,
          frequencyPerMonth: 12,
          slots: [],
        },
      ],
      createdById: null,
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.getCadence(scope);

    expect(result.effectiveChannels[0].effectiveFrequencyPerMonth).toBe(12);

    expect(result.effectiveChannels[0].frequencyInherited).toBe(false);
  });

  it('rejects invalid IANA timezone', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.updateCadence(scope, null, {
        timezone: 'Franca/Brasil',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects duplicated channel keys', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.updateCadence(scope, null, {
        channels: [
          {
            channel: 'instagram',
            enabled: true,
            frequencyPerMonth: null,
            slots: [],
          },
          {
            channel: 'instagram',
            enabled: true,
            frequencyPerMonth: null,
            slots: [],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicated weekly slots inside one channel', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.updateCadence(scope, null, {
        channels: [
          {
            channel: 'instagram',
            enabled: true,
            frequencyPerMonth: null,
            slots: [
              {
                dayOfWeek: 2,
                time: '08:00',
              },
              {
                dayOfWeek: 2,
                time: '08:00',
              },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists explicit cadence while preserving inherited frequency', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.updateCadence(
      scope,
      '44444444-4444-4444-8444-444444444444',
      {
        timezone: 'America/Sao_Paulo',
        autoDistributionEnabled: true,
        channels: [
          {
            channel: 'instagram',
            enabled: true,
            frequencyPerMonth: null,
            slots: [
              {
                dayOfWeek: 4,
                time: '09:30',
              },
              {
                dayOfWeek: 2,
                time: '08:00',
              },
            ],
          },
        ],
      },
    );

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: 'America/Sao_Paulo',
        autoDistributionEnabled: true,
        channels: [
          {
            channel: 'instagram',
            enabled: true,
            frequencyPerMonth: null,
            slots: [
              {
                dayOfWeek: 2,
                time: '08:00',
              },
              {
                dayOfWeek: 4,
                time: '09:30',
              },
            ],
          },
        ],
      }),
    );

    expect(result.effectiveChannels[0].effectiveFrequencyPerMonth).toBe(8);
  });

  it('reflects a changed Planner monthly volume without rewriting cadence', async () => {
    repository.findOne.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      ...scope,
      timezone: 'America/Sao_Paulo',
      autoDistributionEnabled: false,
      channels: [
        {
          channel: 'instagram',
          enabled: true,
          frequencyPerMonth: null,
          slots: [],
        },
      ],
      createdById: null,
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    settingsService.getSettings.mockResolvedValue({
      settings: {
        monthlyContentVolume: 20,
      },
      persisted: true,
      updatedAt: new Date(),
    });

    const result = await service.getCadence(scope);

    expect(result.effectiveChannels[0].effectiveFrequencyPerMonth).toBe(20);

    expect(result.effectiveChannels[0].frequencyInherited).toBe(true);

    expect(repository.save).not.toHaveBeenCalled();
  });
});
