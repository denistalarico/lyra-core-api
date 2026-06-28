import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

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
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateContractTemplateFromPresetDto,
  ) {
    return this.contractsService.createTemplateFromPreset(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Post('templates/custom')
  @RequirePermission('agency.contracts.templates.manage.admin')
  createCustomTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateCustomContractTemplateDto,
  ) {
    return this.contractsService.createCustomTemplate(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Post('templates/preview')
  @RequirePermission('agency.contracts.templates.manage.admin')
  previewTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: PreviewContractTemplateDto,
  ) {
    return this.contractsService.previewTemplate(
      getContextFromHeaders(headers),
      dto,
    );
  }

  // ─── Template CRUD ───────────────────────────────────────────────────────────

  @Get('templates')
  @RequirePermission('agency.contracts.templates.manage.admin')
  listTemplates(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListContractTemplatesQueryDto,
  ) {
    return this.contractsService.listTemplates(
      getContextFromHeaders(headers),
      query,
    );
  }

  @Post('templates')
  @RequirePermission('agency.contracts.templates.manage.admin')
  createTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateContractTemplateDto,
  ) {
    return this.contractsService.createTemplate(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Get('templates/:id/schema')
  @RequirePermission('agency.contracts.templates.manage.admin')
  getTemplateSchema(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.getTemplateSchema(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post('templates/:id/validate-variables')
  @RequirePermission('agency.contracts.templates.manage.admin')
  validateTemplateVariables(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() body: { variablesData: Record<string, unknown>; templateVersionId?: string },
  ) {
    return this.contractsService.validateTemplateVariables(
      getContextFromHeaders(headers),
      id,
      body.variablesData ?? {},
      body.templateVersionId ?? null,
    );
  }

  @Get('templates/:id/versions')
  @RequirePermission('agency.contracts.templates.manage.admin')
  listTemplateVersions(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.listTemplateVersions(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post('templates/:id/versions')
  @RequirePermission('agency.contracts.templates.manage.admin')
  createTemplateVersion(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateContractTemplateVersionDto,
  ) {
    return this.contractsService.createTemplateVersion(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post('templates/:id/activate')
  @RequirePermission('agency.contracts.templates.manage.admin')
  activateTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.activateTemplate(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post('templates/:id/archive')
  @DangerousAction()
  @RequirePermission('agency.contracts.archive.admin')
  archiveTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.archiveTemplate(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Delete('templates/:id')
  @DangerousAction()
  @RequirePermission('agency.contracts.templates.manage.admin')
  deleteTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.deleteTemplate(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Get('templates/:id')
  @RequirePermission('agency.contracts.templates.manage.admin')
  findTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.findTemplate(getContextFromHeaders(headers), id);
  }

  @Patch('templates/:id')
  @RequirePermission('agency.contracts.templates.manage.admin')
  updateTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateContractTemplateDto,
  ) {
    return this.contractsService.updateTemplate(
      getContextFromHeaders(headers),
      id,
      dto,
    );
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
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.contractsService.getSignatureProviderSettings(
      getContextFromHeaders(headers),
      ContractSignatureProvider.Autentique,
    );
  }

  @Put('signature-providers/autentique')
  @RequirePermission('agency.contracts.integrations.manage.owner_only')
  updateAutentiqueSettings(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: UpdateSignatureProviderSettingsDto,
  ) {
    return this.contractsService.updateSignatureProviderSettings(
      getContextFromHeaders(headers),
      ContractSignatureProvider.Autentique,
      dto,
    );
  }

  @Post('signature-providers/autentique/test')
  @RequirePermission('agency.contracts.integrations.manage.owner_only')
  testAutentiqueSettings(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.contractsService.testSignatureProviderSettings(
      getContextFromHeaders(headers),
      ContractSignatureProvider.Autentique,
    );
  }

  // ─── Contract records ────────────────────────────────────────────────────────

  @Post('from-template')
  @RequirePermission('agency.contracts.create.from_template')
  createContractFromTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateContractFromTemplateDto,
  ) {
    return this.contractsService.createContractFromTemplate(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Get()
  @RequirePermission('agency.contracts.view.assigned')
  listContracts(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListContractsQueryDto,
  ) {
    return this.contractsService.listContracts(
      getContextFromHeaders(headers),
      query,
    );
  }

  @Post()
  @RequirePermission('agency.contracts.create.from_template')
  createContract(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateContractRecordDto,
  ) {
    return this.contractsService.createContract(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Get(':id/events')
  @RequirePermission('agency.contracts.view.assigned')
  listEvents(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.listEvents(getContextFromHeaders(headers), id);
  }

  @Post(':id/generate-html')
  @RequirePermission('agency.contracts.view.assigned')
  generateContractHtml(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: GenerateContractHtmlDto,
  ) {
    return this.contractsService.generateContractHtml(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/generate-pdf')
  @RequirePermission('agency.contracts.view.assigned')
  generateContractPdf(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: GenerateContractPdfDto,
  ) {
    return this.contractsService.generateContractPdf(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/prepare-signature')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  prepareContractSignature(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: PrepareContractSignatureDto,
  ) {
    return this.contractsService.prepareContractSignature(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/send-signature')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  sendContractToSignatureProvider(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: SendContractToSignatureProviderDto,
  ) {
    return this.contractsService.sendContractToSignatureProvider(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/mark-manually-signed')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  markManuallySigned(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: MarkContractManuallySignedDto,
  ) {
    return this.contractsService.markManuallySigned(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/upload-manually-signed')
  @RequirePermission('agency.contracts.send_signature.manager_or_admin')
  uploadManuallySignedContract(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UploadManuallySignedContractDto,
  ) {
    return this.contractsService.uploadManuallySignedContract(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/upload-attachment')
  @RequirePermission('agency.contracts.create.from_template')
  uploadContractAttachment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UploadManuallySignedContractDto,
  ) {
    return this.contractsService.uploadContractAttachment(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Get(':id/documents/:documentId/file')
  @RequirePermission('agency.contracts.view.assigned')
  getContractDocumentFile(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.contractsService.getContractDocumentBase64(
      getContextFromHeaders(headers),
      id,
      documentId,
    );
  }

  @Post(':id/parties')
  @RequirePermission('agency.contracts.create.from_template')
  addParty(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateContractPartyDto,
  ) {
    return this.contractsService.addParty(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Patch(':id/parties/:partyId')
  @RequirePermission('agency.contracts.create.from_template')
  updateParty(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('partyId') partyId: string,
    @Body() dto: UpdateContractPartyDto,
  ) {
    return this.contractsService.updateParty(
      getContextFromHeaders(headers),
      id,
      partyId,
      dto,
    );
  }

  @Delete(':id/parties/:partyId')
  @DangerousAction()
  @RequirePermission('agency.contracts.archive.admin')
  removeParty(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('partyId') partyId: string,
  ) {
    return this.contractsService.removeParty(
      getContextFromHeaders(headers),
      id,
      partyId,
    );
  }

  @Get(':id')
  @RequirePermission('agency.contracts.view.assigned')
  findContract(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.findContract(getContextFromHeaders(headers), id);
  }

  @Patch(':id')
  @RequirePermission('agency.contracts.create.from_template')
  updateContract(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateContractRecordDto,
  ) {
    return this.contractsService.updateContract(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/cancel')
  @DangerousAction()
  @RequirePermission('agency.contracts.delete.owner_only')
  cancelContract(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.cancelContract(
      getContextFromHeaders(headers),
      id,
    );
  }
}
