import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DocumentLayoutsService } from '../../document-layouts/document-layouts.service';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
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

@Controller('agency/finance')
export class FinanceController {
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
  setupDefaults(@Req() req: Request) {
    return this.financeDefaultsService.setupDefaults(getFinanceContext(req));
  }





  @Get('entries')
  listJournalEntries(@Req() req: Request) {
    return this.financeJournalEntryService.list(getFinanceContext(req));
  }

  @Post('entries')
  createJournalEntry(
    @Req() req: Request,
    @Body() dto: CreateFinanceJournalEntryDto,
  ) {
    return this.financeJournalEntryService.create(getFinanceContext(req), dto);
  }

  @Get('entries/:id')
  getJournalEntry(@Req() req: Request, @Param('id') id: string) {
    return this.financeJournalEntryService.get(getFinanceContext(req), id);
  }

  @Post('entries/:id/post')
  postJournalEntry(@Req() req: Request, @Param('id') id: string) {
    return this.financeJournalEntryService.post(getFinanceContext(req), id);
  }

  @Post('entries/:id/cancel')
  cancelJournalEntry(@Req() req: Request, @Param('id') id: string) {
    return this.financeJournalEntryService.cancel(getFinanceContext(req), id);
  }

  @Get('payment-providers')
  listPaymentProviders(@Req() req: Request) {
    return this.financePaymentProviderService.list(getFinanceContext(req));
  }

  @Post('payment-providers')
  createPaymentProvider(
    @Req() req: Request,
    @Body() dto: CreateFinancePaymentProviderDto,
  ) {
    return this.financePaymentProviderService.create(getFinanceContext(req), dto);
  }

  @Get('payment-providers/:id')
  getPaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.get(getFinanceContext(req), id);
  }

  @Patch('payment-providers/:id')
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
  deletePaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.delete(getFinanceContext(req), id);
  }

  @Post('payment-providers/:id/connect')
  connectPaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.connect(getFinanceContext(req), id);
  }

  @Post('payment-providers/:id/disconnect')
  disconnectPaymentProvider(@Req() req: Request, @Param('id') id: string) {
    return this.financePaymentProviderService.disconnect(
      getFinanceContext(req),
      id,
    );
  }

  @Get('fiscal-profile')
  getFiscalProfile(@Req() req: Request) {
    return this.financeFiscalService.getProfile(getFinanceContext(req));
  }

  @Patch('fiscal-profile')
  updateFiscalProfile(
    @Req() req: Request,
    @Body() dto: UpdateFinanceFiscalProfileDto,
  ) {
    return this.financeFiscalService.updateProfile(getFinanceContext(req), dto);
  }

  @Get('document-sequences')
  listDocumentSequences(@Req() req: Request) {
    return this.financeDocumentNumberingService.listSequences(
      getFinanceContext(req),
    );
  }

  @Post('document-sequences/defaults')
  upsertDefaultSequences(@Req() req: Request) {
    return this.financeDocumentNumberingService.upsertDefaults(getFinanceContext(req));
  }

  @Patch('document-sequences/:id')
  updateDocumentSequence(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: { prefix?: string; padding?: number; nextNumber?: number },
  ) {
    return this.financeDocumentNumberingService.updateSequence(getFinanceContext(req), id, dto);
  }

  @Get('settings')
  getSettings(@Req() req: Request) {
    return this.financeService.getSettings(getFinanceContext(req));
  }

  @Patch('settings')
  updateSettings(@Req() req: Request, @Body() dto: UpdateFinanceSettingsDto) {
    return this.financeService.updateSettings(getFinanceContext(req), dto);
  }

  @Get('accounts')
  listAccounts(@Req() req: Request) {
    return this.financeService.listAccounts(getFinanceContext(req));
  }

  @Post('accounts')
  createAccount(@Req() req: Request, @Body() dto: CreateFinanceAccountDto) {
    return this.financeService.createAccount(getFinanceContext(req), dto);
  }

  @Patch('accounts/:id')
  updateAccount(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceAccountDto,
  ) {
    return this.financeService.updateAccount(getFinanceContext(req), id, dto);
  }

  @Delete('accounts/:id')
  deleteAccount(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteAccount(getFinanceContext(req), id);
  }

  @Get('journals')
  listJournals(@Req() req: Request) {
    return this.financeService.listJournals(getFinanceContext(req));
  }

  @Post('journals')
  createJournal(@Req() req: Request, @Body() dto: CreateFinanceJournalDto) {
    return this.financeService.createJournal(getFinanceContext(req), dto);
  }

  @Patch('journals/:id')
  updateJournal(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceJournalDto,
  ) {
    return this.financeService.updateJournal(getFinanceContext(req), id, dto);
  }

  @Delete('journals/:id')
  deleteJournal(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteJournal(getFinanceContext(req), id);
  }

  @Get('categories')
  listCategories(@Req() req: Request) {
    return this.financeService.listCategories(getFinanceContext(req));
  }

  @Post('categories')
  createCategory(@Req() req: Request, @Body() dto: CreateFinanceCategoryDto) {
    return this.financeService.createCategory(getFinanceContext(req), dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceCategoryDto,
  ) {
    return this.financeService.updateCategory(getFinanceContext(req), id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteCategory(getFinanceContext(req), id);
  }

  @Get('tags')
  listTags(@Req() req: Request) {
    return this.financeService.listTags(getFinanceContext(req));
  }

  @Post('tags')
  createTag(@Req() req: Request, @Body() dto: CreateFinanceTagDto) {
    return this.financeService.createTag(getFinanceContext(req), dto);
  }

  @Get('cost-centers')
  listCostCenters(@Req() req: Request) {
    return this.financeService.listCostCenters(getFinanceContext(req));
  }

  @Post('cost-centers')
  createCostCenter(
    @Req() req: Request,
    @Body() dto: CreateFinanceCostCenterDto,
  ) {
    return this.financeService.createCostCenter(getFinanceContext(req), dto);
  }

  @Patch('cost-centers/:id')
  updateCostCenter(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceCostCenterDto,
  ) {
    return this.financeService.updateCostCenter(getFinanceContext(req), id, dto);
  }

  @Delete('cost-centers/:id')
  deleteCostCenter(@Req() req: Request, @Param('id') id: string) {
    return this.financeService.deleteCostCenter(getFinanceContext(req), id);
  }

  @Get('bank-accounts')
  listBankAccounts(@Req() req: Request) {
    return this.financeService.listBankAccounts(getFinanceContext(req));
  }

  @Post('bank-accounts')
  createBankAccount(
    @Req() req: Request,
    @Body() dto: CreateFinanceBankAccountDto,
  ) {
    return this.financeService.createBankAccount(getFinanceContext(req), dto);
  }

  @Patch('bank-accounts/:id')
  updateBankAccount(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceBankAccountDto,
  ) {
    return this.financeService.updateBankAccount(getFinanceContext(req), id, dto);
  }


  @Get('profitability/overview')
  getProfitabilityOverview(@Req() req: Request) {
    return this.financeProfitabilityService.getOverview(getFinanceContext(req));
  }


  @Get('profitability/projects/:id')
  getProjectProfitability(@Req() req: Request, @Param('id') id: string) {
    return this.financeProfitabilityService.getProjectDetail(
      getFinanceContext(req),
      id,
    );
  }

  @Get('profitability/clients/:id')
  getClientProfitability(@Req() req: Request, @Param('id') id: string) {
    return this.financeProfitabilityService.getClientDetail(
      getFinanceContext(req),
      id,
    );
  }


  @Get('profitability/rules')
  getProfitabilityRules(@Req() req: Request) {
    return this.financeService.getProfitabilityRules(getFinanceContext(req));
  }

  @Patch('profitability/rules')
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
  getReportsOverview(@Req() req: Request) {
    return this.financeService.getReportsOverview(getFinanceContext(req));
  }



  @Get('reports/metrics/history')
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
  createMonthlyReportSnapshot(@Req() req: Request) {
    return this.financeService.createMonthlyReportSnapshot(getFinanceContext(req));
  }


  @Get('invoices')
  listInvoices(@Req() req: Request) {
    return this.financeBillingService.listInvoices(getFinanceContext(req));
  }

  @Post('invoices')
  createInvoice(@Req() req: Request, @Body() dto: CreateFinanceInvoiceDto) {
    return this.financeBillingService.createInvoice(getFinanceContext(req), dto);
  }

  @Get('invoices/:id')
  getInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.getInvoice(getFinanceContext(req), id);
  }

  @Patch('invoices/:id')
  updateInvoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceInvoiceDto,
  ) {
    return this.financeBillingService.updateInvoice(getFinanceContext(req), id, dto);
  }

  @Delete('invoices/:id')
  deleteInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.deleteInvoice(getFinanceContext(req), id);
  }

  @Post('invoices/:id/issue')
  issueInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.issueInvoice(getFinanceContext(req), id);
  }

  @Post('invoices/:id/cancel')
  cancelInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.cancelInvoice(getFinanceContext(req), id);
  }

  @Post('invoices/:id/revert-draft')
  revertInvoiceToDraft(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.revertInvoiceToDraft(getFinanceContext(req), id);
  }

  @Post('invoices/:id/lines')
  addInvoiceLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddFinanceInvoiceLineDto,
  ) {
    return this.financeBillingService.addInvoiceLine(getFinanceContext(req), id, dto);
  }

  @Patch('invoices/:id/lines/:lineId')
  updateInvoiceLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateFinanceInvoiceLineDto,
  ) {
    return this.financeBillingService.updateInvoiceLine(getFinanceContext(req), id, lineId, dto);
  }

  @Delete('invoices/:id/lines/:lineId')
  removeInvoiceLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.financeBillingService.removeInvoiceLine(getFinanceContext(req), id, lineId);
  }

  @Post('invoices/:id/pdf')
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

    const buffer = await this.documentPdfRenderer.renderInvoicePdf({
      invoice,
      lines,
      layout,
      template,
    });

    const safeNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '-');
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${safeNumber}.pdf"`,
      'Cache-Control': 'no-store',
    });
    return response.send(buffer);
  }

  @Get('bills')
  listBills(@Req() req: Request) {
    return this.financeBillingService.listBills(getFinanceContext(req));
  }

  @Post('bills')
  createBill(@Req() req: Request, @Body() dto: CreateFinanceBillDto) {
    return this.financeBillingService.createBill(getFinanceContext(req), dto);
  }

  @Get('bills/:id')
  getBill(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.getBill(getFinanceContext(req), id);
  }

  @Patch('bills/:id')
  updateBill(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceBillDto,
  ) {
    return this.financeBillingService.updateBill(getFinanceContext(req), id, dto);
  }

  @Delete('bills/:id')
  deleteBill(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.deleteBill(getFinanceContext(req), id);
  }

  @Post('bills/:id/cancel')
  cancelBill(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.cancelBill(getFinanceContext(req), id);
  }

  @Post('bills/:id/lines')
  addBillLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddFinanceBillLineDto,
  ) {
    return this.financeBillingService.addBillLine(getFinanceContext(req), id, dto);
  }

  @Patch('bills/:id/lines/:lineId')
  updateBillLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateFinanceBillLineDto,
  ) {
    return this.financeBillingService.updateBillLine(getFinanceContext(req), id, lineId, dto);
  }

  @Delete('bills/:id/lines/:lineId')
  removeBillLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.financeBillingService.removeBillLine(getFinanceContext(req), id, lineId);
  }

  @Post('bills/:id/pdf')
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

    const buffer = await this.documentPdfRenderer.renderBillPdf({
      bill,
      lines,
      layout,
      template,
    });

    const safeNumber = bill.billNumber.replace(/[^a-zA-Z0-9-_]/g, '-');
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="bill-${safeNumber}.pdf"`,
      'Cache-Control': 'no-store',
    });
    return response.send(buffer);
  }

  @Get('payments')
  listPayments(@Req() req: Request) {
    return this.financeBillingService.listPayments(getFinanceContext(req));
  }

  @Post('payments')
  createPayment(@Req() req: Request, @Body() dto: CreateFinancePaymentDto) {
    return this.financeBillingService.createPayment(getFinanceContext(req), dto);
  }

  @Patch('payments/:id')
  updatePayment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateFinancePaymentDto,
  ) {
    return this.financeBillingService.updatePayment(getFinanceContext(req), id, dto);
  }

  @Delete('payments/:id')
  deletePayment(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.deletePayment(getFinanceContext(req), id);
  }

  @Post('payments/:id/allocate')
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
  generateDueRecurringInvoices(@Req() req: Request) {
    return this.financeBillingService.generateDueRecurringInvoices(
      getFinanceContext(req),
    );
  }

  @Get('recurring-profiles')
  listRecurringProfiles(@Req() req: Request) {
    return this.financeBillingService.listRecurringProfiles(getFinanceContext(req));
  }

  @Post('recurring-profiles')
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

}
