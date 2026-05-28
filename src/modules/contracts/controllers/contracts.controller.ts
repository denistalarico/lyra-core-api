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
import { ContractsService } from '../services/contracts.service';
import {
CreateContractPartyDto,
CreateContractRecordDto,
CreateContractTemplateDto,
CreateContractTemplateVersionDto,
ListContractsQueryDto,
ListContractTemplatesQueryDto,
MarkContractManuallySignedDto,
  MockSignatureProviderCallbackDto,
UpdateContractPartyDto,
  UpdateSignatureProviderSettingsDto,
UpdateContractRecordDto,
UpdateContractTemplateDto,
} from '../dto';

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

@Post(':id/mark-manually-signed')
markManuallySigned(
@Headers() headers: Record<string, string | string[] | undefined>,
@Param('id') id: string,
@Body() dto: MarkContractManuallySignedDto,
  MockSignatureProviderCallbackDto,
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
  UpdateSignatureProviderSettingsDto,
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

@Get(':id/events')
listEvents(
@Headers() headers: Record<string, string | string[] | undefined>,
@Param('id') id: string,
) {
return this.contractsService.listEvents(getContextFromHeaders(headers), id);
}
}
