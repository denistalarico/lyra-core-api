import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesNotificationPublisher } from '../crm/sales-notification.publisher';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
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
    TypeOrmModule.forFeature(
      [
        QuoteEntity,
        QuoteItemEntity,
        QuoteStatusHistoryEntity,
        QuoteTemplateEntity,
        QuoteTemplateSectionEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [QuotesController],
  providers: [QuotesService, SalesNotificationPublisher],
  exports: [QuotesService],
})
export class QuotesModule {}
