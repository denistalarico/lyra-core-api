import { ConflictException, ForbiddenException } from '@nestjs/common';
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
import { BackfillSocialApprovalPieces1802900100000 } from '../../database/migrations/1802900100000-backfill-social-approval-pieces';
import { AddSocialApprovalPieceDescription1803400000000 } from '../../database/migrations/1803400000000-add-social-approval-piece-description';
import { AddSocialApprovalCardCustomization1803300000000 } from '../../database/migrations/1803300000000-add-social-approval-card-customization';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import { ClientAreaMemberModuleAccessEntity } from '../client-area/entities/client-area-member-module-access.entity';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../permissions/catalog/role-permission-matrix.catalog';
import { PlatformRoleKey } from '../permissions/enums/permission.enums';
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
import {
  APPROVAL_NO_CLIENT_APPROVER,
  SocialApprovalAuthorityService,
} from './social-approval-authority.service';
import { ClientApprovalBoardService } from './client/client-approval-board.service';
import { ClientApprovalsService } from './client/client-approvals.service';
import { SelfApprovalsService } from './client/self-approvals.service';
import {
  SocialApprovalCommentEntity,
  SocialApprovalEventEntity,
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalSettingsEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStageDecisionEntity,
  SocialApprovalStepEntity,
} from './entities';
import { SocialApprovalBoardService } from './social-approval-board.service';
import { SocialApprovalInboxService } from './social-approval-inbox.service';
import { SocialApprovalPieceActionsService } from './social-approval-piece-actions.service';
import { SocialApprovalPieceSyncService } from './social-approval-piece-sync.service';
import { SocialApprovalPiecesService } from './social-approval-pieces.service';
import { SocialApprovalSettingsService } from './social-approval-settings.service';
import { SocialApprovalsService } from './social-approvals.service';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';

const run = describePostgresIntegration();

const OVERRIDE_KEY = 'social.approvals.review.agency_override.owner';

/**
 * AR1 — the acceptance matrix of the plan (§8), on real PostgreSQL and the
 * real migration chain, in a throwaway schema of the guarded `_test` database.
 */
run('AR1 approval pieces (real PostgreSQL)', () => {
  const schema = `ar1_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const clientNoOwner = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const companyNoOwner = randomUUID();
  const scopeOf = (
    agencyClientId: string | null,
    companyContextId: string | null,
  ): CompanyAwareScope => ({
    tenantId,
    workspaceId,
    agencyClientId,
    companyContextId,
  });
  const own = scopeOf(null, null);
  const scopeA = scopeOf(clientA, companyA);
  const scopeB = scopeOf(clientB, companyB);
  const scopeNoOwner = scopeOf(clientNoOwner, companyNoOwner);
  const ownerUser = randomUUID();
  const operator = randomUUID();
  const clientOwner = randomUUID();
  const clientMemberOne = randomUUID();
  const clientMemberTwo = randomUUID();
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
  let sync: SocialApprovalPieceSyncService;
  let board: SocialApprovalBoardService;
  let actions: SocialApprovalPieceActionsService;
  let clientBoard: ClientApprovalBoardService;
  let selfApprovals: SelfApprovalsService;
  const directory = {
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
      `INSERT INTO agency_client_company_contexts VALUES ($1,$4,$5,$6), ($2,$4,$5,$7), ($3,$4,$5,$8)`,
      [
        companyA,
        companyB,
        companyNoOwner,
        tenantId,
        workspaceId,
        clientA,
        clientB,
        clientNoOwner,
      ],
    );
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialApprovals1795100000000().up(runner);
    await new AddSocialApprovalViewedAudit1795800000000().up(runner);
    await new AddSocialApprovalCommentVisibility1797400000000().up(runner);
    await new AllowOwnScopeSocialApprovals1798800000000().up(runner);
    await new CreateSocialApprovalPieces1802900000000().up(runner);
    await new AddSocialApprovalCardCustomization1803300000000().up(runner);
    await new AddSocialApprovalPieceDescription1803400000000().up(runner);
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
    const pieces = new SocialApprovalPiecesService(db);
    approvals = new SocialApprovalsService(
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalCommentEntity),
      db.getRepository(SocialApprovalStageDecisionEntity),
      db,
      resolver,
      pieces,
      authority,
      settings,
    );
    sync = new SocialApprovalPieceSyncService(db, pieces);
    const inbox = new SocialApprovalInboxService(
      db.getRepository(SocialApprovalRequestEntity),
      directory as never,
    );
    board = new SocialApprovalBoardService(
      db.getRepository(SocialApprovalPieceEntity),
      db.getRepository(SocialApprovalStepEntity),
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalEventEntity),
      inbox,
      sync,
      approvals,
      pieces,
      settings,
      authority,
      { thumbnailPaths: async () => new Map() } as never,
    );
    actions = new SocialApprovalPieceActionsService(
      db,
      approvals,
      pieces,
      {} as never,
      {} as never,
    );
    const clientApprovals = new ClientApprovalsService(
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalCommentEntity),
      db.getRepository(SocialApprovalStageDecisionEntity),
      db.getRepository(AgencyUserProfileEntity),
      db.getRepository(ClientAreaMembershipEntity),
      resolver,
      authority,
      settings,
      db,
    );
    clientBoard = new ClientApprovalBoardService(
      db.getRepository(SocialApprovalPieceEntity),
      db.getRepository(SocialApprovalStepEntity),
      db.getRepository(SocialApprovalRequestEntity),
      clientApprovals,
      sync,
      { thumbnailPaths: async () => new Map() } as never,
    );
    selfApprovals = new SelfApprovalsService(
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalCommentEntity),
      db.getRepository(SocialApprovalStageDecisionEntity),
      db.getRepository(SocialApprovalEventEntity),
      db.getRepository(AgencyUserProfileEntity),
      resolver,
      approvals,
      authority,
      settings,
      clientBoard,
      {} as never,
      {} as never,
      {} as never,
      pieces,
    );

    const members = db.getRepository(ClientAreaMembershipEntity);
    const addMember = async (
      key: string,
      userId: string,
      role: 'client_owner' | 'client_member',
      scope: CompanyAwareScope,
    ) => {
      const row = await members.save({
        tenantId,
        workspaceId,
        agencyClientId: scope.agencyClientId!,
        companyContextId: scope.companyContextId!,
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
    await addMember('ownerA', clientOwner, 'client_owner', scopeA);
    await addMember('oneA', clientMemberOne, 'client_member', scopeA);
    await addMember('twoA', clientMemberTwo, 'client_member', scopeA);
    await addMember('ownerB', randomUUID(), 'client_owner', scopeB);
    await db.getRepository(AgencyUserProfileEntity).save({
      tenantId,
      userId: ownerUser,
      displayName: 'Dono da Agência',
    } as never);
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM social_approval_settings`);
  });

  const plan = (scope: CompanyAwareScope, title = 'Plano') =>
    db.getRepository(SocialPlanEntity).save({
      ...scope,
      title,
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      status: 'draft',
      deletedAt: null,
    } as never);

  /** Real item + revision, so `create()` resolves a real step. */
  async function contentRevision(scope: CompanyAwareScope, planId?: string) {
    const id =
      planId ?? ((await plan(scope)) as unknown as SocialPlanEntity).id;
    const item = (await db.getRepository(SocialContentItemEntity).save({
      tenantId,
      workspaceId,
      agencyClientId: scope.agencyClientId,
      planId: id,
      title: `Item ${randomUUID().slice(0, 6)}`,
      hashtags: [],
      planningStatus: 'planned',
      sortOrder: 0,
    } as never)) as unknown as SocialContentItemEntity;
    const revision = (await db.getRepository(SocialContentRevisionEntity).save({
      tenantId,
      workspaceId,
      agencyClientId: scope.agencyClientId,
      contentItemId: item.id,
      revisionNumber: 1,
      copy: 'texto',
      hashtags: [],
      source: 'human',
    } as never)) as unknown as SocialContentRevisionEntity;
    await db
      .getRepository(SocialContentItemEntity)
      .update(item.id, { currentRevisionId: revision.id });
    return { item, revision, planId: id };
  }

  async function draftRequest(scope: CompanyAwareScope) {
    const { item, revision } = await contentRevision(scope);
    const request = await approvals.create(scope, operator, {
      subjectType: 'planner_content_revision',
      subjectId: item.id,
      subjectRevisionId: revision.id,
    });
    return { request, item, revision };
  }

  async function awaitingClient(scope: CompanyAwareScope) {
    const created = await draftRequest(scope);
    await approvals.submit(scope, created.request.id, operator);
    await approvals.approveInternal(
      scope,
      created.request.id,
      ownerUser,
      'owner',
    );
    return created;
  }

  const pieceOf = async (itemId: string) =>
    db.getRepository(SocialApprovalPieceEntity).findOneByOrFail({
      kind: 'content_item',
      sourceId: itemId,
    });
  const eventsOf = async (requestId: string) =>
    (
      await db
        .getRepository(SocialApprovalEventEntity)
        .find({ where: { requestId }, order: { createdAt: 'ASC' } })
    ).map((event) => event.type);
  const clientUser = (userId: string) => ({ type: 'user' as const, userId });
  const expectCode = (code: string) =>
    expect.objectContaining({
      response: expect.objectContaining({ code }),
    });
  const agencyCtx = (role = 'owner'): RequestContext => ({
    tenantId,
    workspaceId,
    userId: ownerUser,
    role,
  });

  describe('stages and internal approval (D-14)', () => {
    it('internal on: submit goes to review, approval reaches the client', async () => {
      const { request, item } = await draftRequest(scopeA);
      const submitted = await approvals.submit(scopeA, request.id, operator);
      expect(submitted.status).toBe('awaiting_internal_review');
      expect((await pieceOf(item.id)).boardColumn).toBe('internal_review');
      const sent = await approvals.approveInternal(
        scopeA,
        request.id,
        ownerUser,
        'owner',
      );
      expect(sent.status).toBe('awaiting_client');
      expect((await pieceOf(item.id)).boardColumn).toBe('awaiting_client');
      expect(await eventsOf(request.id)).toEqual(['sent', 'approved', 'sent']);
    });

    it('internal off: submit goes straight to the client and records the skip', async () => {
      await settings.update(scopeA, ownerUser, {
        internalApprovalEnabled: false,
      });
      const { request } = await draftRequest(scopeA);
      const saved = await approvals.submit(scopeA, request.id, operator);
      expect(saved.status).toBe('awaiting_client');
      expect(saved.sentToClientAt).not.toBeNull();
      expect(await eventsOf(request.id)).toEqual(['internal_skipped', 'sent']);
    });

    it('own scope is forced through internal, which is final', async () => {
      await expect(
        settings.update(own, ownerUser, { internalApprovalEnabled: false }),
      ).rejects.toThrow('obrigatória');
      const { request, item } = await draftRequest(own);
      await approvals.submit(own, request.id, operator);
      const saved = await approvals.approveInternal(
        own,
        request.id,
        ownerUser,
        'owner',
      );
      expect(saved).toMatchObject({
        status: 'approved',
        resolution: 'internal_final',
        sentToClientAt: null,
      });
      expect((await pieceOf(item.id)).boardColumn).toBe('preparation');
    });
  });

  describe('agency override (D-15)', () => {
    it.each([
      ['draft'],
      ['awaiting_internal_review'],
      ['awaiting_client'],
      ['changes_requested'],
    ])('finishes from %s', async (status) => {
      const { request } = await draftRequest(scopeA);
      if (status !== 'draft') {
        await approvals.submit(scopeA, request.id, operator);
        if (status !== 'awaiting_internal_review')
          await approvals.approveInternal(
            scopeA,
            request.id,
            ownerUser,
            'owner',
          );
        if (status === 'changes_requested')
          await approvals.clientRequestChanges(
            scopeA,
            request.id,
            clientUser(clientOwner),
            'ajustar',
          );
      }
      const saved = await approvals.agencyOverride(
        scopeA,
        request.id,
        ownerUser,
      );
      expect(saved).toMatchObject({
        status: 'approved',
        resolution: 'agency_override',
      });
      const decision = await db
        .getRepository(SocialApprovalStageDecisionEntity)
        .findOneByOrFail({
          approvalRequestId: request.id,
          decision: 'agency_override',
        });
      expect(decision.actorUserId).toBe(ownerUser);
    });

    it('records the override on every pending step and only Owner may do it', async () => {
      const { request, item } = await awaitingClient(scopeA);
      const piece = await pieceOf(item.id);
      const assertOwner = (role: PlatformRoleKey) => async () => {
        if (!DEFAULT_ROLE_PERMISSION_MATRIX[role].includes(OVERRIDE_KEY))
          throw new ForbiddenException('forbidden');
      };
      for (const role of [PlatformRoleKey.Admin, PlatformRoleKey.Manager])
        await expect(
          actions.finish(
            scopeA,
            piece.id,
            operator,
            undefined,
            assertOwner(role),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);

      await actions.finish(
        scopeA,
        piece.id,
        ownerUser,
        'publicado direto',
        assertOwner(PlatformRoleKey.Owner),
      );
      const finished = await pieceOf(item.id);
      expect(finished).toMatchObject({
        boardColumn: 'finished',
        finishReason: 'publicado direto',
      });
      expect(finished.finishedAt).not.toBeNull();
      const events = await db
        .getRepository(SocialApprovalEventEntity)
        .find({ where: { pieceId: piece.id } });
      const overrides = events.filter((e) => e.type === 'agency_override');
      expect(overrides).toHaveLength(2);
      expect(events.some((e) => e.type === 'finished')).toBe(true);
      expect(events.find((e) => e.type === 'finished')?.actorName).toBe(
        'Dono da Agência',
      );
      expect(
        (
          await db.getRepository(SocialApprovalRequestEntity).findOneByOrFail({
            id: request.id,
          })
        ).resolution,
      ).toBe('agency_override');
      await expect(
        actions.finish(
          scopeA,
          piece.id,
          ownerUser,
          undefined,
          async () => undefined,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('needs only the base key once every step is approved', async () => {
      const copy = await draftRequest(scopeB);
      const creative = await draftRequest(scopeB);
      const approved = {
        status: 'approved' as const,
        approvedAt: new Date(),
        resolution: 'client_approved' as const,
      };
      const requests = db.getRepository(SocialApprovalRequestEntity);
      await requests.update(copy.request.id, approved);
      await requests.update(creative.request.id, approved);
      const piece = await pieceOf(copy.item.id);
      await db
        .getRepository(SocialApprovalStepEntity)
        .update(
          { pieceId: piece.id, kind: 'creative' },
          { currentRequestId: creative.request.id },
        );
      const assertOwner = jest.fn(async () => undefined);
      await actions.finish(scopeB, piece.id, operator, undefined, assertOwner);
      expect(assertOwner).not.toHaveBeenCalled();
      expect((await pieceOf(copy.item.id)).boardColumn).toBe('finished');
    });
  });

  describe('decision policy (D-03) and responsibles (D-17)', () => {
    it('empty list: only the Owner decides, on both sides', async () => {
      const { request } = await draftRequest(scopeA);
      await approvals.submit(scopeA, request.id, operator);
      await expect(
        approvals.approveInternal(scopeA, request.id, operator, 'admin'),
      ).rejects.toEqual(expectCode('approval_not_designated'));
      await approvals.approveInternal(scopeA, request.id, ownerUser, 'owner');
      await expect(
        approvals.clientApprove(
          scopeA,
          request.id,
          clientUser(clientMemberOne),
        ),
      ).rejects.toEqual(expectCode('approval_not_designated'));
      const saved = await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientOwner),
      );
      expect(saved).toMatchObject({
        status: 'approved',
        resolution: 'client_approved',
      });
    });

    it('filled list: only the listed decide, Owner included', async () => {
      await settings.update(scopeA, ownerUser, {
        clientApproverMembershipIds: [membershipIds.oneA],
      });
      const { request } = await awaitingClient(scopeA);
      await expect(
        approvals.clientApprove(scopeA, request.id, clientUser(clientOwner)),
      ).rejects.toEqual(expectCode('approval_not_designated'));
      const saved = await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientMemberOne),
      );
      expect(saved.status).toBe('approved');
    });

    it('company without Owner and without a list refuses the send', async () => {
      const { request } = await draftRequest(scopeNoOwner);
      await approvals.submit(scopeNoOwner, request.id, operator);
      await expect(
        approvals.approveInternal(scopeNoOwner, request.id, ownerUser, 'owner'),
      ).rejects.toEqual(expectCode(APPROVAL_NO_CLIENT_APPROVER));
      expect(
        (
          await db
            .getRepository(SocialApprovalRequestEntity)
            .findOneByOrFail({ id: request.id })
        ).status,
      ).toBe('awaiting_internal_review');
    });

    it('"first" closes on the first decision and a second is refused', async () => {
      const { request } = await awaitingClient(scopeA);
      await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientOwner),
      );
      await expect(
        approvals.clientApprove(scopeA, request.id, clientUser(clientOwner)),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    async function allRound() {
      await settings.update(scopeA, ownerUser, {
        clientDecisionPolicy: 'all',
        clientApproverMembershipIds: [membershipIds.oneA, membershipIds.twoA],
      });
      return awaitingClient(scopeA);
    }
    const stored = (id: string) =>
      db.getRepository(SocialApprovalRequestEntity).findOneByOrFail({ id });
    const setMember = (id: string, status: 'active' | 'revoked') =>
      db.getRepository(ClientAreaMembershipEntity).update(id, { status });

    it('"all" waits for everyone and blocks a repeat decision', async () => {
      const { request } = await allRound();
      expect(
        [...(await stored(request.id)).requiredClientApproverIds!].sort(),
      ).toEqual([membershipIds.oneA, membershipIds.twoA].sort());
      const first = await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientMemberOne),
      );
      expect(first.status).toBe('awaiting_client');
      await expect(
        approvals.clientApprove(
          scopeA,
          request.id,
          clientUser(clientMemberOne),
        ),
      ).rejects.toEqual(expectCode('approval_already_decided'));
      const done = await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientMemberTwo),
      );
      expect(done).toMatchObject({
        status: 'approved',
        resolution: 'client_approved',
      });
    });

    it('"all": one request for changes closes the round at once', async () => {
      const { request } = await allRound();
      await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientMemberOne),
      );
      const saved = await approvals.clientRequestChanges(
        scopeA,
        request.id,
        clientUser(clientMemberTwo),
        'ajustar',
      );
      expect(saved.status).toBe('changes_requested');
      expect(saved.requiredClientApproverIds).toBeNull();
    });

    it('"all": a member revoked mid-round leaves the count', async () => {
      const { request } = await allRound();
      await setMember(membershipIds.twoA, 'revoked');
      const done = await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientMemberOne),
      );
      expect(done.status).toBe('approved');
      await setMember(membershipIds.twoA, 'active');
    });

    it('"all": reconciliation closes a round only the revoked member held open', async () => {
      const { request } = await allRound();
      await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientMemberOne),
      );
      await setMember(membershipIds.twoA, 'revoked');
      expect(
        await approvals.reconcileOpenRounds(scopeA),
      ).toBeGreaterThanOrEqual(1);
      expect((await stored(request.id)).status).toBe('approved');
      await setMember(membershipIds.twoA, 'active');
    });

    it('"all": a list with nobody left never approves by itself', async () => {
      const { request } = await allRound();
      await setMember(membershipIds.oneA, 'revoked');
      await setMember(membershipIds.twoA, 'revoked');
      await approvals.reconcileOpenRounds(scopeA);
      expect((await stored(request.id)).status).toBe('awaiting_client');
      await setMember(membershipIds.oneA, 'active');
      await setMember(membershipIds.twoA, 'active');
    });

    it('simultaneous decisions: exactly one wins (F-06)', async () => {
      const { request } = await awaitingClient(scopeA);
      const results = await Promise.allSettled([
        approvals.clientApprove(scopeA, request.id, clientUser(clientOwner)),
        approvals.clientRequestChanges(
          scopeA,
          request.id,
          clientUser(clientOwner),
          'ajustar',
        ),
        approvals.clientApprove(scopeA, request.id, clientUser(clientOwner)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      for (const failure of rejected)
        expect(failure.reason).toBeInstanceOf(ConflictException);
      expect(
        await db
          .getRepository(SocialApprovalStageDecisionEntity)
          .countBy({ approvalRequestId: request.id, stage: 'client' }),
      ).toBe(1);
    });
  });

  describe('board projection (D-13)', () => {
    it('sequential: approving the copy returns to preparation on Criativo', async () => {
      const { request, item } = await awaitingClient(scopeA);
      await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientOwner),
      );
      const piece = await pieceOf(item.id);
      const steps = await db
        .getRepository(SocialApprovalStepEntity)
        .find({ where: { pieceId: piece.id } });
      expect(piece.boardColumn).toBe('preparation');
      expect(piece.activeStepId).toBe(
        steps.find((step) => step.kind === 'creative')?.id,
      );
    });

    it('a changed revision makes the approval stale, and it stops counting', async () => {
      const { request, item } = await awaitingClient(scopeA);
      await approvals.clientApprove(
        scopeA,
        request.id,
        clientUser(clientOwner),
      );
      const newer = (await db.getRepository(SocialContentRevisionEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: clientA,
        contentItemId: item.id,
        revisionNumber: 2,
        copy: 'outro texto',
        hashtags: [],
        source: 'human',
      } as never)) as unknown as SocialContentRevisionEntity;
      await db
        .getRepository(SocialContentItemEntity)
        .update(item.id, { currentRevisionId: newer.id });
      await board.reconcile(scopeA);
      const piece = await pieceOf(item.id);
      const copy = await db
        .getRepository(SocialApprovalStepEntity)
        .findOneByOrFail({ pieceId: piece.id, kind: 'copy' });
      expect(copy.isStale).toBe(true);
      expect(piece.activeStepId).toBe(copy.id);
    });
  });

  describe('sync (D-31)', () => {
    const contexts = (scope: CompanyAwareScope) => [
      {
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      },
    ];
    const count = (kind: string, sourceId: string) =>
      db
        .getRepository(SocialApprovalPieceEntity)
        .countBy({ kind: kind as never, sourceId });

    it.each([
      ['own', own],
      ['company', scopeA],
    ])('repeating does not duplicate, %s scope', async (_label, scope) => {
      const { item, planId } = await contentRevision(scope);
      await sync.syncContexts(scope, contexts(scope));
      await sync.syncContexts(scope, contexts(scope));
      expect(await count('content_item', item.id)).toBe(1);
      expect(await count('plan_table', planId)).toBe(1);
      const piece = await pieceOf(item.id);
      expect(
        await db
          .getRepository(SocialApprovalStepEntity)
          .countBy({ pieceId: piece.id }),
      ).toBe(2);
    });

    it('archive hides, restore returns, and calendar_only never appears', async () => {
      const { item } = await contentRevision(scopeA);
      await sync.syncContexts(scopeA, contexts(scopeA));
      await db
        .getRepository(SocialContentItemEntity)
        .update(item.id, { archivedAt: new Date() });
      await sync.syncContexts(scopeA, contexts(scopeA));
      expect((await pieceOf(item.id)).sourceState).toBe('hidden');
      await db
        .getRepository(SocialContentItemEntity)
        .update(item.id, { archivedAt: null });
      await sync.syncContexts(scopeA, contexts(scopeA));
      expect((await pieceOf(item.id)).sourceState).toBe('active');

      const calendar = await contentRevision(scopeA);
      await db
        .getRepository(SocialContentItemEntity)
        .update(calendar.item.id, { calendarOnly: true });
      await sync.syncContexts(scopeA, contexts(scopeA));
      expect(await count('content_item', calendar.item.id)).toBe(0);
    });

    it('a posted item lands on Finalizado', async () => {
      const { item } = await contentRevision(scopeA);
      await sync.syncContexts(scopeA, contexts(scopeA));
      await db
        .getRepository(SocialContentItemEntity)
        .update(item.id, { planningStatus: 'posted' });
      await sync.syncContexts(scopeA, contexts(scopeA));
      expect(await pieceOf(item.id)).toMatchObject({
        sourceState: 'posted',
        boardColumn: 'finished',
      });
    });

    it('creates the campaign table piece for an active campaign', async () => {
      const campaign = (await db
        .getRepository(SocialCampaignInstanceEntity)
        .save({
          ...scopeA,
          name: 'Natal',
          status: 'active',
        } as never)) as unknown as SocialCampaignInstanceEntity;
      const { item } = await contentRevision(scopeA);
      await db
        .getRepository(SocialContentItemEntity)
        .update(item.id, { campaignInstanceId: campaign.id });
      await sync.syncContexts(scopeA, contexts(scopeA));
      await sync.syncContexts(scopeA, contexts(scopeA));
      expect(await count('campaign_table', campaign.id)).toBe(1);
    });
  });

  describe('isolation and client visibility', () => {
    const reader = {
      userId: clientOwner,
      permissions: { comment: true, decide: true },
    };

    it('the agency board shows only authorized contexts', async () => {
      const { item } = await contentRevision(scopeB);
      const result = (await board.board(agencyCtx(), {
        column: 'preparation',
        limit: 100,
      })) as {
        columns: Record<string, { items: Array<{ id: string }> }>;
      };
      const ids = result.columns.preparation.items.map((card) => card.id);
      const foreign = await db
        .getRepository(SocialApprovalPieceEntity)
        .findOneBy({ kind: 'content_item', sourceId: item.id });
      expect(foreign === null || !ids.includes(foreign.id)).toBe(true);
    });

    it('a piece of another company answers 404 on detail', async () => {
      const { item } = await awaitingClient(scopeA);
      const piece = await pieceOf(item.id);
      await expect(
        board.pieceDetail(scopeB, piece.id, {
          userId: ownerUser,
          role: 'owner',
          permissions: new Set(),
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        clientBoard.piece(scopeB, piece.id, reader),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('a piece never sent does not exist for the client on any route', async () => {
      const { item } = await draftRequest(scopeA);
      await sync.syncContexts(scopeA, [
        { clientId: clientA, companyContextId: companyA },
      ]);
      const piece = await pieceOf(item.id);
      await expect(
        clientBoard.piece(scopeA, piece.id, reader),
      ).rejects.toMatchObject({ status: 404 });
      const result = (await clientBoard.board(scopeA, { limit: 100 })) as {
        columns: Record<string, { items: Array<{ id: string }> }>;
      };
      const all = Object.values(result.columns).flatMap((c) => c.items);
      expect(all.map((card) => card.id)).not.toContain(piece.id);
    });

    it('a sent piece reaches the client in Aguardando você, with no internal key', async () => {
      const { item } = await awaitingClient(scopeA);
      const piece = await pieceOf(item.id);
      const detail = await clientBoard.piece(scopeA, piece.id, reader);
      expect(detail.column).toBe('awaiting_you');
      const serialized = JSON.stringify(detail);
      for (const key of [
        'tenantId',
        'workspaceId',
        'agencyClientId',
        'companyContextId',
        'sourceId',
        'requestedByUserId',
        'subjectId',
        'subjectRevisionId',
        'storagePath',
      ])
        expect(serialized).not.toContain(key);
    });

    describe('withdrawing a piece', () => {
      const boardIds = async () => {
        const result = (await clientBoard.board(scopeA, { limit: 100 })) as {
          columns: Record<string, { items: Array<{ id: string }> }>;
        };
        return Object.values(result.columns)
          .flatMap((column) => column.items)
          .map((card) => card.id);
      };

      it('a Planner piece returns to preparation, leaves the client, and can be sent again', async () => {
        const { item, revision, request } = await awaitingClient(scopeA);
        const before = await pieceOf(item.id);
        expect(await boardIds()).toContain(before.id);

        await actions.withdraw(scopeA, before.id, operator, false);

        const after = await pieceOf(item.id);
        expect(after.boardColumn).toBe('preparation');
        const row = await db
          .getRepository(SocialApprovalRequestEntity)
          .findOneByOrFail({ id: request.id });
        expect(row.status).toBe('cancelled');
        expect(await boardIds()).not.toContain(before.id);
        await expect(
          db.getRepository(SocialContentItemEntity).findOneByOrFail({
            id: item.id,
          }),
        ).resolves.toMatchObject({ deletedAt: null });

        const again = await approvals.create(scopeA, operator, {
          subjectType: 'planner_content_revision',
          subjectId: item.id,
          subjectRevisionId: revision.id,
        });
        expect(again.id).not.toBe(request.id);
      });

      it('an approved send is detached, keeps its record and frees the card', async () => {
        const { item, request } = await awaitingClient(scopeA);
        await approvals.clientApprove(
          scopeA,
          request.id,
          clientUser(clientOwner),
        );
        const piece = await pieceOf(item.id);
        await actions.withdraw(scopeA, piece.id, ownerUser, true);
        expect((await pieceOf(item.id)).boardColumn).toBe('preparation');
        const row = await db
          .getRepository(SocialApprovalRequestEntity)
          .findOneByOrFail({ id: request.id });
        expect(row.status).toBe('approved');
      });

      it('only the sender or an override may withdraw', async () => {
        const { item } = await awaitingClient(scopeA);
        const piece = await pieceOf(item.id);
        await expect(
          actions.withdraw(scopeA, piece.id, randomUUID(), false),
        ).rejects.toMatchObject({ status: 403 });
      });

      it('a piece never sent has nothing to withdraw', async () => {
        const { item } = await contentRevision(scopeA);
        await sync.syncContexts(scopeA, [
          { clientId: clientA, companyContextId: companyA },
        ]);
        const piece = await pieceOf(item.id);
        await expect(
          actions.withdraw(scopeA, piece.id, ownerUser, true),
        ).rejects.toMatchObject({ status: 409 });
      });

      it('an avulsa leaves the board and answers 404 afterwards', async () => {
        const created = await actions.createStandalone(scopeA, operator, {
          title: 'Avulsa',
          stepKind: 'text',
          text: 'conteúdo',
        });
        await actions.withdraw(scopeA, created.id, operator, false);
        await expect(
          actions.updateCard(scopeA, created.id, { cardColor: 'blue' }),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          board.pieceDetail(scopeA, created.id, {
            userId: ownerUser,
            role: 'owner',
            permissions: new Set(),
          }),
        ).rejects.toMatchObject({ status: 404 });
      });

      it('restyling a card keeps its place in the column', async () => {
        const { item } = await awaitingClient(scopeA);
        const before = await pieceOf(item.id);
        await actions.updateCard(scopeA, before.id, {
          cardColor: 'rose',
          tags: [' Urgente ', 'urgente', 'Natal'],
          display: { thumbnail: false },
        });
        const after = await pieceOf(item.id);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(after.cardColor).toBe('rose');
        expect(after.tags).toEqual(['Urgente', 'Natal']);
        expect(after.cardDisplay).toEqual({ thumbnail: false });
      });

      it('marks a rejection without a new status (D-12)', async () => {
        const { request } = await draftRequest(scopeA);
        await approvals.submit(scopeA, request.id, operator);
        const saved = await approvals.requestChanges(
          scopeA,
          request.id,
          ownerUser,
          'refazer',
          'owner',
          'agency',
          'reject',
        );
        expect(saved.status).toBe('changes_requested');
        expect(saved.changesKind).toBe('reject');
      });
    });
  });

  describe('agency self area (D-24)', () => {
    const ownerReader = {
      userId: ownerUser,
      agencyRole: 'owner' as const,
      permissions: { comment: true, decide: true },
    };
    const adminReader = {
      ...ownerReader,
      userId: operator,
      agencyRole: 'admin' as const,
    };
    type Columns = {
      columns: Record<string, { items: Array<{ id: string; column: string }> }>;
    };
    const selfCards = async () =>
      Object.values(
        ((await selfApprovals.boardList(own, { limit: 100 })) as Columns)
          .columns,
      ).flatMap((column) => column.items);

    it('a draft does not exist on self; the first submit shows it awaiting you', async () => {
      const { request, item } = await draftRequest(own);
      await sync.syncContexts(own, [
        { clientId: null, companyContextId: null },
      ]);
      const piece = await pieceOf(item.id);
      expect((await selfCards()).map((card) => card.id)).not.toContain(
        piece.id,
      );
      await expect(
        selfApprovals.piece(own, piece.id, ownerReader),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        selfApprovals.detail(own, request.id, ownerReader),
      ).rejects.toMatchObject({ status: 404 });

      await approvals.submit(own, request.id, operator);
      const card = (await selfCards()).find((c) => c.id === piece.id);
      expect(card?.column).toBe('awaiting_you');
      const detail = await selfApprovals.detail(own, request.id, ownerReader);
      expect(detail).toMatchObject({
        status: 'awaiting_your_review',
        needsYou: true,
        actions: { canComment: true, canDecide: true },
      });
      expect(detail.sentToClientAt).toEqual(expect.any(String));
    });

    it('the decision is the internal approval, recorded as coming from self', async () => {
      const { request } = await draftRequest(own);
      await approvals.submit(own, request.id, operator);
      const detail = await selfApprovals.approve(own, request.id, ownerReader);
      expect(detail.status).toBe('approved');
      const row = await db
        .getRepository(SocialApprovalRequestEntity)
        .findOneByOrFail({ id: request.id });
      expect(row).toMatchObject({
        resolution: 'internal_final',
        sentToClientAt: null,
      });
      const event = await db
        .getRepository(SocialApprovalEventEntity)
        .findOneByOrFail({ requestId: request.id, type: 'approved' });
      expect(event.surface).toBe('self');
      expect(detail.history.map((entry) => entry.kind)).toContain('approved');
    });

    it('request changes returns to the agency, and an Admin needs D-17', async () => {
      const { request } = await draftRequest(own);
      await approvals.submit(own, request.id, operator);
      const asAdmin = await selfApprovals.detail(own, request.id, adminReader);
      expect(asAdmin.actions.canDecide).toBe(false);
      await expect(
        selfApprovals.approve(own, request.id, adminReader),
      ).rejects.toEqual(expectCode('approval_not_designated'));

      await settings.update(own, ownerUser, {
        internalApproverUserIds: [ownerUser],
      });
      const detail = await selfApprovals.requestChanges(
        own,
        request.id,
        ownerReader,
        'ajustar o texto',
      );
      expect(detail.status).toBe('in_revision');
      expect(detail.comments[0]).toMatchObject({
        body: 'ajustar o texto',
        mine: true,
        author: { name: 'Dono da Agência', side: 'agency' },
      });
    });

    it('comments only while open, and never as a client-visible row', async () => {
      const { request } = await draftRequest(own);
      await approvals.submit(own, request.id, operator);
      await selfApprovals.comment(own, request.id, ownerReader, 'nota');
      const comment = await db
        .getRepository(SocialApprovalCommentEntity)
        .findOneByOrFail({ approvalRequestId: request.id });
      expect(comment.visibility).toBe('internal');
      await selfApprovals.approve(own, request.id, ownerReader);
      await expect(
        selfApprovals.comment(own, request.id, ownerReader, 'outra'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('never shows a company piece, and the projection has no internal key', async () => {
      const company = await awaitingClient(scopeA);
      const companyPiece = await pieceOf(company.item.id);
      expect((await selfCards()).map((card) => card.id)).not.toContain(
        companyPiece.id,
      );
      await expect(
        selfApprovals.piece(own, companyPiece.id, ownerReader),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        selfApprovals.detail(own, company.request.id, ownerReader),
      ).rejects.toMatchObject({ status: 404 });

      const { request, item } = await draftRequest(own);
      await approvals.submit(own, request.id, operator);
      const piece = await pieceOf(item.id);
      const serialized = JSON.stringify(
        await selfApprovals.piece(own, piece.id, ownerReader),
      );
      for (const key of [
        'tenantId',
        'workspaceId',
        'agencyClientId',
        'companyContextId',
        'sourceId',
        'requestedByUserId',
        'subjectId',
        'subjectRevisionId',
        'storagePath',
      ])
        expect(serialized).not.toContain(key);
    });
  });

  describe('backfill', () => {
    it('is idempotent and derives resolution from history', async () => {
      const { request } = await draftRequest(scopeA);
      const legacy = randomUUID();
      const assetId = randomUUID();
      await db.query(
        `INSERT INTO social_approval_requests
           (id, tenant_id, workspace_id, agency_client_id, company_context_id,
            subject_type, subject_id, subject_revision_id, source_module, display_type,
            title, subject_version_label, status, current_stage, requested_by_user_id, approved_at)
         VALUES ($1,$2,$3,$4,$5,'creative_version',$6,$7,'creative_studio','creative',
                 'Legado','v1','approved','client',$8, now())`,
        [
          legacy,
          tenantId,
          workspaceId,
          clientA,
          companyA,
          assetId,
          randomUUID(),
          operator,
        ],
      );
      await db.query(
        `INSERT INTO social_approval_stage_decisions
           (approval_request_id, stage, decision, actor_type, actor_user_id)
         VALUES ($1,'client','approved','user',$2)`,
        [legacy, clientOwner],
      );
      await db.query(
        `UPDATE social_approval_requests SET step_id = NULL WHERE id = $1`,
        [request.id],
      );
      const runner = db.createQueryRunner();
      const migration = new BackfillSocialApprovalPieces1802900100000();
      await migration.up(runner);
      const snapshot = async () => ({
        pieces: (
          await db.query(`SELECT count(*)::int c FROM social_approval_pieces`)
        )[0].c,
        steps: (
          await db.query(`SELECT count(*)::int c FROM social_approval_steps`)
        )[0].c,
        events: (
          await db.query(`SELECT count(*)::int c FROM social_approval_events`)
        )[0].c,
      });
      const first = await snapshot();
      await migration.up(runner);
      expect(await snapshot()).toEqual(first);
      await runner.release();

      const row = await db
        .getRepository(SocialApprovalRequestEntity)
        .findOneByOrFail({ id: legacy });
      expect(row.resolution).toBe('client_approved');
      expect(row.stepId).not.toBeNull();
      const relinked = await db
        .getRepository(SocialApprovalRequestEntity)
        .findOneByOrFail({ id: request.id });
      expect(relinked.stepId).not.toBeNull();
      expect(
        await db
          .getRepository(SocialApprovalEventEntity)
          .countBy({ requestId: legacy, type: 'approved' }),
      ).toBe(1);
    });
  });
});
