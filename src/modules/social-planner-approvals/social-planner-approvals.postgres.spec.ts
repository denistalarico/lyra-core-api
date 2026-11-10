import { AddSocialApprovalCommentRichContent1803500000000 } from '../../database/migrations/1803500000000-add-social-approval-comment-rich-content';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { MediaAssetEntity } from '../../common/media-assets/media-asset.entity';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateSocialApprovals1795100000000 } from '../../database/migrations/1795100000000-create-social-approvals';
import { AddSocialApprovalViewedAudit1795800000000 } from '../../database/migrations/1795800000000-add-social-approval-viewed-audit';
import { AddSocialApprovalCommentVisibility1797400000000 } from '../../database/migrations/1797400000000-add-social-approval-comment-visibility';
import { AllowOwnScopeSocialApprovals1798800000000 } from '../../database/migrations/1798800000000-allow-own-scope-social-approvals';
import { CreateSocialApprovalPieces1802900000000 } from '../../database/migrations/1802900000000-create-social-approval-pieces';
import { AddSocialApprovalPieceDescription1803400000000 } from '../../database/migrations/1803400000000-add-social-approval-piece-description';
import { AddSocialApprovalCardCustomization1803300000000 } from '../../database/migrations/1803300000000-add-social-approval-card-customization';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import { ClientAreaMemberModuleAccessEntity } from '../client-area/entities/client-area-member-module-access.entity';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';
import { ClientApprovalTextEditService } from '../social-approvals/client/client-approval-text-edit.service';
import {
  SocialApprovalCommentEntity,
  SocialApprovalEventEntity,
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalSettingsEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStageDecisionEntity,
  SocialApprovalStepEntity,
  type ApprovalTableSnapshotPayload,
} from '../social-approvals/entities';
import { SocialApprovalAuthorityService } from '../social-approvals/social-approval-authority.service';
import { SocialApprovalTransitionRegistry } from '../social-approvals/approval-transition.port';
import { SocialApprovalPieceActionsService } from '../social-approvals/social-approval-piece-actions.service';
import { SocialApprovalPieceSyncService } from '../social-approvals/social-approval-piece-sync.service';
import { SocialApprovalPiecesService } from '../social-approvals/social-approval-pieces.service';
import { SocialApprovalSettingsService } from '../social-approvals/social-approval-settings.service';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { ApprovalSubjectResolver } from '../social-approvals/subjects/approval-subject-resolver';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
  CreativeProductionEntity,
} from '../social-creative-studio/entities';
import {
  SocialCampaignInstanceEntity,
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialDestinationCreativeEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { SocialContentProductionStatusService } from '../social-planner/services/social-content-production-status.service';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import { SocialPlannerApprovalsService } from './social-planner-approvals.service';

const run = describePostgresIntegration();

/**
 * AR3 — the backend acceptance matrix, on real PostgreSQL in a throwaway
 * schema of the guarded `_test` database. Only the Studio's own send is a
 * stand-in, because it is covered by its own suite.
 */
run('AR3 Planner send and client text edit (real PostgreSQL)', () => {
  const schema = `ar3_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientA = randomUUID();
  const companyA = randomUUID();
  const scopeA: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientA,
    companyContextId: companyA,
  };
  const own: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };
  const ownerUser = randomUUID();
  const clientOwner = randomUUID();
  const memberOne = randomUUID();
  const memberTwo = randomUUID();
  const membershipIds: Record<string, string> = {};

  const SUBJECT_TABLES = [
    MediaAssetEntity,
    SocialPlanEntity,
    SocialContentItemEntity,
    SocialContentRevisionEntity,
    SocialContentDestinationEntity,
    SocialDestinationCreativeEntity,
    SocialCampaignInstanceEntity,
    CreativeFolderEntity,
    CreativeAssetEntity,
    CreativeAssetVersionEntity,
    CreativeProductionEntity,
    ClientAreaMembershipEntity,
    ClientAreaMemberModuleAccessEntity,
    AgencyUserProfileEntity,
  ];
  const APPROVAL_TABLES = [
    SocialApprovalRequestEntity,
    SocialApprovalCommentEntity,
    SocialApprovalStageDecisionEntity,
    SocialApprovalPieceEntity,
    SocialApprovalStepEntity,
    SocialApprovalSnapshotEntity,
    SocialApprovalEventEntity,
    SocialApprovalSettingsEntity,
  ];

  let db: DataSource;
  let approvals: SocialApprovalsService;
  let settings: SocialApprovalSettingsService;
  let pieces: SocialApprovalPiecesService;
  let sync: SocialApprovalPieceSyncService;
  let actions: SocialApprovalPieceActionsService;
  let planner: SocialPlannerService;
  let service: SocialPlannerApprovalsService;
  let textEdit: ClientApprovalTextEditService;

  /** Items with a Studio selection; everything else has none. */
  const selections = new Map<string, unknown>();
  const studioSend = jest.fn();

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
      `INSERT INTO agency_client_company_contexts VALUES ($1,$2,$3,$4)`,
      [companyA, tenantId, workspaceId, clientA],
    );
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialApprovals1795100000000().up(runner);
    await new AddSocialApprovalViewedAudit1795800000000().up(runner);
    await new AddSocialApprovalCommentVisibility1797400000000().up(runner);
    await new AllowOwnScopeSocialApprovals1798800000000().up(runner);
    await new CreateSocialApprovalPieces1802900000000().up(runner);
    await new AddSocialApprovalCardCustomization1803300000000().up(runner);
    await new AddSocialApprovalPieceDescription1803400000000().up(runner);
    await new AddSocialApprovalCommentRichContent1803500000000().up(runner);
    await runner.release();
    await bootstrap.destroy();

    db = new DataSource(
      options([...SUBJECT_TABLES, ...APPROVAL_TABLES], schema),
    );
    await db.initialize();

    const resolver = new ApprovalSubjectResolver(
      db.getRepository(CreativeAssetEntity),
      db.getRepository(CreativeAssetVersionEntity),
      db.getRepository(SocialPlanEntity),
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialContentRevisionEntity),
      db.getRepository(SocialApprovalSnapshotEntity),
      db.getRepository(SocialApprovalStepEntity),
    );
    const authority = new SocialApprovalAuthorityService();
    settings = new SocialApprovalSettingsService(db, authority);
    pieces = new SocialApprovalPiecesService(db);
    const transitions = new SocialApprovalTransitionRegistry();
    approvals = new SocialApprovalsService(
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalCommentEntity),
      db.getRepository(SocialApprovalStageDecisionEntity),
      db,
      resolver,
      pieces,
      authority,
      settings,
      undefined,
      transitions,
    );
    sync = new SocialApprovalPieceSyncService(db, pieces);
    actions = new SocialApprovalPieceActionsService(
      db,
      approvals,
      pieces,
      {
        resolve: async ({ mediaAssetId }: { mediaAssetId: string }) => ({
          id: mediaAssetId,
          mimeType: 'image/png',
        }),
      } as never,
      {} as never,
    );
    planner = new SocialPlannerService(
      db.getRepository(SocialPlanEntity),
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialContentDestinationEntity),
      db.getRepository(SocialContentRevisionEntity),
      {} as never,
      pieces,
    );
    const readiness = {
      snapshot: async (scope: CompanyAwareScope, id: string) => {
        const contentItem = await planner['contentRepository'].findOneOrFail({
          where: {
            id,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
          },
        });
        const plan = await db.getRepository(SocialPlanEntity).findOneOrFail({
          where: { id: contentItem.planId },
        });
        if (plan.companyContextId !== scope.companyContextId)
          throw Object.assign(new Error('not found'), { status: 404 });
        const selection = selections.get(id) ?? null;
        return {
          contentItem,
          selection,
          approval: { state: 'not_sent', projection: null },
        };
      },
    };
    service = new SocialPlannerApprovalsService(
      db,
      approvals,
      pieces,
      actions,
      sync,
      resolver,
      new SocialContentProductionStatusService(
        db.getRepository(SocialContentItemEntity),
        db.getRepository(SocialPlanEntity),
      ),
      { sendSelectedForApproval: studioSend } as never,
      readiness as never,
      transitions,
      { assertCan: jest.fn() } as never,
    );
    service.onModuleInit();
    textEdit = new ClientApprovalTextEditService(
      db,
      approvals,
      pieces,
      settings,
      authority,
      planner,
    );

    const members = db.getRepository(ClientAreaMembershipEntity);
    const add = async (
      key: string,
      userId: string,
      role: 'client_owner' | 'client_member',
    ) => {
      const row = await members.save({
        tenantId,
        workspaceId,
        agencyClientId: clientA,
        companyContextId: companyA,
        userId,
        role,
        status: 'active',
        grantedByUserId: null,
        grantedAt: new Date(),
        revokedByUserId: null,
        revokedAt: null,
      });
      membershipIds[key] = row.id;
      if (role === 'client_member')
        await db.getRepository(ClientAreaMemberModuleAccessEntity).save({
          membershipId: row.id,
          tenantId,
          workspaceId,
          moduleKey: 'approvals',
          level: 'manager',
          grantedByUserId: ownerUser,
          grantedBySurface: 'agency',
        } as never);
    };
    await add('owner', clientOwner, 'client_owner');
    await add('one', memberOne, 'client_member');
    await add('two', memberTwo, 'client_member');
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM social_approval_settings`);
    selections.clear();
    studioSend.mockReset();
  });

  const ctx = (scope: CompanyAwareScope = scopeA): RequestContext => ({
    tenantId,
    workspaceId,
    userId: ownerUser,
    role: 'owner',
    managedContext: scope.agencyClientId
      ? ({
          operatingMode: 'client',
          clientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          managedTenantId: null,
        } as never)
      : undefined,
  });

  const plan = async (scope: CompanyAwareScope = scopeA) =>
    (await db.getRepository(SocialPlanEntity).save({
      ...scope,
      title: 'Plano Dezembro',
      periodStart: '2026-12-01',
      periodEnd: '2026-12-31',
      status: 'draft',
      deletedAt: null,
    } as never)) as unknown as SocialPlanEntity;

  const item = async (
    planId: string,
    scope: CompanyAwareScope = scopeA,
    extra: Record<string, unknown> = {},
  ) =>
    (await db.getRepository(SocialContentItemEntity).save({
      tenantId,
      workspaceId,
      agencyClientId: scope.agencyClientId,
      planId,
      title: `Item ${randomUUID().slice(0, 6)}`,
      hashtags: [],
      planningStatus: 'planned',
      plannedDate: '2026-12-10',
      sortOrder: 0,
      ...extra,
    } as never)) as unknown as SocialContentItemEntity;

  /** Item with a saved text, through the Planner's own write. */
  async function withCopy(scope: CompanyAwareScope = scopeA, planId?: string) {
    const id = planId ?? (await plan(scope)).id;
    const row = await item(id, scope);
    await planner.createRevision(scope, row.id, ownerUser, {
      copy: 'texto original',
    });
    return { planId: id, itemId: row.id };
  }

  async function uploadDirect(
    itemId: string,
    placement = 'feed',
    scope = scopeA,
  ) {
    const destination = (await db
      .getRepository(SocialContentDestinationEntity)
      .save({
        tenantId,
        workspaceId,
        agencyClientId: scope.agencyClientId,
        contentItemId: itemId,
        channel: 'instagram',
        placement,
      } as never)) as unknown as SocialContentDestinationEntity;
    const mediaAssetId = randomUUID();
    await db.getRepository(SocialDestinationCreativeEntity).save({
      tenantId,
      workspaceId,
      agencyClientId: scope.agencyClientId,
      destinationId: destination.id,
      contentItemId: itemId,
      mediaAssetId,
      organicAssetId: randomUUID(),
    } as never);
    return mediaAssetId;
  }

  const internalApprove = (id: string, scope = scopeA) =>
    approvals.approveInternal(scope, id, ownerUser, 'owner');
  const clientApprove = (id: string, userId = clientOwner) =>
    approvals.clientApprove(scopeA, id, { type: 'user', userId });
  const editor = (userId: string) => ({
    userId,
    surface: 'client_area' as const,
  });
  const request = (id: string) =>
    db.getRepository(SocialApprovalRequestEntity).findOneByOrFail({ id });
  const pieceOf = (kind: SocialApprovalPieceEntity['kind'], sourceId: string) =>
    db
      .getRepository(SocialApprovalPieceEntity)
      .findOneByOrFail({ kind, sourceId });
  const stepsOf = (pieceId: string) =>
    db.getRepository(SocialApprovalStepEntity).find({ where: { pieceId } });
  const eventTypes = async (pieceId: string) =>
    (
      await db.getRepository(SocialApprovalEventEntity).find({
        where: { pieceId },
        order: { createdAt: 'ASC' },
      })
    ).map((event) => event.type);
  const planningStatus = async (id: string) =>
    (await db.getRepository(SocialContentItemEntity).findOneByOrFail({ id }))
      .planningStatus;
  const code = (expected: string) =>
    expect.objectContaining({
      response: expect.objectContaining({ code: expected }),
    });
  const contexts = [{ clientId: clientA, companyContextId: companyA }];

  /** Sent, approved internally and now waiting on the client. */
  async function copyAwaitingClient() {
    const created = await withCopy();
    const sent = await service.sendContent(ctx(), created.itemId, 'copy');
    await internalApprove(sent.copy!.approvalId!);
    return { ...created, approvalId: sent.copy!.approvalId! };
  }

  describe('tables (R-09, D-11)', () => {
    it('sends without leaving a draft, warns about gaps and reports the rows', async () => {
      const { id } = await plan();
      await item(id, scopeA, { title: 'Natal' });
      await item(id, scopeA, { title: 'Sem data', plannedDate: null });
      await item(id, scopeA, { title: 'Só calendário', calendarOnly: true });

      const sent = await service.sendPlanTable(ctx(), id);

      expect(sent.status).toBe('awaiting_internal_review');
      expect(sent.itemCount).toBe(2);
      expect(sent.warnings).toEqual({
        itemsWithoutDate: 1,
        itemsWithoutTitle: 0,
      });
      const snapshot = await db
        .getRepository(SocialApprovalSnapshotEntity)
        .findOneByOrFail({
          id: (await request(sent.approvalId)).subjectRevisionId,
        });
      const payload = snapshot.payload as ApprovalTableSnapshotPayload;
      expect(payload.rows.map((row) => row.title)).toEqual([
        'Natal',
        'Sem data',
      ]);
      expect(payload.rows[0].plannedDate).toBe('10/12/2026');
      expect(JSON.stringify(payload)).not.toContain('brief');
    });

    it('a double click is one send; a changed table is a new snapshot', async () => {
      const { id } = await plan();
      const row = await item(id, scopeA, { title: 'Original' });
      const first = await service.sendPlanTable(ctx(), id);
      const again = await service.sendPlanTable(ctx(), id);
      expect(again).toMatchObject({
        changed: false,
        approvalId: first.approvalId,
      });

      await db
        .getRepository(SocialContentItemEntity)
        .update(row.id, { title: 'Novo título' });
      const second = await service.sendPlanTable(ctx(), id);

      expect(second.approvalId).not.toBe(first.approvalId);
      expect(second.revisionLabel).toBe('r2');
      expect((await request(first.approvalId)).status).toBe('superseded');
    });

    it('refuses a table the board would hide (D-31)', async () => {
      const { id } = await plan();
      await item(id, scopeA, { planningStatus: 'posted' });
      await expect(service.sendPlanTable(ctx(), id)).rejects.toEqual(
        code('approval_table_empty'),
      );
      const closed = (await db
        .getRepository(SocialCampaignInstanceEntity)
        .save({
          ...scopeA,
          name: 'Encerrada',
          status: 'completed',
        } as never)) as unknown as SocialCampaignInstanceEntity;
      await expect(service.sendCampaignTable(ctx(), closed.id)).rejects.toEqual(
        code('approval_content_unavailable'),
      );
    });

    it('refuses an empty table and hides another scope', async () => {
      const { id } = await plan();
      await expect(service.sendPlanTable(ctx(), id)).rejects.toEqual(
        code('approval_table_empty'),
      );
      await expect(service.sendPlanTable(ctx(own), id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('a campaign snapshot carries the campaign and only its items', async () => {
      const { id } = await plan();
      const campaign = (await db
        .getRepository(SocialCampaignInstanceEntity)
        .save({
          ...scopeA,
          name: 'Natal',
          objective: 'Vendas',
          startsOn: '2026-12-01',
          endsOn: '2026-12-25',
          status: 'planned',
        } as never)) as unknown as SocialCampaignInstanceEntity;
      await item(id, scopeA, {
        title: 'Da campanha',
        campaignInstanceId: campaign.id,
      });
      await item(id, scopeA, { title: 'Fora da campanha' });

      const sent = await service.sendCampaignTable(ctx(), campaign.id);

      const snapshot = await db
        .getRepository(SocialApprovalSnapshotEntity)
        .findOneByOrFail({
          id: (await request(sent.approvalId)).subjectRevisionId,
        });
      const payload = snapshot.payload as ApprovalTableSnapshotPayload;
      expect(payload.rows.map((row) => row.title)).toEqual(['Da campanha']);
      expect(payload.summary).toEqual(
        expect.arrayContaining([
          { label: 'Campanha', value: 'Natal' },
          { label: 'Período', value: '01/12/2026 a 25/12/2026' },
        ]),
      );
    });

    it('an approved table reopens when an item changes and recovers when it is undone (D-20)', async () => {
      const { id } = await plan();
      const row = await item(id, scopeA, { title: 'Original' });
      const sent = await service.sendPlanTable(ctx(), id);
      await internalApprove(sent.approvalId);
      await clientApprove(sent.approvalId);
      const piece = await pieceOf('plan_table', id);
      expect(piece.boardColumn).toBe('approved');

      await db
        .getRepository(SocialContentItemEntity)
        .update(row.id, { title: 'Alterado' });
      await sync.syncContexts(scopeA, contexts);

      expect((await stepsOf(piece.id))[0].isStale).toBe(true);
      expect((await pieceOf('plan_table', id)).boardColumn).toBe('preparation');
      expect(await eventTypes(piece.id)).toContain('reopened_stale');

      await db
        .getRepository(SocialContentItemEntity)
        .update(row.id, { title: 'Original' });
      await sync.syncContexts(scopeA, contexts);
      expect((await pieceOf('plan_table', id)).boardColumn).toBe('approved');
    });

    it('publishing an item does not make its approved table stale', async () => {
      const { id } = await plan();
      const row = await item(id, scopeA, { title: 'Publica' });
      await item(id, scopeA, { title: 'Continua' });
      const sent = await service.sendPlanTable(ctx(), id);
      await internalApprove(sent.approvalId);
      await clientApprove(sent.approvalId);

      await db
        .getRepository(SocialContentItemEntity)
        .update(row.id, { planningStatus: 'posted' });
      await sync.syncContexts(scopeA, contexts);

      expect((await pieceOf('plan_table', id)).boardColumn).toBe('approved');
    });
  });

  describe('send order (D-21)', () => {
    it('sequential: the creative waits for the approved copy and is never sent by itself', async () => {
      const { itemId } = await withCopy();
      await uploadDirect(itemId);

      const sent = await service.sendContent(ctx(), itemId, 'sequential');
      expect(sent.copy?.status).toBe('awaiting_internal_review');
      expect(sent.creative).toBeNull();
      const state = await service.contentState(ctx(), itemId);
      expect(state.modes.creative).toEqual({
        allowed: false,
        blocker: 'copy_not_approved',
      });
      await expect(
        service.sendContent(ctx(), itemId, 'creative'),
      ).rejects.toEqual(code('approval_copy_not_approved'));

      await internalApprove(sent.copy!.approvalId!);
      await clientApprove(sent.copy!.approvalId!);
      expect(await planningStatus(itemId)).toBe('copy_ready');
      const piece = await pieceOf('content_item', itemId);
      const steps = await stepsOf(piece.id);
      const creativeStep = steps.find((step) => step.kind === 'creative')!;
      expect(creativeStep.currentRequestId).toBeNull();
      expect(piece.boardColumn).toBe('preparation');
      expect(piece.activeStepId).toBe(creativeStep.id);

      const creative = await service.sendContent(ctx(), itemId, 'creative');
      expect(creative.creative?.status).toBe('awaiting_internal_review');
      expect(await planningStatus(itemId)).toBe('creative_ready');
      const row = await request(creative.creative!.approvalId!);
      expect(row.subjectType).toBe('approval_snapshot');
      expect(row.displayType).toBe('media_set');
    });

    it('approving a copy that is no longer the current text moves nothing (D-22)', async () => {
      const { itemId, approvalId } = await copyAwaitingClient();
      await planner.createRevision(scopeA, itemId, ownerUser, {
        copy: 'texto mais novo',
      });
      await clientApprove(approvalId);
      expect(await planningStatus(itemId)).toBe('planned');
    });

    it('together: refuses what is not ready before writing anything', async () => {
      const { itemId } = await withCopy();
      await expect(
        service.sendContent(ctx(), itemId, 'together'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'approval_together_not_ready',
          missing: ['creative'],
        }),
      });
      expect(
        await db.getRepository(SocialApprovalRequestEntity).count({
          where: { subjectId: itemId },
        }),
      ).toBe(0);
    });

    it('together: both steps move and the Planner walks through copy_ready (D-22)', async () => {
      const { itemId } = await withCopy();
      await uploadDirect(itemId);

      const sent = await service.sendContent(ctx(), itemId, 'together');

      expect(sent.copy?.status).toBe('awaiting_internal_review');
      expect(sent.creative?.status).toBe('awaiting_internal_review');
      const piece = await pieceOf('content_item', itemId);
      expect(piece.sendOrder).toBe('together');
      expect(piece.boardColumn).toBe('internal_review');
      const row = await db
        .getRepository(SocialContentItemEntity)
        .findOneByOrFail({ id: itemId });
      expect(row.planningStatus).toBe('creative_ready');
    });

    it('a Studio selection is submitted, not left as a draft, and keeps the batch', async () => {
      const { itemId } = await withCopy();
      const assetId = randomUUID();
      const versionId = randomUUID();
      await db.getRepository(CreativeAssetEntity).save({
        ...scopeA,
        id: assetId,
        name: 'Arte',
        assetType: 'image',
        status: 'ready',
        contentItemId: itemId,
        currentVersionId: null,
      } as never);
      await db.getRepository(CreativeAssetVersionEntity).save({
        id: versionId,
        creativeAssetId: assetId,
        versionNumber: 1,
        mediaAssetId: randomUUID(),
        source: 'upload',
      } as never);
      selections.set(itemId, {
        asset: { id: assetId },
        version: { id: versionId },
        unavailableReason: null,
      });
      studioSend.mockImplementation(async () => {
        const draft = await approvals.create(scopeA, ownerUser, {
          subjectType: 'creative_version',
          subjectId: assetId,
          subjectRevisionId: versionId,
        });
        return { changed: true, approvalId: draft.id };
      });

      const { batchId, sent, results } = await service.sendContentBatch(
        ctx(),
        [itemId],
        'together',
      );

      expect(results[0]).toMatchObject({ ok: true });
      expect(sent).toBe(1);
      const requests = await db
        .getRepository(SocialApprovalRequestEntity)
        .find({ where: { batchId } });
      expect(requests.map((row) => row.status).sort()).toEqual([
        'awaiting_internal_review',
        'awaiting_internal_review',
      ]);
      expect(requests.map((row) => row.subjectType).sort()).toEqual([
        'creative_version',
        'planner_content_revision',
      ]);
    });

    it('a batch shares one id and reports the item that could not go', async () => {
      const first = await withCopy();
      const second = await withCopy();
      const noText = await item((await plan()).id);

      const outcome = await service.sendContentBatch(
        ctx(),
        [first.itemId, second.itemId, noText.id],
        'copy',
      );

      expect(outcome.sent).toBe(2);
      expect(outcome.failed).toBe(1);
      expect(outcome.results[2]).toMatchObject({
        ok: false,
        code: 'approval_copy_not_ready',
      });
      expect(
        await db
          .getRepository(SocialApprovalRequestEntity)
          .count({ where: { batchId: outcome.batchId } }),
      ).toBe(2);
    });

    it('a repeated copy send does nothing', async () => {
      const { itemId } = await withCopy();
      const first = await service.sendContent(ctx(), itemId, 'copy');
      const again = await service.sendContent(ctx(), itemId, 'copy');
      expect(again.changed).toBe(false);
      expect(again.copy?.approvalId).toBe(first.copy?.approvalId);
    });
  });

  describe('stale approvals (D-20)', () => {
    it('a new revision reopens an approved copy, with the event', async () => {
      const { itemId, approvalId } = await copyAwaitingClient();
      await clientApprove(approvalId);
      const piece = await pieceOf('content_item', itemId);
      const copyStep = (await stepsOf(piece.id)).find(
        (step) => step.kind === 'copy',
      )!;
      expect(copyStep.isStale).toBe(false);

      await planner.createRevision(scopeA, itemId, ownerUser, {
        copy: 'texto alterado depois',
      });

      expect(
        (await stepsOf(piece.id)).find((step) => step.kind === 'copy')!.isStale,
      ).toBe(true);
      expect(await eventTypes(piece.id)).toContain('reopened_stale');
      expect((await request(approvalId)).status).toBe('approved');
      const state = await service.contentState(ctx(), itemId);
      expect(state.copy).toMatchObject({ isStale: true, blocker: null });
    });

    it('selecting another version reopens an approved creative', async () => {
      const { itemId } = await withCopy();
      const assetId = randomUUID();
      const approvedVersion = randomUUID();
      const otherVersion = randomUUID();
      await db.getRepository(CreativeAssetEntity).save({
        ...scopeA,
        id: assetId,
        name: 'Arte',
        assetType: 'image',
        status: 'ready',
        contentItemId: itemId,
        currentVersionId: null,
      } as never);
      await db.getRepository(CreativeAssetVersionEntity).save(
        [approvedVersion, otherVersion].map((id, index) => ({
          id,
          creativeAssetId: assetId,
          versionNumber: index + 1,
          mediaAssetId: randomUUID(),
          source: 'upload',
        })) as never,
      );
      const production = (await db
        .getRepository(CreativeProductionEntity)
        .save({
          ...scopeA,
          contentItemId: itemId,
          selectedCreativeAssetId: assetId,
          selectedVersionId: approvedVersion,
        } as never)) as unknown as CreativeProductionEntity;
      const created = await approvals.create(scopeA, ownerUser, {
        subjectType: 'creative_version',
        subjectId: assetId,
        subjectRevisionId: approvedVersion,
      });
      await approvals.submit(scopeA, created.id, ownerUser);
      await internalApprove(created.id);
      await clientApprove(created.id);

      await db
        .getRepository(CreativeProductionEntity)
        .update(production.id, { selectedVersionId: otherVersion });
      await pieces.recomputeContentItem(undefined, itemId);

      const piece = await pieceOf('content_item', itemId);
      expect(
        (await stepsOf(piece.id)).find((step) => step.kind === 'creative')!
          .isStale,
      ).toBe(true);
    });

    it('replacing a direct upload reopens its approved media set', async () => {
      const { itemId } = await withCopy();
      await uploadDirect(itemId);
      const copy = await service.sendContent(ctx(), itemId, 'copy');
      await internalApprove(copy.copy!.approvalId!);
      await clientApprove(copy.copy!.approvalId!);
      const creative = await service.sendContent(ctx(), itemId, 'creative');
      await internalApprove(creative.creative!.approvalId!);
      await clientApprove(creative.creative!.approvalId!);

      await uploadDirect(itemId, 'story');
      await sync.syncContexts(scopeA, contexts);

      const piece = await pieceOf('content_item', itemId);
      expect(
        (await stepsOf(piece.id)).find((step) => step.kind === 'creative')!
          .isStale,
      ).toBe(true);
      expect(piece.boardColumn).toBe('preparation');
    });
  });

  describe('client text edit (D-02, D-03)', () => {
    const allowEdit = (extra: Record<string, unknown> = {}) =>
      settings.update(scopeA, ownerUser, {
        clientCanEditText: true,
        ...extra,
      } as never);

    it('is refused while the setting is off, and writes nothing', async () => {
      const { approvalId, itemId } = await copyAwaitingClient();
      await expect(
        textEdit.edit(scopeA, approvalId, { copy: 'x' }, editor(clientOwner)),
      ).rejects.toEqual(code('approval_text_edit_disabled'));
      expect((await request(approvalId)).status).toBe('awaiting_client');
      expect(
        await db
          .getRepository(SocialContentRevisionEntity)
          .count({ where: { contentItemId: itemId } }),
      ).toBe(1);
    });

    it('save: a client_edit revision becomes the current text, and the old request is superseded', async () => {
      await allowEdit();
      const { approvalId, itemId } = await copyAwaitingClient();

      const finalId = await textEdit.edit(
        scopeA,
        approvalId,
        { copy: 'texto do cliente' },
        editor(clientOwner),
      );

      expect(finalId).not.toBe(approvalId);
      const [previous, current, row] = await Promise.all([
        request(approvalId),
        request(finalId),
        db
          .getRepository(SocialContentItemEntity)
          .findOneByOrFail({ id: itemId }),
      ]);
      expect(previous.status).toBe('superseded');
      expect(current.status).toBe('awaiting_client');
      expect(current.sentToClientAt).not.toBeNull();
      expect(current.requestedByUserId).toBe(ownerUser);
      expect(row.copy).toBe('texto do cliente');
      expect(row.currentRevisionId).toBe(current.subjectRevisionId);
      const revision = await db
        .getRepository(SocialContentRevisionEntity)
        .findOneByOrFail({ id: current.subjectRevisionId });
      expect(revision.source).toBe('client_edit');
      expect(revision.createdById).toBe(clientOwner);
      expect(
        await eventTypes((await pieceOf('content_item', itemId)).id),
      ).toContain('edited');
    });

    it('nothing changed: no new revision, and "Salvar e aprovar" just approves', async () => {
      await allowEdit();
      const { approvalId } = await copyAwaitingClient();
      const finalId = await textEdit.edit(
        scopeA,
        approvalId,
        { copy: 'texto original', approve: true },
        editor(clientOwner),
      );
      expect(finalId).toBe(approvalId);
      expect((await request(approvalId)).status).toBe('approved');
    });

    it('"Todos": an edit restarts the round and the same-transaction approval counts', async () => {
      await allowEdit({
        clientDecisionPolicy: 'all',
        clientApproverMembershipIds: [membershipIds.one, membershipIds.two],
      });
      const { approvalId } = await copyAwaitingClient();
      await clientApprove(approvalId, memberOne);

      const edited = await textEdit.edit(
        scopeA,
        approvalId,
        { copy: 'nova versão', approve: true },
        editor(memberTwo),
      );

      const round = await request(edited);
      expect(round.status).toBe('awaiting_client');
      expect(round.requiredClientApproverIds?.sort()).toEqual(
        [membershipIds.one, membershipIds.two].sort(),
      );
      await expect(clientApprove(edited, memberTwo)).rejects.toEqual(
        code('approval_already_decided'),
      );
      const done = await clientApprove(edited, memberOne);
      expect(done.status).toBe('approved');
    });

    it('"Salvar e aprovar" by someone not designated leaves nothing behind', async () => {
      await allowEdit({
        clientApproverMembershipIds: [membershipIds.one],
      });
      const { approvalId, itemId } = await copyAwaitingClient();

      await expect(
        textEdit.edit(
          scopeA,
          approvalId,
          { copy: 'tentativa', approve: true },
          editor(memberTwo),
        ),
      ).rejects.toEqual(code('approval_not_designated'));

      expect((await request(approvalId)).status).toBe('awaiting_client');
      const row = await db
        .getRepository(SocialContentItemEntity)
        .findOneByOrFail({ id: itemId });
      expect(row.copy).toBe('texto original');
    });

    it('refuses to overwrite a newer text from the agency', async () => {
      await allowEdit();
      const { approvalId, itemId } = await copyAwaitingClient();
      await planner.createRevision(scopeA, itemId, ownerUser, {
        copy: 'agência mudou',
      });
      await expect(
        textEdit.edit(scopeA, approvalId, { copy: 'x' }, editor(clientOwner)),
      ).rejects.toEqual(code('approval_text_outdated'));
    });

    it('an avulsa text piece gets a new snapshot', async () => {
      await allowEdit();
      await settings.update(scopeA, ownerUser, {
        internalApprovalEnabled: false,
      } as never);
      const { id } = await actions.createStandalone(scopeA, ownerUser, {
        title: 'Legenda avulsa',
        stepKind: 'text',
        text: 'primeira',
      } as never);
      const [step] = await stepsOf(id);

      const finalId = await textEdit.edit(
        scopeA,
        step.currentRequestId!,
        { copy: 'segunda' },
        editor(clientOwner),
      );

      const current = await request(finalId);
      expect(current.subjectVersionLabel).toBe('r2');
      expect(current.status).toBe('awaiting_client');
    });

    it('text versions never show the client what was not sent to them', async () => {
      await allowEdit();
      const { approvalId, itemId } = await copyAwaitingClient();
      const finalId = await textEdit.edit(
        scopeA,
        approvalId,
        { copy: 'do cliente' },
        editor(clientOwner),
      );
      await planner.createRevision(scopeA, itemId, ownerUser, {
        copy: 'rascunho interno da agência',
      });
      const internalSend = await service.sendContent(ctx(), itemId, 'copy');
      expect(internalSend.copy?.status).toBe('awaiting_internal_review');

      const forClient = await pieces.textVersions(
        scopeA,
        await request(finalId),
        'client',
      );
      expect(forClient.versions.map((version) => version.fields.copy)).toEqual([
        'texto original',
        'do cliente',
      ]);
      expect(forClient.versions[1]).toMatchObject({
        origin: 'client',
        isCurrent: true,
      });

      const forAgency = await pieces.textVersions(
        scopeA,
        await request(finalId),
        'agency',
      );
      expect(forAgency.versions).toHaveLength(3);
      expect(JSON.stringify(forClient)).not.toContain(
        'rascunho interno da agência',
      );
    });

    it('self: the edit stays in the internal stage and the internal decision closes it', async () => {
      await settings.update(own, ownerUser, {
        clientCanEditText: true,
      } as never);
      const { itemId } = await withCopy(own);
      const sent = await service.sendContent(ctx(own), itemId, 'copy');

      const finalId = await textEdit.edit(
        own,
        sent.copy!.approvalId!,
        { copy: 'revisado pelo dono', approve: true },
        { userId: ownerUser, surface: 'self', role: 'owner' },
      );

      const current = await request(finalId);
      expect(current.status).toBe('approved');
      expect(current.resolution).toBe('internal_final');
      expect(current.sentToClientAt).toBeNull();
    });
  });
});
