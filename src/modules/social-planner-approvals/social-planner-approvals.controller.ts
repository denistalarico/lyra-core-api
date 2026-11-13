import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
  SendContentBatchForApprovalDto,
  SendContentForApprovalDto,
} from './dto/social-planner-approval.dto';
import { SocialPlannerApprovalsService } from './social-planner-approvals.service';

const PLANNER_VIEW = 'social.planner.calendar.view.client';
const PLANNER_UPDATE = 'social.planner.calendar.update.manager';
const CAMPAIGN_VIEW = 'social.campaigns.campaign.view.client';
const CAMPAIGN_UPDATE = 'social.campaigns.campaign.update.manager';

/**
 * AR3 — sending to approval from the Planner. Agency only: none of these
 * routes is `@ClientAreaExposed`, so a client can never send.
 */
@Controller('social/planner')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialPlannerApprovalsController {
  constructor(private readonly service: SocialPlannerApprovalsService) {}

  @Get('plans/:planId/approval-state')
  @RequirePermission(PLANNER_VIEW)
  planState(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.service.planState(ctx, planId);
  }

  @Post('plans/:planId/send-for-approval')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PLANNER_UPDATE)
  sendPlan(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.service.sendPlanTable(ctx, planId);
  }

  @Get('campaigns/:campaignId/approval-state')
  @RequirePermission(CAMPAIGN_VIEW)
  campaignState(
    @RequestContextData() ctx: RequestContext,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ) {
    return this.service.campaignState(ctx, campaignId);
  }

  @Post('campaigns/:campaignId/send-for-approval')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(CAMPAIGN_UPDATE)
  sendCampaign(
    @RequestContextData() ctx: RequestContext,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ) {
    return this.service.sendCampaignTable(ctx, campaignId);
  }

  /** Literal segment: declared before `content/:contentId/...`. */
  @Post('content/batch/send-for-approval')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PLANNER_UPDATE)
  sendBatch(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SendContentBatchForApprovalDto,
  ) {
    return this.service.sendContentBatch(
      ctx,
      dto.contentIds,
      dto.mode ?? 'auto',
    );
  }

  @Get('content/:contentId/approval-state')
  @RequirePermission(PLANNER_VIEW)
  contentState(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.service.contentState(ctx, contentId);
  }

  /** The Studio key is added in the service when a creative goes along. */
  @Post('content/:contentId/send-for-approval')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PLANNER_UPDATE)
  sendContent(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: SendContentForApprovalDto,
  ) {
    return this.service.sendContent(ctx, contentId, dto.mode ?? 'auto');
  }
}
