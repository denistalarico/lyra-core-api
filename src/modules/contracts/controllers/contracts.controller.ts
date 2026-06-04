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
  UpdateContractPartyDto,
  UpdateSignatureProviderSettingsDto,
  UpdateContractRecordDto,
  UpdateContractTemplateDto,
} from '../dto';
import { ContractSignatureProvider } from '../enums';

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

@Controller('agency/contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  // ─── Template presets (must come before /:id routes) ────────────────────────

  @Get('templates/presets')
  getTemplatePresets() {
    return this.contractsService.getTemplatePresets();
  }

  @Post('templates/from-preset')
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
  archiveTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.archiveTemplate(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Get('templates/:id')
  findTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.findTemplate(getContextFromHeaders(headers), id);
  }

  @Patch('templates/:id')
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
  listSignatureProviders() {
    return [{ provider: 'autentique', label: 'Autentique' }];
  }

  @Get('signature-providers/autentique')
  getAutentiqueSettings(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.contractsService.getSignatureProviderSettings(
      getContextFromHeaders(headers),
      ContractSignatureProvider.Autentique,
    );
  }

  @Put('signature-providers/autentique')
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
  listEvents(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.listEvents(getContextFromHeaders(headers), id);
  }

  @Post(':id/generate-html')
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

  @Post(':id/parties')
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
  findContract(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.contractsService.findContract(getContextFromHeaders(headers), id);
  }

  @Patch(':id')
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
