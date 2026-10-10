import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCostLedgerService } from './ai-cost-ledger.service';
import { AiOperationalCostEntity } from './entities';

/**
 * CS6-B — provider-neutral AI cost ledger. Depends on nothing but its table:
 * producing domains (Creative Studio) import it to write, Finance imports it
 * to read. Neither direction ever reaches a provider's own tables.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AiOperationalCostEntity], 'agency')],
  providers: [AiCostLedgerService],
  exports: [AiCostLedgerService],
})
export class AiCostsModule {}
