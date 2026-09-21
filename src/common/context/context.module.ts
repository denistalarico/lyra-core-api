import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyClient } from '../../modules/clients/entities';
import { AgencyClientCompanyContext } from '../../modules/clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../../modules/contacts/entities/contact.entity';
import { AgencyClientAccessEntity } from '../../modules/permissions/entities/agency-client-access.entity';
import { AgencyClientProductAccessEntity } from '../../modules/permissions/entities/agency-client-product-access.entity';
import { TenantProductEntitlementEntity } from '../../modules/platform/entities/tenant-product-entitlement.entity';
import { ManagedContextDirectoryService } from './managed-context-directory.service';
import { OperationalContextResolver } from './operational-context.resolver';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        AgencyClient,
        AgencyClientCompanyContext,
        ContactEntity,
        TenantProductEntitlementEntity,
        AgencyClientAccessEntity,
        AgencyClientProductAccessEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  providers: [OperationalContextResolver, ManagedContextDirectoryService],
  exports: [OperationalContextResolver, ManagedContextDirectoryService],
})
export class ContextModule {}
