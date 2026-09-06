import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import { SocialPublicationRunService } from './social-publication-run.service';

const run = describePostgresIntegration();

run('SocialPublicationRunService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const planId = randomUUID();
  const contentItemId = randomUUID();
  const connectionId = randomUUID();
  const assetId = randomUUID();

  let repository: Repository<SocialPublicationEntity>;
  let service: SocialPublicationRunService;
  let other: SocialPublicationRunService;

  const build = () =>
    new SocialPublicationRunService(repository, AgencyDataSource);

  async function insertPublication(overrides: Record<string, unknown> = {}) {
    const id = randomUUID();

    await AgencyDataSource.query(
      `INSERT INTO social_publications
         ("id", "tenant_id", "workspace_id", "agency_client_id",
          "content_item_id", "destination_id", "provider", "connection_id",
          "asset_id", "external_asset_id", "status", "scheduled_at",
          "payload_snapshot", "payload_hash", "idempotency_key",
          "available_at", "attempts", "max_attempts", "locked_at", "locked_by")
       VALUES ($1, $2, $3, NULL, $4, NULL, 'meta', $5, $6, $7, $8, $9,
               '{}'::jsonb, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        tenantId,
        workspaceId,
        contentItemId,
        connectionId,
        assetId,
        `external-${assetId}`,
        overrides.status ?? 'queued',
        overrides.scheduledAt ?? new Date(),
        'a'.repeat(64),
        `key-${id}`,
        overrides.availableAt ?? new Date(),
        overrides.attempts ?? 0,
        overrides.maxAttempts ?? 5,
        overrides.lockedAt ?? null,
        overrides.lockedBy ?? null,
      ],
    );

    return id;
  }

  async function rowOf(id: string) {
    const rows: unknown[] = await AgencyDataSource.query(
      `SELECT status, attempts, locked_at, locked_by, last_error_code,
              failure_reason, external_publication_id
         FROM social_publications
        WHERE id = $1`,
      [id],
    );

    return rows[0] as {
      status: string;
      attempts: number;
      locked_at: Date | null;
      locked_by: string | null;
      last_error_code: string | null;
      failure_reason: string | null;
      external_publication_id: string | null;
    };
  }

  const clearPublications = () =>
    AgencyDataSource.query(
      `DELETE FROM social_publications WHERE content_item_id = $1`,
      [contentItemId],
    );

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    repository = AgencyDataSource.getRepository(SocialPublicationEntity);
    service = build();
    other = build();

    await AgencyDataSource.query(
      `INSERT INTO social_plans
         (id, tenant_id, workspace_id, title, period_start, period_end)
       VALUES ($1, $2, $3, 'P2 test plan', '2026-09-01', '2026-09-30')`,
      [planId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO social_content_items
         (id, tenant_id, workspace_id, plan_id, title)
       VALUES ($1, $2, $3, $4, 'P2 test content')`,
      [contentItemId, tenantId, workspaceId, planId],
    );
    await AgencyDataSource.query(
      `INSERT INTO social_organic_connections
         (id, tenant_id, workspace_id, provider, authorization_method)
       VALUES ($1, $2, $3, 'meta', 'oauth_user')`,
      [connectionId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO social_organic_assets
         (id, tenant_id, workspace_id, connection_id, provider, asset_type,
          external_asset_id)
       VALUES ($1, $2, $3, $4, 'meta', 'facebook_page', $5)`,
      [assetId, tenantId, workspaceId, connectionId, `external-${assetId}`],
    );
  });

  afterAll(async () => {
    try {
      await clearPublications();
      await AgencyDataSource.query(
        `DELETE FROM social_organic_assets WHERE id = $1`,
        [assetId],
      );
      await AgencyDataSource.query(
        `DELETE FROM social_organic_connections WHERE id = $1`,
        [connectionId],
      );
      await AgencyDataSource.query(`DELETE FROM social_plans WHERE id = $1`, [
        planId,
      ]);
    } finally {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    }
  });

  beforeEach(clearPublications);

  it('lets exactly one of two workers claim one row', async () => {
    const id = await insertPublication();

    const [mine, theirs] = await Promise.all([
      service.claim({ workerId: 'worker-a', limit: 1 }),
      other.claim({ workerId: 'worker-b', limit: 1 }),
    ]);
    const claimed = [...mine, ...theirs];

    expect(claimed.map((row) => row.id)).toEqual([id]);
    expect((await rowOf(id)).attempts).toBe(1);
  });

  it('rejects the original worker write after lease recovery and re-claim', async () => {
    const id = await insertPublication({
      status: 'processing',
      attempts: 1,
      lockedAt: new Date(Date.now() - 60 * 60_000),
      lockedBy: 'worker-expired',
    });
    const checker = {
      checkExisting: jest.fn(() =>
        Promise.resolve({ outcome: 'absent' as const }),
      ),
    };

    await service.recoverStale({ checker });
    await other.claim({ workerId: 'worker-current', limit: 1 });

    const applied = await service.markPublished({
      publicationId: id,
      lockedBy: 'worker-expired',
      identity: {
        publishedAt: new Date(),
        externalPublicationId: 'must-not-land',
        externalPermalink: null,
      },
    });

    expect(checker.checkExisting).toHaveBeenCalledTimes(1);
    expect(applied).toBe(false);
    expect(await rowOf(id)).toMatchObject({
      status: 'processing',
      locked_by: 'worker-current',
      external_publication_id: null,
    });
  });

  it('records provider-confirmed success instead of reclaiming a stale row', async () => {
    const id = await insertPublication({
      status: 'processing',
      attempts: 1,
      lockedAt: new Date(Date.now() - 60 * 60_000),
      lockedBy: 'worker-expired',
    });

    const result = await service.recoverStale({
      checker: {
        checkExisting: () =>
          Promise.resolve({
            outcome: 'published' as const,
            publishedAt: new Date(),
            externalPublicationId: 'external-publication-a',
            externalPermalink: 'https://example.test/post/a',
          }),
      },
    });

    expect(result).toMatchObject({ published: 1, requeued: 0 });
    expect(await rowOf(id)).toMatchObject({
      status: 'published',
      locked_by: null,
      external_publication_id: 'external-publication-a',
    });
    expect(await other.claim({ workerId: 'worker-b', limit: 1 })).toEqual([]);
  });

  it('releases only schedules whose Lyra time is due', async () => {
    const due = await insertPublication({
      status: 'scheduled',
      scheduledAt: new Date(Date.now() - 60_000),
      availableAt: new Date(Date.now() + 60 * 60_000),
    });
    const future = await insertPublication({
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 60 * 60_000),
    });

    await expect(service.releaseScheduled()).resolves.toBe(1);
    expect((await rowOf(due)).status).toBe('queued');
    expect((await rowOf(future)).status).toBe('scheduled');
  });
});
