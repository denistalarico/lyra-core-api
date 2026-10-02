import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddNotificationRecipientSurface1797600000000 } from './1797600000000-add-notification-recipient-surface';

const run = describePostgresIntegration();

/**
 * Asserts a statement is rejected, without poisoning the transaction.
 *
 * A failed statement inside a transaction aborts it, so every later query
 * answers "current transaction is aborted" — which would make the rest of a
 * spec fail for a reason that has nothing to do with the schema under test.
 * The savepoint scopes the failure to the statement being asserted.
 */
async function expectRejected(
  queryRunner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await queryRunner.query(`SAVEPOINT expect_rejected`);
  let rejected = false;
  try {
    await queryRunner.query(sql, params);
  } catch {
    rejected = true;
  }
  await queryRunner.query(`ROLLBACK TO SAVEPOINT expect_rejected`);
  expect(rejected).toBe(true);
}

/**
 * NTF-C1 §53 — the surface migration against real PostgreSQL.
 *
 * `up → down → up`, because a `down` that cannot be followed by an `up` is not
 * a rollback, and because swapping a unique index is exactly the kind of
 * change that works once and fails on replay.
 *
 * Everything runs inside one transaction that is always rolled back, so the
 * disposable test database is left as it was found — the convention every
 * migration suite here follows since the production-wipe incident.
 */
run('notification recipient surface migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('applies defaults, CHECK, the new unique and the indexes, and rolls back', async () => {
    const migration = new AddNotificationRecipientSurface1797600000000();
    const queryRunner = AgencyDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    const indexExists = async (name: string) => {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        [name],
      )) as unknown[];
      return rows.length > 0;
    };

    const constraintExists = async (name: string) => {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema = 'public' AND constraint_name = $1`,
        [name],
      )) as unknown[];
      return rows.length > 0;
    };


    try {
      // The disposable database may already carry this migration.
      await migration.down(queryRunner);

      // A pre-migration recipient, so the backfill has something to act on.
      const [notification] = (await queryRunner.query(
        `INSERT INTO "notifications" (
           "tenant_id", "product_key", "module_key", "event_type", "category",
           "priority", "title", "body", "action_type", "actor_type",
           "source_event_id", "template_key", "occurred_at"
         ) VALUES (
           gen_random_uuid(), 'social', 'approvals',
           'social.approval.awaiting_client', 'approval', 'normal',
           'Aprovação', 'Corpo', 'internal_route', 'system',
           'ntf-c1-postgres-spec', 'notifications.test', now()
         ) RETURNING "id"`,
      )) as Array<{ id: string }>;

      const [{ id: userId }] = (await queryRunner.query(
        `SELECT gen_random_uuid() AS id`,
      )) as Array<{ id: string }>;

      await queryRunner.query(
        `INSERT INTO "notification_recipients" ("notification_id", "user_id", "interest_reason")
         VALUES ($1, $2, 'requester')`,
        [notification.id, userId],
      );

      await migration.up(queryRunner);

      // §52 — the existing row became `agency`, with no heuristic applied.
      const backfilled = (await queryRunner.query(
        `SELECT "recipient_surface" FROM "notification_recipients" WHERE "notification_id" = $1`,
        [notification.id],
      )) as Array<{ recipient_surface: string }>;
      expect(backfilled).toEqual([{ recipient_surface: 'agency' }]);

      // The column default covers a writer that knows nothing of surfaces.
      const [{ id: otherUserId }] = (await queryRunner.query(
        `SELECT gen_random_uuid() AS id`,
      )) as Array<{ id: string }>;
      await queryRunner.query(
        `INSERT INTO "notification_recipients" ("notification_id", "user_id", "interest_reason")
         VALUES ($1, $2, 'participant')`,
        [notification.id, otherUserId],
      );
      const defaulted = (await queryRunner.query(
        `SELECT "recipient_surface" FROM "notification_recipients" WHERE "user_id" = $1`,
        [otherUserId],
      )) as Array<{ recipient_surface: string }>;
      expect(defaulted).toEqual([{ recipient_surface: 'agency' }]);

      // §44 — the same identity on both surfaces of one notification, which
      // the old unique key would have rejected.
      await queryRunner.query(
        `INSERT INTO "notification_recipients"
           ("notification_id", "user_id", "interest_reason", "recipient_surface")
         VALUES ($1, $2, 'approver', 'client_area')`,
        [notification.id, userId],
      );
      const bothSurfaces = (await queryRunner.query(
        `SELECT "recipient_surface" FROM "notification_recipients"
          WHERE "notification_id" = $1 AND "user_id" = $2
          ORDER BY "recipient_surface"`,
        [notification.id, userId],
      )) as Array<{ recipient_surface: string }>;
      expect(bothSurfaces.map((row) => row.recipient_surface)).toEqual([
        'agency',
        'client_area',
      ]);

      // ...but still only once per surface: retries stay idempotent.
      await expectRejected(
        queryRunner,
        `INSERT INTO "notification_recipients"
           ("notification_id", "user_id", "interest_reason", "recipient_surface")
         VALUES ($1, $2, 'approver', 'client_area')`,
        [notification.id, userId],
      );

      expect(
        await indexExists('uq_notification_recipients_notification_surface_user'),
      ).toBe(true);
      expect(
        await indexExists('idx_notification_recipients_surface_user_created'),
      ).toBe(true);
      // The old key must be gone: kept, it would still reject the second
      // surface and the new index would be decorative.
      expect(
        await indexExists('uq_notification_recipients_notification_user'),
      ).toBe(false);
      expect(
        await constraintExists('chk_notification_recipients_surface'),
      ).toBe(true);
      expect(
        await indexExists(
          'idx_notification_push_subscriptions_tenant_surface_user',
        ),
      ).toBe(true);
      expect(
        await constraintExists('chk_notification_push_subscriptions_surface'),
      ).toBe(true);
      // §23 — the endpoint unique is preserved, not replaced.
      expect(
        await indexExists('uq_notification_push_subscriptions_endpoint'),
      ).toBe(true);

      // Replayable after a rollback.
      await migration.down(queryRunner);
      expect(
        await indexExists('uq_notification_recipients_notification_user'),
      ).toBe(true);
      expect(
        await constraintExists('chk_notification_recipients_surface'),
      ).toBe(false);

      await migration.up(queryRunner);
      expect(
        await indexExists('uq_notification_recipients_notification_surface_user'),
      ).toBe(true);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  it('refuses a surface outside the vocabulary, on both tables', async () => {
    const migration = new AddNotificationRecipientSurface1797600000000();
    const queryRunner = AgencyDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await migration.down(queryRunner);
      await migration.up(queryRunner);

      const [notification] = (await queryRunner.query(
        `INSERT INTO "notifications" (
           "tenant_id", "product_key", "module_key", "event_type", "category",
           "priority", "title", "body", "action_type", "actor_type",
           "source_event_id", "template_key", "occurred_at"
         ) VALUES (
           gen_random_uuid(), 'social', 'approvals',
           'social.approval.awaiting_client', 'approval', 'normal',
           'Aprovação', 'Corpo', 'internal_route', 'system',
           'ntf-c1-postgres-check', 'notifications.test', now()
         ) RETURNING "id"`,
      )) as Array<{ id: string }>;

      await expectRejected(
        queryRunner,
        `INSERT INTO "notification_recipients"
           ("notification_id", "user_id", "interest_reason", "recipient_surface")
         VALUES ($1, gen_random_uuid(), 'approver', 'partner_portal')`,
        [notification.id],
      );

      await expectRejected(
        queryRunner,
        `INSERT INTO "notification_push_subscriptions"
           ("tenant_id", "user_id", "endpoint", "p256dh_key", "auth_key", "surface")
         VALUES (gen_random_uuid(), gen_random_uuid(),
                 'https://push.example.com/ntf-c1', 'p', 'a', 'partner_portal')`,
      );
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  /**
   * §25 — a push endpoint stays globally unique across surfaces. This is what
   * makes a re-registration from the other surface *move* the row instead of
   * creating a second owner of one device channel (§58).
   */
  it('keeps the push endpoint unique across surfaces', async () => {
    const migration = new AddNotificationRecipientSurface1797600000000();
    const queryRunner = AgencyDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await migration.down(queryRunner);
      await migration.up(queryRunner);

      await queryRunner.query(
        `INSERT INTO "notification_push_subscriptions"
           ("tenant_id", "user_id", "endpoint", "p256dh_key", "auth_key", "surface")
         VALUES (gen_random_uuid(), gen_random_uuid(),
                 'https://push.example.com/ntf-c1-shared', 'p', 'a', 'agency')`,
      );

      await expectRejected(
        queryRunner,
        `INSERT INTO "notification_push_subscriptions"
           ("tenant_id", "user_id", "endpoint", "p256dh_key", "auth_key", "surface")
         VALUES (gen_random_uuid(), gen_random_uuid(),
                 'https://push.example.com/ntf-c1-shared', 'p', 'a', 'client_area')`,
      );
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
