import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceController } from './controllers/finance.controller';
import {
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
} from './entities';
import { FinanceService } from './services/finance.service';
import { FinanceDefaultsService } from './services/finance-defaults.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
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
    ], 'agency'),
  ],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceDefaultsService],
  exports: [FinanceService, FinanceDefaultsService],
})
export class FinanceModule {}
