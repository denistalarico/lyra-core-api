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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedUser } from '../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../auth/types/auth-token-payload.type';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../permissions';
import {
  ChangeQuoteStatusDto,
  CreateQuoteDto,
  CreateQuoteItemDto,
  QuoteListQueryDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from './dto/quote.dto';
import { QuotesService } from './quotes.service';

type AgencyContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
};

@Controller('agency/sales/quotes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get('health')
  health() {
    return this.quotesService.health();
  }

  @Get('templates')
  @RequirePermission('agency.sales.quotes.create')
  listTemplates(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.quotesService.listTemplates(this.getContext(user, workspaceId));
  }

  @Get()
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  listQuotes(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Query() query: QuoteListQueryDto,
  ) {
    return this.quotesService.listQuotes(
      this.getContext(user, workspaceId),
      query,
    );
  }

  @Post()
  @RequirePermission('agency.sales.quotes.create')
  createQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.createQuote(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Post(':id/duplicate')
  @RequirePermission('agency.sales.quotes.create')
  duplicateQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.quotesService.duplicateQuote(
      this.getContext(user, workspaceId),
      id,
    );
  }

  @Get(':id/preview')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  getQuotePreview(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.quotesService.getQuotePreview(
      this.getContext(user, workspaceId),
      id,
    );
  }

  @Post(':id/convert')
  @RequirePermission('agency.sales.quotes.approve.department')
  convertQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.quotesService.convertQuote(
      this.getContext(user, workspaceId),
      id,
      body?.reason,
    );
  }

  @Post(':id/expire')
  @RequirePermission('agency.sales.quotes.approve.department')
  expireQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.quotesService.expireQuote(
      this.getContext(user, workspaceId),
      id,
      body?.reason,
    );
  }

  @Post(':id/pdf')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  async createQuotePdf(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Res({ passthrough: false }) response: Response,
  ) {
    const pdf = await this.quotesService.createPdf(
      this.getContext(user, workspaceId),
      id,
    );

    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.filename}"`,
      'Cache-Control': 'no-store',
    });

    return response.send(pdf.buffer);
  }

  @Get(':id')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  getQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.quotesService.getQuote(this.getContext(user, workspaceId), id);
  }

  @Patch(':id')
  @RequirePermission('agency.sales.crm.manage.department')
  updateQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotesService.updateQuote(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermission('agency.sales.crm.manage.department')
  @DangerousAction()
  deleteQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.quotesService.deleteQuote(
      this.getContext(user, workspaceId),
      id,
    );
  }

  @Post(':id/items')
  @RequirePermission('agency.sales.crm.manage.department')
  addItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: CreateQuoteItemDto,
  ) {
    return this.quotesService.addItem(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('agency.sales.crm.manage.department')
  updateItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateQuoteItemDto,
  ) {
    return this.quotesService.updateItem(
      this.getContext(user, workspaceId),
      id,
      itemId,
      dto,
    );
  }

  @Delete(':id/items/:itemId')
  @RequirePermission('agency.sales.crm.manage.department')
  @DangerousAction()
  deleteItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.quotesService.deleteItem(
      this.getContext(user, workspaceId),
      id,
      itemId,
    );
  }

  @Post(':id/send')
  @RequirePermission('agency.sales.quotes.approve.department')
  sendQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: ChangeQuoteStatusDto,
  ) {
    return this.quotesService.sendQuote(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Post(':id/accept')
  @RequirePermission('agency.sales.quotes.approve.department')
  acceptQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: ChangeQuoteStatusDto,
  ) {
    return this.quotesService.acceptQuote(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Post(':id/reject')
  @RequirePermission('agency.sales.quotes.approve.department')
  rejectQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: ChangeQuoteStatusDto,
  ) {
    return this.quotesService.rejectQuote(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Post(':id/archive')
  @RequirePermission('agency.sales.quotes.approve.department')
  @DangerousAction()
  archiveQuote(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: ChangeQuoteStatusDto,
  ) {
    return this.quotesService.archiveQuote(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  private getContext(
    user: AuthTokenPayload,
    workspaceId?: string,
  ): AgencyContext {
    return {
      tenantId: user.tenantId,
      workspaceId: workspaceId ?? user.workspaceId,
      userId: user.sub,
    };
  }
}
