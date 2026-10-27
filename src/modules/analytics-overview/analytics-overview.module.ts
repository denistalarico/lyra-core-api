import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientAreaBridgeRegistryModule } from '../../common/client-area-bridge/client-area-bridge.registry';
import { PermissionsModule } from '../permissions';
import { AnalyticsOverviewHeaderController } from './analytics-overview-header.controller';
import { AnalyticsOverviewHeaderEntity } from './analytics-overview-header.entity';
import { AnalyticsOverviewHeaderService } from './analytics-overview-header.service';
import { AnalyticsOverviewClientAreaScope } from './analytics-overview-client-area-scope';

/**
 * State shared by the LeadFlow and Social Analytics. Imports neither product
 * module: the header is a scope-level document and reads no metric.
 */
@Module({
  imports: [
    ClientAreaBridgeRegistryModule,
    PermissionsModule,
    TypeOrmModule.forFeature([AnalyticsOverviewHeaderEntity], 'agency'),
  ],
  controllers: [AnalyticsOverviewHeaderController],
  providers: [AnalyticsOverviewHeaderService, AnalyticsOverviewClientAreaScope],
  exports: [AnalyticsOverviewHeaderService],
})
export class AnalyticsOverviewModule {}
