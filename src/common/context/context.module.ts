import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyClient } from '../../modules/clients/entities';
import { OperationalContextResolver } from './operational-context.resolver';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [TypeOrmModule.forFeature([AgencyClient], AGENCY_CONNECTION)],
  providers: [OperationalContextResolver],
  exports: [OperationalContextResolver],
})
export class ContextModule {}
