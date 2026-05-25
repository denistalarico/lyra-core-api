import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentLayoutsController } from './document-layouts.controller';
import { DocumentLayoutsService } from './document-layouts.service';
import {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
} from './entities/document-layout.entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [DocumentLayoutEntity, DocumentLayoutTemplateEntity],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [DocumentLayoutsController],
  providers: [DocumentLayoutsService],
  exports: [DocumentLayoutsService],
})
export class DocumentLayoutsModule {}
