import { Module } from '@nestjs/common';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { PermissionsModule } from '../permissions';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { AcquisitionCohortController } from './acquisition-cohort.controller';
import { AcquisitionCohortService } from './acquisition-cohort.service';
import { ObservedAttributionSummaryController } from './observed-attribution-summary.controller';
import { ObservedAttributionSummaryService } from './observed-attribution-summary.service';
import { ObservedAttributionController } from './observed-attribution.controller';
import { ObservedAttributionService } from './observed-attribution.service';

/**
 * Where cross-domain reads live.
 *
 * A module of its own rather than a controller added to Social or LeadFlow, and
 * the dependency arrows are the argument: this imports both products and
 * neither imports it. Put the same endpoint inside Social and Social would have
 * to import LeadFlow — after which "does Social depend on LeadFlow?" has the
 * answer "yes, for one report", and the next cross-domain view makes it two.
 *
 * It contains no fact source of its own and owns no table. Everything it
 * returns is composed at read time from the two I2 adapters, which is what
 * keeps the four rules that make Social numbers correct, and the client
 * predicate that makes LeadFlow numbers correct, in the domains that own them.
 */
@Module({
  imports: [
    SocialIntegrationsModule,
    LeadFlowAnalyticsModule,
    PermissionsModule,
  ],
  controllers: [
    AcquisitionCohortController,
    ObservedAttributionController,
    ObservedAttributionSummaryController,
  ],
  providers: [
    AcquisitionCohortService,
    ObservedAttributionService,
    ObservedAttributionSummaryService,
  ],
  exports: [
    AcquisitionCohortService,
    ObservedAttributionService,
    ObservedAttributionSummaryService,
  ],
})
export class IntelligenceAnalyticsModule {}
