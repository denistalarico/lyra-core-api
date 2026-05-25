import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
