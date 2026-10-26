import { Module } from '@nestjs/common';
import { BrandKitModule } from '../brand-kit/brand-kit.module';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { AnalyticsReportLetterheadService } from './analytics-report-letterhead.service';
import { AnalyticsReportLogoService } from './analytics-report-logo.service';

/**
 * The server half of the Analytics PDF, shared by Social and LeadFlow (D-AN-5):
 * the snapshot contract, the renderer, the letterhead and the client logo.
 *
 * No controller and no table: each product keeps its own routes, permissions
 * and archive, and only borrows how a report is put on paper.
 * `DocumentLayoutsModule` gives the agency's document model, `BrandKitModule`
 * the client's logo through the service it exports for exactly this.
 */
@Module({
  imports: [DocumentLayoutsModule, BrandKitModule],
  providers: [AnalyticsReportLogoService, AnalyticsReportLetterheadService],
  exports: [AnalyticsReportLogoService, AnalyticsReportLetterheadService],
})
export class AnalyticsReportsModule {}
