import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowAutomationGlobalConfigVersionEntity } from '../entities';
import type { LeadFlowAutomationGlobalDefaultsSnapshot } from '../types/leadflow-automation.types';
import {
  DEFAULT_LEADFLOW_AUTOMATION_GLOBAL_DEFAULTS,
  LeadFlowAutomationGlobalConfigService,
  normalizeGlobalDefaults,
  resolveLeadFlowAutomationEffectiveConfig,
} from './leadflow-automation-global-config.service';

const settings = {
  id: 'settings-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
} as LeadFlowClientSettingsEntity;

function persistedSnapshot(): LeadFlowAutomationGlobalDefaultsSnapshot {
  return {
    version: 3,
    source: 'persisted',
    createdAt: '2026-08-03T12:00:00.000Z',
    config: {
      ...DEFAULT_LEADFLOW_AUTOMATION_GLOBAL_DEFAULTS,
      timezone: 'America/Sao_Paulo',
      businessHours: {
        enabled: true,
        windows: { mon: { start: '09:00', end: '18:00' } },
      },
      crm: { pipelineRef: 'pipeline-global', stageRef: 'stage-global' },
      channels: { defaultChannel: 'whatsapp' },
      consent: { requireExplicitConsent: true },
      followUp: { defaultDelayHours: 24, maxAttempts: 3 },
    },
  };
}

describe('LeadFlowAutomationGlobalConfigService', () => {
  it('resolves template < global < override and keeps consent monotonic', () => {
    const effective = resolveLeadFlowAutomationEffectiveConfig(
      persistedSnapshot(),
      {
        template: {
          trigger: { pipelineRef: 'pipeline-template', delayHours: 8 },
          conditions: { businessHoursOnly: false },
          actions: { maxAttempts: 1 },
          message: { channel: 'email' },
          schedulePolicy: { timezone: 'UTC' },
        },
        override: {
          trigger: { pipelineRef: 'pipeline-override', stageRef: null },
          conditions: { requireExplicitConsent: false },
          actions: { maxAttempts: 7 },
          message: { channel: 'sms' },
          schedulePolicy: { timezone: 'Europe/Lisbon' },
        },
      },
    );

    expect(effective.trigger).toMatchObject({
      pipelineRef: 'pipeline-override',
      stageRef: 'stage-global',
      delayHours: 24,
    });
    expect(effective.actions.maxAttempts).toBe(7);
    expect(effective.message.channel).toBe('sms');
    expect(effective.schedulePolicy).toMatchObject({
      timezone: 'Europe/Lisbon',
      respectBusinessHours: true,
    });
    expect(effective.conditions.businessHoursOnly).toBe(true);
    expect(effective.conditions.requireExplicitConsent).toBe(true);
    expect(effective.inheritedFields).toEqual(
      expect.arrayContaining([
        'trigger.stageRef',
        'conditions.requireExplicitConsent',
      ]),
    );
    expect(effective.inheritedFields).not.toContain('trigger.pipelineRef');
    expect(effective.inheritedFields).not.toContain('actions.maxAttempts');
  });

  it('rejects an open or malformed defaults schema', () => {
    expect(() =>
      normalizeGlobalDefaults({
        ...persistedSnapshot().config,
        unexpected: true,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      normalizeGlobalDefaults({
        ...persistedSnapshot().config,
        timezone: 'not/a-timezone',
      }),
    ).toThrow('Timezone global inválido.');
  });

  it('appends a version and refuses a stale expected version', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({ version: 2 }),
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (value: unknown) => ({
        ...(value as object),
        createdAt: new Date('2026-08-03T12:00:00.000Z'),
      })),
    } as unknown as Repository<LeadFlowAutomationGlobalConfigVersionEntity>;
    const dataSource = {
      transaction: jest.fn(
        async (callback: (manager: EntityManager) => unknown) =>
          callback({
            getRepository: jest.fn(() => repository),
          } as unknown as EntityManager),
      ),
    } as unknown as DataSource;
    const service = new LeadFlowAutomationGlobalConfigService(
      dataSource,
      repository,
    );

    const saved = await service.createVersion(
      settings,
      persistedSnapshot().config,
      2,
      'user-1',
    );

    expect(saved.version).toBe(3);
    expect(saved.source).toBe('persisted');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ settingsId: 'settings-1', version: 3 }),
    );

    await expect(
      service.createVersion(settings, persistedSnapshot().config, 1, 'user-1'),
    ).rejects.toThrow(ConflictException);
  });
});
