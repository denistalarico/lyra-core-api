import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CreatePlanWorkLinkDto,
  PlanWorkOptionsQueryDto,
  SendSubtaskApprovalItemDto,
} from './dto/social-project-work.dto';
import { SocialPlanWorkService } from './social-plan-work.service';
import { SocialSubtaskApprovalsService } from './social-subtask-approvals.service';

const PLANNER_VIEW = 'social.planner.calendar.view.client';
const PLANNER_UPDATE = 'social.planner.calendar.update.manager';

/**
 * AR4 — the plan's link to Projects, in the Social context. None of these
 * routes is `@ClientAreaExposed`, so a client can never link or reconcile.
 */
@Controller('social/planner')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialPlanWorkController {
  constructor(private readonly service: SocialPlanWorkService) {}

  /** No plan id: the new-plan modal runs before the plan exists. */
  @Get('work-link/options')
  @RequirePermission(PLANNER_UPDATE)
  options(
    @RequestContextData() ctx: RequestContext,
    @Query() query: PlanWorkOptionsQueryDto,
  ) {
    return this.service.options(ctx, query);
  }

  @Get('work-link/options/projects/:projectId/stages')
  @RequirePermission(PLANNER_UPDATE)
  stages(
    @RequestContextData() ctx: RequestContext,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.projectStages(ctx, projectId);
  }

  @Get('plans/:planId/work-link')
  @RequirePermission(PLANNER_VIEW)
  link(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.service.getLink(ctx, planId);
  }

  @Post('plans/:planId/work-link')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PLANNER_UPDATE)
  createLink(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: CreatePlanWorkLinkDto,
  ) {
    return this.service.createLink(ctx, planId, dto);
  }

  @Post('plans/:planId/work-link/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PLANNER_UPDATE)
  reconcile(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.service.reconcile(ctx, planId);
  }
}

/**
 * AR4 — the approval section of a subtask, reached from Projects.
 *
 * Only `JwtAuthGuard`: there is no context header on a task screen, so the
 * guard's header-based product check does not apply. The service proves task
 * visibility, the Social gate (R-11) and the permission for the scope it
 * resolves from the task itself. Deliberately absent from
 * `PROJECT_CLIENT_ROUTES`: the Client Area reads through its own route.
 */
@Controller('social/project-approvals')
@UseGuards(JwtAuthGuard)
export class SocialSubtaskApprovalsController {
  constructor(private readonly service: SocialSubtaskApprovalsService) {}

  @Get('tasks/:taskId/subtasks/:subtaskId')
  section(
    @RequestContextData() ctx: RequestContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
  ) {
    return this.service.section(ctx, taskId, subtaskId);
  }

  @Post('tasks/:taskId/subtasks/:subtaskId/items')
  @HttpCode(HttpStatus.OK)
  send(
    @RequestContextData() ctx: RequestContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
    @Body() dto: SendSubtaskApprovalItemDto,
  ) {
    return this.service.send(ctx, taskId, subtaskId, dto);
  }

  @Post('tasks/:taskId/reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(
    @RequestContextData() ctx: RequestContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.service.reconcileTask(ctx, taskId);
  }
}
