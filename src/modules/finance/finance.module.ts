import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgencyProject,
  AgencyTask,
  AgencyTaskTimeEntry,
} from '../projects/entities';
import { FinanceController } from './controllers/finance.controller';
import {
  FinanceAccount,
  FinanceRecurringProfile,
  FinancePaymentAllocation,
  FinancePayment,
  FinanceInvoiceLine,
  FinanceInvoice,
  FinanceBillLine,
  FinanceBill,
  FinanceBankAccount,
  FinanceCategory,
  FinanceCostCenter,
  FinanceJournal,
  FinanceMetricSnapshot,
  FinancePeriod,
  FinanceProfitabilityRule,
  FinanceReportSnapshot,
  FinanceSetting,
  FinanceTag,
} from './entities';
import { FinanceService } from './services/finance.service';
import { FinanceDefaultsService } from './services/finance-defaults.service';
import { FinanceBillingService } from './services/finance-billing.service';
import { FinanceProfitabilityService } from './services/finance-profitability.service';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        FinanceAccount,
        FinanceBankAccount,
        FinanceCategory,
        FinanceCostCenter,
        FinanceJournal,
        FinanceMetricSnapshot,
        FinancePeriod,
        FinanceProfitabilityRule,
        FinanceReportSnapshot,
        FinanceSetting,
        FinanceTag,
        FinanceInvoice,
        FinanceInvoiceLine,
        FinanceBill,
        FinanceBillLine,
        FinancePayment,
        FinancePaymentAllocation,
        FinanceRecurringProfile,
        AgencyProject,
        AgencyTask,
        AgencyTaskTimeEntry,
      ],
      'agency',
    ),
  ],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    FinanceDefaultsService,
    FinanceBillingService,
    FinanceProfitabilityService,
  ],
  exports: [
    FinanceService,
    FinanceDefaultsService,
    FinanceBillingService,
    FinanceProfitabilityService,
  ],
})
export class FinanceModule {}
