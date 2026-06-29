import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DocumentLayoutsService } from '../../document-layouts/document-layouts.service';
import {
  DocumentPdfRendererService,
  PdfEngineUnavailableError,
} from '../../document-layouts/document-pdf-renderer.service';
import {
  CreateFinanceAccountDto,
  CreateFinanceBankAccountDto,
  CreateFinanceCategoryDto,
  CreateFinanceCostCenterDto,
  CreateFinanceJournalDto,
  CreateFinanceTagDto,
  UpdateFinanceAccountDto,
  UpdateFinanceCategoryDto,
  UpdateFinanceCostCenterDto,
  UpdateFinanceJournalDto,
  UpdateFinanceProfitabilityRulesDto,
  UpdateFinanceSettingsDto,
  FinanceMetricsHistoryQueryDto,
  UpdateFinanceFiscalProfileDto,
  CreateFinancePaymentProviderDto,
  UpdateFinancePaymentProviderDto,
  CreateFinanceJournalEntryDto,
  AddFinanceInvoiceLineDto,
  CreateFinanceInvoiceDto,
  UpdateFinanceInvoiceDto,
  UpdateFinanceInvoiceLineDto,
  AddFinanceBillLineDto,
  CreateFinanceBillDto,
  UpdateFinanceBillDto,
  UpdateFinanceBillLineDto,
  UpdateFinanceBankAccountDto,
  UpdateFinancePaymentDto,
  CreateFinancePaymentDto,
  CreateFinanceRecurringProfileDto,
  UpdateFinanceRecurringProfileDto,
  CreateFinanceBillRecurrenceDto,
  UpdateFinanceBillRecurrenceDto,
  AllocateFinancePaymentDto,
} from '../dto';
import { FinanceService } from '../services/finance.service';
import { FinanceDefaultsService } from '../services/finance-defaults.service';
import { FinanceBillingService } from '../services/finance-billing.service';
import { FinanceProfitabilityService } from '../services/finance-profitability.service';
import { FinanceDocumentNumberingService } from '../services/finance-document-numbering.service';
import { FinanceFiscalService } from '../services/finance-fiscal.service';
import { FinancePaymentProviderService } from '../services/finance-payment-provider.service';
import { FinanceJournalEntryService } from '../services/finance-journal-entry.service';
import { getFinanceContext } from '../services/finance-context';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';

const RequireFinancePermission = (permissionKey: string) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PermissionsGuard),
    RequirePermission(permissionKey),
  );

@Controller('agency/finance')
export class FinanceController {
  private readonly logger = new Logger(FinanceController.name);

  // Maps PDF rendering failures to a clean, user-facing response. The real cause
  // (e.g. a missing browser engine) is logged server-side while the client gets
  // a friendly 503 instead of an opaque 500.
  private handlePdfError(error: unknown, document: string): never {
    if (error instanceof PdfEngineUnavailableError) {
      this.logger.error(
        `PDF engine unavailable while generating ${document}: ${
          error.cause instanceof Error ? error.cause.message : String(error.cause)
        }`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível gerar o PDF no momento: o motor de geração de documentos está indisponível. Tente novamente em instantes ou contate o suporte.',
      );
    }

    this.logger.error(
      `Failed to generate ${document}: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`,
    );
    throw new ServiceUnavailableException(
      'Não foi possível gerar o PDF do documento. A falha foi registrada para análise.',
    );
  }

  constructor(
    private readonly financeService: FinanceService,
    private readonly financeDefaultsService: FinanceDefaultsService,
    private readonly financeBillingService: FinanceBillingService,
    private readonly financeProfitabilityService: FinanceProfitabilityService,
    private readonly financeDocumentNumberingService: FinanceDocumentNumberingService,
    private readonly financeFiscalService: FinanceFiscalService,
    private readonly financePaymentProviderService: FinancePaymentProviderService,
    private readonly financeJournalEntryService: FinanceJournalEntryService,
    private readonly documentLayoutsService: DocumentLayoutsService,
    private readonly documentPdfRenderer: DocumentPdfRendererService,
  ) {}

  @Get('health')
  getHealth() {
    return this.financeService.getHealth();
  }

  @Post('setup/defaults')
  @RequireFinancePermission('agency.finance.settings.manage.admin_or_owner')
  setupDefaults(@Req() req: Request) {
    return this.financeDefaultsService.setupDefaults(getFinanceContext(req));
  }





  @Get('entries')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listJournalEntries(@Req() req: Request) {
    return this.financeJournalEntryService.list(getFinanceContext(req));
  }

  @Post('entries')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  createJournalEntry(
    @Req() req: Request,
    @Body() dto: CreateFinanceJournalEntryDto,
  ) {
    return this.financeJournalEntryService.create(getFinanceContext(req), dto);
  }

  @Get('entries/:id')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  getJournalEntry(@Req() req: Request, @Param('id') id: string) {
    return this.financeJournalEntryService.get(getFinanceContext(req), id);
  }

  @Post('entries/:id/post')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  postJournalEntry(@Req() req: Request, @Param('id') id: string) {
    return this.financeJournalEntryService.post(getFinanceContext(req), id);
  }

  @Post('entries/:id/cancel')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  cancelJournalEntry(@Req() req: Request, @Param('id') id: string) {
    return this.financeJournalEntryService.cancel(getFinanceContext(req), id);
  }

  @Get('payment-providers')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  listPaymentProviders(@Req() req: Request) {
    return this.financePaymentProviderService.list(getFinanceContext(req));
  }

  @Post('payment-providers')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  createPaymentProvider(
    @Req() req: Request,
    @Body() dto: CreateFinancePaymentProviderDto,
  ) {
    return this.financePaymentProviderService.create(getFinanceContext(req), dto);
  }

  @Get('payment-providers/:id')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  getPaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.get(getFinanceContext(req), id);
  }

  @Patch('payment-providers/:id')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updatePaymentProvider(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinancePaymentProviderDto,
  ) {
    return this.financePaymentProviderService.update(
      getFinanceContext(req),
      id,
      dto,
    );
  }

  @Delete('payment-providers/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  deletePaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.delete(getFinanceContext(req), id);
  }

  @Post('payment-providers/:id/connect')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  connectPaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.connect(getFinanceContext(req), id);
  }

  @Post('payment-providers/:id/disconnect')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  disconnectPaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.disconnect(
      getFinanceContext(req),
      id,
    );
  }

  @Get('fiscal-profile')
  @RequireFinancePermission('agency.finance.fiscal.manage.owner_only')
  getFiscalProfile(@Req() req: Request) {
    return this.financeFiscalService.getProfile(getFinanceContext(req));
  }

  @Patch('fiscal-profile')
  @RequireFinancePermission('agency.finance.fiscal.manage.owner_only')
  updateFiscalProfile(
    @Req() req: Request,
    @Body() dto: UpdateFinanceFiscalProfileDto,
  ) {
    return this.financeFiscalService.updateProfile(getFinanceContext(req), dto);
  }

  @Get('document-sequences')
  @RequireFinancePermission('agency.finance.fiscal.manage.owner_only')
  listDocumentSequences(@Req() req: Request) {
    return this.financeDocumentNumberingService.listSequences(
      getFinanceContext(req),
    );
  }

  @Post('document-sequences/defaults')
  @RequireFinancePermission('agency.finance.fiscal.manage.owner_only')
  upsertDefaultSequences(@Req() req: Request) {
    return this.financeDocumentNumberingService.upsertDefaults(getFinanceContext(req));
  }

  @Patch('document-sequences/:id')
  @RequireFinancePermission('agency.finance.fiscal.manage.owner_only')
  updateDocumentSequence(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: { prefix?: string; padding?: number; nextNumber?: number },
  ) {
    return this.financeDocumentNumberingService.updateSequence(getFinanceContext(req), id, dto);
  }

  @Get('settings')
  @RequireFinancePermission('agency.finance.settings.manage.admin_or_owner')
  getSettings(@Req() req: Request) {
    return this.financeService.getSettings(getFinanceContext(req));
  }

  @Patch('settings')
  @RequireFinancePermission('agency.finance.settings.manage.admin_or_owner')
  updateSettings(@Req() req: Request, @Body() dto: UpdateFinanceSettingsDto) {
    return this.financeService.updateSettings(getFinanceContext(req), dto);
  }

  @Get('accounts')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listAccounts(@Req() req: Request) {
    return this.financeService.listAccounts(getFinanceContext(req));
  }

  @Post('accounts')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  createAccount(@Req() req: Request, @Body() dto: CreateFinanceAccountDto) {
    return this.financeService.createAccount(getFinanceContext(req), dto);
  }

  @Patch('accounts/:id')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  updateAccount(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceAccountDto,
  ) {
    return this.financeService.updateAccount(getFinanceContext(req), id, dto);
  }

  @Delete('accounts/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  deleteAccount(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteAccount(getFinanceContext(req), id);
  }

  @Get('journals')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listJournals(@Req() req: Request) {
    return this.financeService.listJournals(getFinanceContext(req));
  }

  @Post('journals')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  createJournal(@Req() req: Request, @Body() dto: CreateFinanceJournalDto) {
    return this.financeService.createJournal(getFinanceContext(req), dto);
  }

  @Patch('journals/:id')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  updateJournal(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceJournalDto,
  ) {
    return this.financeService.updateJournal(getFinanceContext(req), id, dto);
  }

  @Delete('journals/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  deleteJournal(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteJournal(getFinanceContext(req), id);
  }

  @Get('categories')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listCategories(@Req() req: Request) {
    return this.financeService.listCategories(getFinanceContext(req));
  }

  @Post('categories')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  createCategory(@Req() req: Request, @Body() dto: CreateFinanceCategoryDto) {
    return this.financeService.createCategory(getFinanceContext(req), dto);
  }

  @Patch('categories/:id')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  updateCategory(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceCategoryDto,
  ) {
    return this.financeService.updateCategory(getFinanceContext(req), id, dto);
  }

  @Delete('categories/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  deleteCategory(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteCategory(getFinanceContext(req), id);
  }

  @Get('tags')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listTags(@Req() req: Request) {
    return this.financeService.listTags(getFinanceContext(req));
  }

  @Post('tags')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  createTag(@Req() req: Request, @Body() dto: CreateFinanceTagDto) {
    return this.financeService.createTag(getFinanceContext(req), dto);
  }

  @Get('cost-centers')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listCostCenters(@Req() req: Request) {
    return this.financeService.listCostCenters(getFinanceContext(req));
  }

  @Post('cost-centers')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  createCostCenter(
    @Req() req: Request,
    @Body() dto: CreateFinanceCostCenterDto,
  ) {
    return this.financeService.createCostCenter(getFinanceContext(req), dto);
  }

  @Patch('cost-centers/:id')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  updateCostCenter(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceCostCenterDto,
  ) {
    return this.financeService.updateCostCenter(getFinanceContext(req), id, dto);
  }

  @Delete('cost-centers/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  deleteCostCenter(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteCostCenter(getFinanceContext(req), id);
  }

  @Get('bank-accounts')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listBankAccounts(@Req() req: Request) {
    return this.financeService.listBankAccounts(getFinanceContext(req));
  }

  @Get('bank-accounts/:id')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  getBankAccount(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.getBankAccount(getFinanceContext(req), id);
  }

  @Post('bank-accounts')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  createBankAccount(
    @Req() req: Request,
    @Body() dto: CreateFinanceBankAccountDto,
  ) {
    return this.financeService.createBankAccount(getFinanceContext(req), dto);
  }

  @Patch('bank-accounts/:id')
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  updateBankAccount(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceBankAccountDto,
  ) {
    return this.financeService.updateBankAccount(getFinanceContext(req), id, dto);
  }

  @Delete('bank-accounts/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.transactions.manage.finance_or_owner')
  deleteBankAccount(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteBankAccount(getFinanceContext(req), id);
  }


  @Get('profitability/overview')
  @RequireFinancePermission('agency.finance.profitability.view.finance_or_owner')
  getProfitabilityOverview(@Req() req: Request) {
    return this.financeProfitabilityService.getOverview(getFinanceContext(req));
  }


  @Get('profitability/projects/:id')
  @RequireFinancePermission('agency.finance.profitability.view.finance_or_owner')
  getProjectProfitability(@Req() req: Request, @Param('id') id: string) {
    return this.financeProfitabilityService.getProjectDetail(
      getFinanceContext(req),
      id,
    );
  }

  @Get('profitability/clients/:id')
  @RequireFinancePermission('agency.finance.profitability.view.finance_or_owner')
  getClientProfitability(@Req() req: Request, @Param('id') id: string) {
    return this.financeProfitabilityService.getClientDetail(
      getFinanceContext(req),
      id,
    );
  }


  @Get('profitability/rules')
  @RequireFinancePermission('agency.finance.profitability.view.finance_or_owner')
  getProfitabilityRules(@Req() req: Request) {
    return this.financeService.getProfitabilityRules(getFinanceContext(req));
  }

  @Patch('profitability/rules')
  @RequireFinancePermission('agency.finance.settings.manage.admin_or_owner')
  updateProfitabilityRules(
    @Req() req: Request,
    @Body() dto: UpdateFinanceProfitabilityRulesDto,
  ) {
    return this.financeService.updateProfitabilityRules(
      getFinanceContext(req),
      dto,
    );
  }

  @Get('reports/overview')
  @RequireFinancePermission('agency.finance.reports.view.finance_or_owner')
  getReportsOverview(@Req() req: Request) {
    return this.financeService.getReportsOverview(getFinanceContext(req));
  }



  @Get('reports/metrics/history')
  @RequireFinancePermission('agency.finance.reports.view.finance_or_owner')
  getMetricsHistory(
    @Req() req: Request,
    @Query() query: FinanceMetricsHistoryQueryDto,
  ) {
    return this.financeService.getMetricsHistory(
      getFinanceContext(req),
      query,
    );
  }

  @Post('reports/snapshots/monthly')
  @RequireFinancePermission('agency.finance.reports.view.finance_or_owner')
  createMonthlyReportSnapshot(@Req() req: Request) {
    return this.financeService.createMonthlyReportSnapshot(getFinanceContext(req));
  }


  @Get('invoices')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listInvoices(@Req() req: Request) {
    return this.financeBillingService.listInvoices(getFinanceContext(req));
  }

  @Post('invoices')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  createInvoice(@Req() req: Request, @Body() dto: CreateFinanceInvoiceDto) {
    return this.financeBillingService.createInvoice(getFinanceContext(req), dto);
  }

  @Get('invoices/:id')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  getInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.getInvoice(getFinanceContext(req), id);
  }

  @Patch('invoices/:id')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updateInvoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceInvoiceDto,
  ) {
    return this.financeBillingService.updateInvoice(getFinanceContext(req), id, dto);
  }

  @Delete('invoices/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  deleteInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.deleteInvoice(getFinanceContext(req), id);
  }

  @Post('invoices/:id/issue')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  issueInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.issueInvoice(getFinanceContext(req), id);
  }

  @Post('invoices/:id/cancel')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  cancelInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.cancelInvoice(getFinanceContext(req), id);
  }

  @Post('invoices/:id/revert-draft')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  revertInvoiceToDraft(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.revertInvoiceToDraft(getFinanceContext(req), id);
  }

  @Post('invoices/:id/lines')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  addInvoiceLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddFinanceInvoiceLineDto,
  ) {
    return this.financeBillingService.addInvoiceLine(getFinanceContext(req), id, dto);
  }

  @Patch('invoices/:id/lines/:lineId')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updateInvoiceLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateFinanceInvoiceLineDto,
  ) {
    return this.financeBillingService.updateInvoiceLine(getFinanceContext(req), id, lineId, dto);
  }

  @Delete('invoices/:id/lines/:lineId')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  removeInvoiceLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.financeBillingService.removeInvoiceLine(getFinanceContext(req), id, lineId);
  }

  @Post('invoices/:id/pdf')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  async createInvoicePdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: false }) response: Response,
  ) {
    const ctx = getFinanceContext(req);
    const invoice = await this.financeBillingService.getInvoice(ctx, id);
    const lines = invoice.lines ?? [];

    const layout = await this.documentLayoutsService.getDefaultLayout(ctx);
    const template =
      await this.documentLayoutsService.getSystemTemplateForType(layout.layoutType, 'invoice') ??
      await this.documentLayoutsService.getSystemTemplateForType(layout.layoutType, 'quote');

    if (!template) {
      throw new NotFoundException('Document layout template not found.');
    }

    let buffer: Buffer;
    try {
      buffer = await this.documentPdfRenderer.renderInvoicePdf({
        invoice,
        lines,
        layout,
        template,
      });
    } catch (error) {
      this.handlePdfError(error, `invoice ${invoice.invoiceNumber}`);
    }

    const safeNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '-');
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${safeNumber}.pdf"`,
      'Cache-Control': 'no-store',
    });
    return response.send(buffer);
  }

  @Get('bills')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listBills(@Req() req: Request) {
    return this.financeBillingService.listBills(getFinanceContext(req));
  }

  @Post('bills')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  createBill(@Req() req: Request, @Body() dto: CreateFinanceBillDto) {
    return this.financeBillingService.createBill(getFinanceContext(req), dto);
  }

  @Get('bills/:id')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  getBill(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.getBill(getFinanceContext(req), id);
  }

  @Patch('bills/:id')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updateBill(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceBillDto,
  ) {
    return this.financeBillingService.updateBill(getFinanceContext(req), id, dto);
  }

  @Delete('bills/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  deleteBill(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.deleteBill(getFinanceContext(req), id);
  }

  @Post('bills/:id/cancel')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  cancelBill(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.cancelBill(getFinanceContext(req), id);
  }

  @Post('bills/:id/lines')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  addBillLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddFinanceBillLineDto,
  ) {
    return this.financeBillingService.addBillLine(getFinanceContext(req), id, dto);
  }

  @Patch('bills/:id/lines/:lineId')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updateBillLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateFinanceBillLineDto,
  ) {
    return this.financeBillingService.updateBillLine(getFinanceContext(req), id, lineId, dto);
  }

  @Delete('bills/:id/lines/:lineId')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  removeBillLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.financeBillingService.removeBillLine(getFinanceContext(req), id, lineId);
  }

  @Post('bills/:id/pdf')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  async createBillPdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: false }) response: Response,
  ) {
    const ctx = getFinanceContext(req);
    const bill = await this.financeBillingService.getBill(ctx, id);
    const lines = bill.lines ?? [];

    const layout = await this.documentLayoutsService.getDefaultLayout(ctx);
    const template =
      await this.documentLayoutsService.getSystemTemplateForType(layout.layoutType, 'generic') ??
      await this.documentLayoutsService.getSystemTemplateForType(layout.layoutType, 'quote');

    if (!template) {
      throw new NotFoundException('Document layout template not found.');
    }

    let buffer: Buffer;
    try {
      buffer = await this.documentPdfRenderer.renderBillPdf({
        bill,
        lines,
        layout,
        template,
      });
    } catch (error) {
      this.handlePdfError(error, `bill ${bill.billNumber}`);
    }

    const safeNumber = bill.billNumber.replace(/[^a-zA-Z0-9-_]/g, '-');
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="bill-${safeNumber}.pdf"`,
      'Cache-Control': 'no-store',
    });
    return response.send(buffer);
  }

  @Get('payments')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listPayments(@Req() req: Request) {
    return this.financeBillingService.listPayments(getFinanceContext(req));
  }

  @Post('payments')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  createPayment(@Req() req: Request, @Body() dto: CreateFinancePaymentDto) {
    return this.financeBillingService.createPayment(getFinanceContext(req), dto);
  }

  @Patch('payments/:id')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updatePayment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinancePaymentDto,
  ) {
    return this.financeBillingService.updatePayment(getFinanceContext(req), id, dto);
  }

  @Delete('payments/:id')
  @DangerousAction()
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  deletePayment(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.deletePayment(getFinanceContext(req), id);
  }

  @Post('payments/:id/allocate')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  allocatePayment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AllocateFinancePaymentDto,
  ) {
    return this.financeBillingService.allocatePayment(
      getFinanceContext(req),
      id,
      dto,
    );
  }


  @Post('recurring-profiles/:id/generate-invoice')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  generateInvoiceFromRecurringProfile(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.financeBillingService.generateInvoiceFromRecurringProfile(
      getFinanceContext(req),
      id,
    );
  }

  @Post('recurring-profiles/generate-due-invoices')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  generateDueRecurringInvoices(@Req() req: Request) {
    return this.financeBillingService.generateDueRecurringInvoices(
      getFinanceContext(req),
    );
  }

  @Get('recurring-profiles')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listRecurringProfiles(@Req() req: Request) {
    return this.financeBillingService.listRecurringProfiles(getFinanceContext(req));
  }

  @Post('recurring-profiles')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  createRecurringProfile(
    @Req() req: Request,
    @Body() dto: CreateFinanceRecurringProfileDto,
  ) {
    return this.financeBillingService.createRecurringProfile(
      getFinanceContext(req),
      dto,
    );
  }

  @Patch('recurring-profiles/:id')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updateRecurringProfile(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceRecurringProfileDto,
  ) {
    return this.financeBillingService.updateRecurringProfile(
      getFinanceContext(req),
      id,
      dto,
    );
  }

  // ── Bill recurrences (contas a pagar recorrentes) ────────────────────────
  // Static paths are declared before the `:id` routes so they are not captured
  // as an id by the router.

  @Post('bill-recurrences/run-due')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  generateDueBillRecurrences(@Req() req: Request) {
    return this.financeBillingService.generateDueBillRecurrences(
      getFinanceContext(req),
    );
  }

  @Get('bill-recurrences')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  listBillRecurrences(@Req() req: Request) {
    return this.financeBillingService.listBillRecurrences(getFinanceContext(req));
  }

  @Post('bill-recurrences')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  createBillRecurrence(
    @Req() req: Request,
    @Body() dto: CreateFinanceBillRecurrenceDto,
  ) {
    return this.financeBillingService.createBillRecurrence(
      getFinanceContext(req),
      dto,
    );
  }

  @Get('bill-recurrences/:id')
  @RequireFinancePermission('agency.finance.transactions.view.finance_or_owner')
  getBillRecurrence(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.getBillRecurrence(getFinanceContext(req), id);
  }

  @Patch('bill-recurrences/:id')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  updateBillRecurrence(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceBillRecurrenceDto,
  ) {
    return this.financeBillingService.updateBillRecurrence(
      getFinanceContext(req),
      id,
      dto,
    );
  }

  @Post('bill-recurrences/:id/pause')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  pauseBillRecurrence(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.pauseBillRecurrence(getFinanceContext(req), id);
  }

  @Post('bill-recurrences/:id/resume')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  resumeBillRecurrence(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.resumeBillRecurrence(getFinanceContext(req), id);
  }

  @Post('bill-recurrences/:id/generate')
  @RequireFinancePermission('agency.finance.billing.manage.owner_only')
  generateBillFromRecurrence(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.generateBillFromRecurrence(
      getFinanceContext(req),
      id,
    );
  }

}
