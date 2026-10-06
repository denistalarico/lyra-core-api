import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { QueryRunner } from 'typeorm';
import {
  MediaAssetEntity,
  MediaAssetResolverService,
  type MediaAssetScope,
  MediaAssetUploadService,
} from '../../common/media-assets';
import type { FilesService } from '../../common/files/files.service';
import { ASSIGN_EXCLUSIVE_LEGACY_MEDIA_SQL } from '../../modules/clients/reconciliation/company-legacy-media';
import { CompanyLegacyReconciliationService } from '../../modules/clients/reconciliation/company-legacy-reconciliation.service';
import { CREATIVE_GENERATION_MEDIA_SOURCE } from '../../modules/social-creative-studio/creative-retention';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateMediaAssets1791700000000 } from './1791700000000-create-media-assets';
import { ScopeMediaAssetsByCompany1797800000000 } from './1797800000000-scope-media-assets-by-company';

const run = describePostgresIntegration();

const PNG = Buffer.concat([
  Buffer.from([0x89]),
  Buffer.from('PNG\r\n\x1a\n', 'latin1'),
  Buffer.alloc(32, 7),
]);

/**
 * CS3.1.1 against real PostgreSQL. Everything happens inside ONE transaction
 * on a throwaway schema in the guarded `_test` database and is rolled back —
 * no product table is created, truncated or deleted.
 */
run('CS3.1.1 media_assets company scope (real PostgreSQL)', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const multiClient = randomUUID();
  const singleClient = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const companyS = randomUUID();

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  async function inThrowawaySchema(
    body: (runner: QueryRunner) => Promise<void>,
  ) {
    const runner = AgencyDataSource.createQueryRunner();
    const schema = `cs311_${randomUUID().replaceAll('-', '')}`;
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET LOCAL search_path TO "${schema}", public`);
      await createOwnerSchema(runner);
      await new CreateMediaAssets1791700000000().up(runner);
      await runner.query(
        `INSERT INTO agency_client_company_contexts
           (id, tenant_id, workspace_id, agency_client_id)
         VALUES ($1,$4,$5,$6), ($2,$4,$5,$6), ($3,$4,$5,$7)`,
        [
          companyA,
          companyB,
          companyS,
          tenantId,
          workspaceId,
          multiClient,
          singleClient,
        ],
      );
      await body(runner);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }

  async function media(
    runner: QueryRunner,
    id: string,
    agencyClientId: string | null,
    extra: { workspaceId?: string; source?: string } = {},
  ) {
    await runner.query(
      `INSERT INTO media_assets
         (id, tenant_id, workspace_id, agency_client_id, storage_path,
          mime_type, byte_size, source)
       VALUES ($1,$2,$3,$4,$5,'image/png',10,$6)`,
      [
        id,
        tenantId,
        extra.workspaceId ?? workspaceId,
        agencyClientId,
        `media-assets/${id}.png`,
        extra.source ?? 'planner_upload',
      ],
    );
  }

  async function companyOf(runner: QueryRunner, id: string) {
    const [row] = (await runner.query(
      'SELECT company_context_id FROM media_assets WHERE id = $1',
      [id],
    )) as { company_context_id: string | null }[];
    return row.company_context_id;
  }

  it('backfills only from unique owners or a single-company client, then enforces scope; up/down/up', async () => {
    await inThrowawaySchema(async (runner) => {
      const ids = Object.fromEntries(
        [
          'versionA',
          'thumbA',
          'bindingB',
          'conflict',
          'legacyOwner',
          'unownedMulti',
          'unownedSingle',
          'singleLegacyOwner',
          'agency',
          'publicationA',
          'foreignOwner',
        ].map((key) => [key, randomUUID()]),
      ) as Record<string, string>;
      for (const key of Object.keys(ids))
        await media(
          runner,
          ids[key],
          key === 'agency'
            ? null
            : key.startsWith('single') || key === 'unownedSingle'
              ? singleClient
              : multiClient,
        );

      const assetA = await creativeAsset(runner, multiClient, companyA);
      const assetB = await creativeAsset(runner, multiClient, companyB);
      const assetSingleLegacy = await creativeAsset(runner, singleClient, null);
      await version(runner, assetA, ids.versionA, ids.thumbA);
      await version(runner, assetB, ids.conflict, null);
      await version(runner, assetSingleLegacy, ids.singleLegacyOwner, null);

      const planA = await plan(runner, multiClient, companyA);
      const planB = await plan(runner, multiClient, companyB);
      const planLegacy = await plan(runner, multiClient, null);
      const planOtherWorkspace = await plan(
        runner,
        multiClient,
        companyA,
        randomUUID(),
      );
      await binding(runner, planB, ids.bindingB);
      await binding(runner, planA, ids.conflict);
      await binding(runner, planLegacy, ids.legacyOwner);
      await binding(runner, planOtherWorkspace, ids.foreignOwner);
      await publicationMedia(runner, planA, ids.publicationA);

      const migration = new ScopeMediaAssetsByCompany1797800000000();
      await migration.up(runner);

      expect({
        versionA: await companyOf(runner, ids.versionA),
        thumbA: await companyOf(runner, ids.thumbA),
        bindingB: await companyOf(runner, ids.bindingB),
        publicationA: await companyOf(runner, ids.publicationA),
        conflict: await companyOf(runner, ids.conflict),
        legacyOwner: await companyOf(runner, ids.legacyOwner),
        foreignOwner: await companyOf(runner, ids.foreignOwner),
        unownedMulti: await companyOf(runner, ids.unownedMulti),
        unownedSingle: await companyOf(runner, ids.unownedSingle),
        singleLegacyOwner: await companyOf(runner, ids.singleLegacyOwner),
        agency: await companyOf(runner, ids.agency),
      }).toEqual({
        versionA: companyA,
        thumbA: companyA,
        bindingB: companyB,
        publicationA: companyA,
        conflict: null, // owners in A and B: never guessed
        legacyOwner: null, // owner itself is legacy: media follows it
        foreignOwner: null, // owner outside the media's scope: anomaly, not evidence
        unownedMulti: null, // two companies, no owner: legacy_unassigned
        unownedSingle: companyS, // the client's only company (CC2C rule)
        singleLegacyOwner: null, // owner rule wins over the single-company rule
        agency: null,
      });
      const [{ count }] = (await runner.query(
        'SELECT count(*)::int AS count FROM media_assets',
      )) as { count: number }[];
      expect(count).toBe(Object.keys(ids).length); // nothing deleted

      // CHECK: a company implies a client.
      await expectViolation(runner, () =>
        runner.query(
          `UPDATE media_assets SET company_context_id = $1 WHERE id = $2`,
          [companyA, ids.agency],
        ),
      );
      // FK: a company of another client is refused.
      await expectViolation(runner, () =>
        runner.query(
          `UPDATE media_assets SET company_context_id = $1 WHERE id = $2`,
          [companyS, ids.unownedMulti],
        ),
      );
      // Trigger: a version of an A asset cannot point at B media.
      const mediaB = randomUUID();
      await media(runner, mediaB, multiClient);
      await runner.query(
        'UPDATE media_assets SET company_context_id = $1 WHERE id = $2',
        [companyB, mediaB],
      );
      await expectViolation(runner, () =>
        version(runner, assetA, mediaB, null, 2),
      );
      const mediaA = randomUUID();
      await media(runner, mediaA, multiClient);
      await runner.query(
        'UPDATE media_assets SET company_context_id = $1 WHERE id = $2',
        [companyA, mediaA],
      );
      await version(runner, assetA, mediaA, null, 2);

      // Re-runnable, reversible, re-appliable.
      await migration.up(runner);
      await migration.down(runner);
      const columns = (await runner.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'media_assets'
            AND column_name = 'company_context_id'`,
      )) as unknown[];
      expect(columns).toHaveLength(0);
      await migration.up(runner);
      expect(await companyOf(runner, ids.versionA)).toBe(companyA);
    });
  });

  it('isolates upload, list, resolve, temporary read and promotion by company; agency and legacy never widen', async () => {
    await inThrowawaySchema(async (runner) => {
      await new ScopeMediaAssetsByCompany1797800000000().up(runner);
      const repository = runner.manager.getRepository(MediaAssetEntity);
      const files = {
        uploadPrivateBuffer: jest.fn((input: { path: string }) =>
          Promise.resolve({ path: input.path }),
        ),
        getPrivateAsset: jest.fn(() =>
          Promise.resolve({
            body: Readable.from([PNG]),
            contentType: 'image/png',
            cacheControl: 'private, no-store',
          }),
        ),
        deleteObject: jest.fn(() => Promise.resolve()),
      };
      const upload = new MediaAssetUploadService(
        repository,
        files as unknown as FilesService,
        {
          extract: () =>
            Promise.resolve({
              width: 1,
              height: 1,
              durationSeconds: null,
              codec: 'png',
            }),
        },
      );
      const resolver = new MediaAssetResolverService(repository);
      const scopeA: MediaAssetScope = {
        tenantId,
        workspaceId,
        agencyClientId: multiClient,
        companyContextId: companyA,
      };
      const scopeB: MediaAssetScope = { ...scopeA, companyContextId: companyB };
      const agency: MediaAssetScope = {
        tenantId,
        workspaceId,
        agencyClientId: null,
        companyContextId: null,
      };
      const legacy: MediaAssetScope = { ...scopeA, companyContextId: null };
      const file = {
        buffer: PNG,
        originalname: 'a.png',
        mimetype: 'image/png',
      };

      // Upload stamps the caller's company.
      const ofA = await upload.upload(scopeA, null, {
        file,
        source: 'planner_upload',
      });
      const ofB = await upload.upload(scopeB, null, {
        file,
        source: 'planner_upload',
      });
      const ofAgency = await upload.upload(agency, null, {
        file,
        source: 'planner_upload',
      });
      expect(await companyOf(runner, ofA.id)).toBe(companyA);
      expect(await companyOf(runner, ofB.id)).toBe(companyB);
      expect(await companyOf(runner, ofAgency.id)).toBeNull();
      const legacyId = randomUUID();
      await media(runner, legacyId, multiClient); // pre-migration style row

      // Listing (the publishing media picker).
      const ids = async (scope: MediaAssetScope) =>
        (await upload.list(scope)).items.map((item) => item.id).sort();
      expect(await ids(scopeA)).toEqual([ofA.id]);
      expect(await ids(scopeB)).toEqual([ofB.id]);
      expect(await ids(agency)).toEqual([ofAgency.id]);

      // Resolver (publication, executor, Studio content, client approvals).
      await expect(
        resolver.resolve({ ...scopeA, mediaAssetId: ofA.id }),
      ).resolves.toMatchObject({ id: ofA.id });
      await expect(
        resolver.resolve({ ...scopeB, mediaAssetId: ofA.id }),
      ).rejects.toThrow('Media asset not found.');
      await expect(
        resolver.resolve({ ...agency, mediaAssetId: ofA.id }),
      ).rejects.toThrow('Media asset not found.');
      await expect(
        resolver.resolve({ ...scopeA, mediaAssetId: legacyId }),
      ).rejects.toThrow('Media asset not found.');
      await expect(
        resolver.resolve({ ...agency, mediaAssetId: legacyId }),
      ).rejects.toThrow('Media asset not found.');
      await expect(
        resolver.resolve({ ...legacy, mediaAssetId: legacyId }),
      ).resolves.toMatchObject({ id: legacyId });
      await expect(
        resolver.resolve({ ...legacy, mediaAssetId: ofA.id }),
      ).rejects.toThrow('Media asset not found.');
      // Direct content lookup.
      await expect(upload.getContent(scopeB, ofA.id)).rejects.toThrow(
        'Media asset not found.',
      );

      // Temporary generation: A's candidate is invisible to B everywhere.
      const temp = await upload.upload(scopeA, null, {
        file,
        source: CREATIVE_GENERATION_MEDIA_SOURCE,
        metadata: { generationId: 'g', outputIndex: 0 },
      });
      expect(await companyOf(runner, temp.id)).toBe(companyA);
      await expect(
        upload.getTemporaryContent(
          scopeB,
          temp.id,
          CREATIVE_GENERATION_MEDIA_SOURCE,
        ),
      ).rejects.toThrow('Media asset not found.');
      await expect(
        resolver.resolve({ ...scopeA, mediaAssetId: temp.id }),
      ).rejects.toThrow('Media asset not found.');
      expect(await ids(scopeA)).toEqual([ofA.id]);

      // Promotion temporary A → durable A (through the persisted generation
      // output) is proven in creative-image-generation.postgres.spec.ts.
    });
  });

  it('reconciling a legacy root moves only the media it alone owns', async () => {
    await inThrowawaySchema(async (runner) => {
      await new ScopeMediaAssetsByCompany1797800000000().up(runner);
      const legacyAsset = await creativeAsset(runner, multiClient, null);
      const otherLegacyAsset = await creativeAsset(runner, multiClient, null);
      const own = randomUUID();
      const ownThumb = randomUUID();
      const shared = randomUUID();
      for (const id of [own, ownThumb, shared])
        await media(runner, id, multiClient);
      await version(runner, legacyAsset, own, ownThumb);
      await version(runner, legacyAsset, shared, null, 2);
      await version(runner, otherLegacyAsset, shared, null);

      // The service's own binder: proves `'creative_asset:' || id` survives
      // the named-parameter rewrite.
      const service = new CompanyLegacyReconciliationService(
        null as never,
      ) as unknown as {
        bind(sql: string, params: Record<string, unknown>): [string, unknown[]];
      };
      await runner.query(
        `UPDATE social_creative_assets SET company_context_id = $1 WHERE id = $2`,
        [companyA, legacyAsset],
      );
      const [sql, values] = service.bind(ASSIGN_EXCLUSIVE_LEGACY_MEDIA_SQL, {
        ownerKey: `creative_asset:${legacyAsset}`,
        tenantId,
        workspaceId,
        agencyClientId: multiClient,
        companyContextId: companyA,
      });
      const moved: unknown = await runner.query(sql, values);
      const movedRows = Array.isArray(moved)
        ? Array.isArray(moved[0])
          ? (moved[0] as unknown[])
          : (moved as unknown[])
        : [];

      expect(await companyOf(runner, own)).toBe(companyA);
      expect(await companyOf(runner, ownThumb)).toBe(companyA);
      expect(await companyOf(runner, shared)).toBeNull();
      expect(movedRows).toHaveLength(2);
    });
  });
});

async function createOwnerSchema(runner: QueryRunner) {
  await runner.query(`
    CREATE TABLE agency_client_company_contexts (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL,
      UNIQUE (id, tenant_id, workspace_id, agency_client_id)
    );
    CREATE TABLE social_plans (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, company_context_id uuid
    );
    CREATE TABLE social_content_items (
      id uuid PRIMARY KEY, plan_id uuid NOT NULL REFERENCES social_plans(id)
    );
    CREATE TABLE social_creative_assets (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, company_context_id uuid
    );
    CREATE TABLE social_creative_asset_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      creative_asset_id uuid NOT NULL REFERENCES social_creative_assets(id),
      version_number integer NOT NULL,
      media_asset_id uuid NOT NULL,
      thumbnail_media_asset_id uuid
    );
    CREATE TABLE social_destination_creatives (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
      content_item_id uuid NOT NULL, media_asset_id uuid NOT NULL
    );
    CREATE TABLE social_publications (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
      content_item_id uuid NOT NULL, media_asset_id uuid
    );
    CREATE TABLE social_publication_media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      publication_id uuid NOT NULL, media_asset_id uuid NOT NULL
    );
  `);
}

let tenantForHelpers = '';
let workspaceForHelpers = '';

async function scopeOf(runner: QueryRunner) {
  if (!tenantForHelpers) {
    const [row] = (await runner.query(
      'SELECT tenant_id, workspace_id FROM agency_client_company_contexts LIMIT 1',
    )) as { tenant_id: string; workspace_id: string }[];
    tenantForHelpers = row.tenant_id;
    workspaceForHelpers = row.workspace_id;
  }
  return { tenantId: tenantForHelpers, workspaceId: workspaceForHelpers };
}

async function creativeAsset(
  runner: QueryRunner,
  agencyClientId: string,
  companyContextId: string | null,
) {
  const { tenantId, workspaceId } = await scopeOf(runner);
  const id = randomUUID();
  await runner.query(
    'INSERT INTO social_creative_assets VALUES ($1,$2,$3,$4,$5)',
    [id, tenantId, workspaceId, agencyClientId, companyContextId],
  );
  return id;
}

async function version(
  runner: QueryRunner,
  assetId: string,
  mediaId: string,
  thumbnailId: string | null,
  versionNumber = 1,
) {
  await runner.query(
    `INSERT INTO social_creative_asset_versions
       (creative_asset_id, version_number, media_asset_id, thumbnail_media_asset_id)
     VALUES ($1,$2,$3,$4)`,
    [assetId, versionNumber, mediaId, thumbnailId],
  );
}

async function plan(
  runner: QueryRunner,
  agencyClientId: string,
  companyContextId: string | null,
  workspaceOverride?: string,
) {
  const { tenantId, workspaceId } = await scopeOf(runner);
  const id = randomUUID();
  await runner.query('INSERT INTO social_plans VALUES ($1,$2,$3,$4,$5)', [
    id,
    tenantId,
    workspaceOverride ?? workspaceId,
    agencyClientId,
    companyContextId,
  ]);
  const itemId = randomUUID();
  await runner.query('INSERT INTO social_content_items VALUES ($1,$2)', [
    itemId,
    id,
  ]);
  return itemId;
}

async function binding(runner: QueryRunner, itemId: string, mediaId: string) {
  const { tenantId } = await scopeOf(runner);
  await runner.query(
    `INSERT INTO social_destination_creatives (tenant_id, content_item_id, media_asset_id)
     VALUES ($1,$2,$3)`,
    [tenantId, itemId, mediaId],
  );
}

async function publicationMedia(
  runner: QueryRunner,
  itemId: string,
  mediaId: string,
) {
  const { tenantId } = await scopeOf(runner);
  const publicationId = randomUUID();
  await runner.query('INSERT INTO social_publications VALUES ($1,$2,$3,NULL)', [
    publicationId,
    tenantId,
    itemId,
  ]);
  await runner.query(
    `INSERT INTO social_publication_media (publication_id, media_asset_id)
     VALUES ($1,$2)`,
    [publicationId, mediaId],
  );
}

async function expectViolation(
  runner: QueryRunner,
  operation: () => Promise<unknown>,
) {
  const savepoint = `cs311_${randomUUID().replaceAll('-', '')}`;
  await runner.query(`SAVEPOINT ${savepoint}`);
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await runner.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
  expect(rejected).toBe(true);
}
