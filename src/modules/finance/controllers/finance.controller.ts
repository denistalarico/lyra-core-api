import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
} from '../dto';
import { FinanceService } from '../services/finance.service';
import { FinanceDefaultsService } from '../services/finance-defaults.service';
import { getFinanceContext } from '../services/finance-context';

@Controller('agency/finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly financeDefaultsService: FinanceDefaultsService,
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
}
