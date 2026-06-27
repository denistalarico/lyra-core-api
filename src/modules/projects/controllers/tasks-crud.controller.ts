import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
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

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role?: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
    role: String(headers['x-user-role'] ?? headers['x-role'] ?? 'member'),
  };
}

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
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksCrudService.listWorkspaceTasks(
      getContextFromHeaders(headers),
      query,
    );
  }

  @Get('active-timers')
  @RequirePermission('agency.tasks.time.track.self')
  listActiveTimers(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.taskWorkspaceService.listActiveTimers(
      getContextFromHeaders(headers),
    );
  }

  @Get('my-assigned-subtasks')
  @RequirePermission('agency.tasks.task.update.assigned')
  listMyAssignedSubtasks(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.taskWorkspaceService.getMyAssignedSubtaskCards(
      getContextFromHeaders(headers),
    );
  }

  @Get('my')
  @RequirePermission('agency.tasks.task.update.assigned')
  listMyTasks(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksCrudService.listMyTasks(
      getContextFromHeaders(headers),
      query,
    );
  }

  @Post()
  @RequirePermission('agency.tasks.task.create.assigned')
  createWorkspaceTask(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksCrudService.createWorkspaceTask(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Post('my')
  @RequirePermission('agency.tasks.task.create.assigned')
  createMyTask(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksCrudService.createMyTask(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Get(':id')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  findOne(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.findOne(getContextFromHeaders(headers), id);
  }

  @Patch(':id')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksCrudService.update(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/cover')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @UseInterceptors(FileInterceptor('file', TASK_COVER_UPLOAD_OPTIONS))
  uploadCover(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }

    return this.tasksCrudService.uploadCover(
      getContextFromHeaders(headers),
      id,
      file,
    );
  }

  @Delete(':id')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @DangerousAction()
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.archive(getContextFromHeaders(headers), id);
  }

  @Delete(':id/permanent')
  @RequirePermission('agency.tasks.task.manage.department')
  @DangerousAction()
  remove(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.remove(getContextFromHeaders(headers), id);
  }

  // ── Task Attachments ───────────────────────────────────────────────────────

  @Get(':id/attachments')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  listAttachments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.taskAttachmentsService.listAttachments(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/attachments')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @UseInterceptors(FileInterceptor('file', TASK_ATTACHMENT_UPLOAD_OPTIONS))
  uploadAttachment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.taskAttachmentsService.uploadAttachment(
      getContextFromHeaders(headers),
      id,
      file,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @DangerousAction()
  deleteAttachment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.taskAttachmentsService.deleteAttachment(
      getContextFromHeaders(headers),
      id,
      attachmentId,
    );
  }
}
