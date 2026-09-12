import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialPlanGeneration1793000000000 } from './1793000000000-add-social-plan-generation';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const queryRunner = {
    query: jest.fn((statement: string) => {
      sql.push(statement);
      return Promise.resolve();
    }),
  };
  return run(queryRunner as never).then(() => sql.join('\n'));
}

describe('social plan generation migration', () => {
  it('lets a plan run exist without a content item', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPlanGeneration1793000000000().up(queryRunner),
    );

    expect(sql).toContain('ALTER COLUMN "content_item_id" DROP NOT NULL');
    expect(sql).toContain("'plan_grid'");
  });

  /**
   * The nullability is for one kind only. Without this CHECK a bug in the copy
   * path could write a run with no content item and nothing would notice until
   * a proposal had nowhere to land.
   */
  it('still requires a content item for every copy run', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPlanGeneration1793000000000().up(queryRunner),
    );

    expect(sql).toContain('CK_social_copy_generation_runs_content_required');
    expect(sql).toContain(
      '"run_kind" = \'plan_grid\' OR "content_item_id" IS NOT NULL',
    );
  });

  /**
   * The pre-existing in-flight guard is keyed on `content_item_id`, which is
   * NULL for plan runs — and NULLs are distinct in a Postgres unique index, so
   * without this a double-clicked button would reach the provider twice.
   */
  it('guards against two concurrent plan generations for one plan', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPlanGeneration1793000000000().up(queryRunner),
    );

    expect(sql).toContain('UQ_social_copy_generation_runs_plan_in_flight');
    expect(sql).toContain(
      'WHERE "run_kind" = \'plan_grid\' AND "status" IN (\'queued\', \'processing\')',
    );
  });

  it('records what the operator asked for', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPlanGeneration1793000000000().up(queryRunner),
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "requested_items" integer');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "commemorative_date_keys" jsonb',
    );
    expect(sql).toContain('ALTER COLUMN "instruction" TYPE varchar(2000)');
  });

  it('removes plan runs on the way down rather than faking a content item', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPlanGeneration1793000000000().down(queryRunner),
    );

    expect(sql).toContain(
      `DELETE FROM "social_copy_generation_runs" WHERE "run_kind" = 'plan_grid'`,
    );
    expect(sql).toContain('ALTER COLUMN "content_item_id" SET NOT NULL');
  });

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddSocialPlanGeneration1793000000000,
    );
  });
});
