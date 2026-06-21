import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
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
  FinanceDocumentSequence,
  FinanceFiscalProfile,
  FinancePaymentProvider,
  FinanceJournal,
  FinanceJournalEntry,
  FinanceJournalEntryLine,
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
import { FinanceDocumentNumberingService } from './services/finance-document-numbering.service';
import { FinanceFiscalService } from './services/finance-fiscal.service';
import { FinancePaymentProviderService } from './services/finance-payment-provider.service';
import { FinanceJournalEntryService } from './services/finance-journal-entry.service';
import { NotificationsModule } from '../notifications';
import { FinanceNotificationPublisher } from './services/finance-notification.publisher';
import { PermissionsModule } from '../permissions';

@Module({
  imports: [
    DocumentLayoutsModule,
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        FinanceAccount,
        FinanceBankAccount,
        FinanceCategory,
        FinanceCostCenter,
        FinanceDocumentSequence,
        FinanceFiscalProfile,
        FinancePaymentProvider,
        FinanceJournal,
        FinanceJournalEntry,
        FinanceJournalEntryLine,
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
    FinanceDocumentNumberingService,
    FinanceFiscalService,
    FinancePaymentProviderService,
    FinanceJournalEntryService,
    FinanceNotificationPublisher,
  ],
  exports: [
    FinanceService,
    FinanceDefaultsService,
    FinanceBillingService,
    FinanceProfitabilityService,
    FinanceDocumentNumberingService,
    FinanceFiscalService,
    FinancePaymentProviderService,
    FinanceJournalEntryService,
  ],
})
export class FinanceModule {}
