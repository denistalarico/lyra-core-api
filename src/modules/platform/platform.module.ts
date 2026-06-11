import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantProductEntitlementEntity } from './entities/tenant-product-entitlement.entity';
import { PlatformContextController } from './platform-context.controller';
import { PlatformContextService } from './platform-context.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [TenantProductEntitlementEntity],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [PlatformContextController],
  providers: [PlatformContextService],
  exports: [PlatformContextService],
})
export class PlatformModule {}
