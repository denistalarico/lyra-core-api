import { CompanyProductClientAccessGuard } from './company-product-client-access.guard';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import {
  RemoveCompanyProductDto,
  ArchiveClientProductsDto,
  CompanyProductActionDto,
} from '../dto/company-product.dto';
import {
  ClientCompanyProductsService,
  companyProductKey,
} from '../services/client-company-products.service';

@Controller('agency/clients/:clientId')
@UseGuards(JwtAuthGuard, PermissionsGuard, CompanyProductClientAccessGuard)
export class ClientCompanyProductsController {
  constructor(private readonly products: ClientCompanyProductsService) {}
  @Get('products/companies')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  matrix(
    @AuthorizedContext() ctx: AuthorizedRequestContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.products.matrix(ctx, clientId);
  }
  @Get('companies/:companyContextId/products/:productKey/pending-work')
  @RequirePermission('agency.clients.products.manage.admin')
  pending(
    @AuthorizedContext() ctx: AuthorizedRequestContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('companyContextId', ParseUUIDPipe) companyId: string,
    @Param('productKey') key: string,
  ) {
    return this.products.pending(
      ctx,
      clientId,
      companyId,
      companyProductKey(key),
    );
  }
  @Post('companies/:companyContextId/products/:productKey/activate')
  @HttpCode(200)
  @RequirePermission('agency.clients.products.manage.admin')
  activate(
    @AuthorizedContext() ctx: AuthorizedRequestContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('companyContextId', ParseUUIDPipe) companyId: string,
    @Param('productKey') key: string,
  ) {
    return this.products.activate(
      ctx,
      clientId,
      companyId,
      companyProductKey(key),
    );
  }
  @Post('companies/:companyContextId/products/:productKey/remove')
  @HttpCode(200)
  @RequirePermission('agency.clients.products.manage.admin')
  remove(
    @AuthorizedContext() ctx: AuthorizedRequestContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('companyContextId', ParseUUIDPipe) companyId: string,
    @Param('productKey') key: string,
    @Body() dto: RemoveCompanyProductDto,
  ) {
    return this.products.remove(
      ctx,
      clientId,
      companyId,
      companyProductKey(key),
      dto.mode,
      dto.reason,
    );
  }
  @Post('companies/:companyContextId/products/:productKey/:action')
  @HttpCode(200)
  @RequirePermission('agency.clients.products.manage.admin')
  action(
    @AuthorizedContext() ctx: AuthorizedRequestContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('companyContextId', ParseUUIDPipe) companyId: string,
    @Param('productKey') key: string,
    @Param('action') action: string,
    @Body() dto: CompanyProductActionDto,
  ) {
    if (action === 'remove-now' && dto.confirm !== true)
      throw new BadRequestException('Explicit confirmation is required.');
    return this.products.action(
      ctx,
      clientId,
      companyId,
      companyProductKey(key),
      this.actionKey(action),
    );
  }
  private actionKey(action: string): 'retry' | 'remove-now' | 'cancel-removal' {
    if (
      action === 'retry' ||
      action === 'remove-now' ||
      action === 'cancel-removal'
    )
      return action;
    throw new NotFoundException();
  }
  @Post('archive')
  @HttpCode(200)
  @RequirePermission('agency.clients.profile.archive.admin')
  archive(
    @AuthorizedContext() ctx: AuthorizedRequestContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: ArchiveClientProductsDto,
  ) {
    return this.products.archive(ctx, clientId, dto.mode);
  }
  @Post('archive/:action')
  @HttpCode(200)
  @RequirePermission('agency.clients.profile.archive.admin')
  archiveAction(
    @AuthorizedContext() ctx: AuthorizedRequestContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('action') action: string,
  ) {
    return this.products.archiveAction(ctx, clientId, this.actionKey(action));
  }
}
