import { AddSocialApprovalCommentRichContent1803500000000 } from '../../database/migrations/1803500000000-add-social-approval-comment-rich-content';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
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
import { CreateSocialWorkLinks1803100000000 } from '../../database/migrations/1803100000000-create-social-work-links';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import { ClientAreaMemberModuleAccessEntity } from '../client-area/entities/client-area-member-module-access.entity';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectEvent,
  AgencyProjectStage,
  AgencyTask,
  AgencyTaskAttachment,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskStage,
  AgencyTaskTimeEntry,
  TaskStatus,
} from '../projects';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import { TaskWorkspaceService } from '../projects/services/task-workspace.service';
import { ClientApprovalBoardService } from '../social-approvals/client/client-approval-board.service';
import { SocialApprovalTransitionRegistry } from '../social-approvals/approval-transition.port';
import {
  SocialApprovalCommentEntity,
  SocialApprovalEventEntity,
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalSettingsEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStageDecisionEntity,
  SocialApprovalStepEntity,
} from '../social-approvals/entities';
import { SocialApprovalAuthorityService } from '../social-approvals/social-approval-authority.service';
import { SocialApprovalPieceActionsService } from '../social-approvals/social-approval-piece-actions.service';
import { SocialApprovalPieceSourcesService } from '../social-approvals/social-approval-piece-sources.service';
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
import { SocialPlanContentChangeRegistry } from '../social-planner/services/social-plan-content-change.port';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import { SocialPlannerApprovalsService } from '../social-planner-approvals/social-planner-approvals.service';
import {
  SocialContentWorkLinkEntity,
  SocialPlanWorkLinkEntity,
} from './entities';
import { SocialPlanWorkService } from './social-plan-work.service';
import { SocialSubtaskApprovalsService } from './social-subtask-approvals.service';
import { SocialWorkStatusService } from './social-work-status.service';

const run = describePostgresIntegration();

/**
 * AR4 — the backend acceptance matrix, on real PostgreSQL in a throwaway
 * schema of the guarded `_test` database. Approvals, Planner and the Projects
 * services are the real ones; the Social gate and the Studio are stand-ins
 * with their own suites.
 */
run('AR4 Planner, Approvals and Projects (real PostgreSQL)', () => {
  const schema = `ar4_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientA = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const clientC = randomUUID();
  const companyC = randomUUID();
  const scopeA: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientA,
    companyContextId: companyA,
  };
  const scopeC: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientC,
    companyContextId: companyC,
  };
  const own: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };
  const ownerUser = randomUUID();
  const clientOwner = randomUUID();

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
    AgencyProject,
    AgencyProjectEvent,
    AgencyProjectStage,
    AgencyPersonalTaskStage,
    AgencyTask,
    AgencyTaskAttachment,
    AgencyTaskChecklistItem,
    AgencyTaskComment,
    AgencyTaskStage,
    AgencyTaskTimeEntry,
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
    SocialPlanWorkLinkEntity,
    SocialContentWorkLinkEntity,
  ];

  let db: DataSource;
  let approvals: SocialApprovalsService;
  let actions: SocialApprovalPieceActionsService;
  let planner: SocialPlannerService;
  let plannerApprovals: SocialPlannerApprovalsService;
  let tasks: TasksCrudService;
  let checklist: TaskWorkspaceService;
  let status: SocialWorkStatusService;
  let work: SocialPlanWorkService;
  let section: SocialSubtaskApprovalsService;
  let board: ClientApprovalBoardService;
  let transitions: SocialApprovalTransitionRegistry;
  let changes: SocialPlanContentChangeRegistry;

  /** Authorized companies per client; absence means Social not contracted. */
  const companies = new Map<string, Array<{ id: string; name: string }>>();
  let ownAvailable = true;
  const attachTask = jest.fn().mockResolvedValue(true);
  const privateFiles: Array<{ path: string; body: Buffer }> = [];

  const gate = {
    ownAvailable: async () => ownAvailable,
    companiesOf: async (_ctx: unknown, clientId: string) =>
      companies.get(clientId) ?? [],
    scopeAvailable: async (_ctx: unknown, scope: CompanyAwareScope) =>
      scope.agencyClientId
        ? (companies.get(scope.agencyClientId) ?? []).some(
            (row) => row.id === scope.companyContextId,
          )
        : ownAvailable,
    assertScope: async (_ctx: unknown, scope: CompanyAwareScope) => {
      if (!(await gate.scopeAvailable(_ctx, scope)))
        throw Object.assign(new Error('social_not_contracted'), {
          status: 403,
        });
    },
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
      extra: { options: `-c search_path=${schema},public`, max: 12 },
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
    for (const [id, client] of [
      [companyA, clientA],
      [companyB, clientA],
      [companyC, clientC],
    ])
      await bootstrap.query(
        `INSERT INTO agency_client_company_contexts VALUES ($1,$2,$3,$4)`,
        [id, tenantId, workspaceId, client],
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
    await new CreateSocialWorkLinks1803100000000().up(runner);
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
    const settings = new SocialApprovalSettingsService(db, authority);
    const pieces = new SocialApprovalPiecesService(db);
    transitions = new SocialApprovalTransitionRegistry();
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
    const sync = new SocialApprovalPieceSyncService(db, pieces);
    const files = {
      getAsset: async () => ({
        body: Readable.from([Buffer.from('anexo')]),
      }),
      uploadPrivateBuffer: async (input: { path: string; body: Buffer }) => {
        privateFiles.push(input);
        return { path: input.path };
      },
    };
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
      files as never,
      transitions,
    );
    changes = new SocialPlanContentChangeRegistry();
    planner = new SocialPlannerService(
      db.getRepository(SocialPlanEntity),
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialContentDestinationEntity),
      db.getRepository(SocialContentRevisionEntity),
      { assertOptionalLinks: async () => undefined } as never,
      pieces,
      changes,
    );
    const readiness = {
      snapshot: async (scope: CompanyAwareScope, id: string) => ({
        contentItem: await db
          .getRepository(SocialContentItemEntity)
          .findOneOrFail({ where: { id, tenantId: scope.tenantId } }),
        selection: null,
        approval: { state: 'not_sent', projection: null },
      }),
    };
    plannerApprovals = new SocialPlannerApprovalsService(
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
      {} as never,
      readiness as never,
      transitions,
      { assertCan: jest.fn() } as never,
    );
    plannerApprovals.onModuleInit();

    tasks = new TasksCrudService(
      db.getRepository(AgencyTask),
      db.getRepository(AgencyProjectEvent),
      db.getRepository(AgencyProject),
      db.getRepository(AgencyTaskStage),
      db.getRepository(AgencyPersonalTaskStage),
      db.getRepository(AgencyTaskAttachment),
      db.getRepository(AgencyTaskChecklistItem),
      db.getRepository(AgencyTaskComment),
      db.getRepository(AgencyTaskTimeEntry),
      {} as never,
      {
        publishAssigned: jest.fn(),
        publishCompleted: jest.fn(),
        publishReopened: jest.fn(),
        publishReassigned: jest.fn(),
        publishBlocked: jest.fn(),
        publishUnblocked: jest.fn(),
      } as never,
    );
    checklist = new TaskWorkspaceService(
      db.getRepository(AgencyTask),
      db.getRepository(AgencyTaskChecklistItem),
      db.getRepository(AgencyTaskComment),
      db.getRepository(AgencyTaskTimeEntry),
      db.getRepository(AgencyProject),
      tasks,
    );
    status = new SocialWorkStatusService(db, tasks, checklist, transitions);
    status.onModuleInit();
    const permissions = {
      can: async () => true,
      assertCan: jest.fn(),
    };
    work = new SocialPlanWorkService(
      db,
      tasks,
      checklist,
      {
        create: (_ctx: unknown, dto: { name: string; clientId: string }) =>
          project(dto.clientId ?? null, dto.name),
        archive: async () => undefined,
      } as never,
      {
        attachMaterializedTask: attachTask,
        requireProjectInScope: async () => undefined,
        projectCandidatesForScope: async () => ({ items: [] }),
      } as never,
      changes,
      status,
      permissions as never,
      gate as never,
    );
    work.onModuleInit();
    section = new SocialSubtaskApprovalsService(
      db,
      tasks,
      gate as never,
      permissions as never,
      actions,
      plannerApprovals,
      planner,
      status,
    );
    board = new ClientApprovalBoardService(
      db.getRepository(SocialApprovalPieceEntity),
      db.getRepository(SocialApprovalStepEntity),
      db.getRepository(SocialApprovalRequestEntity),
      {} as never,
      { syncContexts: async () => undefined } as never,
      { thumbnailPaths: async () => new Map() } as never,
    );

    await db.getRepository(ClientAreaMembershipEntity).save(
      [scopeA, scopeC].map((scope) => ({
        tenantId,
        workspaceId,
        agencyClientId: scope.agencyClientId!,
        companyContextId: scope.companyContextId!,
        userId: clientOwner,
        role: 'client_owner' as const,
        status: 'active' as const,
        grantedByUserId: null,
        grantedAt: new Date(),
        revokedByUserId: null,
        revokedAt: null,
      })) as never,
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(() => {
    companies.clear();
    companies.set(clientA, [{ id: companyA, name: 'Empresa A' }]);
    companies.set(clientC, [{ id: companyC, name: 'Empresa C' }]);
    ownAvailable = true;
    attachTask.mockClear();
    privateFiles.length = 0;
  });

  const ctx = (scope: CompanyAwareScope = scopeA): RequestContext => ({
    tenantId,
    workspaceId,
    userId: ownerUser,
    role: 'owner',
    managedContext: scope.agencyClientId
      ? ({
          productKey: 'social',
          operatingMode: 'client',
          clientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          managedTenantId: null,
        } as never)
      : undefined,
  });

  const project = async (clientId: string | null, name = 'Projeto') =>
    (await db.getRepository(AgencyProject).save({
      tenantId,
      workspaceId,
      clientId,
      ownerId: ownerUser,
      name,
      markerIds: [],
    } as never)) as unknown as AgencyProject;

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

  const linked = async (
    scope: CompanyAwareScope = scopeA,
    mode: 'project_linked' | 'task_created' = 'project_linked',
  ) => {
    const row = await project(scope.agencyClientId);
    const created = await plan(scope);
    const { link } = await work.createLink(ctx(scope), created.id, {
      mode,
      projectId: row.id,
    });
    return { planId: created.id, projectId: row.id, link };
  };

  const links = (contentItemId: string) =>
    db.getRepository(SocialContentWorkLinkEntity).find({
      where: { contentItemId },
      order: { stepKind: 'ASC' },
    });
  const taskOf = (id: string) =>
    db.getRepository(AgencyTask).findOneOrFail({ where: { id } });
  const subtaskOf = (id: string) =>
    db.getRepository(AgencyTaskChecklistItem).findOneOrFail({ where: { id } });
  const stepsOfTask = (taskId: string) =>
    db.getRepository(AgencyTaskChecklistItem).find({ where: { taskId } });

  const materializeAll = async (planId: string) => {
    const link = await db
      .getRepository(SocialPlanWorkLinkEntity)
      .findOneOrFail({ where: { planId } });
    return work.materialize(link, null);
  };

  /** Copy already written, sent through the real AR3 path. */
  const sendCopy = async (itemId: string, scope = scopeA) => {
    await planner.createRevision(scope, itemId, ownerUser, { copy: 'texto' });
    return plannerApprovals.sendContent(ctx(scope), itemId, 'copy');
  };
  const approveAll = async (approvalId: string, scope = scopeA) => {
    await approvals.approveInternal(scope, approvalId, ownerUser, 'owner');
    if (scope.agencyClientId)
      await approvals.clientApprove(scope, approvalId, {
        type: 'user',
        userId: clientOwner,
      });
  };

  describe('materialization (D-25)', () => {
    it('makes one task with Copy and Criativo per item, and repeats nothing', async () => {
      const { planId, projectId } = await linked();
      const first = await item(planId);
      await item(planId, scopeA, { calendarOnly: true });

      expect(await materializeAll(planId)).toBe(1);
      const rows = await links(first.id);
      expect(rows.map((row) => row.stepKind)).toEqual(['copy', 'creative']);
      const task = await taskOf(rows[0].taskId);
      expect(task).toMatchObject({
        projectId,
        clientId: clientA,
        visibility: 'workspace',
      });
      expect(task.dueDate?.toISOString()).toBe('2026-12-10T12:00:00.000Z');
      expect(
        (await stepsOfTask(task.id)).map((row) => row.title).sort(),
      ).toEqual(['Copy', 'Criativo']);

      expect(await materializeAll(planId)).toBe(0);
      await Promise.all([materializeAll(planId), materializeAll(planId)]);
      expect(await links(first.id)).toHaveLength(2);
      expect(
        await db.getRepository(AgencyTask).count({ where: { projectId } }),
      ).toBe(1);
      expect(attachTask).toHaveBeenCalledWith(
        expect.objectContaining({ companyContextId: companyA }),
        first.id,
        ownerUser,
        expect.objectContaining({
          taskId: task.id,
          subtaskId: rows[1].subtaskId,
          projectId,
        }),
      );
    });

    it('task_created makes one task and one subtask per item', async () => {
      const { planId, link } = await linked(scopeA, 'task_created');
      const first = await item(planId, scopeA, { title: 'Primeiro post' });
      const second = await item(planId);
      await materializeAll(planId);
      const [a] = await links(first.id);
      const [b] = await links(second.id);
      expect(a).toMatchObject({ stepKind: 'item', taskId: link.parentTaskId });
      expect(b.taskId).toBe(link.parentTaskId);
      expect((await subtaskOf(a.subtaskId!)).title).toBe('Primeiro post');
    });

    it('E5: a task per item is named by day and plan and describes the item', async () => {
      const { planId } = await linked();
      const first = await item(planId, scopeA, {
        title: 'Seleção de presentes',
        theme: 'Natal',
        plannedDate: '2026-12-05',
        creativeFormat: 'carousel',
        funnelStage: 'discovery',
        contentType: 'promotion',
        objective: 'engagement',
        cta: 'Compre já',
      });
      await db.getRepository(SocialContentDestinationEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: clientA,
        contentItemId: first.id,
        channel: 'instagram',
        placement: 'feed',
      } as never);
      await materializeAll(planId);
      const [row] = await links(first.id);
      const task = await taskOf(row.taskId);
      expect(task.title).toBe('05/12 · Plano Dezembro');
      expect(task.description).toBe(
        [
          'Data: 05/12/2026',
          'Tema: Natal',
          'Conteúdo: Seleção de presentes',
          'Canais: Instagram · Feed',
          'Formato: Carrossel',
          'Funil: Descoberta',
          'Tipo: Divulgação',
          'Objetivo: Engajamento',
          'CTA: Compre já',
        ].join('\n'),
      );
      expect(task.dueDate?.toISOString()).toBe('2026-12-05T12:00:00.000Z');
    });

    it('E5: one task with subtasks may start a new project and describes plan and items', async () => {
      const created = await plan(scopeA);
      await db.getRepository(SocialPlanEntity).update(created.id, {
        primaryObjective: 'Engajamento',
        strategyMode: 'always_on',
      } as never);
      const { link } = await work.createLink(ctx(scopeA), created.id, {
        mode: 'task_created',
        createProject: true,
        projectName: 'Social Dezembro',
      });
      const project = await db
        .getRepository(AgencyProject)
        .findOneOrFail({ where: { id: link.projectId } });
      expect(project.name).toBe('Social Dezembro');
      const parent = await taskOf(link.parentTaskId!);
      expect(parent).toMatchObject({
        title: 'Plano Dezembro',
        projectId: project.id,
        description: [
          'Início: 01/12/2026',
          'Fim: 31/12/2026',
          'Objetivo principal: Engajamento',
          'Modo estratégico: Posts para Redes Sociais',
        ].join('\n'),
      });
      const first = await item(created.id, scopeA, {
        title: 'Primeiro post',
        theme: 'Natal',
        plannedDate: '2026-12-05',
        creativeFormat: 'image',
        cta: 'Saiba mais',
      });
      await materializeAll(created.id);
      const [row] = await links(first.id);
      const subtask = await subtaskOf(row.subtaskId!);
      expect(subtask).toMatchObject({
        title: 'Primeiro post',
        description: '05/12 · Natal · Imagem · Saiba mais',
      });
      expect(new Date(subtask.dueDate!).toISOString()).toBe(
        '2026-12-05T12:00:00.000Z',
      );
    });

    it('an item created after the modal becomes work, also from a generated grid', async () => {
      const { planId } = await linked();
      const created = await planner.createContent(scopeA, planId, ownerUser, {
        title: 'Criado depois',
        plannedDate: '2026-12-15',
      } as never);
      expect(await links(created.id)).toHaveLength(2);

      const generated = await item(planId);
      await changes.notify({
        tenantId,
        workspaceId,
        contentItemIds: [generated.id],
      });
      expect(await links(generated.id)).toHaveLength(2);
    });

    it('removing an item cancels the task without deleting it, and restoring brings it back', async () => {
      const { planId } = await linked();
      const row = await item(planId);
      await materializeAll(planId);
      const [link] = await links(row.id);

      await db
        .getRepository(SocialContentItemEntity)
        .update(row.id, { archivedAt: new Date() });
      await changes.notify({
        tenantId,
        workspaceId,
        contentItemIds: [row.id],
      });
      expect((await taskOf(link.taskId)).status).toBe('cancelled');
      expect((await links(row.id))[0].cancelledAt).not.toBeNull();

      await db
        .getRepository(SocialContentItemEntity)
        .update(row.id, { archivedAt: null });
      await materializeAll(planId);
      expect((await taskOf(link.taskId)).status).toBe('in_progress');
      expect((await links(row.id))[0].cancelledAt).toBeNull();
      expect(
        await db
          .getRepository(AgencyTask)
          .count({ where: { id: link.taskId } }),
      ).toBe(1);
    });

    it('a discarded draft still cancels through the link it left', async () => {
      const { planId } = await linked();
      const row = await item(planId);
      await materializeAll(planId);
      const [link] = await links(row.id);
      await db.getRepository(SocialContentItemEntity).delete(row.id);
      await changes.notify({
        tenantId,
        workspaceId,
        contentItemIds: [row.id],
      });
      expect((await taskOf(link.taskId)).status).toBe('cancelled');
    });

    it('a task a person cancelled is not brought back by a restore', async () => {
      const { planId } = await linked();
      const row = await item(planId);
      await materializeAll(planId);
      const [link] = await links(row.id);
      await tasks.update(
        { tenantId, workspaceId, userId: ownerUser, role: 'owner' },
        link.taskId,
        { status: TaskStatus.Cancelled },
      );
      await materializeAll(planId);
      expect((await taskOf(link.taskId)).status).toBe('cancelled');
    });

    it('changing the date moves the deadline; a hand-set deadline survives', async () => {
      const { planId } = await linked();
      const row = await item(planId);
      await materializeAll(planId);
      const [link] = await links(row.id);

      await planner.updateContent(scopeA, row.id, ownerUser, {
        plannedDate: '2026-12-20',
      } as never);
      expect((await taskOf(link.taskId)).dueDate?.toISOString()).toBe(
        '2026-12-20T12:00:00.000Z',
      );
      expect((await subtaskOf(link.subtaskId!)).dueDate?.toISOString()).toBe(
        '2026-12-20T12:00:00.000Z',
      );

      await tasks.update(
        { tenantId, workspaceId, userId: ownerUser, role: 'owner' },
        link.taskId,
        { dueDate: '2026-12-25T12:00:00.000Z' },
      );
      await materializeAll(planId);
      expect((await taskOf(link.taskId)).dueDate?.toISOString()).toBe(
        '2026-12-25T12:00:00.000Z',
      );
    });

    it('keeps the created mode one per plan, and refuses another mode', async () => {
      const { planId, projectId } = await linked();
      await expect(
        work.createLink(ctx(), planId, { mode: 'project_linked', projectId }),
      ).resolves.toMatchObject({ changed: false });
      await expect(
        work.createLink(ctx(), planId, { mode: 'task_created', projectId }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('refuses to link a plan for a client without Social', async () => {
      companies.delete(clientA);
      const row = await project(clientA);
      const created = await plan();
      await expect(
        work.createLink(ctx(), created.id, {
          mode: 'project_linked',
          projectId: row.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('status follows the decision (D-26)', () => {
    it('walks each decision, and a replay changes nothing', async () => {
      const { planId } = await linked();
      const row = await item(planId);
      await materializeAll(planId);
      const [copy] = await links(row.id);

      const sent = await sendCopy(row.id);
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('in_review');

      await approvals.approveInternal(
        scopeA,
        sent.copy!.approvalId!,
        ownerUser,
        'owner',
      );
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('in_review');

      await approvals.clientRequestChanges(
        scopeA,
        sent.copy!.approvalId!,
        { type: 'user', userId: clientOwner },
        'ajustar',
      );
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('in_progress');

      const before = await subtaskOf(copy.subtaskId!);
      await status.syncTask(tenantId, workspaceId, copy.taskId);
      await status.syncTask(tenantId, workspaceId, copy.taskId);
      const after = await subtaskOf(copy.subtaskId!);
      expect(after.status).toBe('in_progress');
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });

    it('approves the parent only when every subtask is approved', async () => {
      const { planId } = await linked(own);
      const row = await item(planId, own);
      await materializeAll(planId);
      const [copy, creative] = await links(row.id);

      const sent = await sendCopy(row.id, own);
      await approvals.approveInternal(
        own,
        sent.copy!.approvalId!,
        ownerUser,
        'owner',
      );
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('approved');
      expect((await subtaskOf(copy.subtaskId!)).isDone).toBe(false);
      expect((await taskOf(copy.taskId)).status).toBe('in_progress');

      await db
        .getRepository(AgencyTaskChecklistItem)
        .update(creative.subtaskId!, { status: 'approved' });
      await status.syncTask(tenantId, workspaceId, copy.taskId);
      expect((await taskOf(copy.taskId)).status).toBe('approved');
    });

    it('a shared subtask takes the most delayed delivery', async () => {
      const { planId } = await linked(own, 'task_created');
      const row = await item(planId, own);
      await materializeAll(planId);
      const [link] = await links(row.id);

      const sent = await sendCopy(row.id, own);
      expect((await subtaskOf(link.subtaskId!)).status).toBe('in_progress');
      await approvals.approveInternal(
        own,
        sent.copy!.approvalId!,
        ownerUser,
        'owner',
      );
      // Copy approved, creative never sent: not approved yet.
      expect((await subtaskOf(link.subtaskId!)).status).toBe('in_progress');
    });

    it('never overwrites a cancelled subtask', async () => {
      const { planId } = await linked(own);
      const row = await item(planId, own);
      await materializeAll(planId);
      const [copy] = await links(row.id);
      await db
        .getRepository(AgencyTaskChecklistItem)
        .update(copy.subtaskId!, { status: 'cancelled' });
      await sendCopy(row.id, own);
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('cancelled');
    });

    it('a failing observer never reverts the decision, and reconciliation repairs', async () => {
      const { planId } = await linked(own);
      const row = await item(planId, own);
      await materializeAll(planId);
      const [copy] = await links(row.id);
      const spy = jest
        .spyOn(status, 'syncTask')
        .mockRejectedValue(new Error('projects down'));

      const sent = await sendCopy(row.id, own);
      expect(sent.copy?.status).toBe('awaiting_internal_review');
      spy.mockRestore();
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('in_progress');

      await work.reconcile(ctx(own), planId);
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('in_review');
    });

    it('finishing a piece closes its work, even with nothing to transition', async () => {
      const { planId } = await linked(own);
      const row = await item(planId, own);
      await materializeAll(planId);
      const [copy, creative] = await links(row.id);
      await plannerApprovals.contentState(ctx(own), row.id);
      const sync = new SocialApprovalPieceSyncService(
        db,
        new SocialApprovalPiecesService(db),
      );
      await sync.syncContexts(own, [
        { clientId: null, companyContextId: null },
      ]);
      const piece = await db
        .getRepository(SocialApprovalPieceEntity)
        .findOneOrFail({
          where: { kind: 'content_item', sourceId: row.id },
        });

      await actions.finish(own, piece.id, ownerUser, undefined, async () => {
        return undefined;
      });

      expect((await subtaskOf(copy.subtaskId!)).status).toBe('done');
      expect((await subtaskOf(copy.subtaskId!)).isDone).toBe(true);
      expect((await subtaskOf(creative.subtaskId!)).status).toBe('done');
      expect((await taskOf(copy.taskId)).status).toBe('done');
    });
  });

  describe('subtask section (R-16, R-18, D-27, D-28)', () => {
    const manualSubtask = async (
      clientId: string | null,
      title = 'Peça da campanha',
    ) => {
      const context = {
        tenantId,
        workspaceId,
        userId: ownerUser,
        role: 'owner',
      };
      const task = await tasks.createWorkspaceTask(context, {
        title: 'Tarefa solta',
        clientId,
      });
      const subtask = await checklist.createChecklistItem(context, task.id, {
        title,
      });
      return { taskId: task.id, subtaskId: subtask.id };
    };

    it('turns a free subtask into an avulsa with its title and follows the decision', async () => {
      const { taskId, subtaskId } = await manualSubtask(
        clientA,
        'Banner do site',
      );
      const { result, section: view } = await section.send(
        ctx(),
        taskId,
        subtaskId,
        { kind: 'text', text: 'Texto para aprovar' },
      );
      expect(result).toMatchObject({ target: 'standalone' });
      const piece = await db
        .getRepository(SocialApprovalPieceEntity)
        .findOneOrFail({
          where: { id: (result as { pieceId: string }).pieceId },
        });
      expect(piece).toMatchObject({
        kind: 'standalone',
        origin: 'projects',
        title: 'Banner do site',
        companyContextId: companyA,
      });
      expect(view.available && view.items).toHaveLength(1);
      expect((await subtaskOf(subtaskId)).status).toBe('in_review');
      const approvalId = view.available && view.items[0].approvalId;
      await approveAll(approvalId as string);
      expect((await subtaskOf(subtaskId)).status).toBe('approved');
      expect((await taskOf(taskId)).status).toBe('approved');

      await section.send(ctx(), taskId, subtaskId, {
        kind: 'link',
        url: 'https://exemplo.com/peca',
      });
      expect((await subtaskOf(subtaskId)).status).toBe('in_review');
      expect((await taskOf(taskId)).status).toBe('in_progress');
    });

    it('copies a task attachment into the private bucket (D-29)', async () => {
      const { taskId, subtaskId } = await manualSubtask(clientA);
      const attachment = await db.getRepository(AgencyTaskAttachment).save({
        tenantId,
        workspaceId,
        taskId,
        uploadedById: ownerUser,
        fileName: 'briefing.pdf',
        fileSize: 5,
        mimeType: 'application/pdf',
        assetPath: 'tenants/x/briefing.pdf',
        assetUrl: 'https://cdn/briefing.pdf',
      });
      const { result } = await section.send(ctx(), taskId, subtaskId, {
        kind: 'file',
        attachmentId: attachment.id,
      });
      expect(privateFiles).toHaveLength(1);
      expect(privateFiles[0].path).toMatch(/^social-approvals\/.*\.pdf$/);
      const snapshot = await db
        .getRepository(SocialApprovalSnapshotEntity)
        .findOneOrFail({
          where: { kind: 'file' },
          order: { createdAt: 'DESC' },
        });
      expect(snapshot.payload).toMatchObject({
        fileName: 'briefing.pdf',
        storagePath: privateFiles[0].path,
      });
      expect(result).toMatchObject({ target: 'standalone' });
    });

    it('refuses an attachment of another task', async () => {
      const { taskId, subtaskId } = await manualSubtask(clientA);
      const other = await manualSubtask(clientA);
      const attachment = await db.getRepository(AgencyTaskAttachment).save({
        tenantId,
        workspaceId,
        taskId: other.taskId,
        uploadedById: ownerUser,
        fileName: 'x.pdf',
        fileSize: 1,
        mimeType: 'application/pdf',
        assetPath: 'x',
        assetUrl: 'x',
      });
      await expect(
        section.send(ctx(), taskId, subtaskId, {
          kind: 'file',
          attachmentId: attachment.id,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('asks for the company only with more than one, and refuses a foreign one', async () => {
      companies.set(clientA, [
        { id: companyA, name: 'Empresa A' },
        { id: companyB, name: 'Empresa B' },
      ]);
      const { taskId, subtaskId } = await manualSubtask(clientA);
      const before = await section.section(ctx(), taskId, subtaskId);
      expect(before.available && before.company.required).toBe(true);

      await expect(
        section.send(ctx(), taskId, subtaskId, {
          kind: 'text',
          text: 'x',
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        section.send(ctx(), taskId, subtaskId, {
          kind: 'text',
          text: 'x',
          companyContextId: companyC,
        }),
      ).rejects.toMatchObject({ status: 403 });

      await section.send(ctx(), taskId, subtaskId, {
        kind: 'text',
        text: 'x',
        companyContextId: companyB,
      });
      const after = await section.section(ctx(), taskId, subtaskId);
      expect(after.available && after.company.selectedId).toBe(companyB);
      expect(after.available && after.company.required).toBe(false);
    });

    it('uses the own scope for a task without client', async () => {
      const { taskId, subtaskId } = await manualSubtask(null);
      const { result } = await section.send(ctx(own), taskId, subtaskId, {
        kind: 'text',
        text: 'interno',
      });
      const piece = await db
        .getRepository(SocialApprovalPieceEntity)
        .findOneOrFail({
          where: { id: (result as { pieceId: string }).pieceId },
        });
      expect(piece.agencyClientId).toBeNull();
    });

    it('links a new avulsa only to work of its own client and keeps its description', async () => {
      const sources = new SocialApprovalPieceSourcesService(db);
      const { taskId, subtaskId } = await manualSubtask(clientA, 'Arte');
      const sibling = await manualSubtask(clientA, 'Outra');
      const foreign = await manualSubtask(null);
      const foreignProject = await project(null);

      const listed = (await sources.tasks(scopeA, ownerUser)).items.map(
        (row) => row.id,
      );
      expect(listed).toContain(taskId);
      expect(listed).not.toContain(foreign.taskId);
      expect(await sources.subtasks(scopeA, ownerUser, taskId)).toEqual({
        items: [{ id: subtaskId, title: 'Arte' }],
      });
      await expect(
        sources.subtasks(scopeA, ownerUser, foreign.taskId),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        sources.resolveWork(scopeA, ownerUser, { workTaskId: foreign.taskId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        sources.resolveWork(scopeA, ownerUser, {
          workProjectId: foreignProject.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        sources.resolveWork(scopeA, ownerUser, {
          workTaskId: taskId,
          workSubtaskId: sibling.subtaskId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        sources.resolveWork(scopeA, ownerUser, { workSubtaskId: subtaskId }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const work = await sources.resolveWork(scopeA, ownerUser, {
        workTaskId: taskId,
        workSubtaskId: subtaskId,
      });
      const { id } = await actions.createStandalone(
        scopeA,
        ownerUser,
        {
          title: 'Peça',
          stepKind: 'text',
          text: 'conteúdo',
          description: '  Sobre a peça ',
        },
        { work: work! },
      );
      const piece = await db
        .getRepository(SocialApprovalPieceEntity)
        .findOneOrFail({ where: { id } });
      expect(piece.description).toBe('Sobre a peça');
      expect(piece.origin).toBe('approvals');
      const step = await db
        .getRepository(SocialApprovalStepEntity)
        .findOneOrFail({ where: { pieceId: id } });
      expect(step).toMatchObject({
        workTaskId: taskId,
        workSubtaskId: subtaskId,
      });
    });

    it('offers nothing to a client without Social', async () => {
      const { taskId, subtaskId } = await manualSubtask(clientA);
      companies.delete(clientA);
      await expect(section.section(ctx(), taskId, subtaskId)).resolves.toEqual({
        available: false,
      });
      await expect(
        section.send(ctx(), taskId, subtaskId, { kind: 'text', text: 'x' }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(section.reconcileTask(ctx(), taskId)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('a linked subtask writes a Planner revision and sends through the Planner', async () => {
      const { planId } = await linked();
      const row = await item(planId);
      await materializeAll(planId);
      const [copy, creative] = await links(row.id);

      const view = await section.section(ctx(), copy.taskId, copy.subtaskId!);
      expect(view.available && view.target).toBe('planner_item');
      expect(view.available && view.allowedKinds).toEqual(['text']);

      const { result } = await section.send(
        ctx(),
        copy.taskId,
        copy.subtaskId!,
        { kind: 'text', text: 'Copy escrita na subtarefa' },
      );
      expect(result).toMatchObject({
        target: 'planner_item',
        contentItemId: row.id,
      });
      const stored = await db
        .getRepository(SocialContentItemEntity)
        .findOneOrFail({ where: { id: row.id } });
      expect(stored.copy).toBe('Copy escrita na subtarefa');
      expect(stored.currentRevisionId).not.toBeNull();
      expect((await subtaskOf(copy.subtaskId!)).status).toBe('in_review');

      await expect(
        section.send(ctx(), creative.taskId, creative.subtaskId!, {
          kind: 'text',
          text: 'x',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('Client Area read (D-06)', () => {
    it('shows only what was sent, never another company', async () => {
      const { planId } = await linked();
      const row = await item(planId);
      await materializeAll(planId);
      const [copy] = await links(row.id);

      const sent = await sendCopy(row.id);
      // Still at the internal stage: not the client's yet.
      await expect(
        board.workItems(scopeA, { taskId: copy.taskId }),
      ).resolves.toEqual({ items: [] });

      await approvals.approveInternal(
        scopeA,
        sent.copy!.approvalId!,
        ownerUser,
        'owner',
      );
      const visible = await board.workItems(scopeA, {
        taskId: copy.taskId,
        subtaskId: copy.subtaskId!,
      });
      expect(visible.items).toHaveLength(1);
      expect(visible.items[0]).toMatchObject({ column: 'awaiting_you' });
      expect(Object.keys(visible.items[0]).sort()).toEqual(
        [
          'activeStep',
          'finishedAt',
          'id',
          'kind',
          'lastActivityAt',
          'needsYou',
          'source',
          'steps',
          'thumbnail',
          'title',
          'column',
        ].sort(),
      );

      await expect(
        board.workItems(scopeC, { taskId: copy.taskId }),
      ).resolves.toEqual({ items: [] });
    });
  });

  it('the migration can be repeated and reverted', async () => {
    const runner = db.createQueryRunner();
    const migration = new CreateSocialWorkLinks1803100000000();
    await migration.up(runner);
    await migration.down(runner);
    const [{ exists }] = await runner.query(
      `SELECT to_regclass('"${schema}".social_plan_work_links') IS NOT NULL AS exists`,
    );
    expect(exists).toBe(false);
    await migration.up(runner);
    await runner.release();
  });
});
