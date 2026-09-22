import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyActivity, AgencyActivityLink } from '../activities/entities';
import { FinanceModule } from '../finance';
import { FinanceCostCenter } from '../finance/entities';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { TenantProductEntitlementEntity } from '../platform/entities/tenant-product-entitlement.entity';
import { ContactCompanyLinkEntity } from '../contacts/entities/contact-company-link.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { AgencyProject, AgencyTask } from '../projects/entities';
import { TeamConfigOption } from '../team/entities';
import { ClientLifecycleController } from './controllers/client-lifecycle.controller';
import { ClientCompaniesController } from './controllers/client-companies.controller';
import { CompanyContextReconciliationController } from './controllers/company-context-reconciliation.controller';
import { ClientsController } from './controllers/clients.controller';
import {
  AgencyClient,
  AgencyClientCompanyContext,
  ClientLifecycleProcess,
  ClientLifecycleStep,
  CompanyContextReconciliationAudit,
} from './entities';
import { CompanyLegacyReconciliationService } from './reconciliation/company-legacy-reconciliation.service';
import { AgencyClientCompanyContextService } from './services/agency-client-company-context.service';
import { ClientCostCenterService } from './services/client-cost-center.service';
import { ClientLifecycleService } from './services/client-lifecycle.service';
import { ClientNotificationPublisher } from './services/client-notification.publisher';
import { ClientsProfitabilityService } from './services/clients-profitability.service';
import { ClientsService } from './services/clients.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FinanceModule,
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        AgencyClient,
        AgencyClientCompanyContext,
        CompanyContextReconciliationAudit,
        ContactEntity,
        ContactCompanyLinkEntity,
        AgencyProject,
        AgencyTask,
        AgencyActivity,
        AgencyActivityLink,
        TeamConfigOption,
        ClientLifecycleProcess,
        ClientLifecycleStep,
        FinanceCostCenter,
        TenantProductEntitlementEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [
    ClientsController,
    ClientCompaniesController,
    CompanyContextReconciliationController,
    ClientLifecycleController,
  ],
  providers: [
    ClientsService,
    AgencyClientCompanyContextService,
    CompanyLegacyReconciliationService,
    ClientsProfitabilityService,
    ClientNotificationPublisher,
    ClientLifecycleService,
    ClientCostCenterService,
  ],
  exports: [
    ClientsService,
    ClientsProfitabilityService,
    ClientCostCenterService,
  ],
})
export class ClientsModule {}
