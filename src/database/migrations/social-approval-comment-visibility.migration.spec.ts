import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialApprovalCommentVisibility1797400000000 } from './1797400000000-add-social-approval-comment-visibility';

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

const up = () =>
  collectSql((queryRunner) =>
    new AddSocialApprovalCommentVisibility1797400000000().up(queryRunner),
  );
const down = () =>
  collectSql((queryRunner) =>
    new AddSocialApprovalCommentVisibility1797400000000().down(queryRunner),
  );

describe('AP3 approval comment visibility migration', () => {
  it('is registered in the agency datasource', () => {
    // An unregistered agency migration fails only at runtime, in production.
    const names = (
      (AgencyDataSource.options.migrations ?? []) as Array<
        string | (new () => unknown)
      >
    ).map((migration) =>
      typeof migration === 'function' ? migration.name : String(migration),
    );
    expect(names).toContain('AddSocialApprovalCommentVisibility1797400000000');
  });

  it('adds the column defaulting to internal, so an untaught writer cannot leak', async () => {
    const sql = await up();

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "visibility"');
    expect(sql).toContain("NOT NULL DEFAULT 'internal'");
  });

  it('backfills every existing comment to internal without consulting stage', async () => {
    const sql = await up();

    expect(sql).toContain('UPDATE "social_approval_comments"');
    expect(sql).toContain(`SET "visibility" = 'internal'`);
    // CA0 §AC: `stage='client'` does not mean the client was the audience,
    // so the backfill must never branch on it.
    const backfill = sql
      .split('UPDATE "social_approval_comments"')[1]
      ?.split(';')[0];
    expect(backfill).not.toContain('stage');
  });

  it('constrains the vocabulary to internal and client', async () => {
    const sql = await up();

    expect(sql).toContain('CK_social_approval_comments_visibility');
    expect(sql).toContain(`CHECK ("visibility" IN ('internal', 'client'))`);
  });

  it('indexes the client read path only', async () => {
    const sql = await up();

    expect(sql).toContain('IDX_social_approval_comments_client_visible');
    expect(sql).toContain(`WHERE "visibility" = 'client'`);
  });

  it('creates the client notification ledger with a per-recipient idempotency key', async () => {
    const sql = await up();

    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "client_area_approval_notifications"',
    );
    expect(sql).toContain('UQ_client_area_approval_notifications_event_user');
    expect(sql).toContain('("tenant_id", "source_event_id", "user_id")');
  });

  it('reverses everything it created', async () => {
    const sql = await down();

    expect(sql).toContain(
      'DROP TABLE IF EXISTS "client_area_approval_notifications"',
    );
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "IDX_social_approval_comments_client_visible"',
    );
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "CK_social_approval_comments_visibility"',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS "visibility"');
  });

  it('is idempotent in both directions', async () => {
    // Every statement is guarded, so a re-run of either direction is a no-op
    // rather than an error. `postgres-spec-isolation` requires this: the
    // integration specs apply migrations against an already-migrated database.
    for (const sql of [await up(), await down()]) {
      for (const statement of sql.split(';').filter((s) => s.trim())) {
        if (/^\s*(UPDATE|ALTER TABLE "\w+"\s*$)/m.test(statement)) continue;
        if (statement.includes('ADD CONSTRAINT')) continue;
        expect(statement).toMatch(/IF (NOT )?EXISTS|ADD COLUMN IF NOT EXISTS/);
      }
    }
  });
});
