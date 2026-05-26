import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TasksCrudService } from '../services/tasks-crud.service';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from '../dto';

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
  constructor(private readonly tasksCrudService: TasksCrudService) {}

  @Get()
  listWorkspaceTasks(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksCrudService.listWorkspaceTasks(getContextFromHeaders(headers), query);
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

  @Delete(':id')
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.tasksCrudService.archive(getContextFromHeaders(headers), id);
  }
}
