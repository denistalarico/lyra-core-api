import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateTeamPaymentDocumentDto,
  CreateTeamPaymentDto,
  CreateTeamPaymentItemDto,
  GenerateTeamPaymentsDto,
  ListTeamPaymentsQueryDto,
  MarkTeamPaymentPaidDto,
  UpdateTeamPaymentDto,
  UpdateTeamPaymentItemDto,
} from '../dto';
import { TeamPaymentsService } from '../services/team-payments.service';
import { FinanceTeamPaymentReconciliationService } from '../../finance/services/finance-team-payment-reconciliation.service';
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
@Controller('agency/team/payments')
export class TeamPaymentsController {
  private readonly logger = new Logger(TeamPaymentsController.name);

  constructor(
    private readonly teamPaymentsService: TeamPaymentsService,
    private readonly financeTeamPaymentReconciliationService: FinanceTeamPaymentReconciliationService,
  ) {}

  private async getReconciledPayment(ctx: RequestContext, id: string) {
    const payment = await this.teamPaymentsService.getPayment(ctx, id);
    try {
      return await this.financeTeamPaymentReconciliationService.reconcilePayment(
        ctx,
        payment,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Finance reconciliation failed for Team payment ${id}: ${message}`,
      );
      return payment;
    }
  }

  @Get('batches')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  listBatches(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.teamPaymentsService.listBatches(getContextFromHeaders(headers));
  }

  @Post('generate')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  generatePayments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: GenerateTeamPaymentsDto,
  ) {
    return this.teamPaymentsService.generatePayments(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Get()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  async listPayments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTeamPaymentsQueryDto,
  ) {
    const ctx = getContextFromHeaders(headers);
    try {
      await this.financeTeamPaymentReconciliationService.reconcileWorkspacePayments(
        ctx,
        {
          memberId: query.memberId,
          batchId: query.batchId,
          competenceStart: query.competenceStart,
          competenceEnd: query.competenceEnd,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Finance reconciliation failed for Team payments: ${message}`,
      );
    }
    return this.teamPaymentsService.listPayments(ctx, query);
  }

  @Post()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  createPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamPaymentDto,
  ) {
    return this.teamPaymentsService.createPayment(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Get(':id')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  async getPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    const ctx = getContextFromHeaders(headers);
    return this.getReconciledPayment(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  updatePayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamPaymentDto,
  ) {
    return this.teamPaymentsService.updatePayment(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Delete(':id')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  deletePayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.deletePayment(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/archive')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  archivePayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.archivePayment(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/confirm')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  confirmPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.confirmPayment(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/approve')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  approvePayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.approvePayment(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/send-to-finance')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  sendToFinance(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.sendPaymentToFinance(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/mark-paid')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  markPaid(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: MarkTeamPaymentPaidDto,
  ) {
    return this.teamPaymentsService.markPaid(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/revert-payment')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  revertPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.revertPayment(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/cancel')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  cancelPayment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.cancelPayment(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/back-to-draft')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  backToDraft(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.backToDraft(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post(':id/items')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  createItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateTeamPaymentItemDto,
  ) {
    return this.teamPaymentsService.createItem(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
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
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  deleteItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.teamPaymentsService.deleteItem(
      getContextFromHeaders(headers),
      id,
      itemId,
    );
  }

  @Get(':id/finance')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  async getPaymentFinanceStatus(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    const ctx = getContextFromHeaders(headers);
    await this.getReconciledPayment(ctx, id);
    return this.teamPaymentsService.getPaymentFinanceStatus(ctx, id);
  }

  @Post(':id/documents')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  createDocument(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateTeamPaymentDocumentDto,
  ) {
    return this.teamPaymentsService.createDocument(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Delete(':id/documents/:documentId')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
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
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
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
    res.setHeader(
      'Content-Disposition',
      `inline; filename="document-${documentId}.pdf"`,
    );
    res.send(buffer);
  }
}
