import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencySalesItemEntity } from '../agency/entities/agency-sales.entities';
import { AgencyClient } from '../clients/entities';
import { SalesNotificationPublisher } from '../crm/sales-notification.publisher';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import {
  FinanceCategory,
  FinanceCostCenter,
  FinanceInvoice,
} from '../finance/entities';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { QuoteInvoiceService } from './quote-invoice.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import {
  QuoteEntity,
  QuoteItemEntity,
  QuoteStatusHistoryEntity,
  QuoteTemplateEntity,
  QuoteTemplateSectionEntity,
} from './entities/quote.entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    DocumentLayoutsModule,
    NotificationsModule,
    PermissionsModule,
    FinanceModule,
    TypeOrmModule.forFeature(
      [
        QuoteEntity,
        QuoteItemEntity,
        QuoteStatusHistoryEntity,
        QuoteTemplateEntity,
        QuoteTemplateSectionEntity,
        // Read-only access used by the quote → invoice integration.
        AgencySalesItemEntity,
        AgencyClient,
        FinanceInvoice,
        FinanceCostCenter,
        FinanceCategory,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [QuotesController],
  providers: [QuotesService, QuoteInvoiceService, SalesNotificationPublisher],
  exports: [QuotesService],
})
export class QuotesModule {}
