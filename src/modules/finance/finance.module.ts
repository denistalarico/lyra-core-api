import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import {
  AgencyProject,
  AgencyProjectSettings,
  AgencyTask,
  AgencyTaskTimeEntry,
} from '../projects/entities';
import { TeamMember } from '../team/entities';
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
  FinanceBillRecurrence,
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
import { FinancePostingService } from './services/finance-posting.service';
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
        FinanceBillRecurrence,
        FinancePayment,
        FinancePaymentAllocation,
        FinanceRecurringProfile,
        AgencyProject,
        AgencyProjectSettings,
        AgencyTask,
        AgencyTaskTimeEntry,
        TeamMember,
      ],
      'agency',
    ),
  ],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    FinanceDefaultsService,
    FinanceBillingService,
    FinancePostingService,
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
    FinancePostingService,
    FinanceProfitabilityService,
    FinanceDocumentNumberingService,
    FinanceFiscalService,
    FinancePaymentProviderService,
    FinanceJournalEntryService,
  ],
})
export class FinanceModule {}
