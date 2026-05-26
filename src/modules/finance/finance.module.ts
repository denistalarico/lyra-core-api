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
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
