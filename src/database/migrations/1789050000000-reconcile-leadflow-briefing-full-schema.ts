import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CreateLeadflowBriefingProvenance1788500000000 } from './1788500000000-create-leadflow-briefing-provenance';

/**
 * Replays the complete, idempotent Briefing schema in dependency order.
 *
 * Some Agency databases recorded an earlier revision of 1788500000000 while
 * one or more Briefing tables were still absent. This migration intentionally
 * sorts before 1789100000000, whose foreign keys require the base source,
 * version and extraction-job tables to exist first.
 *
 * Keeping this as a new forward-only migration means already-run migrations
 * are never edited and every environment gets one deterministic repair pass.
 */
export class ReconcileLeadflowBriefingFullSchema1789050000000 implements MigrationInterface {
  name = 'ReconcileLeadflowBriefingFullSchema1789050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await new CreateLeadflowBriefingProvenance1788500000000().up(queryRunner);
  }

  public async down(): Promise<void> {
    // Forward-only reconciliation: the repaired tables may predate this run.
  }
}
