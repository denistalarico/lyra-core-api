import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectEvent,
  AgencyProjectSettings,
  AgencyProjectStage,
  AgencyProjectUserPreferences,
  AgencyTask,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskStage,
  AgencyTaskTimeEntry,
} from './entities';
import { ProjectsController } from './controllers/projects.controller';
import { ProjectsCrudController } from './controllers/projects-crud.controller';
import { ProjectStagesController } from './controllers/project-stages.controller';
import { TasksCrudController } from './controllers/tasks-crud.controller';
import { TaskWorkspaceController } from './controllers/task-workspace.controller';
import { ProjectBoardsController } from './controllers/project-boards.controller';
import { ProjectSeedsController } from './controllers/project-seeds.controller';
import { ProjectSettingsController } from './controllers/project-settings.controller';
import { ProjectEventsController } from './controllers/project-events.controller';
import { ProjectsService } from './services/projects.service';
import { ProjectsCrudService } from './services/projects-crud.service';
import { ProjectStagesService } from './services/project-stages.service';
import { TasksCrudService } from './services/tasks-crud.service';
import { TaskWorkspaceService } from './services/task-workspace.service';
import { ProjectBoardsService } from './services/project-boards.service';
import { ProjectSeedsService } from './services/project-seeds.service';
import { ProjectSettingsService } from './services/project-settings.service';
import { ProjectEventsService } from './services/project-events.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        AgencyProject,
        AgencyProjectEvent,
        AgencyProjectSettings,
        AgencyProjectUserPreferences,
        AgencyProjectStage,
        AgencyTask,
        AgencyTaskStage,
        AgencyPersonalTaskStage,
        AgencyTaskChecklistItem,
        AgencyTaskComment,
        AgencyTaskTimeEntry,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [
    ProjectsController,
    ProjectStagesController,
    ProjectBoardsController,
    TasksCrudController,
    TaskWorkspaceController,
    ProjectSeedsController,
    ProjectSettingsController,
    ProjectEventsController,
    ProjectsCrudController,
  ],
  providers: [
    ProjectsService,
    ProjectsCrudService,
    ProjectStagesService,
    TasksCrudService,
    TaskWorkspaceService,
    ProjectBoardsService,
    ProjectSeedsService,
    ProjectSettingsService,
    ProjectEventsService,
  ],
  exports: [
    ProjectsService,
    ProjectsCrudService,
    ProjectStagesService,
    TasksCrudService,
    TaskWorkspaceService,
    ProjectBoardsService,
    ProjectSeedsService,
    ProjectSettingsService,
    ProjectEventsService,
  ],
})
export class ProjectsModule {}
