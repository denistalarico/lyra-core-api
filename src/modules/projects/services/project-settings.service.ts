import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgencyProjectSettings,
  AgencyProjectUserPreferences,
  ProjectCardDisplaySettings,
  ProjectBoardPreference,
  ProjectMarkerSetting,
  ProjectStageTemplate,
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

const defaultCardDisplaySettings: ProjectCardDisplaySettings = {
  client: true,
  project: true,
  cover: true,
  markers: true,
  priority: true,
  progress: true,
  taskCount: true,
  activity: true,
  subtasks: true,
  responsible: true,
  dueDate: true,
  status: true,
};

const cardDisplaySettingKeys = Object.keys(defaultCardDisplaySettings) as Array<
  keyof ProjectCardDisplaySettings
>;

const emptyBoardPreference: ProjectBoardPreference = {
  foldedStageIds: [],
  pinnedCardsByStage: {},
  cardOrderByStage: {},
};

function normalizeCardIdsByStage(value?: Record<string, string[]> | null) {
  return value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([stageId]) => typeof stageId === 'string')
          .map(([stageId, cardIds]) => [
            stageId,
            Array.isArray(cardIds)
              ? cardIds.filter(
                  (cardId): cardId is string => typeof cardId === 'string',
                )
              : [],
          ]),
      )
    : {};
}

function normalizeBoardPreference(
  value?: Partial<ProjectBoardPreference> | null,
): ProjectBoardPreference {
  return {
    foldedStageIds: Array.isArray(value?.foldedStageIds)
      ? value.foldedStageIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
    pinnedCardsByStage: normalizeCardIdsByStage(value?.pinnedCardsByStage),
    cardOrderByStage: normalizeCardIdsByStage(value?.cardOrderByStage),
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

    if (dto.stageTemplates !== undefined) {
      settings.stageTemplates = this.normalizeStageTemplates(
        dto.stageTemplates,
      );
    }

    if (dto.projectCardDisplayDefaults !== undefined) {
      settings.projectCardDisplayDefaults = this.normalizeCardDisplaySettings(
        dto.projectCardDisplayDefaults,
      );
    }

    if (dto.taskCardDisplayDefaults !== undefined) {
      settings.taskCardDisplayDefaults = this.normalizeCardDisplaySettings(
        dto.taskCardDisplayDefaults,
      );
    }

    return this.serializeSettings(await this.settingsRepository.save(settings));
  }

  async getPreferences(context: RequestContext) {
    const preferences = await this.findOrCreatePreferences(context);

    return this.serializePreferences(preferences);
  }

  async updatePreferences(
    context: RequestContext,
    dto: UpdateProjectPreferencesDto,
  ) {
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
      preferences.workspaceTaskBoard = normalizeBoardPreference(
        dto.workspaceTaskBoard,
      );
    }

    if (dto.personalTaskBoard !== undefined) {
      preferences.personalTaskBoard = normalizeBoardPreference(
        dto.personalTaskBoard,
      );
    }

    return this.serializePreferences(
      await this.preferencesRepository.save(preferences),
    );
  }

  private async findOrCreateSettings(context: RequestContext) {
    const existing = await this.settingsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (existing) return existing;

    // Use upsert to handle race conditions
    await this.settingsRepository.upsert(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectMarkers: defaultProjectMarkers,
        taskMarkers: defaultTaskMarkers,
        taskTypes: defaultTaskTypes,
        taskExecutionMode: 'hybrid',
        projectCardDisplayDefaults: defaultCardDisplaySettings,
        taskCardDisplayDefaults: defaultCardDisplaySettings,
      },
      ['tenantId', 'workspaceId'],
    );

    // Return the created/updated record
    return this.settingsRepository.findOneOrFail({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
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

    // Use upsert to handle race conditions
    await this.preferencesRepository.upsert(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        overviewColumnOrder: [],
        projectBoard: emptyBoardPreference,
        workspaceTaskBoard: emptyBoardPreference,
        personalTaskBoard: emptyBoardPreference,
      },
      ['tenantId', 'workspaceId', 'userId'],
    );

    // Return the created/updated record
    return this.preferencesRepository.findOneOrFail({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });
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

  private normalizeStageTemplates(
    templates: ProjectStageTemplate[],
  ): ProjectStageTemplate[] {
    if (!Array.isArray(templates)) return [];
    return templates
      .filter((template) => template && template.name?.trim())
      .map((template) => ({
        id: template.id || `stage-template-${Date.now()}`,
        name: template.name.trim(),
        stages: Array.isArray(template.stages)
          ? template.stages
              .filter((stage) => stage && stage.name?.trim())
              .map((stage) => ({
                name: stage.name.trim(),
                color: stage.color ?? null,
              }))
          : [],
      }));
  }

  private normalizeCardDisplaySettings(
    value?: Record<string, boolean> | null,
  ): ProjectCardDisplaySettings {
    return cardDisplaySettingKeys.reduce<ProjectCardDisplaySettings>(
      (normalized, key) => {
        normalized[key] =
          typeof value?.[key] === 'boolean'
            ? value[key]
            : defaultCardDisplaySettings[key];
        return normalized;
      },
      { ...defaultCardDisplaySettings },
    );
  }

  private serializeSettings(settings: AgencyProjectSettings) {
    return {
      projectMarkers: settings.projectMarkers?.length
        ? settings.projectMarkers
        : defaultProjectMarkers,
      taskMarkers: settings.taskMarkers?.length
        ? settings.taskMarkers
        : defaultTaskMarkers,
      taskTypes: settings.taskTypes?.length
        ? settings.taskTypes
        : defaultTaskTypes,
      taskExecutionMode:
        (settings.taskExecutionMode as ProjectTaskExecutionMode | undefined) ??
        'hybrid',
      stageTemplates: Array.isArray(settings.stageTemplates)
        ? settings.stageTemplates
        : [],
      projectCardDisplayDefaults: this.normalizeCardDisplaySettings(
        settings.projectCardDisplayDefaults,
      ),
      taskCardDisplayDefaults: this.normalizeCardDisplaySettings(
        settings.taskCardDisplayDefaults,
      ),
    };
  }

  private serializePreferences(preferences: AgencyProjectUserPreferences) {
    return {
      overviewColumnOrder: Array.isArray(preferences.overviewColumnOrder)
        ? preferences.overviewColumnOrder
        : [],
      projectBoard: normalizeBoardPreference(preferences.projectBoard),
      workspaceTaskBoard: normalizeBoardPreference(
        preferences.workspaceTaskBoard,
      ),
      personalTaskBoard: normalizeBoardPreference(
        preferences.personalTaskBoard,
      ),
    };
  }
}
