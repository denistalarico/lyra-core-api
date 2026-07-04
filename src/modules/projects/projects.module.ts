import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectAttachment,
  AgencyProjectEvent,
  AgencyProjectFollower,
  AgencyProjectSettings,
  AgencyProjectStage,
  AgencyProjectUserPreferences,
  AgencyTask,
  AgencyTaskAttachment,
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
import { ProjectFollowersAttachmentsController } from './controllers/project-followers-attachments.controller';
import { ProjectsPublicController } from './controllers/projects-public.controller';
import { ProjectFollowersAttachmentsService } from './services/project-followers-attachments.service';
import { ProjectsDashboardQueryService } from './services/projects-dashboard-query.service';
import { ProjectsService } from './services/projects.service';
import { ProjectsCrudService } from './services/projects-crud.service';
import { ProjectStagesService } from './services/project-stages.service';
import { TasksCrudService } from './services/tasks-crud.service';
import { TaskAttachmentsService } from './services/task-attachments.service';
import { TaskWorkspaceService } from './services/task-workspace.service';
import { ProjectBoardsService } from './services/project-boards.service';
import { ProjectSeedsService } from './services/project-seeds.service';
import { ProjectSettingsService } from './services/project-settings.service';
import { ProjectEventsService } from './services/project-events.service';
import { FilesModule } from '../../common/files/files.module';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { TaskNotificationPublisher } from './services/task-notification.publisher';
import { ProjectNotificationPublisher } from './services/project-notification.publisher';
import { DeadlineNotificationScheduler } from './services/deadline-notification.scheduler';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        AgencyProject,
        AgencyProjectEvent,
        AgencyProjectFollower,
        AgencyProjectAttachment,
        AgencyProjectSettings,
        AgencyProjectUserPreferences,
        AgencyProjectStage,
        AgencyTask,
        AgencyTaskAttachment,
        AgencyTaskStage,
        AgencyPersonalTaskStage,
        AgencyTaskChecklistItem,
        AgencyTaskComment,
        AgencyTaskTimeEntry,
      ],
      AGENCY_CONNECTION,
    ),
    FilesModule,
    NotificationsModule,
    PermissionsModule,
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
    ProjectFollowersAttachmentsController,
    ProjectsCrudController,
    ProjectsPublicController,
  ],
  providers: [
    ProjectsService,
    ProjectsCrudService,
    ProjectStagesService,
    TasksCrudService,
    TaskAttachmentsService,
    TaskWorkspaceService,
    ProjectBoardsService,
    ProjectSeedsService,
    ProjectSettingsService,
    ProjectEventsService,
    ProjectFollowersAttachmentsService,
    ProjectsDashboardQueryService,
    TaskNotificationPublisher,
    ProjectNotificationPublisher,
    DeadlineNotificationScheduler,
  ],
  exports: [
    ProjectsService,
    ProjectsCrudService,
    ProjectStagesService,
    TasksCrudService,
    TaskAttachmentsService,
    TaskWorkspaceService,
    ProjectBoardsService,
    ProjectSeedsService,
    ProjectSettingsService,
    ProjectEventsService,
    ProjectFollowersAttachmentsService,
    ProjectsDashboardQueryService,
  ],
})
export class ProjectsModule {}
