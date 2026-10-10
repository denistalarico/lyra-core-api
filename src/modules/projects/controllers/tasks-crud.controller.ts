import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { TasksCrudService } from '../services/tasks-crud.service';
import { TaskAttachmentsService } from '../services/task-attachments.service';
import { TaskWorkspaceService } from '../services/task-workspace.service';
import { CreateTaskDto, ListTasksQueryDto, UpdateTaskDto } from '../dto';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../../common/files/files.service';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

const TASK_ATTACHMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
};

const TASK_COVER_UPLOAD_OPTIONS = {
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Unsupported image format.'), false);
      return;
    }

    callback(null, true);
  },
};

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects/tasks')
export class TasksCrudController {
  constructor(
    private readonly tasksCrudService: TasksCrudService,
    private readonly taskAttachmentsService: TaskAttachmentsService,
    private readonly taskWorkspaceService: TaskWorkspaceService,
  ) {}

  @Get()
  @RequirePermission('agency.tasks.task.manage.department')
  listWorkspaceTasks(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksCrudService.listWorkspaceTasks(context, query);
  }

  @Get('active-timers')
  @RequirePermission('agency.tasks.time.track.self')
  listActiveTimers(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.taskWorkspaceService.listActiveTimers(context);
  }

  @Get('my-assigned-subtasks')
  @RequirePermission('agency.tasks.task.update.assigned')
  listMyAssignedSubtasks(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.taskWorkspaceService.getMyAssignedSubtaskCards(context);
  }

  @Get('my')
  @RequirePermission('agency.tasks.task.update.assigned')
  listMyTasks(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksCrudService.listMyTasks(context, query);
  }

  @Post()
  @RequirePermission('agency.tasks.task.create.assigned')
  createWorkspaceTask(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksCrudService.createWorkspaceTask(context, dto);
  }

  @Post('my')
  @RequirePermission('agency.tasks.task.create.assigned')
  createMyTask(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksCrudService.createMyTask(context, dto);
  }

  @Get(':id')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  findOne(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.findOne(context, id);
  }

  @Patch(':id')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksCrudService.update(context, id, dto);
  }

  @Post(':id/cover')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @UseInterceptors(FileInterceptor('file', TASK_COVER_UPLOAD_OPTIONS))
  uploadCover(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }

    return this.tasksCrudService.uploadCover(context, id, file);
  }

  @Delete(':id')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @DangerousAction()
  archive(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.archive(context, id);
  }

  @Delete(':id/permanent')
  @RequirePermission('agency.tasks.task.manage.department')
  @DangerousAction()
  remove(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.remove(context, id);
  }

  // ── Task Attachments ───────────────────────────────────────────────────────

  @Get(':id/attachments')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  listAttachments(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.taskAttachmentsService.listAttachments(context, id);
  }

  @Post(':id/attachments')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @UseInterceptors(FileInterceptor('file', TASK_ATTACHMENT_UPLOAD_OPTIONS))
  uploadAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.taskAttachmentsService.uploadAttachment(context, id, file);
  }

  @Delete(':id/attachments/:attachmentId')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @DangerousAction()
  deleteAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.taskAttachmentsService.deleteAttachment(
      context,
      id,
      attachmentId,
    );
  }
}
