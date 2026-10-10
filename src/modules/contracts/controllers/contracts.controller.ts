import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContractsService } from '../services/contracts.service';
import {
  CreateContractFromTemplateDto,
  CreateContractPartyDto,
  CreateContractRecordDto,
  CreateContractTemplateDto,
  CreateContractTemplateFromPresetDto,
  CreateContractTemplateVersionDto,
  CreateCustomContractTemplateDto,
  GenerateContractHtmlDto,
  GenerateContractPdfDto,
  ListContractsQueryDto,
  ListContractTemplatesQueryDto,
  MarkContractManuallySignedDto,
  PrepareContractSignatureDto,
  PreviewContractTemplateDto,
  SendContractToSignatureProviderDto,
  UploadManuallySignedContractDto,
  UpdateContractPartyDto,
  UpdateSignatureProviderSettingsDto,
  UpdateContractRecordDto,
  UpdateContractTemplateDto,
} from '../dto';
import { ContractSignatureProvider } from '../enums';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  // TODO(permissions): enforce assigned/client/department contract scope when
  // scoped evaluators are available for contract records.
  // ─── Template presets (must come before /:id routes) ────────────────────────

  @Get('templates/presets')
  @RequirePermission('agency.contracts.create.from_template')
  getTemplatePresets() {
    return this.contractsService.getTemplatePresets();
  }

  @Post('templates/from-preset')
  @RequirePermission('agency.contracts.templates.manage.admin')
  createTemplateFromPreset(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateContractTemplateFromPresetDto,
  ) {
    return this.contractsService.createTemplateFromPreset(context, dto);
  }

  @Post('templates/custom')
  @RequirePermission('agency.contracts.templates.manage.admin')
  createCustomTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateCustomContractTemplateDto,
  ) {
    return this.contractsService.createCustomTemplate(context, dto);
  }

  @Post('templates/preview')
  @RequirePermission('agency.contracts.templates.manage.admin')
  previewTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: PreviewContractTemplateDto,
  ) {
    return this.contractsService.previewTemplate(context, dto);
  }

  // ─── Template CRUD ───────────────────────────────────────────────────────────

  @Get('templates')
  @RequirePermission('agency.contracts.templates.manage.admin')
  listTemplates(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListContractTemplatesQueryDto,
  ) {
    return this.contractsService.listTemplates(context, query);
  }

  @Post('templates')
  @RequirePermission('agency.contracts.templates.manage.admin')
  createTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateContractTemplateDto,
  ) {
    return this.contractsService.createTemplate(context, dto);
  }

  @Get('templates/:id/schema')
  @RequirePermission('agency.contracts.templates.manage.admin')
  getTemplateSchema(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.getTemplateSchema(context, id);
  }

  @Post('templates/:id/validate-variables')
  @RequirePermission('agency.contracts.templates.manage.admin')
  validateTemplateVariables(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body()
    body: {
      variablesData: Record<string, unknown>;
      templateVersionId?: string;
    },
  ) {
    return this.contractsService.validateTemplateVariables(
      context,
      id,
      body.variablesData ?? {},
      body.templateVersionId ?? null,
    );
  }

  @Get('templates/:id/versions')
  @RequirePermission('agency.contracts.templates.manage.admin')
  listTemplateVersions(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.listTemplateVersions(context, id);
  }

  @Post('templates/:id/versions')
  @RequirePermission('agency.contracts.templates.manage.admin')
  createTemplateVersion(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CreateContractTemplateVersionDto,
  ) {
    return this.contractsService.createTemplateVersion(context, id, dto);
  }

  @Post('templates/:id/activate')
  @RequirePermission('agency.contracts.templates.manage.admin')
  activateTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.activateTemplate(context, id);
  }

  @Post('templates/:id/archive')
  @DangerousAction()
  @RequirePermission('agency.contracts.archive.admin')
  archiveTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.archiveTemplate(context, id);
  }

  @Delete('templates/:id')
  @DangerousAction()
  @RequirePermission('agency.contracts.templates.manage.admin')
  deleteTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.deleteTemplate(context, id);
  }

  @Get('templates/:id')
  @RequirePermission('agency.contracts.templates.manage.admin')
  findTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.findTemplate(context, id);
  }

  @Patch('templates/:id')
  @RequirePermission('agency.contracts.templates.manage.admin')
  updateTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateContractTemplateDto,
  ) {
    return this.contractsService.updateTemplate(context, id, dto);
  }

  // ─── Signature providers (must come before /:id routes) ─────────────────────

  @Get('signature-providers')
  @RequirePermission('agency.contracts.integrations.manage.owner_only')
  listSignatureProviders() {
    return [{ provider: 'autentique', label: 'Autentique' }];
  }

  @Get('signature-providers/autentique')
  @RequirePermission('agency.contracts.integrations.manage.owner_only')
  getAutentiqueSettings(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.contractsService.getSignatureProviderSettings(
      context,
      ContractSignatureProvider.Autentique,
    );
  }

  @Put('signature-providers/autentique')
  @RequirePermission('agency.contracts.integrations.manage.owner_only')
  updateAutentiqueSettings(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: UpdateSignatureProviderSettingsDto,
  ) {
    return this.contractsService.updateSignatureProviderSettings(
      context,
      ContractSignatureProvider.Autentique,
      dto,
    );
  }

  @Post('signature-providers/autentique/test')
  @RequirePermission('agency.contracts.integrations.manage.owner_only')
  testAutentiqueSettings(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.contractsService.testSignatureProviderSettings(
      context,
      ContractSignatureProvider.Autentique,
    );
  }

  // ─── Contract records ────────────────────────────────────────────────────────

  @Post('from-template')
  @RequirePermission('agency.contracts.create.from_template')
  createContractFromTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateContractFromTemplateDto,
  ) {
    return this.contractsService.createContractFromTemplate(context, dto);
  }

  @Get()
  @RequirePermission('agency.contracts.view.assigned')
  listContracts(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListContractsQueryDto,
  ) {
    return this.contractsService.listContracts(context, query);
  }

  @Post()
  @RequirePermission('agency.contracts.create.from_template')
  createContract(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateContractRecordDto,
  ) {
    return this.contractsService.createContract(context, dto);
  }

  @Get(':id/events')
  @RequirePermission('agency.contracts.view.assigned')
  listEvents(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.listEvents(context, id);
  }

  @Post(':id/generate-html')
  @RequirePermission('agency.contracts.view.assigned')
  generateContractHtml(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: GenerateContractHtmlDto,
  ) {
    return this.contractsService.generateContractHtml(context, id, dto);
  }

  @Post(':id/generate-pdf')
  @RequirePermission('agency.contracts.view.assigned')
  generateContractPdf(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: GenerateContractPdfDto,
  ) {
    return this.contractsService.generateContractPdf(context, id, dto);
  }

  @Post(':id/prepare-signature')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  prepareContractSignature(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: PrepareContractSignatureDto,
  ) {
    return this.contractsService.prepareContractSignature(context, id, dto);
  }

  @Post(':id/send-signature')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  sendContractToSignatureProvider(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: SendContractToSignatureProviderDto,
  ) {
    return this.contractsService.sendContractToSignatureProvider(
      context,
      id,
      dto,
    );
  }

  @Post(':id/mark-manually-signed')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  markManuallySigned(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: MarkContractManuallySignedDto,
  ) {
    return this.contractsService.markManuallySigned(context, id, dto);
  }

  @Post(':id/upload-manually-signed')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  uploadManuallySignedContract(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UploadManuallySignedContractDto,
  ) {
    return this.contractsService.uploadManuallySignedContract(context, id, dto);
  }

  @Post(':id/upload-attachment')
  @RequirePermission('agency.contracts.create.from_template')
  uploadContractAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UploadManuallySignedContractDto,
  ) {
    return this.contractsService.uploadContractAttachment(context, id, dto);
  }

  @Get(':id/documents/:documentId/file')
  @RequirePermission('agency.contracts.view.assigned')
  getContractDocumentFile(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.contractsService.getContractDocumentBase64(
      context,
      id,
      documentId,
    );
  }

  @Post(':id/parties')
  @RequirePermission('agency.contracts.create.from_template')
  addParty(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CreateContractPartyDto,
  ) {
    return this.contractsService.addParty(context, id, dto);
  }

  @Patch(':id/parties/:partyId')
  @RequirePermission('agency.contracts.create.from_template')
  updateParty(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('partyId') partyId: string,
    @Body() dto: UpdateContractPartyDto,
  ) {
    return this.contractsService.updateParty(context, id, partyId, dto);
  }

  @Delete(':id/parties/:partyId')
  @DangerousAction()
  @RequirePermission('agency.contracts.archive.admin')
  removeParty(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('partyId') partyId: string,
  ) {
    return this.contractsService.removeParty(context, id, partyId);
  }

  @Get(':id')
  @RequirePermission('agency.contracts.view.assigned')
  findContract(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.findContract(context, id);
  }

  @Patch(':id')
  @RequirePermission('agency.contracts.create.from_template')
  updateContract(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateContractRecordDto,
  ) {
    return this.contractsService.updateContract(context, id, dto);
  }

  @Post(':id/cancel')
  @DangerousAction()
  @RequirePermission('agency.contracts.delete.owner_only')
  cancelContract(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.contractsService.cancelContract(context, id);
  }
}
