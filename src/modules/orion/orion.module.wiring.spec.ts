import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ClientAreaBridgeRegistryModule } from '../../common/client-area-bridge/client-area-bridge.registry';
import { OperationalContextResolver } from '../../common/context/operational-context.resolver';
import { AiCostLedgerService } from '../ai-costs/ai-cost-ledger.service';
import { AiCostsModule } from '../ai-costs/ai-costs.module';
import { CrmModule } from '../crm/crm.module';
import { CrmService } from '../crm/crm.service';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { LeadFlowAgendaService } from '../leadflow-agenda/leadflow-agenda.service';
import { LeadFlowAgentsModule } from '../leadflow-agents/leadflow-agents.module';
import { LeadFlowAgentService } from '../leadflow-agents/services/leadflow-agent.service';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { LeadFlowAnalyticsService } from '../leadflow-analytics/services/leadflow-analytics.service';
import { LeadFlowOperationalAnalyticsService } from '../leadflow-analytics/services/leadflow-operational-analytics.service';
import { PermissionsModule } from '../permissions';
import { PermissionScopeEvaluatorService } from '../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { OrionController } from './orion.controller';
import { OrionModule } from './orion.module';
import { OrionService } from './orion.service';

@Global()
@Module({
  providers: [
    { provide: getDataSourceToken('agency'), useValue: { query: jest.fn() } },
  ],
  exports: [getDataSourceToken('agency')],
})
class FixtureDatabase {}

const fixture = (...tokens: unknown[]) => {
  @Module({
    providers: tokens.map((provide) => ({
      provide: provide as never,
      useValue: {},
    })),
    exports: tokens as never[],
  })
  class Fixture {}
  return Fixture;
};

/**
 * OR4 — the production `OrionModule` resolves every provider of its own and
 * the controller boots. Product modules are replaced by fixtures exporting
 * the exact tokens the Orion consumes, so a missing export or provider here
 * fails the spec instead of the API boot.
 */
describe('OrionModule wiring', () => {
  it('resolves the service and the controller', async () => {
    const mod = await Test.createTestingModule({
      imports: [FixtureDatabase, ClientAreaBridgeRegistryModule, OrionModule],
    })
      .overrideModule(AiCostsModule)
      .useModule(fixture(AiCostLedgerService))
      .overrideModule(PermissionsModule)
      // The real module also exports ContextModule, which the guard needs.
      .useModule(
        fixture(
          PlatformPermissionService,
          PermissionScopeEvaluatorService,
          PermissionsGuard,
          OperationalContextResolver,
        ),
      )
      .overrideModule(LeadFlowAgentsModule)
      .useModule(fixture(LeadFlowAgentService))
      .overrideModule(LeadFlowAnalyticsModule)
      .useModule(
        fixture(LeadFlowAnalyticsService, LeadFlowOperationalAnalyticsService),
      )
      .overrideModule(CrmModule)
      .useModule(fixture(CrmService))
      .overrideModule(LeadFlowAgendaModule)
      .useModule(fixture(LeadFlowAgendaService))
      .compile();
    try {
      expect(mod.get(OrionService)).toBeInstanceOf(OrionService);
      expect(mod.get(OrionController)).toBeInstanceOf(OrionController);
    } finally {
      await mod.close();
    }
  });
});
