import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';
import {
  CreateKnowledgeVaultItemDto,
  GrantKnowledgeVaultPermissionDto,
  RevealKnowledgeVaultItemDto,
  UpdateKnowledgeVaultItemDto,
} from '../dto';
import {
  KnowledgeVaultReauthService,
  KnowledgeVaultService,
} from '../services';
import { KnowledgeContext } from '../services/knowledge-context';

function buildKnowledgeContext(
  headers: Record<string, string | string[] | undefined>,
): KnowledgeContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
    role: String(headers['x-user-role'] ?? ''),
  };
}

@Controller('agency/knowledge/vault')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeVaultController {
  constructor(
    private readonly vaultService: KnowledgeVaultService,
    private readonly reauthService: KnowledgeVaultReauthService,
  ) {}

  @Get()
  @RequirePermission('agency.knowledge.categories.manage.admin')
  list(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.vaultService.list(buildKnowledgeContext(headers));
  }

  @Post()
  @RequirePermission('agency.knowledge.categories.manage.admin')
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.create(buildKnowledgeContext(headers), dto);
  }

  @Patch(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.update(buildKnowledgeContext(headers), id, dto);
  }

  @Post(':id/permissions')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  grantPermission(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: GrantKnowledgeVaultPermissionDto,
  ) {
    return this.vaultService.grantPermission(
      buildKnowledgeContext(headers),
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  delete(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.vaultService.delete(buildKnowledgeContext(headers), id);
  }

  @Post(':id/reveal')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  async reveal(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: RevealKnowledgeVaultItemDto,
  ) {
    const context = buildKnowledgeContext(headers);

    await this.reauthService.verifyPassword(context, dto.password);

    return this.vaultService.reveal(context, id);
  }
}
