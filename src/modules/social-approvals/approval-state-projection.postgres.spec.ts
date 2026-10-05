import { randomUUID } from 'crypto';
import { DataSource, type DataSourceOptions, type Repository } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  SocialApprovalRequestEntity,
  type SocialApprovalStatus,
} from './entities';
import { SocialApprovalsService } from './social-approvals.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
} from '../social-creative-studio/entities';
import { CreativeVersionApprovalService } from '../social-creative-studio/creative-version-approval.service';
import { NotFoundException } from '@nestjs/common';

const run = describePostgresIntegration();

run(
  'CS2B.3 exact-revision approval state lookup (real TypeORM/PostgreSQL)',
  () => {
    let db: DataSource;
    let requests: Repository<SocialApprovalRequestEntity>;
    let service: SocialApprovalsService;
    const schema = `cs2b3_${randomUUID().replace(/-/g, '')}`;
    const scope = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      agencyClientId: randomUUID(),
      companyContextId: randomUUID(),
    };
    const subject = {
      subjectType: 'creative_version',
      subjectId: randomUUID(),
      subjectRevisionId: randomUUID(),
    };
    const v2 = randomUUID();
    const older = new Date('2026-10-01T12:00:00Z');
    const newer = new Date('2026-10-02T12:00:00Z');
    const comments = { find: jest.fn() };
    const decisions = { find: jest.fn() };

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
          SocialApprovalRequestEntity,
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
      requests = db.getRepository(SocialApprovalRequestEntity);
      service = new SocialApprovalsService(
        requests,
        comments as never,
        decisions as never,
        db,
        {} as never,
      );
    });
    beforeEach(async () => {
      await requests.clear();
      await db.getRepository(CreativeAssetVersionEntity).clear();
      await db.getRepository(CreativeAssetEntity).clear();
      jest.clearAllMocks();
    });
    afterAll(async () => {
      if (db?.isInitialized) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    });

    const seed = (
      status: SocialApprovalStatus,
      overrides: Partial<SocialApprovalRequestEntity> = {},
    ) =>
      requests.save({
        ...scope,
        ...subject,
        sourceModule: 'creative_studio',
        displayType: 'creative',
        title: 'Creative projection',
        subjectVersionLabel: 'v1',
        status,
        currentStage: 'internal',
        requestedByUserId: randomUUID(),
        requestedAt: older,
        createdAt: older,
        sentToClientAt: null,
        approvedAt: null,
        cancelledAt: null,
        supersededAt: null,
        ...overrides,
      });

    it('returns null without a request and never loads comments/decisions', async () => {
      await expect(
        service.findStateForSubjectRevision(scope, subject),
      ).resolves.toBeNull();
      expect(comments.find).not.toHaveBeenCalled();
      expect(decisions.find).not.toHaveBeenCalled();
    });

    async function studioFixture() {
      const assets = db.getRepository(CreativeAssetEntity);
      const versions = db.getRepository(CreativeAssetVersionEntity);
      await assets.save({
        id: subject.subjectId,
        ...scope,
        name: 'Creative A',
        assetType: 'image',
        currentVersionId: v2,
      });
      await versions.save([
        {
          id: subject.subjectRevisionId,
          creativeAssetId: subject.subjectId,
          versionNumber: 1,
          mediaAssetId: randomUUID(),
          source: 'upload',
        },
        {
          id: v2,
          creativeAssetId: subject.subjectId,
          versionNumber: 2,
          mediaAssetId: randomUUID(),
          source: 'replace',
        },
      ]);
      return {
        assets,
        versions,
        studio: new CreativeVersionApprovalService(
          assets,
          versions,
          service,
          {
            reflectCreativeStatus: jest.fn(),
          } as never,
          {} as never,
        ),
      };
    }

    it('Studio → real Approvals returns null for a real authorized version without a request', async () => {
      const { studio } = await studioFixture();
      await expect(
        studio.approvalForVersion(
          scope,
          subject.subjectId,
          subject.subjectRevisionId,
        ),
      ).resolves.toEqual({ approval: null });
    });

    it('Studio → real Approvals reads old and current revisions without mutating assets, versions or requests', async () => {
      const { studio, assets, versions } = await studioFixture();
      const old = await seed('superseded', { supersededAt: newer });
      const current = await seed('awaiting_client', {
        subjectRevisionId: v2,
        currentStage: 'client',
        sentToClientAt: newer,
      });
      const before = {
        assets: await assets.find(),
        versions: await versions.find(),
        requests: await requests.find(),
      };
      await expect(
        studio.approvalForVersion(
          scope,
          subject.subjectId,
          subject.subjectRevisionId,
        ),
      ).resolves.toMatchObject({
        approval: { approvalId: old.id, status: 'superseded' },
      });
      await expect(
        studio.approvalForVersion(scope, subject.subjectId, v2),
      ).resolves.toMatchObject({
        approval: { approvalId: current.id, status: 'awaiting_client' },
      });
      expect({
        assets: await assets.find(),
        versions: await versions.find(),
        requests: await requests.find(),
      }).toEqual(before);
    });

    it('Studio blocks known-version cross-company and mismatched-asset reads before querying Approvals', async () => {
      const { studio } = await studioFixture();
      const read = jest.spyOn(service, 'findStateForSubjectRevision');
      try {
        await expect(
          studio.approvalForVersion(
            { ...scope, companyContextId: randomUUID() },
            subject.subjectId,
            subject.subjectRevisionId,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        const otherAsset = await db
          .getRepository(CreativeAssetEntity)
          .save({ ...scope, name: 'Creative B', assetType: 'image' });
        await expect(
          studio.approvalForVersion(
            scope,
            otherAsset.id,
            subject.subjectRevisionId,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(read).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    });

    it.each([
      'draft',
      'awaiting_internal_review',
      'awaiting_client',
      'changes_requested',
      'approved',
      'cancelled',
      'superseded',
    ] as const)(
      'projects %s and only real request metadata',
      async (status) => {
        const row = await seed(status, {
          currentStage: 'client',
          sentToClientAt: newer,
          approvedAt: status === 'approved' ? newer : null,
          cancelledAt: status === 'cancelled' ? newer : null,
          supersededAt: status === 'superseded' ? newer : null,
        });
        await expect(
          service.findStateForSubjectRevision(scope, subject),
        ).resolves.toEqual({
          approvalId: row.id,
          status,
          currentStage: row.currentStage,
          createdAt: older,
          sentToClientAt: newer,
          approvedAt: row.approvedAt,
          cancelledAt: row.cancelledAt,
          supersededAt: row.supersededAt,
        });
        expect(comments.find).not.toHaveBeenCalled();
        expect(decisions.find).not.toHaveBeenCalled();
      },
    );

    it('returns superseded v1 and active v2 separately for the same logical asset', async () => {
      const first = await seed('superseded', { supersededAt: newer });
      const second = await seed('awaiting_client', {
        subjectRevisionId: v2,
        createdAt: newer,
        currentStage: 'client',
        sentToClientAt: newer,
      });
      await expect(
        service.findStateForSubjectRevision(scope, subject),
      ).resolves.toMatchObject({ approvalId: first.id, status: 'superseded' });
      await expect(
        service.findStateForSubjectRevision(scope, {
          ...subject,
          subjectRevisionId: v2,
        }),
      ).resolves.toMatchObject({
        approvalId: second.id,
        status: 'awaiting_client',
      });
    });

    it('prefers the exact revision active request over a newer terminal request', async () => {
      const active = await seed('changes_requested');
      await seed('cancelled', { createdAt: newer });
      await expect(
        service.findStateForSubjectRevision(scope, subject),
      ).resolves.toMatchObject({
        approvalId: active.id,
        status: 'changes_requested',
      });
    });

    it('falls back to the newest terminal request for that exact revision', async () => {
      await seed('approved');
      const latest = await seed('cancelled', { createdAt: newer });
      await seed('approved', {
        subjectRevisionId: v2,
        createdAt: new Date('2026-10-03T12:00:00Z'),
      });
      await expect(
        service.findStateForSubjectRevision(scope, subject),
      ).resolves.toMatchObject({ approvalId: latest.id });
    });

    it('breaks equal createdAt ties by id descending, independent of insertion order', async () => {
      const greaterId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      await seed('approved', { id: greaterId });
      await seed('cancelled', { id: '00000000-0000-4000-8000-000000000001' });
      await expect(
        service.findStateForSubjectRevision(scope, subject),
      ).resolves.toMatchObject({ approvalId: greaterId });
    });

    it.each(['tenantId', 'workspaceId', 'agencyClientId', 'companyContextId'])(
      'never widens %s',
      async (key) => {
        await seed('awaiting_client');
        await expect(
          service.findStateForSubjectRevision(
            { ...scope, [key]: randomUUID() },
            subject,
          ),
        ).resolves.toBeNull();
      },
    );

    it.each(['subjectType', 'subjectId', 'subjectRevisionId'])(
      'requires exact %s',
      async (key) => {
        await seed('approved');
        await expect(
          service.findStateForSubjectRevision(scope, {
            ...subject,
            [key]: randomUUID(),
          }),
        ).resolves.toBeNull();
      },
    );

    it('keeps null agency/legacy predicates explicit and never returns company requests', async () => {
      await seed('awaiting_client');
      await expect(
        service.findStateForSubjectRevision(
          { ...scope, agencyClientId: null, companyContextId: null },
          subject,
        ),
      ).resolves.toBeNull();
      await expect(
        service.findStateForSubjectRevision(
          { ...scope, companyContextId: null },
          subject,
        ),
      ).resolves.toBeNull();
    });
  },
);
