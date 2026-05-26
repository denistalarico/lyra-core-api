import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateFinanceAccountDto,
  CreateFinanceBankAccountDto,
  CreateFinanceCategoryDto,
  CreateFinanceCostCenterDto,
  CreateFinanceJournalDto,
  CreateFinanceTagDto,
  UpdateFinanceAccountDto,
  UpdateFinanceProfitabilityRulesDto,
  UpdateFinanceSettingsDto,
  FinanceMetricsHistoryQueryDto,
  CreateFinanceInvoiceDto,
  UpdateFinanceInvoiceDto,
  CreateFinanceBillDto,
  UpdateFinanceBillDto,
  CreateFinancePaymentDto,
  CreateFinanceRecurringProfileDto,
  UpdateFinanceRecurringProfileDto,
  AllocateFinancePaymentDto,
} from '../dto';
import { FinanceService } from '../services/finance.service';
import { FinanceDefaultsService } from '../services/finance-defaults.service';
import { FinanceBillingService } from '../services/finance-billing.service';
import { FinanceProfitabilityService } from '../services/finance-profitability.service';
import { getFinanceContext } from '../services/finance-context';

@Controller('agency/finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly financeDefaultsService: FinanceDefaultsService,
    private readonly financeBillingService: FinanceBillingService,
    private readonly financeProfitabilityService: FinanceProfitabilityService,
  ) {}

  @Get('health')
  getHealth() {
    return this.financeService.getHealth();
  }

  @Post('setup/defaults')
  setupDefaults(@Req() req: Request) {
    return this.financeDefaultsService.setupDefaults(getFinanceContext(req));
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

  @Get('journals')
  listJournals(@Req() req: Request) {
    return this.financeService.listJournals(getFinanceContext(req));
  }

  @Post('journals')
  createJournal(@Req() req: Request, @Body() dto: CreateFinanceJournalDto) {
    return this.financeService.createJournal(getFinanceContext(req), dto);
  }

  @Get('categories')
  listCategories(@Req() req: Request) {
    return this.financeService.listCategories(getFinanceContext(req));
  }

  @Post('categories')
  createCategory(@Req() req: Request, @Body() dto: CreateFinanceCategoryDto) {
    return this.financeService.createCategory(getFinanceContext(req), dto);
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

  @Post('invoices/:id/issue')
  issueInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.issueInvoice(getFinanceContext(req), id);
  }

  @Post('invoices/:id/cancel')
  cancelInvoice(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.cancelInvoice(getFinanceContext(req), id);
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

  @Post('bills/:id/cancel')
  cancelBill(@Req() req: Request, @Param('id') id: string) {
    return this.financeBillingService.cancelBill(getFinanceContext(req), id);
  }

  @Get('payments')
  listPayments(@Req() req: Request) {
    return this.financeBillingService.listPayments(getFinanceContext(req));
  }

  @Post('payments')
  createPayment(@Req() req: Request, @Body() dto: CreateFinancePaymentDto) {
    return this.financeBillingService.createPayment(getFinanceContext(req), dto);
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
