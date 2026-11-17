import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions';
import {
  CreateFormDto,
  ListFormSubmissionsQueryDto,
  ListFormsQueryDto,
  PatchFormDto,
  SetFormsAddonDto,
} from './dto/forms.dto';
import { FormsAddonService } from './services/forms-addon.service';
import { FormsService } from './services/forms.service';

function requireWorkspace(ctx: RequestContext) {
  if (!ctx.workspaceId)
    throw new BadRequestException('Workspace context is required.');
  return ctx.workspaceId;
}

/** Forms addon (agency side). Scope always comes from the authenticated context. */
@Controller('forms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly addon: FormsAddonService,
  ) {}

  @Get('addon')
  @RequirePermission('agency.forms.forms.view')
  async getAddon(@RequestContextData() ctx: RequestContext) {
    return {
      enabled: await this.addon.isEnabled(ctx.tenantId, requireWorkspace(ctx)),
    };
  }

  /** Settings > Apps & integrations card (D-F11). */
  @Put('addon')
  @RequirePermission('agency.settings.apps.manage.admin')
  setAddon(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SetFormsAddonDto,
  ) {
    return this.addon.setEnabled(
      ctx.tenantId,
      requireWorkspace(ctx),
      dto.enabled,
    );
  }

  @Get()
  @RequirePermission('agency.forms.forms.view')
  list(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListFormsQueryDto,
  ) {
    return this.forms.list(ctx, query);
  }

  @Post()
  @RequirePermission('agency.forms.forms.manage.admin')
  create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateFormDto,
  ) {
    return this.forms.create(ctx, dto);
  }

  @Get('submissions/:submissionId')
  @RequirePermission('agency.forms.submissions.view')
  getSubmission(
    @RequestContextData() ctx: RequestContext,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return this.forms.getSubmission(ctx, submissionId);
  }

  @Post('submissions/:submissionId/reprocess')
  @RequirePermission('agency.forms.submissions.reprocess')
  reprocess(
    @RequestContextData() ctx: RequestContext,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return this.forms.reprocessSubmission(ctx, submissionId);
  }

  @Post('submissions/:submissionId/mark-spam')
  @RequirePermission('agency.forms.submissions.reprocess')
  markSpam(
    @RequestContextData() ctx: RequestContext,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return this.forms.markSpam(ctx, submissionId);
  }

  @Get(':id')
  @RequirePermission('agency.forms.forms.view')
  get(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('agency.forms.forms.manage.admin')
  patch(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchFormDto,
  ) {
    return this.forms.patch(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('agency.forms.forms.manage.admin')
  remove(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.remove(ctx, id);
  }

  @Post(':id/publish')
  @RequirePermission('agency.forms.forms.manage.admin')
  publish(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.publish(ctx, id);
  }

  @Post(':id/deactivate')
  @RequirePermission('agency.forms.forms.manage.admin')
  deactivate(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.deactivate(ctx, id);
  }

  @Post(':id/archive')
  @RequirePermission('agency.forms.forms.manage.admin')
  archive(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.archive(ctx, id);
  }

  @Post(':id/rotate-key')
  @RequirePermission('agency.forms.forms.manage.admin')
  rotateKey(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.rotateKey(ctx, id);
  }

  @Get(':id/submissions')
  @RequirePermission('agency.forms.submissions.view')
  listSubmissions(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListFormSubmissionsQueryDto,
  ) {
    return this.forms.listSubmissions(ctx, id, query);
  }
}
