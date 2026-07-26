import { Repository } from 'typeorm';
import {
  AgencyProjectSettings,
  AgencyProjectUserPreferences,
} from '../entities';
import { ProjectSettingsService } from './project-settings.service';

describe('ProjectSettingsService card display defaults', () => {
  it('fills missing card attributes with visible defaults', async () => {
    const { service } = makeService(
      makeSettings({
        projectCardDisplayDefaults: { markers: false },
        taskCardDisplayDefaults: {},
      }),
    );

    const settings = await service.getSettings(makeContext());

    expect(settings.projectCardDisplayDefaults).toEqual(
      expect.objectContaining({
        markers: false,
        client: true,
        progress: true,
        responsible: true,
      }),
    );
    expect(settings.taskCardDisplayDefaults).toEqual(
      expect.objectContaining({
        project: true,
        cover: true,
        activity: true,
        status: true,
      }),
    );
  });

  it('normalizes and persists supported defaults on update', async () => {
    const stored = makeSettings();
    const { service, settingsRepository } = makeService(stored);

    const settings = await service.updateSettings(makeContext(), {
      projectCardDisplayDefaults: {
        client: false,
        taskCount: false,
      },
      taskCardDisplayDefaults: {
        cover: false,
        dueDate: false,
      },
    });

    expect(settingsRepository.save).toHaveBeenCalledWith(stored);
    expect(settings.projectCardDisplayDefaults.client).toBe(false);
    expect(settings.projectCardDisplayDefaults.markers).toBe(true);
    expect(settings.taskCardDisplayDefaults.cover).toBe(false);
    expect(settings.taskCardDisplayDefaults.status).toBe(true);
  });
});

function makeService(settings: AgencyProjectSettings) {
  const settingsRepository = {
    findOne: jest.fn().mockResolvedValue(settings),
    save: jest.fn((value: AgencyProjectSettings) => Promise.resolve(value)),
  };
  const preferencesRepository = {};

  return {
    service: new ProjectSettingsService(
      settingsRepository as unknown as Repository<AgencyProjectSettings>,
      preferencesRepository as Repository<AgencyProjectUserPreferences>,
    ),
    settingsRepository,
  };
}

function makeSettings(
  overrides: Partial<AgencyProjectSettings> = {},
): AgencyProjectSettings {
  const now = new Date('2026-07-25T12:00:00.000Z');

  return {
    id: 'settings-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    projectMarkers: [],
    taskMarkers: [],
    taskTypes: [],
    taskExecutionMode: 'hybrid',
    stageTemplates: [],
    projectCardDisplayDefaults: {},
    taskCardDisplayDefaults: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  };
}
