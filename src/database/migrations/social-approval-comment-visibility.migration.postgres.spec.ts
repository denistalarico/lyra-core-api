import { randomUUID } from 'crypto';
import { DataSource, type DataSourceOptions, type QueryRunner } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { assertSafePostgresTarget } from '../../testing/postgres-integration-guard';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AddSocialApprovalCommentVisibility1797400000000 } from './1797400000000-add-social-approval-comment-visibility';

const run = describePostgresIntegration();

/**
 * AP3 §59 — the comment visibility migration against a real PostgreSQL:
 * `up`, `down`, `up` again, with the data guarantees checked at each step.
 *
 * The second `up` is the part that matters operationally: a migration that
 * only works on a virgin schema breaks the moment a deploy is retried.
 */
run('AP3 comment visibility migration (PostgreSQL)', () => {
  let db: DataSource;
  let runner: QueryRunner;

  const T = randomUUID();
  const W = randomUUID();
  const approvalId = randomUUID();
  let legacyClientStageCommentId = '';

  const migration = () => new AddSocialApprovalCommentVisibility1797400000000();

  const columnExists = async () => {
    const rows = await db.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'social_approval_comments' AND column_name = 'visibility'`,
    );
    return rows.length > 0;
  };

  beforeAll(async () => {
    assertSafePostgresTarget();
    db = new DataSource({
      ...(getAgencyTypeOrmConfig() as unknown as DataSourceOptions),
      name: `ap3-migration-${randomUUID()}`,
    });
    await db.initialize();
    runner = db.createQueryRunner();
    await runner.connect();

    // Start from a schema without the column, whatever state the disposable
    // database happens to be in.
    await migration().down(runner);

    // `social_approval_requests.company_context_id` is a real foreign key, so
    // the fixture needs the organization → agency client → company chain.
    const [{ id: orgId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO contacts (tenant_id,workspace_id,type,display_name)
       VALUES ($1,$2,'organization','Empresa AP3 migration') RETURNING id`,
      [T, W],
    );
    const [{ id: clientId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO agency_clients (tenant_id,workspace_id,contact_id,display_name,managed_tenant_id)
       VALUES ($1,$2,$3,'Interno AP3',$4) RETURNING id`,
      [T, W, orgId, randomUUID()],
    );
    const [{ id: companyId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO agency_client_company_contexts
         (tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary)
       VALUES ($1,$2,$3,$4,'active',true) RETURNING id`,
      [T, W, clientId, orgId],
    );

    await runner.query(
      `INSERT INTO social_approval_requests
         (id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,
          source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id,requested_at)
       VALUES ($1,$2,$3,$4,$5,'planner_content_revision',$6,$7,'social_planner','content_revision',
               'Fixture AP3','r1','awaiting_client','client',$8,now())`,
      [
        approvalId,
        T,
        W,
        clientId,
        companyId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ],
    );

    // The exact row CA0 §AC warns about: an Agency note taken while the
    // request waits on the client, so `stage='client'` although nobody
    // intended the client to read it.
    const [row] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_approval_comments
         (approval_request_id,stage,actor_type,actor_user_id,body)
       VALUES ($1,'client','user',$2,'NOTA INTERNA pre-AP3') RETURNING id`,
      [approvalId, randomUUID()],
    );
    legacyClientStageCommentId = row.id;
  }, 60_000);

  afterAll(async () => {
    try {
      if (db?.isInitialized) {
        assertSafePostgresTarget();
        await runner.query(
          `ALTER TABLE "social_approval_comments" DISABLE TRIGGER "TRG_social_approval_comments_append_only"`,
        );
        await runner.query(
          `DELETE FROM social_approval_comments WHERE approval_request_id = $1`,
          [approvalId],
        );
        await runner.query(
          `ALTER TABLE "social_approval_comments" ENABLE TRIGGER "TRG_social_approval_comments_append_only"`,
        );
        await runner.query(
          `DELETE FROM social_approval_requests WHERE tenant_id = $1`,
          [T],
        );
        await runner.query(
          `DELETE FROM client_area_approval_notifications WHERE tenant_id = $1`,
          [T],
        );
        for (const table of [
          'agency_client_company_contexts',
          'agency_clients',
          'contacts',
        ]) {
          await runner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [T]);
        }
      }
    } finally {
      await runner?.release();
      await db?.destroy();
    }
  });

  it('adds the column and backfills every pre-existing comment to internal', async () => {
    expect(await columnExists()).toBe(false);

    await migration().up(runner);

    expect(await columnExists()).toBe(true);
    const [row] = await db.query<Array<{ visibility: string }>>(
      `SELECT visibility FROM social_approval_comments WHERE id = $1`,
      [legacyClientStageCommentId],
    );
    // stage='client', audience internal. Inferring from stage would have
    // published this note to the customer on day one.
    expect(row.visibility).toBe('internal');
  });

  it('defaults a comment that does not name a visibility to internal', async () => {
    const [row] = await db.query<Array<{ visibility: string }>>(
      `INSERT INTO social_approval_comments
         (approval_request_id,stage,actor_type,actor_user_id,body)
       VALUES ($1,'client','user',$2,'Sem visibility explicita')
       RETURNING visibility`,
      [approvalId, randomUUID()],
    );
    expect(row.visibility).toBe('internal');
  });

  it('accepts a client comment', async () => {
    const [row] = await db.query<Array<{ visibility: string }>>(
      `INSERT INTO social_approval_comments
         (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
       VALUES ($1,'client','client','user',$2,'Do cliente') RETURNING visibility`,
      [approvalId, randomUUID()],
    );
    expect(row.visibility).toBe('client');
  });

  it('rejects any visibility outside the vocabulary', async () => {
    await expect(
      runner.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','public','user',$2,'Invalida')`,
        [approvalId, randomUUID()],
      ),
    ).rejects.toThrow(
      /CK_social_approval_comments_visibility|check constraint/i,
    );
  });

  it('creates a notification ledger that refuses a duplicate per recipient', async () => {
    const shared = {
      workspaceId: randomUUID(),
      companyContextId: randomUUID(),
      userId: randomUUID(),
      membershipId: randomUUID(),
      eventId: `client_area.approval.awaiting_client:${approvalId}:2026-01-02T10:00:00.000Z`,
    };
    const insert = () =>
      runner.query(
        `INSERT INTO client_area_approval_notifications
           (tenant_id,workspace_id,company_context_id,approval_request_id,source_event_id,event_type,user_id,membership_id)
         VALUES ($1,$2,$3,$4,$5,'client_area.approval.awaiting_client',$6,$7)`,
        [
          T,
          shared.workspaceId,
          shared.companyContextId,
          approvalId,
          shared.eventId,
          shared.userId,
          shared.membershipId,
        ],
      );

    await insert();
    // The retry of the same source event for the same person.
    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
  });

  it('reverses cleanly and re-applies (up, down, up)', async () => {
    await migration().down(runner);
    expect(await columnExists()).toBe(false);

    const ledger = await db.query<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name = 'client_area_approval_notifications'`,
    );
    expect(ledger).toHaveLength(0);

    await migration().up(runner);
    expect(await columnExists()).toBe(true);

    // The comments survived the round trip and are internal again.
    const rows = await db.query<Array<{ visibility: string }>>(
      `SELECT visibility FROM social_approval_comments WHERE approval_request_id = $1`,
      [approvalId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.visibility === 'internal')).toBe(true);
  });

  it('is idempotent: a repeated up changes nothing', async () => {
    await expect(migration().up(runner)).resolves.toBeUndefined();
    expect(await columnExists()).toBe(true);
  });
});
