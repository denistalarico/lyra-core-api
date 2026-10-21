import { CompanyLogoRegistryModule } from '../../common/client-area-bridge/company-logo.registry';
import { CompanyProductClientAccessGuard } from './controllers/company-product-client-access.guard';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import { CompanyProductWriteInterceptor } from '../../common/company-products/company-product-write.interceptor';
import { ClientCompanyProductsService } from './services/client-company-products.service';
import { ClientManagedTenantProvisioningService } from './services/client-managed-tenant-provisioning.service';
import { ClientCompanyProductsScheduler } from './services/client-company-products.scheduler';
import { ClientCompanyProductsController } from './controllers/client-company-products.controller';
import { AgencyContactsModule } from '../agency/agency-contacts.module';
import { AgencyClientLifecycleHooks } from './agency-client-lifecycle-hooks';
import { ClientCompanySetupService } from './services/client-company-setup.service';
import { ContractRecord, ContractDefaults } from '../contracts/entities';
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
import { ClientsPortfolioMonthlyController } from './controllers/clients-portfolio-monthly.controller';
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
    CompanyLogoRegistryModule,
    CompanyProductsModule,
    AgencyContactsModule,
    FinanceModule,
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        ContractRecord,
        ContractDefaults,
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
    ClientCompanyProductsController,
    ClientsController,
    ClientsPortfolioMonthlyController,
    ClientCompaniesController,
    CompanyContextReconciliationController,
    ClientLifecycleController,
  ],
  providers: [
    CompanyProductClientAccessGuard,
    ClientCompanyProductsService,
    ClientManagedTenantProvisioningService,
    ClientCompanyProductsScheduler,
    { provide: APP_INTERCEPTOR, useClass: CompanyProductWriteInterceptor },
    AgencyClientLifecycleHooks,
    ClientCompanySetupService,
    ClientsService,
    AgencyClientCompanyContextService,
    CompanyLegacyReconciliationService,
    ClientsProfitabilityService,
    ClientNotificationPublisher,
    ClientLifecycleService,
    ClientCostCenterService,
  ],
  exports: [
    AgencyClientLifecycleHooks,
    ClientsService,
    ClientsProfitabilityService,
    ClientCostCenterService,
  ],
})
export class ClientsModule {}
