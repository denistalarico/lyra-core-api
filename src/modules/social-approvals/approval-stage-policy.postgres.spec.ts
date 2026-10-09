import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions, type Repository } from 'typeorm';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { MediaAssetEntity } from '../../common/media-assets/media-asset.entity';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateSocialApprovals1795100000000 } from '../../database/migrations/1795100000000-create-social-approvals';
import { AddSocialApprovalViewedAudit1795800000000 } from '../../database/migrations/1795800000000-add-social-approval-viewed-audit';
import { AddSocialApprovalCommentVisibility1797400000000 } from '../../database/migrations/1797400000000-add-social-approval-comment-visibility';
import { AllowOwnScopeSocialApprovals1798800000000 } from '../../database/migrations/1798800000000-allow-own-scope-social-approvals';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from '../social-creative-studio/entities';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialDestinationCreativeEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { approvalStagesFor } from './approval-stage.policy';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from './entities';
import { SocialApprovalInboxService } from './social-approval-inbox.service';
import { SocialApprovalsService } from './social-approvals.service';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';

const run = describePostgresIntegration();

/**
 * CS5 Closeout — the corrected approval workflow against real PostgreSQL.
 *
 *   managed client  internal → client → approved
 *   own (agency / B2B producing for itself)   internal → approved
 *
 * The approval tables are built by the REAL migration chain (AP1 → viewed
 * audit → comment visibility → own scope), with a company-scoped request
 * written before the new migration so "legacy preserved" is a fact, not an
 * assumption. Subject tables come from entity metadata. Throwaway schema of
 * the guarded `_test` database, dropped at the end.
 */
run('CS5 Closeout approval stage policy (real PostgreSQL)', () => {
  const schema = `cs5c_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const own: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };
  const scopeA: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientA,
    companyContextId: companyA,
  };
  const scopeB: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientB,
    companyContextId: companyB,
  };
  const reviewer = randomUUID();
  const clientUser = { type: 'user' as const, userId: randomUUID() };
  const legacyId = randomUUID();

  let db: DataSource;
  let requests: Repository<SocialApprovalRequestEntity>;
  let decisions: Repository<SocialApprovalStageDecisionEntity>;
  let approvals: SocialApprovalsService;
  let inbox: SocialApprovalInboxService;
  let legacyBefore: Record<string, unknown>;
  const published: Array<{ type: string; id: string }> = [];
  const directory = {
    // The reviewer may operate Client A only — never Client B.
    listAuthorizedClients: jest.fn(async () => [
      {
        clientId: clientA,
        displayName: 'Cliente A',
        companies: [{ companyContextId: companyA, displayName: 'Empresa A' }],
      },
    ]),
  };

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

  const SUBJECT_TABLES = [
    MediaAssetEntity,
    SocialPlanEntity,
    SocialContentItemEntity,
    SocialContentRevisionEntity,
    SocialContentDestinationEntity,
    SocialDestinationCreativeEntity,
    CreativeFolderEntity,
    CreativeAssetEntity,
    CreativeAssetVersionEntity,
  ];
  const APPROVAL_TABLES = [
    SocialApprovalRequestEntity,
    SocialApprovalCommentEntity,
    SocialApprovalStageDecisionEntity,
  ];

  beforeAll(async () => {
    const bootstrap = new DataSource(options(SUBJECT_TABLES, `${schema}_boot`));
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.synchronize();
    await bootstrap.query(`
      CREATE TABLE agency_client_company_contexts (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
        agency_client_id uuid NOT NULL,
        UNIQUE (id, tenant_id, workspace_id, agency_client_id)
      )`);
    await bootstrap.query(
      `INSERT INTO agency_client_company_contexts VALUES ($1,$3,$4,$5), ($2,$3,$4,$6)`,
      [companyA, companyB, tenantId, workspaceId, clientA, clientB],
    );
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialApprovals1795100000000().up(runner);
    await new AddSocialApprovalViewedAudit1795800000000().up(runner);
    await new AddSocialApprovalCommentVisibility1797400000000().up(runner);
    // A company request that exists BEFORE the CS5 Closeout migration.
    await runner.query(
      `INSERT INTO social_approval_requests
         (id, tenant_id, workspace_id, agency_client_id, company_context_id,
          subject_type, subject_id, subject_revision_id, source_module,
          display_type, title, subject_version_label, status, current_stage,
          requested_by_user_id, sent_to_client_at)
       VALUES ($1,$2,$3,$4,$5,'creative_version',$6,$7,'creative_studio',
               'creative','Peça legada','v1','awaiting_client','client',$8, now())`,
      [
        legacyId,
        tenantId,
        workspaceId,
        clientA,
        companyA,
        randomUUID(),
        randomUUID(),
        reviewer,
      ],
    );
    legacyBefore = (
      await runner.query(
        `SELECT * FROM social_approval_requests WHERE id = $1`,
        [legacyId],
      )
    )[0];
    await new AllowOwnScopeSocialApprovals1798800000000().up(runner);
    await runner.release();
    await bootstrap.destroy();

    db = new DataSource(
      options([...SUBJECT_TABLES, ...APPROVAL_TABLES], schema),
    );
    await db.initialize();
    requests = db.getRepository(SocialApprovalRequestEntity);
    decisions = db.getRepository(SocialApprovalStageDecisionEntity);
    const resolver = new ApprovalSubjectResolver(
      db.getRepository(CreativeAssetEntity),
      db.getRepository(CreativeAssetVersionEntity),
      db.getRepository(SocialPlanEntity),
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialContentRevisionEntity),
    );
    const publisher = {
      publish: jest.fn(async (type: string, approval: { id: string }) => {
        published.push({ type, id: approval.id });
      }),
      publishClientOnly: jest.fn(async () => undefined),
    };
    approvals = new SocialApprovalsService(
      requests,
      db.getRepository(SocialApprovalCommentEntity),
      decisions,
      db,
      resolver,
      publisher as never,
    );
    inbox = new SocialApprovalInboxService(requests, directory as never);
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(() => {
    published.length = 0;
  });

  /** One immutable creative version in `scope` (asset + version + media). */
  async function creative(scope: CompanyAwareScope) {
    const media = await db.getRepository(MediaAssetEntity).save({
      ...scope,
      storagePath: `media-assets/${randomUUID()}.png`,
      mimeType: 'image/png',
      byteSize: '24',
      source: 'creative_studio',
      metadata: {},
    });
    const asset = await db.getRepository(CreativeAssetEntity).save({
      ...scope,
      name: 'Peça',
      assetType: 'image' as const,
      sourceType: 'upload',
      status: 'ready' as const,
      metadata: {},
    });
    const version = async (versionNumber: number) => {
      const row = await db.getRepository(CreativeAssetVersionEntity).save({
        creativeAssetId: asset.id,
        versionNumber,
        mediaAssetId: media.id,
        source: 'upload',
      });
      return row.id;
    };
    return { assetId: asset.id, version };
  }
  async function draft(scope: CompanyAwareScope) {
    const { assetId, version } = await creative(scope);
    const v1 = await version(1);
    const request = await approvals.create(scope, reviewer, {
      subjectType: 'creative_version',
      subjectId: assetId,
      subjectRevisionId: v1,
    });
    return { request, assetId, version };
  }
  const decisionsOf = async (approvalRequestId: string) =>
    (
      await decisions.find({
        where: { approvalRequestId },
        order: { createdAt: 'ASC' },
      })
    ).map(({ stage, decision }) => `${stage}:${decision}`);

  // ── Migration ──────────────────────────────────────────────────────────

  describe('migration', () => {
    it('preserves the company request written before it, byte for byte', async () => {
      const after = (
        await db.query(`SELECT * FROM social_approval_requests WHERE id = $1`, [
          legacyId,
        ])
      )[0];
      expect(after).toEqual(legacyBefore);
    });

    it('is re-runnable; keeps legacy (client, null) and own-scope client stage impossible; FK still binds companies', async () => {
      const runner = db.createQueryRunner();
      const insert = (patch: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          agency_client_id: null,
          company_context_id: null,
          subject_type: 'creative_version',
          subject_id: randomUUID(),
          subject_revision_id: randomUUID(),
          source_module: 'creative_studio',
          display_type: 'creative',
          title: 'Peça',
          subject_version_label: 'v1',
          status: 'draft',
          current_stage: 'internal',
          requested_by_user_id: reviewer,
          ...patch,
        };
        const keys = Object.keys(row);
        return runner.query(
          `INSERT INTO social_approval_requests (${keys.join(',')})
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
          Object.values(row),
        );
      };
      const refuses = async (patch: Record<string, unknown>, name: string) => {
        await runner.query('SAVEPOINT refused');
        await expect(insert(patch)).rejects.toMatchObject({
          driverError: { constraint: name },
        });
        await runner.query('ROLLBACK TO SAVEPOINT refused');
      };
      try {
        await runner.startTransaction();
        await new AllowOwnScopeSocialApprovals1798800000000().up(runner);
        await refuses(
          { agency_client_id: clientA },
          'CK_social_approval_requests_scope',
        );
        await refuses(
          { status: 'awaiting_client', current_stage: 'client' },
          'CK_social_approval_requests_own_internal',
        );
        await refuses(
          { sent_to_client_at: new Date() },
          'CK_social_approval_requests_own_internal',
        );
        await refuses(
          { agency_client_id: clientA, company_context_id: randomUUID() },
          'FK_social_approval_requests_company',
        );
        // One active request per own-scope revision (NULLs are distinct in
        // the original index, so the own scope has its own).
        const subject = {
          subject_id: randomUUID(),
          subject_revision_id: randomUUID(),
        };
        await insert(subject);
        await refuses(
          subject,
          'UQ_social_approval_requests_active_revision_own',
        );
        await runner.rollbackTransaction();
      } finally {
        await runner.release();
      }
    });

    it('down refuses while own-scope requests exist, and down → up round-trips without them', async () => {
      const runner = db.createQueryRunner();
      const migration = new AllowOwnScopeSocialApprovals1798800000000();
      const nullable = async () =>
        (
          await runner.query(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'social_approval_requests'
                AND column_name IN ('agency_client_id','company_context_id')
                AND is_nullable = 'YES'`,
            [schema],
          )
        )[0].n as number;
      const ownId = randomUUID();
      try {
        await runner.startTransaction();
        // Runs first in this file: the only own-scope row is this one.
        await runner.query(
          `INSERT INTO social_approval_requests
             (id, tenant_id, workspace_id, subject_type, subject_id,
              subject_revision_id, source_module, display_type, title,
              subject_version_label, requested_by_user_id)
           VALUES ($1,$2,$3,'creative_version',$4,$5,'creative_studio',
                   'creative','Peça','v1',$6)`,
          [ownId, tenantId, workspaceId, randomUUID(), randomUUID(), reviewer],
        );
        await runner.query('SAVEPOINT down_refused');
        await expect(migration.down(runner)).rejects.toThrow(
          /own-scope approvals/,
        );
        await runner.query('ROLLBACK TO SAVEPOINT down_refused');
        await runner.query(
          `DELETE FROM social_approval_requests WHERE id = $1`,
          [ownId],
        );
        await migration.down(runner);
        expect(await nullable()).toBe(0);
        await expect(
          runner.query(`SELECT 1 FROM social_approval_requests WHERE id = $1`, [
            legacyId,
          ]),
        ).resolves.toHaveLength(1);
        await migration.up(runner);
        await migration.up(runner);
        expect(await nullable()).toBe(2);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  });

  // ── Lifecycles ─────────────────────────────────────────────────────────

  describe('agency own (and B2B own): internal only', () => {
    it('create → submit → internal approve is final; the client stage never happens', async () => {
      const { request } = await draft(own);
      expect(request).toMatchObject({
        agencyClientId: null,
        companyContextId: null,
        status: 'draft',
        currentStage: 'internal',
      });
      expect(approvalStagesFor(request)).toEqual(['internal']);
      await expect(
        approvals.submit(own, request.id, reviewer),
      ).resolves.toMatchObject({ status: 'awaiting_internal_review' });
      const approved = await approvals.approveInternal(
        own,
        request.id,
        reviewer,
      );
      expect(approved).toMatchObject({
        status: 'approved',
        currentStage: 'internal',
        sentToClientAt: null,
      });
      expect(approved.approvedAt).toBeInstanceOf(Date);
      expect(await decisionsOf(request.id)).toEqual(['internal:approved']);
      expect(published).toEqual([{ type: 'approved', id: request.id }]);
      // No client action exists for it.
      await expect(
        approvals.clientApprove(own, request.id, clientUser),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        approvals.markClientViewed(own, request.id, reviewer),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        approvals.comment(own, request.id, reviewer, 'nota', 'client'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('changes requested internally, then resubmitted and approved', async () => {
      const { request } = await draft(own);
      await approvals.submit(own, request.id, reviewer);
      await expect(
        approvals.requestChanges(own, request.id, reviewer, 'Ajustar a cor.'),
      ).resolves.toMatchObject({
        status: 'changes_requested',
        currentStage: 'internal',
      });
      await approvals.submit(own, request.id, reviewer);
      await approvals.approveInternal(own, request.id, reviewer);
      expect(await decisionsOf(request.id)).toEqual([
        'internal:changes_requested',
        'internal:approved',
      ]);
    });

    it('two concurrent drafts of the same revision leave exactly one active request', async () => {
      const { assetId, version } = await creative(own);
      const v1 = await version(1);
      const input = {
        subjectType: 'creative_version',
        subjectId: assetId,
        subjectRevisionId: v1,
      };
      const outcomes = await Promise.allSettled([
        approvals.create(own, reviewer, input),
        approvals.create(own, reviewer, input),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(
        await requests.countBy({ subjectRevisionId: v1, status: 'draft' }),
      ).toBe(1);
    });
  });

  describe('managed client: internal → client', () => {
    it('create → internal review → internal approve → awaiting client → client approve → approved', async () => {
      const { request } = await draft(scopeA);
      expect(approvalStagesFor(request)).toEqual(['internal', 'client']);
      await approvals.submit(scopeA, request.id, reviewer);
      const internal = await approvals.approveInternal(
        scopeA,
        request.id,
        reviewer,
      );
      expect(internal).toMatchObject({
        status: 'awaiting_client',
        currentStage: 'client',
      });
      expect(internal.sentToClientAt).toBeInstanceOf(Date);
      expect(internal.approvedAt).toBeNull();
      const final = await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser,
      );
      expect(final.status).toBe('approved');
      expect(await decisionsOf(request.id)).toEqual([
        'internal:approved',
        'client:approved',
      ]);
      expect(published.map((p) => p.type)).toEqual([
        'awaiting_client',
        'approved',
      ]);
    });

    it('changes may be requested at the internal stage and at the client stage', async () => {
      const internal = await draft(scopeA);
      await approvals.submit(scopeA, internal.request.id, reviewer);
      await approvals.requestChanges(
        scopeA,
        internal.request.id,
        reviewer,
        'Interno: ajustar.',
      );
      expect(await decisionsOf(internal.request.id)).toEqual([
        'internal:changes_requested',
      ]);

      const client = await draft(scopeA);
      await approvals.submit(scopeA, client.request.id, reviewer);
      await approvals.approveInternal(scopeA, client.request.id, reviewer);
      await expect(
        approvals.clientRequestChanges(
          scopeA,
          client.request.id,
          clientUser,
          'Cliente: trocar a foto.',
        ),
      ).resolves.toMatchObject({
        status: 'changes_requested',
        currentStage: 'internal',
      });
      expect(await decisionsOf(client.request.id)).toEqual([
        'internal:approved',
        'client:changes_requested',
      ]);
    });
  });

  describe('revision', () => {
    it('V1 approved stays approved; V2 needs its own approval', async () => {
      const { request, assetId, version } = await draft(own);
      await approvals.submit(own, request.id, reviewer);
      await approvals.approveInternal(own, request.id, reviewer);
      const v2 = await version(2);
      const second = await approvals.create(own, reviewer, {
        subjectType: 'creative_version',
        subjectId: assetId,
        subjectRevisionId: v2,
      });
      expect(second.status).toBe('draft');
      await expect(
        requests.findOneByOrFail({ id: request.id }),
      ).resolves.toMatchObject({ status: 'approved' });
      await expect(
        approvals.findStateForSubjectRevision(own, {
          subjectType: 'creative_version',
          subjectId: assetId,
          subjectRevisionId: v2,
        }),
      ).resolves.toMatchObject({ status: 'draft' });
    });
  });

  // ── Scope ──────────────────────────────────────────────────────────────

  describe('scope', () => {
    it('own, Client A and Client B never see each other (404), and lists stay in scope', async () => {
      const ownRequest = (await draft(own)).request;
      const aRequest = (await draft(scopeA)).request;
      const bRequest = (await draft(scopeB)).request;
      const cases: Array<[CompanyAwareScope, string]> = [
        [own, aRequest.id],
        [own, bRequest.id],
        [scopeA, ownRequest.id],
        [scopeA, bRequest.id],
        [scopeB, ownRequest.id],
        [scopeB, aRequest.id],
      ];
      for (const [scope, id] of cases) {
        await expect(approvals.detail(scope, id)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        await expect(
          approvals.submit(scope, id, reviewer),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
      // A creative of another scope is not a subject here either.
      const foreign = await creative(scopeA);
      await expect(
        approvals.create(own, reviewer, {
          subjectType: 'creative_version',
          subjectId: foreign.assetId,
          subjectRevisionId: await foreign.version(1),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const ids = async (scope: CompanyAwareScope) =>
        (await approvals.list(scope, {})).items.map((item) => item.id);
      expect(await ids(own)).toContain(ownRequest.id);
      expect(await ids(own)).not.toContain(aRequest.id);
      expect(await ids(scopeA)).toEqual(
        expect.arrayContaining([aRequest.id, legacyId]),
      );
      expect(await ids(scopeA)).not.toContain(ownRequest.id);
      expect(await ids(scopeB)).not.toContain(aRequest.id);
    });
  });

  // ── Cross-context list ─────────────────────────────────────────────────

  describe('inbox', () => {
    const agencyCtx: RequestContext = {
      tenantId,
      workspaceId,
      userId: reviewer,
      role: 'member',
    };

    it('agency mode lists own + authorized companies with their context and stages; never an unauthorized company', async () => {
      const ownRequest = (await draft(own)).request;
      const aRequest = (await draft(scopeA)).request;
      const bRequest = (await draft(scopeB)).request;
      const { items } = await inbox.list(agencyCtx, { limit: 100 });
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get(ownRequest.id)).toMatchObject({
        context: { kind: 'own' },
        stages: ['internal'],
      });
      expect(byId.get(aRequest.id)).toMatchObject({
        context: {
          kind: 'managed_client',
          clientId: clientA,
          clientName: 'Cliente A',
          companyContextId: companyA,
          companyName: 'Empresa A',
        },
        stages: ['internal', 'client'],
      });
      expect(byId.has(bRequest.id)).toBe(false);
      expect(directory.listAuthorizedClients).toHaveBeenCalledWith(
        { tenantId, workspaceId, userId: reviewer, role: 'member' },
        'social',
      );

      const onlyOwn = await inbox.list(agencyCtx, { scope: 'own', limit: 100 });
      expect(onlyOwn.items.every((item) => item.context.kind === 'own')).toBe(
        true,
      );
      const onlyManaged = await inbox.list(agencyCtx, {
        scope: 'managed',
        limit: 100,
      });
      expect(
        onlyManaged.items.every(
          (item) => item.context.kind === 'managed_client',
        ),
      ).toBe(true);
      const clientStage = await inbox.list(agencyCtx, {
        stage: 'client',
        limit: 100,
      });
      expect(clientStage.items.map((item) => item.id)).toContain(legacyId);
      expect(
        clientStage.items.every((item) => item.currentStage === 'client'),
      ).toBe(true);
    });

    it('client mode is exactly the current company; pages with a cursor', async () => {
      const bRequest = (await draft(scopeB)).request;
      await draft(scopeB);
      const clientCtx: RequestContext = {
        ...agencyCtx,
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: clientB,
          companyContextId: companyB,
          managedTenantId: randomUUID(),
          clientName: 'Cliente B',
          companyName: 'Empresa B',
        },
      };
      const first = await inbox.list(clientCtx, { limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const all = await inbox.list(clientCtx, { limit: 100 });
      expect(all.items.map((item) => item.id)).toContain(bRequest.id);
      expect(
        all.items.every(
          (item) =>
            item.context.kind === 'managed_client' &&
            item.context.companyContextId === companyB,
        ),
      ).toBe(true);
      const second = await inbox.list(clientCtx, {
        limit: 100,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((item) => item.id)).not.toContain(
        first.items[0].id,
      );
    });
  });
});
