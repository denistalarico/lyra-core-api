import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@Controller('agency/knowledge/vault')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeVaultController {
  constructor(
    private readonly vaultService: KnowledgeVaultService,
    private readonly reauthService: KnowledgeVaultReauthService,
  ) {}

  @Get()
  @RequirePermission('agency.knowledge.categories.manage.admin')
  list(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.vaultService.list(context);
  }

  // ── Personal vault (any authenticated user, scoped to themselves) ────────

  @Get('personal')
  listPersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.vaultService.listPersonal(context);
  }

  @Post('personal')
  createPersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.createPersonal(context, dto);
  }

  @Patch('personal/:id')
  updatePersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.updatePersonal(
      context,
      id,
      dto,
    );
  }

  @Delete('personal/:id')
  @DangerousAction()
  deletePersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.vaultService.deletePersonal(context, id);
  }

  @Post('personal/:id/reveal')
  @DangerousAction()
  async revealPersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: RevealKnowledgeVaultItemDto,
  ) {
    await this.reauthService.verifyPassword(context, dto.password);
    return this.vaultService.revealPersonal(context, id);
  }

  @Post()
  @RequirePermission('agency.knowledge.categories.manage.admin')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.create(context, dto);
  }

  @Patch(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.update(context, id, dto);
  }

  @Post(':id/permissions')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  grantPermission(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: GrantKnowledgeVaultPermissionDto,
  ) {
    return this.vaultService.grantPermission(
      context,
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  delete(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.vaultService.delete(context, id);
  }

  @Post(':id/reveal')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  async reveal(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: RevealKnowledgeVaultItemDto,
  ) {

    await this.reauthService.verifyPassword(context, dto.password);

    return this.vaultService.reveal(context, id);
  }
}
