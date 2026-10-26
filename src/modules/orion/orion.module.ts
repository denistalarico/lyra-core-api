import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AgencyContactsModule } from '../agency/agency-contacts.module';
import { AiCostsModule } from '../ai-costs/ai-costs.module';
import { CrmModule } from '../crm/crm.module';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { LeadFlowAgentsModule } from '../leadflow-agents/leadflow-agents.module';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { PermissionsModule } from '../permissions';
import { OrionBudgetService } from './orion-budget.service';
import { OrionConfigService } from './orion-config.service';
import { OrionController } from './orion.controller';
import { OrionProvider } from './orion.provider';
import { OrionService } from './orion.service';
import { OrionHelpSearchService } from './tools/orion-help-search.service';
import { OrionToolAccessService } from './tools/orion-tool-access.service';
import { OrionProposalService } from './tools/orion-proposal.service';
import { OrionToolsService } from './tools/orion-tools.service';

/**
 * OR4 — the Orion, assistant of the platform (D-OR-2). Not a LeadFlow agent:
 * no row in `leadflow_agents`, nothing to edit or pause. Exports the service
 * so the Team Chat (OR6) and the client chat (OR7) can call it server-side.
 *
 * `orion_turns` is written with SQL under an advisory lock (no repository);
 * `OrionTurnEntity` is registered in `agencyEntities` for its metadata.
 */
@Module({
  imports: [
    JwtModule.register({}),
    AiCostsModule,
    PermissionsModule,
    LeadFlowAgentsModule,
    LeadFlowAnalyticsModule,
    CrmModule,
    // Agenda → appointments → Team Chat → Orion (OR6) closes a file-level
    // cycle; the forward reference keeps the import defined at decoration.
    forwardRef(() => LeadFlowAgendaModule),
    // OR5: contact names are resolved for proposals.
    AgencyContactsModule,
  ],
  controllers: [OrionController],
  providers: [
    OrionConfigService,
    OrionProvider,
    OrionBudgetService,
    OrionHelpSearchService,
    OrionToolAccessService,
    OrionProposalService,
    OrionToolsService,
    OrionService,
  ],
  exports: [OrionService, OrionConfigService],
})
export class OrionModule {}
