import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CreateAppointmentsCore1760000019000 } from './1760000019000-create-appointments-core';

/**
 * Installs the existing scheduled-items schema in the Agency datasource.
 *
 * The legacy Suite used the default datasource. LeadFlow events and their
 * transactional outbox live in the Agency datasource, so Phase 9 deliberately
 * reuses the proven schema there instead of inventing a second appointment
 * model. Historical cross-database backfill remains an explicit deployment
 * operation and is not performed by this migration.
 */
export class CreateLeadflowAppointmentsCore1788000000000 implements MigrationInterface {
  name = 'CreateLeadflowAppointmentsCore1788000000000';

  private readonly legacySchema = new CreateAppointmentsCore1760000019000();

  up(queryRunner: QueryRunner): Promise<void> {
    return this.legacySchema.up(queryRunner);
  }

  down(queryRunner: QueryRunner): Promise<void> {
    return this.legacySchema.down(queryRunner);
  }
}
