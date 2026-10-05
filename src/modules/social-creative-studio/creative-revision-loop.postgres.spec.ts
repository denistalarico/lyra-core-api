import { randomUUID } from 'crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, type DataSourceOptions, type Repository } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from '../social-approvals/entities';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { ApprovalSubjectResolver } from '../social-approvals/subjects/approval-subject-resolver';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
  type SocialContentPlanningStatus,
} from '../social-planner/entities';
import { SocialContentProductionStatusService } from '../social-planner/services/social-content-production-status.service';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from './entities';

const run = describePostgresIntegration();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');
const png = () => ({ buffer: PNG, originalname: 'criativo.png', size: 24 });

run(
  'CS2B.6 revision loop — Studio + Approvals + Planner (real TypeORM/PostgreSQL)',
  () => {
    let db: DataSource;
    let plans: Repository<SocialPlanEntity>;
    let items: Repository<SocialContentItemEntity>;
    let assets: Repository<CreativeAssetEntity>;
    let versions: Repository<CreativeAssetVersionEntity>;
    let requests: Repository<SocialApprovalRequestEntity>;
    let approvals: SocialApprovalsService;
    let plannerStatus: SocialContentProductionStatusService;
    let assetService: CreativeAssetService;
    let studio: CreativeVersionApprovalService;
    const mediaUpload = {
      upload: jest.fn(async () => ({
        id: randomUUID(),
        originalFilename: 'criativo.png',
      })),
      removeAfterFailedConsumerOperation: jest.fn(async () => undefined),
    };
    const thumbnails = { create: jest.fn(async () => ({ id: randomUUID() })) };
    const schema = `cs2b6_${randomUUID().replace(/-/g, '')}`;
    const companyA = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      agencyClientId: randomUUID(),
      companyContextId: randomUUID(),
    };
    const companyB = { ...companyA, companyContextId: randomUUID() };
    const operator = randomUUID();
    const clientUser = randomUUID();

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
          CreativeFolderEntity,
          CreativeAssetEntity,
          CreativeAssetVersionEntity,
          SocialApprovalRequestEntity,
          SocialApprovalCommentEntity,
          SocialApprovalStageDecisionEntity,
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
      assets = db.getRepository(CreativeAssetEntity);
      versions = db.getRepository(CreativeAssetVersionEntity);
      requests = db.getRepository(SocialApprovalRequestEntity);
      plannerStatus = new SocialContentProductionStatusService(items, plans);
      approvals = new SocialApprovalsService(
        requests,
        db.getRepository(SocialApprovalCommentEntity),
        db.getRepository(SocialApprovalStageDecisionEntity),
        db,
        new ApprovalSubjectResolver(
          assets,
          versions,
          plans,
          items,
          {} as never,
        ),
      );
      assetService = new CreativeAssetService(
        assets,
        versions,
        db.getRepository(CreativeFolderEntity),
        items,
        plans,
        db,
        mediaUpload as never,
        {} as never,
        thumbnails as never,
        plannerStatus,
      );
      studio = new CreativeVersionApprovalService(
        assets,
        versions,
        approvals,
        plannerStatus,
        assetService,
      );
    });
    beforeEach(async () => {
      await db.query(
        `TRUNCATE "${schema}"."social_approval_stage_decisions", "${schema}"."social_approval_comments", "${schema}"."social_approval_requests", "${schema}"."social_creative_asset_versions", "${schema}"."social_creative_assets", "${schema}"."social_content_items", "${schema}"."social_plans" CASCADE`,
      );
      jest.clearAllMocks();
    });
    afterAll(async () => {
      if (db?.isInitialized) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    });

    async function seedItem(planningStatus: SocialContentPlanningStatus) {
      const plan = await plans.save({
        ...companyA,
        title: 'Plano',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
      return items.save({
        tenantId: companyA.tenantId,
        workspaceId: companyA.workspaceId,
        agencyClientId: companyA.agencyClientId,
        planId: plan.id,
        title: 'Post',
        planningStatus,
        updatedById: null,
      });
    }
    const statusOf = async (id: string) =>
      (await items.findOneByOrFail({ id })).planningStatus;

    /** v1 uploaded, handed to approval and sent back by the client. */
    async function changesRequested(contentItemId?: string) {
      const asset = await assetService.upload(companyA, operator, {
        file: png(),
        contentItemId,
      });
      const v1Id = asset.currentVersionId!;
      const a = await studio.sendForApproval(
        companyA,
        operator,
        asset.id,
        v1Id,
      );
      await approvals.submit(companyA, a.id, operator);
      await approvals.approveInternal(companyA, a.id, operator);
      await approvals.clientRequestChanges(
        companyA,
        a.id,
        { type: 'user', userId: clientUser },
        'Trocar a cor do fundo.',
      );
      const v1 = await versions.findOneByOrFail({ id: v1Id });
      return { asset, v1, a };
    }

    it('closes the loop: changes_requested → v2 → Approval B supersedes A, Planner creative_ready → in_progress → ready', async () => {
      const item = await seedItem('copy_ready');
      const { asset, v1, a } = await changesRequested(item.id);
      expect(await statusOf(item.id)).toBe('creative_ready');
      await expect(
        requests.findOneByOrFail({ id: a.id }),
      ).resolves.toMatchObject({ status: 'changes_requested' });

      const v2 = await studio.startRevision(
        companyA,
        operator,
        asset.id,
        v1.id,
        png(),
      );

      // A. new version, v1 untouched; B. sequence; C. same asset.
      expect(v2.id).not.toBe(v1.id);
      await expect(
        versions.findOneByOrFail({ id: v2.id }),
      ).resolves.toMatchObject({
        creativeAssetId: asset.id,
        versionNumber: 2,
        source: 'replace',
        createdById: operator,
      });
      await expect(versions.findOneByOrFail({ id: v1.id })).resolves.toEqual(
        v1,
      );
      expect(await assets.count()).toBe(1);
      await expect(
        assets.findOneByOrFail({ id: asset.id }),
      ).resolves.toMatchObject({ currentVersionId: v2.id });
      // G. the revision reopened production.
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      // D. producing a version touches no approval.
      await expect(
        requests.findOneByOrFail({ id: a.id }),
      ).resolves.toMatchObject({
        status: 'changes_requested',
        subjectRevisionId: v1.id,
      });
      expect(await requests.count()).toBe(1);

      const b = await studio.sendForApproval(
        companyA,
        operator,
        asset.id,
        v2.id,
      );

      // E. B belongs to v2; F. Approvals superseded A by itself; D. A keeps v1.
      expect(b.subjectRevisionId).toBe(v2.id);
      expect(b.subjectId).toBe(asset.id);
      expect(b.status).toBe('draft');
      const oldA = await requests.findOneByOrFail({ id: a.id });
      expect(oldA).toMatchObject({
        status: 'superseded',
        subjectRevisionId: v1.id,
        subjectId: asset.id,
      });
      expect(oldA.supersededAt).toBeInstanceOf(Date);
      expect(await statusOf(item.id)).toBe('creative_ready');

      // CS2B.3 projection stays per version.
      await expect(
        studio.approvalForVersion(companyA, asset.id, v1.id),
      ).resolves.toMatchObject({
        approval: { approvalId: a.id, status: 'superseded' },
      });
      await expect(
        studio.approvalForVersion(companyA, asset.id, v2.id),
      ).resolves.toMatchObject({
        approval: { approvalId: b.id, status: 'draft' },
      });

      // v1 can no longer start a revision (superseded), nor v2 (draft).
      for (const versionId of [v1.id, v2.id])
        await expect(
          studio.startRevision(companyA, operator, asset.id, versionId, png()),
        ).rejects.toBeInstanceOf(ConflictException);
      expect(await versions.countBy({ creativeAssetId: asset.id })).toBe(2);
    });

    it('a second revision of the same version is refused (double click)', async () => {
      const { asset, v1 } = await changesRequested();
      await studio.startRevision(companyA, operator, asset.id, v1.id, png());
      mediaUpload.upload.mockClear();
      await expect(
        studio.startRevision(companyA, operator, asset.id, v1.id, png()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mediaUpload.upload).not.toHaveBeenCalled();
      expect(await versions.countBy({ creativeAssetId: asset.id })).toBe(2);
    });

    it('two concurrent revisions: exactly one version is created, the loser is a 409 with binaries compensated', async () => {
      const { asset, v1 } = await changesRequested();
      const results = await Promise.allSettled([
        studio.startRevision(companyA, operator, asset.id, v1.id, png()),
        studio.startRevision(companyA, randomUUID(), asset.id, v1.id, png()),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(
        (await versions.findBy({ creativeAssetId: asset.id }))
          .map((v) => v.versionNumber)
          .sort(),
      ).toEqual([1, 2]);
      // The loser either stopped before storage (it saw v2 already current)
      // or rolled back after it; it never leaves an orphan binary.
      const uploads = mediaUpload.upload.mock.calls.length - 1;
      expect(
        mediaUpload.removeAfterFailedConsumerOperation.mock.calls.length,
      ).toBe(uploads === 2 ? 2 : 0);
    });

    it('a racing writer on the version number yields 409 from the real unique constraint', async () => {
      const { asset, v1 } = await changesRequested();
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        // An uncommitted v2 from "another operator" holds the unique key.
        await runner.manager.insert(CreativeAssetVersionEntity, {
          creativeAssetId: asset.id,
          versionNumber: 2,
          mediaAssetId: randomUUID(),
          source: 'replace',
        });
        const pending = studio
          .startRevision(companyA, operator, asset.id, v1.id, png())
          .then(
            () => null,
            (error: unknown) => error,
          );
        await waitForLockWait();
        await runner.commitTransaction();
        const error = await pending;
        expect(error).toBeInstanceOf(ConflictException);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
      await expect(
        assets.findOneByOrFail({ id: asset.id }),
      ).resolves.toMatchObject({ currentVersionId: v1.id });
      expect(
        mediaUpload.removeAfterFailedConsumerOperation,
      ).toHaveBeenCalledTimes(2);
    });

    async function waitForLockWait() {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row]: Array<{ waiting: number }> = await db.query(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE $1`,
          [`%${schema}%social_creative_asset_versions%`],
        );
        if (row.waiting > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('the revision never reached the version insert');
    }

    it('rolls back the version and the current pointer with the Planner', async () => {
      const item = await seedItem('copy_ready');
      const { asset, v1 } = await changesRequested(item.id);
      const spy = jest
        .spyOn(plannerStatus, 'reflectCreativeRevisionStarted')
        .mockRejectedValueOnce(new Error('planner write failed'));
      try {
        await expect(
          studio.startRevision(companyA, operator, asset.id, v1.id, png()),
        ).rejects.toThrow('planner write failed');
      } finally {
        spy.mockRestore();
      }
      expect(await versions.countBy({ creativeAssetId: asset.id })).toBe(1);
      await expect(
        assets.findOneByOrFail({ id: asset.id }),
      ).resolves.toMatchObject({ currentVersionId: v1.id });
      expect(await statusOf(item.id)).toBe('creative_ready');
    });

    it('I. a Planner item already `ready` is not regressed, but the revision still happens', async () => {
      const item = await seedItem('copy_ready');
      const { asset, v1 } = await changesRequested(item.id);
      await items.update({ id: item.id }, { planningStatus: 'ready' });

      const v2 = await studio.startRevision(
        companyA,
        operator,
        asset.id,
        v1.id,
        png(),
      );

      expect(v2.versionNumber).toBe(2);
      expect(await statusOf(item.id)).toBe('ready');
      await studio.sendForApproval(companyA, operator, asset.id, v2.id);
      expect(await statusOf(item.id)).toBe('ready');
    });

    it('J. works for an asset without a Planner link', async () => {
      const { asset, v1 } = await changesRequested();
      expect(asset.contentItemId).toBeNull();
      await expect(
        studio.startRevision(companyA, operator, asset.id, v1.id, png()),
      ).resolves.toMatchObject({ versionNumber: 2 });
      expect(await items.count()).toBe(0);
    });

    it('K. company B cannot revise company A asset or version', async () => {
      const { asset, v1, a } = await changesRequested();
      mediaUpload.upload.mockClear();
      await expect(
        studio.startRevision(companyB, operator, asset.id, v1.id, png()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mediaUpload.upload).not.toHaveBeenCalled();
      expect(await versions.countBy({ creativeAssetId: asset.id })).toBe(1);
      await expect(
        requests.findOneByOrFail({ id: a.id }),
      ).resolves.toMatchObject({ status: 'changes_requested' });
    });

    it('an archived asset keeps its history but cannot start a revision', async () => {
      const { asset, v1, a } = await changesRequested();
      await assetService.archive(companyA, asset.id);
      mediaUpload.upload.mockClear();
      await expect(
        studio.startRevision(companyA, operator, asset.id, v1.id, png()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mediaUpload.upload).not.toHaveBeenCalled();
      expect(await versions.countBy({ creativeAssetId: asset.id })).toBe(1);
      await expect(
        studio.approvalForVersion(companyA, asset.id, v1.id),
      ).resolves.toMatchObject({
        approval: { approvalId: a.id, status: 'changes_requested' },
      });
    });

    it('L. the revision response exposes no storage internals', async () => {
      const { asset, v1 } = await changesRequested();
      const v2 = await studio.startRevision(
        companyA,
        operator,
        asset.id,
        v1.id,
        png(),
      );
      const row = await versions.findOneByOrFail({ id: v2.id });
      const detail = await assetService.detail(companyA, asset.id);
      for (const view of [v2, detail.versions[0]]) {
        const serialized = JSON.stringify(view);
        expect(serialized).not.toMatch(/storagePath|storage_path|bucket|s3:/i);
        expect(serialized).not.toContain(row.mediaAssetId);
        expect(serialized).not.toContain(String(row.thumbnailMediaAssetId));
      }
      expect(v2).toMatchObject({
        id: v2.id,
        versionNumber: 2,
        contentPath: `/social/creative-studio/assets/${asset.id}/content?versionId=${v2.id}`,
      });
    });
  },
);
