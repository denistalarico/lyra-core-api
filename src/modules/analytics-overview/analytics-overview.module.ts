import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { AnalyticsOverviewHeaderController } from './analytics-overview-header.controller';
import { AnalyticsOverviewHeaderEntity } from './analytics-overview-header.entity';
import { AnalyticsOverviewHeaderService } from './analytics-overview-header.service';

/**
 * State shared by the LeadFlow and Social Analytics. Imports neither product
 * module: the header is a scope-level document and reads no metric.
 */
@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature([AnalyticsOverviewHeaderEntity], 'agency'),
  ],
  controllers: [AnalyticsOverviewHeaderController],
  providers: [AnalyticsOverviewHeaderService],
  exports: [AnalyticsOverviewHeaderService],
})
export class AnalyticsOverviewModule {}
