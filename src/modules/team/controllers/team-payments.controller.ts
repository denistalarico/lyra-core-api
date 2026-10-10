import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

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
  listBatches(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.teamPaymentsService.listBatches(context);
  }

  @Post('generate')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  generatePayments(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: GenerateTeamPaymentsDto,
  ) {
    return this.teamPaymentsService.generatePayments(context, dto);
  }

  @Get()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  async listPayments(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListTeamPaymentsQueryDto,
  ) {
    const ctx = context;
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
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateTeamPaymentDto,
  ) {
    return this.teamPaymentsService.createPayment(context, dto);
  }

  @Get(':id')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  async getPayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    const ctx = context;
    return this.getReconciledPayment(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  updatePayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateTeamPaymentDto,
  ) {
    return this.teamPaymentsService.updatePayment(context, id, dto);
  }

  @Delete(':id')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  deletePayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.deletePayment(context, id);
  }

  @Post(':id/archive')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  archivePayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.archivePayment(context, id);
  }

  @Post(':id/confirm')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  confirmPayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.confirmPayment(context, id);
  }

  @Post(':id/approve')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  approvePayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.approvePayment(context, id);
  }

  @Post(':id/send-to-finance')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  sendToFinance(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.sendPaymentToFinance(context, id);
  }

  @Post(':id/mark-paid')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  markPaid(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: MarkTeamPaymentPaidDto,
  ) {
    return this.teamPaymentsService.markPaid(context, id, dto);
  }

  @Post(':id/revert-payment')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  revertPayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.revertPayment(context, id);
  }

  @Post(':id/cancel')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  cancelPayment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.cancelPayment(context, id);
  }

  @Post(':id/back-to-draft')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  backToDraft(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamPaymentsService.backToDraft(context, id);
  }

  @Post(':id/items')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  createItem(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CreateTeamPaymentItemDto,
  ) {
    return this.teamPaymentsService.createItem(context, id, dto);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  updateItem(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTeamPaymentItemDto,
  ) {
    return this.teamPaymentsService.updateItem(context, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  deleteItem(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.teamPaymentsService.deleteItem(context, id, itemId);
  }

  @Get(':id/finance')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  async getPaymentFinanceStatus(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    const ctx = context;
    await this.getReconciledPayment(ctx, id);
    return this.teamPaymentsService.getPaymentFinanceStatus(ctx, id);
  }

  @Post(':id/documents')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  createDocument(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CreateTeamPaymentDocumentDto,
  ) {
    return this.teamPaymentsService.createDocument(context, id, dto);
  }

  @Delete(':id/documents/:documentId')
  @DangerousAction()
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  deleteDocument(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.teamPaymentsService.deleteDocument(context, id, documentId);
  }

  @Get(':id/documents/:documentId/pdf')
  @RequirePermission('agency.team.compensation.view.owner_or_hr')
  async getDocumentPdf(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.teamPaymentsService.generateDocumentPdf(
      context,
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
