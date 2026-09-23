import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities/leadflow-client-settings.entity';
import {
  SocialCampaignInstanceEntity,
  SocialCampaignTemplateEntity,
  SocialContentDestinationEntity,
  SocialContentIdeaEntity,
  SocialContentItemEntity,
  SocialCopyGenerationProposalEntity,
  SocialCopyGenerationRunEntity,
  SocialDestinationCreativeEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
  SocialContentRevisionEntity,
  SocialPlannerSettingsEntity,
  SocialPublishingCadenceEntity,
} from './entities';
import { SocialPlannerController } from './social-planner.controller';
import { SocialContentPublicationGuard } from './services/content-publication-guard.port';
import { SocialCampaignService } from './services/social-campaign.service';
import { SocialContentLifecycleService } from './services/social-content-lifecycle.service';
import { SocialCopyGenerationConfigService } from './services/social-copy-generation-config.service';
import { SocialCopyGenerationProvider } from './services/social-copy-generation-provider';
import { SocialCopyGenerationStateMachine } from './services/social-copy-generation-state-machine';
import { SocialCopyGenerationService } from './services/social-copy-generation.service';
import { SocialCopyGenerationWorker } from './services/social-copy-generation.worker';
import { SocialBrandContextPort } from './services/social-brand-context.port';
import { SocialPlanGenerationProvider } from './services/social-plan-generation-provider';
import { SocialPlanGenerationService } from './services/social-plan-generation.service';
import { SocialPlannerService } from './services/social-planner.service';
import { SocialPlannerSettingsService } from './services/social-planner-settings.service';
import { SocialPublishingCadenceService } from './services/social-publishing-cadence.service';

@Module({
  imports: [
    PermissionsModule,
    SocialApprovalsModule,
    TypeOrmModule.forFeature(
      [
        SocialPlanEntity,
        SocialContentItemEntity,
        SocialContentDestinationEntity,
        /**
         * Read by `SocialContentLifecycleService` so a duplicate carries its
         * creatives. The entity lives in this module (E5 put it here because
         * the Planner owns the destination); only the service that validates
         * capability lives in `social-organic`.
         */
        SocialDestinationCreativeEntity,
        SocialContentRevisionEntity,
        /**
         * Copy generation (E8). The runs and their staged proposals live in this
         * module because the Planner owns the content they describe, and because
         * the accept path has to write a `social_content_revisions` row in the
         * same transaction.
         */
        SocialCopyGenerationRunEntity,
        SocialCopyGenerationProposalEntity,
        SocialPlannerSettingsEntity,
        SocialPublishingCadenceEntity,
        SocialCampaignTemplateEntity,
        SocialCampaignInstanceEntity,
        SocialEditorialPillarEntity,
        SocialContentIdeaEntity,
        /**
         * Read-only, through `SocialBrandContextPort`. Plan generation grounds
         * its prompt in the brand facts the agency already declared once in
         * /social/settings#brand-kit, and the commemorative date picker filters
         * by the country and business mode stored on the same row. Registered
         * here rather than importing LeadFlowSettingsModule because the Planner
         * needs the row without the request-scoped permission checks that
         * module's read methods perform — see the port's doc comment.
         */
        LeadFlowClientSettingsEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialPlannerController],
  providers: [
    SocialPlannerService,
    SocialContentLifecycleService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
    SocialCampaignService,
    SocialCopyGenerationConfigService,
    SocialCopyGenerationStateMachine,
    SocialCopyGenerationProvider,
    SocialCopyGenerationService,
    /**
     * Plan generation (the "Criar com IA" button). Shares the copy generation
     * config — one deployment decision configures the provider for both — but
     * keeps its own prompt, schema and provider class, because the two calls
     * state opposite goals.
     */
    SocialBrandContextPort,
    SocialPlanGenerationProvider,
    SocialPlanGenerationService,
    /**
     * The only provider here that runs on a timer. It is inert unless
     * `SOCIAL_COPY_GENERATION_PROVIDER_MODE` is set away from its `disabled`
     * default, so importing this module never starts paying for a provider.
     */
    SocialCopyGenerationWorker,
    /**
     * Provided AND exported so `social-organic` can register its publication
     * source into the same instance. The Planner owns the class; Organic
     * imports this module, which is the direction that was already true.
     */
    SocialContentPublicationGuard,
  ],
  exports: [
    SocialPlannerService,
    SocialContentLifecycleService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
    SocialCampaignService,
    SocialCopyGenerationService,
    SocialPlanGenerationService,
    SocialContentPublicationGuard,
  ],
})
export class SocialPlannerModule {}
