import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import { DocumentLayoutsController } from './document-layouts.controller';
import { DocumentLayoutsService } from './document-layouts.service';
import {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
} from './entities/document-layout.entities';
import { WorkspaceSettingsCompanyEntity } from '../settings/entities/workspace-settings-company.entity';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [DocumentLayoutEntity, DocumentLayoutTemplateEntity],
      AGENCY_CONNECTION,
    ),
    TypeOrmModule.forFeature([WorkspaceSettingsCompanyEntity]),
  ],
  controllers: [DocumentLayoutsController],
  providers: [DocumentLayoutsService, DocumentPdfRendererService],
  exports: [DocumentLayoutsService, DocumentPdfRendererService],
})
export class DocumentLayoutsModule {}
