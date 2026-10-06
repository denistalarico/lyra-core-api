import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { MediaAssetEntity } from '../../common/media-assets/media-asset.entity';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateSocialContentReferences1798200000000 } from '../../database/migrations/1798200000000-create-social-content-references';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialContentReferenceEntity,
  SocialContentRevisionEntity,
  SocialDestinationCreativeEntity,
  SocialPlanEntity,
} from './entities';
import { SocialContentLifecycleService } from './services/social-content-lifecycle.service';
import {
  SocialContentReferenceService,
  type SocialContentReferenceView,
} from './services/social-content-reference.service';
import {
  SocialPlannerService,
  type SocialPlannerScope,
} from './services/social-planner.service';

const run = describePostgresIntegration();

/**
 * Planner Visual References against real PostgreSQL: the migration's CHECKs,
 * FKs and triggers (both directions), and the service flows on top of them.
 *
 * Throwaway schema of the guarded `_test` database, `search_path = <schema>,
 * public`, so tables, trigger functions and FKs all live inside it. Dropped at
 * the end; no product table is touched.
 */
run('Planner Visual References (real PostgreSQL)', () => {
  const schema = `pvr_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const scopeA: SocialPlannerScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientId,
    companyContextId: companyA,
  };
  const scopeB: SocialPlannerScope = { ...scopeA, companyContextId: companyB };
  const ACTOR = randomUUID();
  const agency: SocialPlannerScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };

  let db: DataSource;
  let references: SocialContentReferenceService;
  let lifecycle: SocialContentLifecycleService;

  function options(entities: DataSourceOptions['entities'], name: string) {
    const base = getAgencyTypeOrmConfig() as Extract<
      DataSourceOptions,
      { type: 'postgres' }
    >;
    return {
      ...base,
      type: 'postgres' as const,
      name,
      entities,
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      schema,
      extra: { options: `-c search_path=${schema},public`, max: 8 },
    };
  }

  const PLANNER_TABLES = [
    MediaAssetEntity,
    SocialPlanEntity,
    SocialContentItemEntity,
    SocialContentDestinationEntity,
    SocialDestinationCreativeEntity,
    SocialContentRevisionEntity,
  ];

  async function plan(scope: SocialPlannerScope) {
    return db.getRepository(SocialPlanEntity).save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      title: 'Plano',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
  }

  async function item(scope: SocialPlannerScope, planId?: string) {
    return db.getRepository(SocialContentItemEntity).save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      planId: planId ?? (await plan(scope)).id,
      title: 'Post',
    });
  }

  async function media(
    scope: SocialPlannerScope,
    patch: Partial<MediaAssetEntity> = {},
  ) {
    return db.getRepository(MediaAssetEntity).save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      storagePath: `media-assets/${randomUUID()}.png`,
      mimeType: 'image/png',
      byteSize: '100',
      width: 10,
      height: 10,
      source: 'planner_reference',
      metadata: {},
      ...patch,
    });
  }

  /** Raw INSERT: what the database alone accepts, bypassing the service. */
  function rawReference(
    scope: SocialPlannerScope,
    contentItemId: string,
    mediaAssetId: string,
    patch: Record<string, unknown> = {},
  ) {
    const row: Record<string, unknown> = {
      tenant_id: scope.tenantId,
      workspace_id: scope.workspaceId,
      agency_client_id: scope.agencyClientId,
      company_context_id: scope.companyContextId,
      content_item_id: contentItemId,
      media_asset_id: mediaAssetId,
      kind: 'product',
      sort_order: 0,
      ...patch,
    };
    const keys = Object.keys(row);
    return db.query(
      `INSERT INTO social_content_references (${keys.join(',')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
  }

  beforeAll(async () => {
    const bootstrap = new DataSource(
      options(PLANNER_TABLES, `${schema}_bootstrap`),
    );
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.synchronize();
    await bootstrap.query(`
      CREATE TABLE agency_client_company_contexts (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        agency_client_id uuid NOT NULL,
        UNIQUE (id, tenant_id, workspace_id, agency_client_id)
      )`);
    await bootstrap.query(
      `INSERT INTO agency_client_company_contexts VALUES
         ($1,$3,$4,$5), ($2,$3,$4,$5)`,
      [companyA, companyB, tenantId, workspaceId, clientId],
    );
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialContentReferences1798200000000().up(runner);
    await runner.release();
    await bootstrap.destroy();

    db = new DataSource(
      options([...PLANNER_TABLES, SocialContentReferenceEntity], schema),
    );
    await db.initialize();
    const planner = new SocialPlannerService(
      db.getRepository(SocialPlanEntity),
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialContentDestinationEntity),
      db.getRepository(SocialContentRevisionEntity),
      {} as never,
    );
    references = new SocialContentReferenceService(
      db.getRepository(SocialContentReferenceEntity),
      db.getRepository(MediaAssetEntity),
      planner,
    );
    lifecycle = new SocialContentLifecycleService(
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialPlanEntity),
      db.getRepository(SocialContentDestinationEntity),
      db.getRepository(SocialDestinationCreativeEntity),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  describe('migration', () => {
    it('is re-runnable and reversible: up → up → down → up', async () => {
      const runner = db.createQueryRunner();
      const migration = new CreateSocialContentReferences1798200000000();
      const exists = async () =>
        (
          await runner.query(
            `SELECT count(*)::int AS n FROM information_schema.tables
              WHERE table_schema = $1 AND table_name = 'social_content_references'`,
            [schema],
          )
        )[0].n as number;
      try {
        await runner.startTransaction();
        await migration.up(runner);
        expect(await exists()).toBe(1);
        await migration.down(runner);
        expect(await exists()).toBe(0);
        await migration.up(runner);
        expect(await exists()).toBe(1);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  });

  describe('database integrity (raw SQL, no service)', () => {
    it('accepts agency scope and client + company scope', async () => {
      const a = await item(scopeA);
      await expect(
        rawReference(scopeA, a.id, (await media(scopeA)).id),
      ).resolves.toBeDefined();
      const g = await item(agency);
      await expect(
        rawReference(agency, g.id, (await media(agency)).id),
      ).resolves.toBeDefined();
    });

    it('never points at media of another company, even with a consistent row', async () => {
      const a = await item(scopeA);
      const mediaB = await media(scopeB);
      // Row claims A (matches the item) but the media is B's.
      await expect(rawReference(scopeA, a.id, mediaB.id)).rejects.toThrow(
        /content reference media must use the same company scope/,
      );
      // Row claims B (matches the media) but the item is A's.
      await expect(rawReference(scopeB, a.id, mediaB.id)).rejects.toThrow(
        /company scope of its content item/,
      );
    });

    it('never points at another tenant, workspace or the agency media', async () => {
      const a = await item(scopeA);
      for (const other of [
        { ...scopeA, tenantId: randomUUID() },
        { ...scopeA, workspaceId: randomUUID() },
        agency,
      ]) {
        const foreign = await media(other);
        await expect(rawReference(scopeA, a.id, foreign.id)).rejects.toThrow(
          /same company scope/,
        );
      }
    });

    it.each([
      [
        'a temporary generation candidate',
        { source: 'temporary:creative_generation' },
      ],
      ['a video', { mimeType: 'video/mp4' }],
      ['a soft-deleted media', { deletedAt: new Date() }],
    ])('refuses %s as a reference', async (_label, patch) => {
      const a = await item(scopeA);
      const bad = await media(scopeA, patch as Partial<MediaAssetEntity>);
      await expect(rawReference(scopeA, a.id, bad.id)).rejects.toThrow(
        /durable image/,
      );
    });

    it('a reference is never legacy (client without company), even when item and media are legacy too', async () => {
      const legacy = { ...scopeA, companyContextId: null };
      const l = await item(legacy);
      await expect(
        rawReference(legacy, l.id, (await media(legacy)).id),
      ).rejects.toThrow(/CK_social_content_references_scope/);
    });

    it('caps positions at 0..9 and keeps them unique per item', async () => {
      const a = await item(scopeA);
      await expect(
        rawReference(scopeA, a.id, (await media(scopeA)).id, {
          sort_order: 10,
        }),
      ).rejects.toThrow(/CK_social_content_references_sort_order/);
      await rawReference(scopeA, a.id, (await media(scopeA)).id);
      await expect(
        rawReference(scopeA, a.id, (await media(scopeA)).id),
      ).rejects.toThrow(/UQ_social_content_references_order/);
    });

    describe('reverse guards', () => {
      async function linked() {
        const a = await item(scopeA);
        const m = await media(scopeA);
        await rawReference(scopeA, a.id, m.id);
        return { a, m };
      }

      it.each([
        ['company', `company_context_id = '${companyB}'`],
        [
          'client/company to agency',
          'agency_client_id = NULL, company_context_id = NULL',
        ],
        ['source to temporary', `source = 'temporary:creative_generation'`],
        ['mime to video', `mime_type = 'video/mp4'`],
        ['soft delete', 'deleted_at = now()'],
      ])('a referenced media cannot drift (%s)', async (_label, set) => {
        const { m } = await linked();
        await expect(
          db.query(`UPDATE media_assets SET ${set} WHERE id = $1`, [m.id]),
        ).rejects.toThrow(/used as a content reference/);
      });

      it('an unreferenced media is not affected by the guard', async () => {
        const m = await media(scopeA);
        await expect(
          db.query(
            `UPDATE media_assets SET company_context_id = $2 WHERE id = $1`,
            [m.id, companyB],
          ),
        ).resolves.toBeDefined();
      });

      it('the plan of a referenced item cannot change company', async () => {
        const { a } = await linked();
        await expect(
          db.query(
            `UPDATE social_plans SET company_context_id = $2 WHERE id = $1`,
            [a.planId, companyB],
          ),
        ).rejects.toThrow(/plan has content references/);
      });

      it('a referenced item cannot move to a plan of another company', async () => {
        const { a } = await linked();
        const planB = await plan(scopeB);
        await expect(
          db.query(
            `UPDATE social_content_items SET plan_id = $2 WHERE id = $1`,
            [a.id, planB.id],
          ),
        ).rejects.toThrow(/content item has references/);
      });

      it('deleting a referenced media is refused (FK RESTRICT); deleting the item drops only the links', async () => {
        const { a, m } = await linked();
        await expect(
          db.query('DELETE FROM media_assets WHERE id = $1', [m.id]),
        ).rejects.toThrow(/FK_social_content_references_media/);
        await db.query('DELETE FROM social_content_items WHERE id = $1', [
          a.id,
        ]);
        const [{ n }] = await db.query(
          'SELECT count(*)::int AS n FROM social_content_references WHERE content_item_id = $1',
          [a.id],
        );
        expect(n).toBe(0);
        expect(
          await db.getRepository(MediaAssetEntity).existsBy({ id: m.id }),
        ).toBe(true);
      });
    });
  });

  describe('service', () => {
    it('links an existing durable image and lists it with its media, in order', async () => {
      const a = await item(scopeA);
      const m1 = await media(scopeA);
      const m2 = await media(scopeA, { source: 'creative_studio' });
      await references.link(scopeA, ACTOR, a.id, {
        mediaAssetId: m1.id,
        kind: 'product',
        label: '  Embalagem nova  ',
      });
      await references.link(scopeA, ACTOR, a.id, {
        mediaAssetId: m2.id,
        kind: 'person',
      });

      const list = await references.list(scopeA, a.id);
      expect(list.map((r) => [r.mediaAssetId, r.kind, r.sortOrder])).toEqual([
        [m1.id, 'product', 0],
        [m2.id, 'person', 1],
      ]);
      expect(list[0].label).toBe('Embalagem nova');
      expect(list[0].media).toEqual(
        expect.objectContaining({
          mimeType: 'image/png',
          contentPath: `/social/publishing/media/${m1.id}/content`,
        }),
      );
      expect(JSON.stringify(list)).not.toContain('media-assets/');
      expect(await references.listContentReferences(scopeA, a.id)).toEqual([
        expect.objectContaining({
          mediaAssetId: m1.id,
          kind: 'product',
          sortOrder: 0,
        }),
        expect.objectContaining({
          mediaAssetId: m2.id,
          kind: 'person',
          sortOrder: 1,
        }),
      ]);
    });

    it('Company B can neither see item A references nor link to it; A cannot link B media', async () => {
      const a = await item(scopeA);
      await references.link(scopeA, null, a.id, {
        mediaAssetId: (await media(scopeA)).id,
        kind: 'product',
      });
      await expect(references.list(scopeB, a.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        references.listContentReferences(scopeB, a.id),
      ).rejects.toThrow(NotFoundException);
      await expect(
        references.link(scopeB, null, a.id, {
          mediaAssetId: (await media(scopeB)).id,
          kind: 'product',
        }),
      ).rejects.toThrow(NotFoundException);
      const error = await references
        .link(scopeA, null, a.id, {
          mediaAssetId: (await media(scopeB)).id,
          kind: 'product',
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code: 'reference_media_not_found' }),
      );
    });

    it.each([
      [
        'temporary',
        { source: 'temporary:creative_generation' },
        'reference_media_not_found',
      ],
      ['video', { mimeType: 'video/mp4' }, 'reference_media_not_image'],
    ])('refuses %s media before writing', async (_l, patch, code) => {
      const a = await item(scopeA);
      const bad = await media(scopeA, patch as Partial<MediaAssetEntity>);
      const error = await references
        .link(scopeA, null, a.id, { mediaAssetId: bad.id, kind: 'product' })
        .catch((e: unknown) => e);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code }),
      );
    });

    it('refuses a legacy scope', async () => {
      const legacy = { ...scopeA, companyContextId: null };
      const error = await references
        .link(legacy, null, randomUUID(), {
          mediaAssetId: randomUUID(),
          kind: 'product',
        })
        .catch((e: unknown) => e);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code: 'company_context_required' }),
      );
    });

    it('the same media once per item, but reusable by other items', async () => {
      const a = await item(scopeA);
      const other = await item(scopeA);
      const m = await media(scopeA);
      await references.link(scopeA, null, a.id, {
        mediaAssetId: m.id,
        kind: 'product',
      });
      await expect(
        references.link(scopeA, null, a.id, {
          mediaAssetId: m.id,
          kind: 'style',
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        references.link(scopeA, null, other.id, {
          mediaAssetId: m.id,
          kind: 'style',
        }),
      ).resolves.toEqual(expect.objectContaining({ mediaAssetId: m.id }));
    });

    it('10 concurrent links beyond the limit: exactly 10 stored, the rest 409', async () => {
      const a = await item(scopeA);
      const files = await Promise.all(
        Array.from({ length: 13 }, () => media(scopeA)),
      );
      const results = await Promise.allSettled(
        files.map((m) =>
          references.link(scopeA, null, a.id, {
            mediaAssetId: m.id,
            kind: 'product',
          }),
        ),
      );
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
      expect(rejected).toHaveLength(3);
      for (const r of rejected)
        expect(r.reason).toBeInstanceOf(ConflictException);
      const list = await references.list(scopeA, a.id);
      expect(list.map((r) => r.sortOrder)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    it('reorders by swapping positions; refuses anything but the exact current set', async () => {
      const a = await item(scopeA);
      const linked: SocialContentReferenceView[] = [];
      for (const kind of ['product', 'person', 'style'] as const)
        linked.push(
          await references.link(scopeA, null, a.id, {
            mediaAssetId: (await media(scopeA)).id,
            kind,
          }),
        );
      const order = [linked[2].id, linked[0].id, linked[1].id];
      const result = await references.reorder(scopeA, a.id, order);
      expect(result.map((r) => r.id)).toEqual(order);
      expect((await references.list(scopeA, a.id)).map((r) => r.id)).toEqual(
        order,
      );
      await expect(
        references.reorder(scopeA, a.id, [linked[0].id, linked[1].id]),
      ).rejects.toThrow(BadRequestException);
    });

    it('removing a reference deletes only the link — the media stays — and closes the gap', async () => {
      const a = await item(scopeA);
      const files = [
        await media(scopeA),
        await media(scopeA),
        await media(scopeA),
      ];
      const linked: SocialContentReferenceView[] = [];
      for (const m of files)
        linked.push(
          await references.link(scopeA, null, a.id, {
            mediaAssetId: m.id,
            kind: 'product',
          }),
        );

      await references.remove(scopeA, a.id, linked[0].id);

      const list = await references.list(scopeA, a.id);
      expect(list.map((r) => [r.mediaAssetId, r.sortOrder])).toEqual([
        [files[1].id, 0],
        [files[2].id, 1],
      ]);
      const media0 = await db
        .getRepository(MediaAssetEntity)
        .findOneBy({ id: files[0].id });
      expect(media0).toEqual(
        expect.objectContaining({ id: files[0].id, deletedAt: null }),
      );
      // The next link appends after the remaining ones.
      const next = await references.link(scopeA, null, a.id, {
        mediaAssetId: files[0].id,
        kind: 'style',
      });
      expect(next.sortOrder).toBe(2);
    });

    it('updates kind and clears the label', async () => {
      const a = await item(scopeA);
      const r = await references.link(scopeA, null, a.id, {
        mediaAssetId: (await media(scopeA)).id,
        kind: 'product',
        label: 'x',
      });
      const updated = await references.update(scopeA, a.id, r.id, {
        kind: 'packaging',
        label: null,
      });
      expect(updated).toEqual(
        expect.objectContaining({ kind: 'packaging', label: null }),
      );
    });

    it('soft delete hides the references; clearing deleted_at brings them back untouched', async () => {
      const a = await item(scopeA);
      const m = await media(scopeA);
      await references.link(scopeA, null, a.id, {
        mediaAssetId: m.id,
        kind: 'product',
      });

      await db.query(
        'UPDATE social_content_items SET deleted_at = now() WHERE id = $1',
        [a.id],
      );
      await expect(references.list(scopeA, a.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        references.listContentReferences(scopeA, a.id),
      ).rejects.toThrow(NotFoundException);

      await db.query(
        'UPDATE social_content_items SET deleted_at = NULL WHERE id = $1',
        [a.id],
      );
      expect(
        (await references.list(scopeA, a.id)).map((r) => r.mediaAssetId),
      ).toEqual([m.id]);
    });

    it('archive keeps the references visible (archived items stay editable)', async () => {
      const a = await item(scopeA);
      await references.link(scopeA, null, a.id, {
        mediaAssetId: (await media(scopeA)).id,
        kind: 'product',
      });
      await db.query(
        'UPDATE social_content_items SET archived_at = now() WHERE id = $1',
        [a.id],
      );
      expect(await references.list(scopeA, a.id)).toHaveLength(1);
    });

    it('duplicating an item copies the links (same media, kind, label, order), never the binary', async () => {
      const a = await item(scopeA);
      const m1 = await media(scopeA);
      const m2 = await media(scopeA);
      await references.link(scopeA, null, a.id, {
        mediaAssetId: m1.id,
        kind: 'product',
        label: 'Frasco',
      });
      await references.link(scopeA, null, a.id, {
        mediaAssetId: m2.id,
        kind: 'person',
      });
      const mediaBefore = await db.getRepository(MediaAssetEntity).count();

      const clone = await lifecycle.duplicate(scopeA, a.id, ACTOR);

      const copied = await references.list(scopeA, clone.id);
      expect(
        copied.map((r) => [r.mediaAssetId, r.kind, r.label, r.sortOrder]),
      ).toEqual([
        [m1.id, 'product', 'Frasco', 0],
        [m2.id, 'person', null, 1],
      ]);
      expect(await db.getRepository(MediaAssetEntity).count()).toBe(
        mediaBefore,
      );
      // The source keeps its own links.
      expect(await references.list(scopeA, a.id)).toHaveLength(2);
    });

    it('agency scope works end to end', async () => {
      const g = await item(agency);
      const m = await media(agency);
      await references.link(agency, null, g.id, {
        mediaAssetId: m.id,
        kind: 'environment',
      });
      expect(await references.listContentReferences(agency, g.id)).toEqual([
        expect.objectContaining({ mediaAssetId: m.id, kind: 'environment' }),
      ]);
    });
  });
});
