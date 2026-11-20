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
  ImportFormGoogleAdsLeadsDto,
  ListFormSubmissionsQueryDto,
  ListFormsQueryDto,
  PatchFormDto,
  SetFormsAddonDto,
  UpdateFormGoogleAdsLeadsDto,
  UpdateFormInboundEmailDto,
} from './dto/forms.dto';
import {
  FormGoogleAdsLeadsService,
  withGoogleAdsLeadsView,
} from './services/form-google-ads-leads.service';
import { FormGoogleAdsLeadsImportService } from './services/form-google-ads-leads-import.service';
import { FormInboundEmailService } from './services/form-inbound-email.service';
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
    private readonly inboundEmail: FormInboundEmailService,
    private readonly googleAdsLeads: FormGoogleAdsLeadsService,
    private readonly googleAdsLeadsImport: FormGoogleAdsLeadsImportService,
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
    return this.forms
      .list(ctx, query)
      .then((items) => items.map(withGoogleAdsLeadsView));
  }

  @Post()
  @RequirePermission('agency.forms.forms.manage.admin')
  create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateFormDto,
  ) {
    return this.forms.create(ctx, dto).then(withGoogleAdsLeadsView);
  }

  /** F4: is the agency IMAP box set up, and how is the reader doing (§6.3). */
  @Get('inbound-email/status')
  @RequirePermission('agency.forms.forms.view')
  inboundEmailStatus(@RequestContextData() ctx: RequestContext) {
    return this.inboundEmail.status(ctx);
  }

  /** /settings/email helper: login + read-only INBOX open, nothing is read. */
  @Post('inbound-email/test-connection')
  @RequirePermission('agency.settings.email.manage.admin')
  testImapConnection(@RequestContextData() ctx: RequestContext) {
    return this.inboundEmail.testConnection(ctx);
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
    return this.forms.get(ctx, id).then(withGoogleAdsLeadsView);
  }

  @Patch(':id')
  @RequirePermission('agency.forms.forms.manage.admin')
  patch(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchFormDto,
  ) {
    return this.forms.patch(ctx, id, dto).then(withGoogleAdsLeadsView);
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
    return this.forms.publish(ctx, id).then(withGoogleAdsLeadsView);
  }

  @Post(':id/deactivate')
  @RequirePermission('agency.forms.forms.manage.admin')
  deactivate(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.deactivate(ctx, id).then(withGoogleAdsLeadsView);
  }

  @Post(':id/archive')
  @RequirePermission('agency.forms.forms.manage.admin')
  archive(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.archive(ctx, id).then(withGoogleAdsLeadsView);
  }

  @Post(':id/rotate-key')
  @RequirePermission('agency.forms.forms.manage.admin')
  rotateKey(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.rotateKey(ctx, id).then(withGoogleAdsLeadsView);
  }

  @Put(':id/inbound-email')
  @RequirePermission('agency.forms.forms.manage.admin')
  async updateInboundEmail(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFormInboundEmailDto,
  ) {
    return this.inboundEmail.configure(ctx, await this.forms.get(ctx, id), dto);
  }

  /** GL1: the key is shown once, in this response; only its hash is stored. */
  @Post(':id/google-ads-leads/key')
  @RequirePermission('agency.forms.forms.manage.admin')
  async generateGoogleAdsLeadsKey(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.googleAdsLeads.generateKey(await this.forms.get(ctx, id));
  }

  @Patch(':id/google-ads-leads')
  @RequirePermission('agency.forms.forms.manage.admin')
  async updateGoogleAdsLeads(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFormGoogleAdsLeadsDto,
  ) {
    return this.googleAdsLeads.updateSettings(
      await this.forms.get(ctx, id),
      dto,
    );
  }

  /** GL2: Google Ads connections in the form's scope, for the import picker. */
  @Get(':id/google-ads-leads/connections')
  @RequirePermission('agency.forms.forms.manage.admin')
  async listGoogleAdsLeadsConnections(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.googleAdsLeadsImport.listConnections(
      await this.forms.get(ctx, id),
    );
  }

  /** GL2: earlier leads through the API; also enables the daily reconciliation. */
  @Post(':id/google-ads-leads/import')
  @RequirePermission('agency.forms.forms.manage.admin')
  async importGoogleAdsLeads(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportFormGoogleAdsLeadsDto,
  ) {
    return this.googleAdsLeadsImport.importLeads(
      await this.forms.get(ctx, id),
      dto.connectionId,
    );
  }

  @Post(':id/inbound-email/test')
  @RequirePermission('agency.forms.forms.manage.admin')
  async testInboundEmail(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inboundEmail.sendTest(await this.forms.get(ctx, id));
  }

  /** Learning mode for the capture script: fields seen in recent captures. */
  @Get(':id/capture-fields')
  @RequirePermission('agency.forms.submissions.view')
  listCaptureFields(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.listCaptureFields(ctx, id);
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
