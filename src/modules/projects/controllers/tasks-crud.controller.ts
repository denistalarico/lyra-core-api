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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { TasksCrudService } from '../services/tasks-crud.service';
import { TaskAttachmentsService } from '../services/task-attachments.service';
import { TaskWorkspaceService } from '../services/task-workspace.service';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from '../dto';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../../common/files/files.service';

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
};

function getContextFromHeaders(headers: Record<string, string | string[] | undefined>): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

@Controller('agency/projects/tasks')
export class TasksCrudController {
  constructor(
    private readonly tasksCrudService: TasksCrudService,
    private readonly taskAttachmentsService: TaskAttachmentsService,
    private readonly taskWorkspaceService: TaskWorkspaceService,
  ) {}

  @Get()
  listWorkspaceTasks(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksCrudService.listWorkspaceTasks(getContextFromHeaders(headers), query);
  }

  @Get('active-timers')
  listActiveTimers(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.taskWorkspaceService.listActiveTimers(getContextFromHeaders(headers));
  }

  @Get('my')
  listMyTasks(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksCrudService.listMyTasks(getContextFromHeaders(headers), query);
  }

  @Post()
  createWorkspaceTask(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksCrudService.createWorkspaceTask(getContextFromHeaders(headers), dto);
  }

  @Post('my')
  createMyTask(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksCrudService.createMyTask(getContextFromHeaders(headers), dto);
  }

  @Get(':id')
  findOne(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.findOne(getContextFromHeaders(headers), id);
  }

  @Patch(':id')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksCrudService.update(getContextFromHeaders(headers), id, dto);
  }

  @Post(':id/cover')
  @UseInterceptors(FileInterceptor('file', TASK_COVER_UPLOAD_OPTIONS))
  uploadCover(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }

    return this.tasksCrudService.uploadCover(getContextFromHeaders(headers), id, file);
  }

  @Delete(':id')
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.archive(getContextFromHeaders(headers), id);
  }

  // ── Task Attachments ───────────────────────────────────────────────────────

  @Get(':id/attachments')
  listAttachments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.taskAttachmentsService.listAttachments(getContextFromHeaders(headers), id);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', TASK_ATTACHMENT_UPLOAD_OPTIONS))
  uploadAttachment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.taskAttachmentsService.uploadAttachment(getContextFromHeaders(headers), id, file);
  }

  @Delete(':id/attachments/:attachmentId')
  deleteAttachment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.taskAttachmentsService.deleteAttachment(getContextFromHeaders(headers), id, attachmentId);
  }
}
