import { randomUUID } from 'crypto';
import { DataSource, type DataSourceOptions, type Repository } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../../config/typeorm.config';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
} from '../../social-creative-studio/entities';
import { CreativeVersionApprovalService } from '../../social-creative-studio/creative-version-approval.service';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
  type SocialContentPlanningStatus,
} from '../entities';
import { SocialContentProductionStatusService } from './social-content-production-status.service';

const run = describePostgresIntegration();

run(
  'CS2B.4 Planner production status reflection (real TypeORM/PostgreSQL)',
  () => {
    let db: DataSource;
    let plans: Repository<SocialPlanEntity>;
    let items: Repository<SocialContentItemEntity>;
    let service: SocialContentProductionStatusService;
    const schema = `cs2b4_${randomUUID().replace(/-/g, '')}`;
    const companyA = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      agencyClientId: randomUUID(),
      companyContextId: randomUUID(),
    };
    const companyB = { ...companyA, companyContextId: randomUUID() };

    beforeAll(async () => {
      // Isolated schema in the guarded disposable DB; no product migrations run.
      db = new DataSource({
        ...(getAgencyTypeOrmConfig() as Extract<
          DataSourceOptions,
          { type: 'postgres' }
        >),
        type: 'postgres',
        name: schema,
        schema,
        entities: [
          SocialPlanEntity,
          SocialContentItemEntity,
          CreativeAssetEntity,
          CreativeAssetVersionEntity,
        ],
        migrations: [],
        migrationsRun: false,
        synchronize: false,
      });
      await db.initialize();
      await db.query(`CREATE SCHEMA "${schema}"`);
      await db.synchronize();
      plans = db.getRepository(SocialPlanEntity);
      items = db.getRepository(SocialContentItemEntity);
      service = new SocialContentProductionStatusService(items, plans);
    });
    beforeEach(async () => {
      await db.getRepository(CreativeAssetVersionEntity).clear();
      await db.getRepository(CreativeAssetEntity).clear();
      await items.clear();
      await plans.clear();
    });
    afterAll(async () => {
      if (db?.isInitialized) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    });

    async function seed(
      planningStatus: SocialContentPlanningStatus,
      scope = companyA,
    ) {
      const plan = await plans.save({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        title: 'Plano',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
      const item = await items.save({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        planId: plan.id,
        title: 'Post',
        planningStatus,
        updatedById: null,
      });
      return { plan, item };
    }

    const statusOf = async (id: string) =>
      (await items.findOneByOrFail({ id })).planningStatus;

    const reflect = (
      contentItemId: string,
      status: 'creative_in_progress' | 'creative_ready',
      scope = companyA,
    ) =>
      service.reflectCreativeStatus(scope, {
        contentItemId,
        status,
        actorUserId: randomUUID(),
      });

    it('walks copy_ready → creative_in_progress → creative_ready idempotently', async () => {
      const { item } = await seed('copy_ready');
      const before = item.updatedAt;

      await expect(reflect(item.id, 'creative_in_progress')).resolves.toBe(
        true,
      );
      await expect(reflect(item.id, 'creative_in_progress')).resolves.toBe(
        false,
      );
      expect(await statusOf(item.id)).toBe('creative_in_progress');

      await expect(reflect(item.id, 'creative_ready')).resolves.toBe(true);
      await expect(reflect(item.id, 'creative_ready')).resolves.toBe(false);
      // A later version never walks the item back.
      await expect(reflect(item.id, 'creative_in_progress')).resolves.toBe(
        false,
      );
      const row = await items.findOneByOrFail({ id: item.id });
      expect(row.planningStatus).toBe('creative_ready');
      expect(row.updatedById).not.toBeNull();
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it.each(['idea', 'planned', 'copy_in_progress', 'ready'] as const)(
      'leaves %s untouched for both creative statuses',
      async (from) => {
        const { item } = await seed(from);
        await expect(reflect(item.id, 'creative_in_progress')).resolves.toBe(
          false,
        );
        await expect(reflect(item.id, 'creative_ready')).resolves.toBe(false);
        const row = await items.findOneByOrFail({ id: item.id });
        expect(row.planningStatus).toBe(from);
        expect(row.updatedById).toBeNull();
      },
    );

    it('isolates companies: company A cannot move company B content', async () => {
      const { item } = await seed('copy_ready', companyB);
      await expect(reflect(item.id, 'creative_ready', companyA)).resolves.toBe(
        false,
      );
      expect(await statusOf(item.id)).toBe('copy_ready');
      await expect(reflect(item.id, 'creative_ready', companyB)).resolves.toBe(
        true,
      );
    });

    it('ignores soft-deleted content and soft-deleted plans', async () => {
      const deletedItem = await seed('copy_ready');
      await items.update(
        { id: deletedItem.item.id },
        { deletedAt: new Date() },
      );
      const deletedPlan = await seed('copy_ready');
      await plans.update(
        { id: deletedPlan.plan.id },
        { deletedAt: new Date() },
      );

      await expect(
        reflect(deletedItem.item.id, 'creative_in_progress'),
      ).resolves.toBe(false);
      await expect(
        reflect(deletedPlan.item.id, 'creative_in_progress'),
      ).resolves.toBe(false);
      expect(await statusOf(deletedPlan.item.id)).toBe('copy_ready');
    });

    it("rolls back with the caller's transaction", async () => {
      const { item } = await seed('copy_ready');
      await expect(
        db.transaction(async (manager) => {
          await service.reflectCreativeStatus(
            companyA,
            {
              contentItemId: item.id,
              status: 'creative_in_progress',
              actorUserId: null,
            },
            manager,
          );
          throw new Error('version insert failed');
        }),
      ).rejects.toThrow('version insert failed');
      expect(await statusOf(item.id)).toBe('copy_ready');
    });

    it('Studio send for approval → real Planner row becomes creative_ready', async () => {
      const { item } = await seed('creative_in_progress');
      const assets = db.getRepository(CreativeAssetEntity);
      const versions = db.getRepository(CreativeAssetVersionEntity);
      const asset = await assets.save({
        ...companyA,
        name: 'Criativo',
        assetType: 'image',
        contentItemId: item.id,
      });
      const version = await versions.save({
        creativeAssetId: asset.id,
        versionNumber: 1,
        mediaAssetId: randomUUID(),
        source: 'upload',
      });
      const approvals = {
        create: jest.fn(async () => ({ id: randomUUID(), status: 'draft' })),
      };
      const studio = new CreativeVersionApprovalService(
        assets,
        versions,
        approvals as never,
        service,
        {} as never,
      );

      await studio.sendForApproval(
        companyA,
        randomUUID(),
        asset.id,
        version.id,
      );

      expect(approvals.create).toHaveBeenCalledTimes(1);
      expect(await statusOf(item.id)).toBe('creative_ready');
    });
  },
);
