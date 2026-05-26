import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgencyProjectSettings,
  AgencyProjectUserPreferences,
  ProjectBoardPreference,
  ProjectMarkerSetting,
  ProjectTaskExecutionMode,
  ProjectTaskTypeSetting,
} from '../entities';
import { UpdateProjectPreferencesDto, UpdateProjectSettingsDto } from '../dto';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const defaultProjectMarkers: ProjectMarkerSetting[] = [
  { id: 'project-marker-campaign', name: 'Campanha', color: '#2563EB' },
  { id: 'project-marker-design', name: 'Design', color: '#7C3AED' },
];

const defaultTaskMarkers: ProjectMarkerSetting[] = [
  { id: 'task-marker-urgent', name: 'Urgente', color: '#DC2626' },
  { id: 'task-marker-review', name: 'Revisao', color: '#F59E0B' },
];

const defaultTaskTypes: ProjectTaskTypeSetting[] = [
  { id: 'task-type-design', name: 'Design' },
  { id: 'task-type-development', name: 'Desenvolvimento' },
  { id: 'task-type-setup', name: 'Setup' },
];

const emptyBoardPreference: ProjectBoardPreference = {
  foldedStageIds: [],
  pinnedCardsByStage: {},
};

function normalizeBoardPreference(
  value?: Partial<ProjectBoardPreference> | null,
): ProjectBoardPreference {
  return {
    foldedStageIds: Array.isArray(value?.foldedStageIds)
      ? value.foldedStageIds.filter((id): id is string => typeof id === 'string')
      : [],
    pinnedCardsByStage:
      value?.pinnedCardsByStage && typeof value.pinnedCardsByStage === 'object'
        ? Object.fromEntries(
            Object.entries(value.pinnedCardsByStage)
              .filter(([stageId]) => typeof stageId === 'string')
              .map(([stageId, cardIds]) => [
                stageId,
                Array.isArray(cardIds)
                  ? cardIds.filter((cardId): cardId is string => typeof cardId === 'string')
                  : [],
              ]),
          )
        : {},
  };
}

@Injectable()
export class ProjectSettingsService {
  constructor(
    @InjectRepository(AgencyProjectSettings, 'agency')
    private readonly settingsRepository: Repository<AgencyProjectSettings>,

    @InjectRepository(AgencyProjectUserPreferences, 'agency')
    private readonly preferencesRepository: Repository<AgencyProjectUserPreferences>,
  ) {}

  async getSettings(context: RequestContext) {
    const settings = await this.findOrCreateSettings(context);

    return this.serializeSettings(settings);
  }

  async updateSettings(context: RequestContext, dto: UpdateProjectSettingsDto) {
    const settings = await this.findOrCreateSettings(context);

    if (dto.projectMarkers !== undefined) {
      settings.projectMarkers = this.normalizeMarkers(dto.projectMarkers);
    }

    if (dto.taskMarkers !== undefined) {
      settings.taskMarkers = this.normalizeMarkers(dto.taskMarkers);
    }

    if (dto.taskTypes !== undefined) {
      settings.taskTypes = this.normalizeTaskTypes(dto.taskTypes);
    }

    if (dto.taskExecutionMode !== undefined) {
      settings.taskExecutionMode = dto.taskExecutionMode;
    }

    return this.serializeSettings(await this.settingsRepository.save(settings));
  }

  async getPreferences(context: RequestContext) {
    const preferences = await this.findOrCreatePreferences(context);

    return this.serializePreferences(preferences);
  }

  async updatePreferences(context: RequestContext, dto: UpdateProjectPreferencesDto) {
    const preferences = await this.findOrCreatePreferences(context);

    if (dto.overviewColumnOrder !== undefined) {
      preferences.overviewColumnOrder = dto.overviewColumnOrder.filter(
        (column): column is string => typeof column === 'string',
      );
    }

    if (dto.projectBoard !== undefined) {
      preferences.projectBoard = normalizeBoardPreference(dto.projectBoard);
    }

    if (dto.workspaceTaskBoard !== undefined) {
      preferences.workspaceTaskBoard = normalizeBoardPreference(dto.workspaceTaskBoard);
    }

    if (dto.personalTaskBoard !== undefined) {
      preferences.personalTaskBoard = normalizeBoardPreference(dto.personalTaskBoard);
    }

    return this.serializePreferences(await this.preferencesRepository.save(preferences));
  }

  private async findOrCreateSettings(context: RequestContext) {
    const existing = await this.settingsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (existing) return existing;

    return this.settingsRepository.save(
      this.settingsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectMarkers: defaultProjectMarkers,
        taskMarkers: defaultTaskMarkers,
        taskTypes: defaultTaskTypes,
        taskExecutionMode: 'hybrid',
      }),
    );
  }

  private async findOrCreatePreferences(context: RequestContext) {
    const existing = await this.preferencesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });

    if (existing) return existing;

    return this.preferencesRepository.save(
      this.preferencesRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        overviewColumnOrder: [],
        projectBoard: emptyBoardPreference,
        workspaceTaskBoard: emptyBoardPreference,
        personalTaskBoard: emptyBoardPreference,
      }),
    );
  }

  private normalizeMarkers(markers: ProjectMarkerSetting[]) {
    return markers
      .filter((marker) => marker && marker.name?.trim())
      .map((marker) => ({
        id: marker.id || `marker-${Date.now()}`,
        name: marker.name.trim(),
        color: marker.color || '#2563EB',
      }));
  }

  private normalizeTaskTypes(taskTypes: ProjectTaskTypeSetting[]) {
    return taskTypes
      .filter((taskType) => taskType && taskType.name?.trim())
      .map((taskType) => ({
        id: taskType.id || `task-type-${Date.now()}`,
        name: taskType.name.trim(),
      }));
  }

  private serializeSettings(settings: AgencyProjectSettings) {
    return {
      projectMarkers: settings.projectMarkers?.length
        ? settings.projectMarkers
        : defaultProjectMarkers,
      taskMarkers: settings.taskMarkers?.length ? settings.taskMarkers : defaultTaskMarkers,
      taskTypes: settings.taskTypes?.length ? settings.taskTypes : defaultTaskTypes,
      taskExecutionMode:
        (settings.taskExecutionMode as ProjectTaskExecutionMode | undefined) ?? 'hybrid',
    };
  }

  private serializePreferences(preferences: AgencyProjectUserPreferences) {
    return {
      overviewColumnOrder: Array.isArray(preferences.overviewColumnOrder)
        ? preferences.overviewColumnOrder
        : [],
      projectBoard: normalizeBoardPreference(preferences.projectBoard),
      workspaceTaskBoard: normalizeBoardPreference(preferences.workspaceTaskBoard),
      personalTaskBoard: normalizeBoardPreference(preferences.personalTaskBoard),
    };
  }
}
