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
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateTeamPaymentDocumentDto,
  CreateTeamPaymentDto,
  CreateTeamPaymentItemDto,
  GenerateTeamPaymentsDto,
  ListTeamPaymentsQueryDto,
  UpdateTeamPaymentDto,
  UpdateTeamPaymentItemDto,
} from '../dto';
import { TeamPaymentsService } from '../services/team-payments.service';

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

@Controller('agency/team/payments')
export class TeamPaymentsController {
  constructor(private readonly teamPaymentsService: TeamPaymentsService) {}

  @Get('batches')
  listBatches(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.teamPaymentsService.listBatches(getContextFromHeaders(headers));
  }

  @Post('generate')
  generatePayments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: GenerateTeamPaymentsDto,
  ) {
    return this.teamPaymentsService.generatePayments(getContextFromHeaders(headers), dto);
  }

  @Get()
  listPayments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTeamPaymentsQueryDto,
  ) {
    return this.teamPaymentsService.listPayments(getContextFromHeaders(headers), query);
  }

  @Post()
  createPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamPaymentDto,
  ) {
    return this.teamPaymentsService.createPayment(getContextFromHeaders(headers), dto);
  }

  @Get(':id')
  getPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.getPayment(getContextFromHeaders(headers), id);
  }

  @Patch(':id')
  updatePayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamPaymentDto,
  ) {
    return this.teamPaymentsService.updatePayment(getContextFromHeaders(headers), id, dto);
  }

  @Delete(':id')
  deletePayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.deletePayment(getContextFromHeaders(headers), id);
  }

  @Post(':id/archive')
  archivePayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.archivePayment(getContextFromHeaders(headers), id);
  }

  @Post(':id/confirm')
  confirmPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.confirmPayment(getContextFromHeaders(headers), id);
  }

  @Post(':id/mark-paid')
  markPaid(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.markPaid(getContextFromHeaders(headers), id);
  }

  @Post(':id/cancel')
  cancelPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.cancelPayment(getContextFromHeaders(headers), id);
  }

  @Post(':id/back-to-draft')
  backToDraft(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.backToDraft(getContextFromHeaders(headers), id);
  }

  @Post(':id/items')
  createItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateTeamPaymentItemDto,
  ) {
    return this.teamPaymentsService.createItem(getContextFromHeaders(headers), id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTeamPaymentItemDto,
  ) {
    return this.teamPaymentsService.updateItem(
      getContextFromHeaders(headers),
      id,
      itemId,
      dto,
    );
  }

  @Delete(':id/items/:itemId')
  deleteItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.teamPaymentsService.deleteItem(getContextFromHeaders(headers), id, itemId);
  }

  @Get(':id/finance')
  getPaymentFinanceStatus(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.getPaymentFinanceStatus(getContextFromHeaders(headers), id);
  }

  @Post(':id/documents')
  createDocument(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateTeamPaymentDocumentDto,
  ) {
    return this.teamPaymentsService.createDocument(getContextFromHeaders(headers), id, dto);
  }

  @Delete(':id/documents/:documentId')
  deleteDocument(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.teamPaymentsService.deleteDocument(
      getContextFromHeaders(headers),
      id,
      documentId,
    );
  }

  @Get(':id/documents/:documentId/pdf')
  async getDocumentPdf(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.teamPaymentsService.generateDocumentPdf(
      getContextFromHeaders(headers),
      id,
      documentId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="document-${documentId}.pdf"`);
    res.send(buffer);
  }
}
