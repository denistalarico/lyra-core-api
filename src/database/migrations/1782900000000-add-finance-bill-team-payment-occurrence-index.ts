import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hard idempotency for the Team → Finance integration. A team competence may
 * only ever produce a single payable, identified by
 * `metadata->>'teamPaymentOccurrenceKey'` (= "team_payment:<paymentId>").
 *
 * Mirrors the recurrence occurrence guard: a partial UNIQUE index so concurrent
 * confirm/approve/reprocess attempts can never create a duplicate bill, even if
 * the application-level pre-check races. The service also pre-checks and reuses
 * an existing bill, so this index is the belt-and-suspenders backstop.
 */
export class AddFinanceBillTeamPaymentOccurrenceIndex1782900000000
  implements MigrationInterface
{
  name = 'AddFinanceBillTeamPaymentOccurrenceIndex1782900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_bills_team_payment_occurrence"
      ON "finance_bills" ("tenant_id", "workspace_id", (("metadata" ->> 'teamPaymentOccurrenceKey')))
      WHERE ("metadata" ->> 'teamPaymentOccurrenceKey') IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_finance_bills_team_payment_occurrence"`,
    );
  }
}
