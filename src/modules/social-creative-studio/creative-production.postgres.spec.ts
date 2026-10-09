import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions, type Repository } from 'typeorm';
import { MediaAssetEntity } from '../../common/media-assets/media-asset.entity';
import type { RequestContext } from '../../common/context/request-context.interface';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateSocialCreativeProductions1798700000000 } from '../../database/migrations/1798700000000-create-social-creative-productions';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectEvent,
  AgencyTask,
  AgencyTaskAttachment,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskStage,
  AgencyTaskTimeEntry,
  TaskVisibility,
} from '../projects';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import { SocialApprovalTransitionRegistry } from '../social-approvals/approval-transition.port';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from '../social-approvals/entities';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { ApprovalSubjectResolver } from '../social-approvals/subjects/approval-subject-resolver';
import { META_INSTAGRAM_PROFESSIONAL_CAPABILITIES } from '../social-organic/providers/meta/meta-capabilities';
import { DestinationCreativeService } from '../social-organic/publication/destination-creative.service';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialDestinationCreativeEntity,
  SocialPlanEntity,
  type SocialContentPlanningStatus,
} from '../social-planner/entities';
import { SocialContentProductionStatusService } from '../social-planner/services/social-content-production-status.service';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeProductionReadinessService } from './creative-production-readiness.service';
import { CreativeProductionService } from './creative-production.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
  CreativeProductionEntity,
  CreativeProductionEventEntity,
} from './entities';

const run = describePostgresIntegration();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');
const png = () => ({ buffer: PNG, originalname: 'criativo.png', size: 24 });

/**
 * CS5-B against real PostgreSQL: the migration (CHECKs, FKs, guard triggers),
 * and the production flows on top of the REAL owner services — Studio,
 * Approvals (with the transition seam), Planner, Agency Tasks and the
 * destination-creative owner. Only the edges that need a provider or the
 * permission catalog are stubbed.
 *
 * Throwaway schema of the guarded `_test` database (`search_path = <schema>,
 * public`), dropped at the end. No product table is touched.
 */
run('CS5-B creative production (real PostgreSQL)', () => {
  const schema = `cs5b_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const scopeA: CreativeStudioScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientId,
    companyContextId: companyA,
  };
  const scopeB: CreativeStudioScope = { ...scopeA, companyContextId: companyB };
  const agency: CreativeStudioScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };
  const operator = randomUUID();
  const otherUser = randomUUID();
  const clientUser = randomUUID();
  const teamMemberId = randomUUID();
  const organicAssetId = randomUUID();
  const ctx = (userId = operator): RequestContext => ({
    tenantId,
    workspaceId,
    userId,
    role: 'member',
  });

  let db: DataSource;
  let items: Repository<SocialContentItemEntity>;
  let assets: Repository<CreativeAssetEntity>;
  let versions: Repository<CreativeAssetVersionEntity>;
  let requests: Repository<SocialApprovalRequestEntity>;
  let productions: Repository<CreativeProductionEntity>;
  let events: Repository<CreativeProductionEventEntity>;
  let destinationCreatives: Repository<SocialDestinationCreativeEntity>;
  let tasks: Repository<AgencyTask>;
  let approvals: SocialApprovalsService;
  let unobservedApprovals: SocialApprovalsService;
  let assetService: CreativeAssetService;
  let versionApprovals: CreativeVersionApprovalService;
  let production: CreativeProductionService;
  const permissions = {
    can: jest.fn(async (_context: unknown, _key: string) => true),
    assertCan: jest.fn(async () => undefined),
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

  const BASE_TABLES = [
    MediaAssetEntity,
    SocialPlanEntity,
    SocialContentItemEntity,
    SocialContentDestinationEntity,
    SocialDestinationCreativeEntity,
    CreativeFolderEntity,
    CreativeAssetEntity,
    CreativeAssetVersionEntity,
    SocialApprovalRequestEntity,
    SocialApprovalCommentEntity,
    SocialApprovalStageDecisionEntity,
    AgencyProject,
    AgencyProjectEvent,
    AgencyTask,
    AgencyTaskStage,
    AgencyPersonalTaskStage,
    AgencyTaskChecklistItem,
    AgencyTaskAttachment,
    AgencyTaskComment,
    AgencyTaskTimeEntry,
  ];

  beforeAll(async () => {
    const bootstrap = new DataSource(options(BASE_TABLES, `${schema}_boot`));
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.synchronize();
    // What the product migrations add beyond the entity metadata, and that
    // these flows depend on.
    await bootstrap.query(`
      CREATE TABLE agency_client_company_contexts (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
        agency_client_id uuid NOT NULL,
        UNIQUE (id, tenant_id, workspace_id, agency_client_id)
      )`);
    await bootstrap.query(
      `INSERT INTO agency_client_company_contexts VALUES ($1,$3,$4,$5), ($2,$3,$4,$5)`,
      [companyA, companyB, tenantId, workspaceId, clientId],
    );
    await bootstrap.query(`
      CREATE TABLE team_members (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
        user_id uuid, archived_at timestamptz
      )`);
    await bootstrap.query(
      `INSERT INTO team_members VALUES ($1,$2,$3,$4,NULL)`,
      [teamMemberId, tenantId, workspaceId, operator],
    );
    await bootstrap.query(`
      CREATE UNIQUE INDEX "UQ_social_destination_creatives_primary"
        ON social_destination_creatives (destination_id) WHERE role = 'primary'`);
    await bootstrap.query(`
      CREATE UNIQUE INDEX "UQ_social_approval_requests_active_revision"
        ON social_approval_requests (tenant_id, workspace_id, agency_client_id,
          company_context_id, subject_type, subject_id, subject_revision_id)
        WHERE status IN ('draft','awaiting_internal_review','awaiting_client','changes_requested')`);
    // CS5 Closeout (1798800000000): the own scope's active-request index.
    await bootstrap.query(`
      CREATE UNIQUE INDEX "UQ_social_approval_requests_active_revision_own"
        ON social_approval_requests (tenant_id, workspace_id, subject_type,
          subject_id, subject_revision_id)
        WHERE agency_client_id IS NULL AND company_context_id IS NULL
          AND status IN ('draft','awaiting_internal_review','awaiting_client','changes_requested')`);
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialCreativeProductions1798700000000().up(runner);
    await runner.release();
    await bootstrap.destroy();

    db = new DataSource(
      options(
        [
          ...BASE_TABLES,
          CreativeProductionEntity,
          CreativeProductionEventEntity,
        ],
        schema,
      ),
    );
    await db.initialize();
    const plans = db.getRepository(SocialPlanEntity);
    items = db.getRepository(SocialContentItemEntity);
    assets = db.getRepository(CreativeAssetEntity);
    versions = db.getRepository(CreativeAssetVersionEntity);
    requests = db.getRepository(SocialApprovalRequestEntity);
    productions = db.getRepository(CreativeProductionEntity);
    events = db.getRepository(CreativeProductionEventEntity);
    destinationCreatives = db.getRepository(SocialDestinationCreativeEntity);
    tasks = db.getRepository(AgencyTask);
    const media = db.getRepository(MediaAssetEntity);

    const plannerStatus = new SocialContentProductionStatusService(
      items,
      plans,
    );
    const registry = new SocialApprovalTransitionRegistry();
    const resolver = new ApprovalSubjectResolver(
      assets,
      versions,
      plans,
      items,
      {} as never,
    );
    const approvalArgs = [
      requests,
      db.getRepository(SocialApprovalCommentEntity),
      db.getRepository(SocialApprovalStageDecisionEntity),
      db,
      resolver,
    ] as const;
    approvals = new SocialApprovalsService(
      ...approvalArgs,
      undefined,
      registry,
    );
    // Same domain, no observer wired: how a missed transition looks.
    unobservedApprovals = new SocialApprovalsService(...approvalArgs);
    const mediaUpload = {
      upload: jest.fn(async (scope: CreativeStudioScope) =>
        media.save({
          ...scope,
          storagePath: `media-assets/${randomUUID()}.jpg`,
          mimeType: 'image/jpeg',
          byteSize: '1000',
          width: 1080,
          height: 1080,
          source: 'creative_studio',
          metadata: {},
        }),
      ),
      removeAfterFailedConsumerOperation: jest.fn(async () => undefined),
    };
    assetService = new CreativeAssetService(
      assets,
      versions,
      db.getRepository(CreativeFolderEntity),
      items,
      plans,
      db,
      mediaUpload as never,
      {} as never,
      { create: jest.fn(async () => ({ id: randomUUID() })) } as never,
      plannerStatus,
    );
    const readiness = new CreativeProductionReadinessService(
      productions,
      events,
      assets,
      versions,
      media,
      items,
      plans,
      approvals,
      plannerStatus,
      registry,
    );
    readiness.onModuleInit();
    versionApprovals = new CreativeVersionApprovalService(
      assets,
      versions,
      approvals,
      plannerStatus,
      assetService,
      readiness,
    );
    const destinationOwner = new DestinationCreativeService(
      destinationCreatives,
      db.getRepository(SocialContentDestinationEntity),
      items,
      media,
      {
        findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === organicAssetId
            ? {
                id: organicAssetId,
                provider: 'meta',
                assetType: 'instagram_professional',
                status: 'active',
                isPublishEnabled: true,
              }
            : null,
        ),
      } as never,
      {
        has: () => true,
        resolve: () => ({
          capabilities: () => META_INSTAGRAM_PROFESSIONAL_CAPABILITIES,
        }),
      } as never,
    );
    const taskOwner = new TasksCrudService(
      tasks,
      db.getRepository(AgencyProjectEvent),
      db.getRepository(AgencyProject),
      db.getRepository(AgencyTaskStage),
      db.getRepository(AgencyPersonalTaskStage),
      db.getRepository(AgencyTaskAttachment),
      db.getRepository(AgencyTaskChecklistItem),
      db.getRepository(AgencyTaskComment),
      db.getRepository(AgencyTaskTimeEntry),
      {} as never,
      { publishAssigned: jest.fn(async () => undefined) } as never,
    );
    production = new CreativeProductionService(
      productions,
      events,
      assets,
      versions,
      media,
      db.getRepository(SocialContentDestinationEntity),
      destinationCreatives,
      tasks,
      db.getRepository(AgencyTaskChecklistItem),
      db.getRepository(AgencyProject),
      db,
      readiness,
      versionApprovals,
      destinationOwner,
      taskOwner,
      permissions as never,
      assetService,
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(() => {
    permissions.can.mockImplementation(async () => true);
    permissions.assertCan.mockImplementation(async () => undefined);
  });

  // ── Fixtures ────────────────────────────────────────────────────────────

  async function seedItem(
    scope: CreativeStudioScope,
    planningStatus: SocialContentPlanningStatus = 'copy_ready',
  ) {
    const plan = await db.getRepository(SocialPlanEntity).save({
      ...scope,
      title: 'Plano Outubro',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    return items.save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      planId: plan.id,
      title: 'Post de lançamento',
      copy: 'COPY SECRETA DO PLANNER',
      planningStatus,
      plannedDate: '2026-10-20',
      updatedById: null,
    });
  }
  /** Asset produced for the item, with v1 (CS2B.4 moves the item on upload). */
  async function produce(scope: CreativeStudioScope, contentItemId?: string) {
    const asset = await assetService.upload(scope, operator, {
      file: png(),
      contentItemId,
    });
    return { asset, v1: asset.currentVersionId! };
  }
  const newVersion = async (scope: CreativeStudioScope, assetId: string) =>
    (await assetService.createVersion(scope, operator, assetId, png())).id;
  const statusOf = async (id: string) =>
    (await items.findOneByOrFail({ id })).planningStatus;
  const select = (
    scope: CreativeStudioScope,
    itemId: string,
    versionId: string,
  ) => production.selectVersion(ctx(), scope, itemId, versionId);
  const view = (scope: CreativeStudioScope, itemId: string) =>
    production.view(ctx(), scope, itemId);
  async function toClient(scope: CreativeStudioScope, approvalId: string) {
    await approvals.submit(scope, approvalId, operator);
    await approvals.approveInternal(scope, approvalId, operator);
  }
  /** Own scope: send the selection, submit, internal approve (final). */
  async function approveOwn(scope: CreativeStudioScope, itemId: string) {
    const { approvalId } = await production.sendSelectedForApproval(
      ctx(),
      scope,
      itemId,
    );
    await approvals.submit(scope, approvalId, operator);
    await approvals.approveInternal(scope, approvalId, operator);
    return approvalId;
  }
  const MP4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom', 'latin1'),
    Buffer.alloc(12),
  ]);
  const mp4 = () => ({ buffer: MP4, originalname: 'reel.mp4', size: 24 });
  const upload = (
    scope: CreativeStudioScope,
    itemId: string,
    file = png(),
    origin: 'production' | 'planner' = 'production',
  ) => production.uploadAndSelect(ctx(), scope, itemId, file, { origin });
  const clientUserActor = { type: 'user' as const, userId: clientUser };
  async function destination(
    scope: CreativeStudioScope,
    contentItemId: string,
    placement = 'feed',
  ) {
    return db.getRepository(SocialContentDestinationEntity).save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      contentItemId,
      channel: 'instagram',
      placement,
    });
  }
  const eventsOf = async (contentItemId: string) =>
    (
      await events.find({
        where: { contentItemId },
        order: { occurredAt: 'ASC' },
      })
    ).map((event) => event.eventType);
  const code = (error: unknown) =>
    ((error as ConflictException).getResponse() as { code?: string }).code;
  async function expectCode(promise: Promise<unknown>, expected: string) {
    const error = await promise.then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(code(error)).toBe(expected);
  }

  // ── Migration and database guards ──────────────────────────────────────

  describe('migration', () => {
    it('is re-runnable and reversible: up → up → down → up', async () => {
      const runner = db.createQueryRunner();
      const migration = new CreateSocialCreativeProductions1798700000000();
      const count = async (sql: string) =>
        (await runner.query(sql, [schema]))[0].n as number;
      const tables = () =>
        count(`SELECT count(*)::int AS n FROM information_schema.tables
                WHERE table_schema = $1 AND table_name IN
                  ('social_creative_productions', 'social_creative_production_events')`);
      const column = () =>
        count(`SELECT count(*)::int AS n FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = 'social_destination_creatives'
                  AND column_name = 'creative_version_id'`);
      try {
        await runner.startTransaction();
        await migration.up(runner);
        expect(await tables()).toBe(2);
        await migration.down(runner);
        expect(await tables()).toBe(0);
        expect(await column()).toBe(0);
        await migration.up(runner);
        expect(await tables()).toBe(2);
        expect(await column()).toBe(1);
        await runner.commitTransaction();
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    });

    it('refuses rows outside the content item scope, mismatched versions and archived creatives', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      const other = await produce(scopeA);
      const insert = (patch: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          agency_client_id: clientId,
          company_context_id: companyA,
          content_item_id: item.id,
          ...patch,
        };
        const keys = Object.keys(row);
        return db.query(
          `INSERT INTO social_creative_productions (${keys.join(',')})
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
          Object.values(row),
        );
      };
      const at = new Date();
      await expect(
        insert({ company_context_id: companyB }),
      ).rejects.toMatchObject({
        driverError: { constraint: 'TR_social_creative_productions_scope' },
      });
      await expect(
        insert({
          selected_creative_asset_id: other.asset.id,
          selected_version_id: v1,
          selected_at: at,
        }),
      ).rejects.toMatchObject({
        driverError: { constraint: 'TR_social_creative_productions_version' },
      });
      await expect(
        insert({ selected_creative_asset_id: asset.id, selected_at: at }),
      ).rejects.toMatchObject({
        driverError: { constraint: 'CK_social_creative_productions_selection' },
      });
      await assets.update({ id: other.asset.id }, { status: 'archived' });
      await expect(
        insert({
          selected_creative_asset_id: other.asset.id,
          selected_version_id: other.v1,
          selected_at: at,
        }),
      ).rejects.toMatchObject({
        driverError: { constraint: 'TR_social_creative_productions_archived' },
      });
    });

    it('refuses a destination creative whose media is not its version media', async () => {
      const item = await seedItem(agency);
      const { asset, v1 } = await produce(agency, item.id);
      const v2 = await newVersion(agency, asset.id);
      const v2Media = (await versions.findOneByOrFail({ id: v2 })).mediaAssetId;
      const target = await destination(agency, item.id);
      await expect(
        destinationCreatives.insert({
          tenantId,
          workspaceId,
          agencyClientId: null,
          destinationId: target.id,
          contentItemId: item.id,
          mediaAssetId: v2Media,
          creativeVersionId: v1,
          organicAssetId,
        }),
      ).rejects.toMatchObject({
        driverError: {
          constraint: 'TR_social_destination_creatives_version_guard',
        },
      });
    });
  });

  // ── Selection ──────────────────────────────────────────────────────────

  describe('selection', () => {
    it('selects explicitly, replays as a no-op, changes without touching history or versions', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      const before = await view(scopeA, item.id);
      // Nothing is inferred from current_version_id.
      expect(before.selectedCreative).toBeNull();
      expect(before.readiness).toEqual({
        state: 'needs_creative',
        blockers: ['no_creative_selected'],
      });

      const first = await select(scopeA, item.id, v1);
      expect(first.changed).toBe(true);
      expect(first.production.selectedCreative).toMatchObject({
        assetId: asset.id,
        versionId: v1,
        versionNumber: 1,
        isAssetCurrentVersion: true,
        selectedById: operator,
      });
      expect(first.production.readiness).toEqual({
        state: 'needs_approval',
        blockers: ['approval_not_sent'],
      });
      // Selecting never sends to approval.
      expect(await requests.countBy({ subjectRevisionId: v1 })).toBe(0);

      expect((await select(scopeA, item.id, v1)).changed).toBe(false);

      const v2 = await newVersion(scopeA, asset.id);
      // The asset moved on; the selection did not.
      expect((await view(scopeA, item.id)).selectedCreative?.versionId).toBe(
        v1,
      );
      const changed = await select(scopeA, item.id, v2);
      expect(changed.production.selectedCreative?.versionId).toBe(v2);
      expect(await eventsOf(item.id)).toEqual([
        'social.creative.version.selected',
        'social.creative.version.selected',
      ]);
      const last = await events.findOneOrFail({
        where: { contentItemId: item.id, creativeVersionId: v2 },
      });
      expect(last.payload).toMatchObject({ previousVersionId: v1 });
      await expect(versions.findOneByOrFail({ id: v1 })).resolves.toMatchObject(
        { versionNumber: 1, creativeAssetId: asset.id },
      );
    });

    it('treats another company, an unknown version and a foreign content item as not found', async () => {
      const item = await seedItem(scopeA);
      const { v1 } = await produce(scopeA, item.id);
      const itemB = await seedItem(scopeB);
      await expect(select(scopeB, itemB.id, v1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(select(scopeB, item.id, v1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(view(scopeB, item.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        select(scopeA, item.id, randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await productions.countBy({ contentItemId: itemB.id })).toBe(0);
    });

    it('refuses archived creatives and creatives produced for another item', async () => {
      const item = await seedItem(scopeA);
      const otherItem = await seedItem(scopeA);
      const foreign = await produce(scopeA, otherItem.id);
      await expectCode(
        select(scopeA, item.id, foreign.v1),
        'creative_linked_to_other_content',
      );
      const archived = await produce(scopeA);
      await assetService.archive(scopeA, archived.asset.id);
      await expectCode(
        select(scopeA, item.id, archived.v1),
        'creative_archived',
      );
      // A library asset with no content link may be selected.
      const library = await produce(scopeA);
      await expect(select(scopeA, item.id, library.v1)).resolves.toMatchObject({
        changed: true,
      });
    });

    it('own scope (agency or B2B for itself) needs the internal approval only: sent → internal approved → ready', async () => {
      const item = await seedItem(agency);
      const { v1 } = await produce(agency, item.id);
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      const result = await select(agency, item.id, v1);
      expect(result.production.approval).toMatchObject({
        required: true,
        scopeKind: 'own',
        stages: ['internal'],
        state: 'not_sent',
      });
      expect(result.production.readiness).toEqual({
        state: 'needs_approval',
        blockers: ['approval_not_sent'],
      });
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      const { approvalId } = await production.sendSelectedForApproval(
        ctx(),
        agency,
        item.id,
      );
      expect(await statusOf(item.id)).toBe('creative_ready');
      await approvals.submit(agency, approvalId, operator);
      let state = await view(agency, item.id);
      expect(state.approval).toMatchObject({
        state: 'pending',
        status: 'awaiting_internal_review',
        currentStage: 'internal',
      });
      expect(state.readiness.state).toBe('creative_ready');
      await approvals.approveInternal(agency, approvalId, operator);
      state = await view(agency, item.id);
      // Final at the internal stage: never `awaiting_client`.
      expect(state.approval).toMatchObject({
        state: 'approved',
        status: 'approved',
        currentStage: 'internal',
        sentToClientAt: null,
      });
      expect(state.readiness).toEqual({ state: 'ready', blockers: [] });
      expect(await statusOf(item.id)).toBe('ready');
    });

    it('managed client: internal approval alone is not ready; the client approval is', async () => {
      const item = await seedItem(scopeA);
      const { v1 } = await produce(scopeA, item.id);
      const selected = await select(scopeA, item.id, v1);
      expect(selected.production.approval).toMatchObject({
        scopeKind: 'managed_client',
        stages: ['internal', 'client'],
      });
      const { approvalId } = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, approvalId);
      const atClient = await view(scopeA, item.id);
      expect(atClient.approval).toMatchObject({
        state: 'pending',
        status: 'awaiting_client',
        currentStage: 'client',
      });
      expect(atClient.readiness.state).toBe('creative_ready');
      expect(await statusOf(item.id)).toBe('creative_ready');
      await approvals.clientApprove(scopeA, approvalId, clientUserActor);
      expect((await view(scopeA, item.id)).readiness.state).toBe('ready');
      expect(await statusOf(item.id)).toBe('ready');
    });

    it('own scope: V1 approved → V2 selected needs a new internal approval', async () => {
      const item = await seedItem(agency);
      const { asset, v1 } = await produce(agency, item.id);
      await select(agency, item.id, v1);
      await approveOwn(agency, item.id);
      expect(await statusOf(item.id)).toBe('ready');
      const v2 = await newVersion(agency, asset.id);
      await select(agency, item.id, v2);
      expect((await view(agency, item.id)).readiness.state).toBe(
        'needs_approval',
      );
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      await approveOwn(agency, item.id);
      expect(await statusOf(item.id)).toBe('ready');
    });

    it('never moves a Planner item whose copy is not ready', async () => {
      const item = await seedItem(agency, 'copy_in_progress');
      const { v1 } = await produce(agency, item.id);
      await select(agency, item.id, v1);
      expect(await statusOf(item.id)).toBe('copy_in_progress');
    });

    it('serializes concurrent selections: the last committed wins, both are recorded', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      const v2 = await newVersion(scopeA, asset.id);
      await Promise.all([
        select(scopeA, item.id, v1),
        select(scopeA, item.id, v2),
      ]);
      const row = await productions.findOneByOrFail({ contentItemId: item.id });
      const history = await events.find({
        where: {
          contentItemId: item.id,
          eventType: 'social.creative.version.selected',
        },
        order: { occurredAt: 'ASC' },
      });
      expect(await productions.countBy({ contentItemId: item.id })).toBe(1);
      expect(history).toHaveLength(2);
      expect(row.selectedVersionId).toBe(history[1].creativeVersionId);
    });
  });

  // ── Approval ───────────────────────────────────────────────────────────

  describe('approval', () => {
    it('sends the selected version once, even under a double send', async () => {
      const item = await seedItem(scopeA);
      const { v1 } = await produce(scopeA, item.id);
      await select(scopeA, item.id, v1);
      const [a, b] = await Promise.all([
        production.sendSelectedForApproval(ctx(), scopeA, item.id),
        production.sendSelectedForApproval(ctx(), scopeA, item.id),
      ]);
      expect(a.approvalId).toBe(b.approvalId);
      expect([a.changed, b.changed].sort()).toEqual([false, true]);
      expect(await requests.countBy({ subjectRevisionId: v1 })).toBe(1);
      const after = await view(scopeA, item.id);
      expect(after.approval).toMatchObject({
        required: true,
        state: 'pending',
        status: 'draft',
      });
      expect(after.readiness).toEqual({
        state: 'creative_ready',
        blockers: ['approval_pending'],
      });
      expect(await statusOf(item.id)).toBe('creative_ready');
      expect(
        (await eventsOf(item.id)).filter(
          (type) => type === 'social.creative.sent_for_approval',
        ),
      ).toHaveLength(1);
    });

    it('approval of the selected version makes it ready and the Planner reaches ready through the seam', async () => {
      const item = await seedItem(scopeA);
      const { v1 } = await produce(scopeA, item.id);
      await select(scopeA, item.id, v1);
      const { approvalId } = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, approvalId);
      expect(await statusOf(item.id)).toBe('creative_ready');
      await approvals.clientApprove(scopeA, approvalId, clientUserActor);
      expect(await statusOf(item.id)).toBe('ready');
      const after = await view(scopeA, item.id);
      expect(after.readiness).toEqual({ state: 'ready', blockers: [] });
      expect(after.approval).toMatchObject({ state: 'approved', approvalId });
      // A second send is an idempotent read of the approved request.
      await expect(
        production.sendSelectedForApproval(ctx(), scopeA, item.id),
      ).resolves.toMatchObject({ changed: false, approvalId });
    });

    it('closes the revision loop: A changes_requested → B revision → B selected and sent → B approved; A intact', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      await select(scopeA, item.id, v1);
      const a = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, a.approvalId);
      await approvals.clientRequestChanges(
        scopeA,
        a.approvalId,
        clientUserActor,
        'Trocar a cor do fundo.',
      );
      let state = await view(scopeA, item.id);
      expect(state.readiness).toEqual({
        state: 'changes_requested',
        blockers: ['changes_requested'],
      });
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      await expectCode(
        production.sendSelectedForApproval(ctx(), scopeA, item.id),
        'revision_required',
      );

      // CS2B.6 revision: provenance through the approval chain of the asset.
      const v2 = (
        await versionApprovals.startRevision(
          scopeA,
          operator,
          asset.id,
          v1,
          png(),
        )
      ).id;
      // The revision is not selected by itself.
      expect((await view(scopeA, item.id)).selectedCreative?.versionId).toBe(
        v1,
      );
      await select(scopeA, item.id, v2);
      state = await view(scopeA, item.id);
      expect(state.readiness.state).toBe('needs_approval');
      expect(state.selectedCreative?.isAssetCurrentVersion).toBe(true);

      const b = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await expect(
        requests.findOneByOrFail({ id: a.approvalId }),
      ).resolves.toMatchObject({ subjectRevisionId: v1, status: 'superseded' });
      await toClient(scopeA, b.approvalId);
      await approvals.clientApprove(scopeA, b.approvalId, clientUserActor);
      expect((await view(scopeA, item.id)).readiness.state).toBe('ready');
      expect(await statusOf(item.id)).toBe('ready');
      // A is still attached to v1, never mutated into an approval of v2.
      await expect(
        requests.findOneByOrFail({ id: a.approvalId }),
      ).resolves.toMatchObject({ subjectRevisionId: v1, status: 'superseded' });
    });

    it('approving v1 while v2 is selected never approves v2', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      await select(scopeA, item.id, v1);
      const a = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, a.approvalId);
      const v2 = await newVersion(scopeA, asset.id);
      await select(scopeA, item.id, v2);
      // The selected version is not in approval: "Em aprovação" is withdrawn.
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      await approvals.clientApprove(scopeA, a.approvalId, clientUserActor);
      await expect(
        requests.findOneByOrFail({ id: a.approvalId }),
      ).resolves.toMatchObject({ status: 'approved', subjectRevisionId: v1 });
      const state = await view(scopeA, item.id);
      expect(state.approval.state).toBe('not_sent');
      expect(state.readiness.state).toBe('needs_approval');
      expect(await statusOf(item.id)).toBe('creative_in_progress');
    });

    it('the CS2B asset-level send follows the selection and never fails on deleted content', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      const v2 = await newVersion(scopeA, asset.id);
      await select(scopeA, item.id, v2);
      // Sending a version that is NOT the selection claims nothing.
      await versionApprovals.sendForApproval(scopeA, operator, asset.id, v1);
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      expect((await view(scopeA, item.id)).approval.state).toBe('not_sent');

      await items.update({ id: item.id }, { deletedAt: new Date() });
      await expect(
        versionApprovals.sendForApproval(scopeA, operator, asset.id, v2),
      ).resolves.toMatchObject({ status: 'draft', subjectRevisionId: v2 });
    });

    it('reconciles a missed approval transition from the owners', async () => {
      const item = await seedItem(scopeA);
      const { v1 } = await produce(scopeA, item.id);
      await select(scopeA, item.id, v1);
      const a = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await unobservedApprovals.submit(scopeA, a.approvalId, operator);
      await unobservedApprovals.approveInternal(scopeA, a.approvalId, operator);
      await unobservedApprovals.clientApprove(
        scopeA,
        a.approvalId,
        clientUserActor,
      );
      // The projection is right on read; only the Planner missed it.
      expect((await view(scopeA, item.id)).readiness.state).toBe('ready');
      expect(await statusOf(item.id)).toBe('creative_ready');
      const result = await production.reconcile(ctx(), scopeA, item.id);
      expect(result.plannerTransition).toEqual({
        from: 'creative_ready',
        to: 'ready',
      });
      expect(await statusOf(item.id)).toBe('ready');
      expect((await production.reconcile(ctx(), scopeA, item.id)).changed).toBe(
        false,
      );
    });
  });

  // ── Agency work ────────────────────────────────────────────────────────

  describe('tasks', () => {
    async function task(patch: Partial<AgencyTask> = {}) {
      return tasks.save({
        tenantId,
        workspaceId,
        clientId,
        createdById: operator,
        title: 'Design',
        visibility: TaskVisibility.Workspace,
        ...patch,
      });
    }

    it('links an existing task of the same client, replays, and shows a deleted task as missing', async () => {
      const item = await seedItem(scopeA);
      const design = await task();
      const linked = await production.linkTask(ctx(), scopeA, item.id, {
        taskId: design.id,
      });
      expect(linked.production.operationalWork).toMatchObject({
        state: 'linked',
        linkKind: 'linked',
        taskId: design.id,
        task: { id: design.id, title: 'Design' },
      });
      expect(
        (
          await production.linkTask(ctx(), scopeA, item.id, {
            taskId: design.id,
          })
        ).changed,
      ).toBe(false);
      // The task owner deletes it permanently: a dangling link, not a cascade.
      await tasks.delete({ id: design.id });
      expect((await view(scopeA, item.id)).operationalWork.state).toBe(
        'missing',
      );
      const unlinked = await production.unlinkTask(ctx(), scopeA, item.id);
      expect(unlinked.production.operationalWork.state).toBe('none');
    });

    it('links a subtask only under its own task, through the project client when the task has none', async () => {
      const item = await seedItem(scopeA);
      const project = await db.getRepository(AgencyProject).save({
        tenantId,
        workspaceId,
        clientId,
        name: 'Planejamento Outubro',
      });
      const editing = await task({
        clientId: null,
        projectId: project.id,
        title: 'Edição',
      });
      const otherTask = await task();
      const checklist = db.getRepository(AgencyTaskChecklistItem);
      const subtask = await checklist.save({
        tenantId,
        workspaceId,
        taskId: editing.id,
        title: 'Reel',
      });
      await expect(
        production.linkTask(ctx(), scopeA, item.id, {
          taskId: otherTask.id,
          subtaskId: subtask.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const linked = await production.linkTask(ctx(), scopeA, item.id, {
        taskId: editing.id,
        subtaskId: subtask.id,
      });
      expect(linked.production.operationalWork).toMatchObject({
        state: 'linked',
        projectId: project.id,
        subtask: { id: subtask.id, title: 'Reel' },
      });
    });

    it('hides tasks of another client, private tasks of others and archived tasks', async () => {
      const item = await seedItem(scopeA);
      for (const hidden of [
        await task({ clientId: otherClientId }),
        await task({
          visibility: TaskVisibility.Private,
          createdById: otherUser,
        }),
        await task({ archivedAt: new Date() }),
      ])
        await expect(
          production.linkTask(ctx(), scopeA, item.id, { taskId: hidden.id }),
        ).rejects.toBeInstanceOf(NotFoundException);
      // Refused before any write: not even the production row exists.
      expect(
        await productions.findOneBy({ contentItemId: item.id }),
      ).toBeNull();
    });

    it('creates one task through the Agency owner, explicit and idempotent under a double click', async () => {
      const item = await seedItem(scopeA);
      const [a, b] = await Promise.all([
        production.createTask(ctx(), scopeA, item.id, {
          dueDate: '2026-10-15T12:00:00.000Z',
          assigneeId: teamMemberId,
        }),
        production.createTask(ctx(), scopeA, item.id, {
          dueDate: '2026-10-15T12:00:00.000Z',
          assigneeId: teamMemberId,
        }),
      ]);
      expect(a.taskId).toBe(b.taskId);
      const created = await tasks.findBy({
        tenantId,
        title: 'Produção criativa: Post de lançamento',
      });
      expect(created).toHaveLength(1);
      // The Agency owner keeps the team-member id it was given.
      expect(created[0]).toMatchObject({
        clientId,
        assigneeId: teamMemberId,
        createdById: operator,
      });
      // Explicit due date only; context and links, never the Planner copy.
      expect(created[0].dueDate?.toISOString()).toBe(
        '2026-10-15T12:00:00.000Z',
      );
      expect(created[0].description).toContain(
        `/social/planner/content/${item.id}`,
      );
      expect(created[0].description).not.toContain('COPY SECRETA');
      expect(
        (await production.createTask(ctx(), scopeA, item.id, {})).changed,
      ).toBe(false);
      expect((await view(scopeA, item.id)).operationalWork).toMatchObject({
        state: 'linked',
        linkKind: 'created',
      });
    });

    it('refuses an unknown assignee, a project of another client and a missing Agency permission', async () => {
      const item = await seedItem(scopeA);
      await expect(
        production.createTask(ctx(), scopeA, item.id, {
          assigneeId: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const foreign = await db.getRepository(AgencyProject).save({
        tenantId,
        workspaceId,
        clientId: otherClientId,
        name: 'Outro',
      });
      await expect(
        production.createTask(ctx(), scopeA, item.id, {
          projectId: foreign.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      permissions.assertCan.mockImplementation(async () => {
        throw new ForbiddenException();
      });
      await expect(
        production.createTask(ctx(), scopeA, item.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        await productions.findOneBy({ contentItemId: item.id }),
      ).toBeNull();
    });
  });

  // ── CS5 Closeout: the production 404 on task link ──────────────────────

  describe('task 404 (CS5 Closeout validation)', () => {
    /**
     * Exactly the production data shape: own-scope content (agency producing
     * for itself) in a workspace whose only live tasks sit in CLIENT projects
     * (task.client_id NULL, project.client_id set). The old picker listed
     * them all; linking any of them was a correct 404.
     */
    async function workspace() {
      const projects = db.getRepository(AgencyProject);
      const clientProject = await projects.save({
        tenantId,
        workspaceId,
        clientId,
        name: 'Projeto do cliente',
      });
      const ownProject = await projects.save({
        tenantId,
        workspaceId,
        clientId: null,
        name: 'Marketing da agência',
      });
      const base = {
        tenantId,
        workspaceId,
        createdById: operator,
        visibility: TaskVisibility.Workspace,
      };
      const clientTask = await tasks.save({
        ...base,
        clientId: null,
        projectId: clientProject.id,
        title: 'Arte do cliente',
      });
      const ownTask = await tasks.save({
        ...base,
        clientId: null,
        projectId: ownProject.id,
        title: 'Arte da agência',
      });
      const looseOwnTask = await tasks.save({
        ...base,
        clientId: null,
        projectId: null,
        title: 'Arte avulsa',
      });
      const othersPrivate = await tasks.save({
        ...base,
        clientId: null,
        projectId: null,
        title: 'Arte privada',
        visibility: TaskVisibility.Private,
        createdById: otherUser,
      });
      return {
        clientProject,
        ownProject,
        clientTask,
        ownTask,
        looseOwnTask,
        othersPrivate,
      };
    }

    it('reproduces it: a client-project task is never linkable to own content, and is no longer offered', async () => {
      const item = await seedItem(agency);
      const w = await workspace();
      // The failure seen in production, unchanged: the scope is NOT relaxed.
      const refused = await production
        .linkTask(ctx(), agency, item.id, { taskId: w.clientTask.id })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refused).toBeInstanceOf(NotFoundException);
      expect((refused as NotFoundException).getResponse()).toMatchObject({
        code: 'task_not_found',
      });

      // The cause: what the picker offers now comes from the link's own rule.
      const offered = (
        await production.taskCandidates(ctx(), agency, item.id, {})
      ).items;
      const offeredIds = offered.map((task) => task.id);
      expect(offeredIds).toEqual(
        expect.arrayContaining([w.ownTask.id, w.looseOwnTask.id]),
      );
      expect(offeredIds).not.toContain(w.clientTask.id);
      expect(offeredIds).not.toContain(w.othersPrivate.id);
      expect(offered.find((task) => task.id === w.ownTask.id)).toMatchObject({
        projectId: w.ownProject.id,
        projectName: 'Marketing da agência',
      });
      // Everything offered links.
      for (const taskId of offeredIds)
        await expect(
          production.linkTask(ctx(), agency, item.id, { taskId }),
        ).resolves.toMatchObject({
          production: { operationalWork: { state: 'linked', taskId } },
        });
      await expect(
        production.taskCandidates(ctx(), agency, item.id, {
          search: 'avulsa',
        }),
      ).resolves.toEqual({
        items: [expect.objectContaining({ id: w.looseOwnTask.id })],
      });
    });

    it('client content is offered (and links) its client tasks only; projects follow the same rule', async () => {
      const item = await seedItem(scopeA);
      const w = await workspace();
      const offered = (
        await production.taskCandidates(ctx(), scopeA, item.id, { limit: 50 })
      ).items.map((task) => task.id);
      expect(offered).toContain(w.clientTask.id);
      expect(offered).not.toContain(w.ownTask.id);
      expect(offered).not.toContain(w.looseOwnTask.id);
      await expect(
        production.linkTask(ctx(), scopeA, item.id, { taskId: w.ownTask.id }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const ownItem = await seedItem(agency);
      const projectsFor = async (scope: CreativeStudioScope, itemId: string) =>
        (
          await production.projectCandidates(scope, itemId, { limit: 50 })
        ).items.map((project) => project.id);
      expect(await projectsFor(agency, ownItem.id)).toContain(w.ownProject.id);
      expect(await projectsFor(agency, ownItem.id)).not.toContain(
        w.clientProject.id,
      );
      expect(await projectsFor(scopeA, item.id)).toContain(w.clientProject.id);
      // Creating under a project of the wrong scope is the same 404.
      await expect(
        production.createTask(ctx(), agency, ownItem.id, {
          projectId: w.clientProject.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        production.createTask(ctx(), agency, ownItem.id, {
          projectId: w.ownProject.id,
        }),
      ).resolves.toMatchObject({ changed: true });
      // Candidates of another company's item: 404, nothing listed.
      await expect(
        production.taskCandidates(ctx(), scopeB, item.id, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── CS5 Closeout: upload from Production / Planner replacement ─────────

  describe('upload and select', () => {
    it('uploads through the Studio owner, creates the version and selects it explicitly', async () => {
      const item = await seedItem(scopeA);
      const first = await upload(scopeA, item.id);
      const asset = await assets.findOneByOrFail({ id: first.creativeAssetId });
      expect(asset).toMatchObject({
        contentItemId: item.id,
        currentVersionId: first.versionId,
        sourceType: 'upload',
      });
      expect(first.production.selectedCreative).toMatchObject({
        assetId: asset.id,
        versionId: first.versionId,
        versionNumber: 1,
      });
      expect(first.production.readiness.state).toBe('needs_approval');
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      const selected = await events.findOneByOrFail({
        contentItemId: item.id,
        eventType: 'social.creative.version.selected',
      });
      expect(selected.payload).toMatchObject({
        via: 'upload',
        origin: 'production',
        previousVersionId: null,
      });
      // Never sent to approval by itself.
      expect(
        await requests.countBy({ subjectRevisionId: first.versionId }),
      ).toBe(0);

      // A second image becomes v2 of the same item asset, selected.
      const second = await upload(scopeA, item.id);
      expect(second.creativeAssetId).toBe(asset.id);
      expect(second.production.selectedCreative).toMatchObject({
        versionNumber: 2,
        versionId: second.versionId,
      });
      // A video cannot be a version of an image: a new asset of the item.
      const video = await upload(scopeA, item.id, mp4());
      expect(video.creativeAssetId).not.toBe(asset.id);
      expect(video.production.selectedCreative).toMatchObject({
        mediaType: 'video',
        versionNumber: 1,
      });
    });

    it('never versions a reused library asset, refuses archived content, missing permission and another company', async () => {
      const item = await seedItem(scopeA);
      const library = await produce(scopeA);
      await select(scopeA, item.id, library.v1);
      const uploaded = await upload(scopeA, item.id);
      expect(uploaded.creativeAssetId).not.toBe(library.asset.id);
      expect(
        await versions.countBy({ creativeAssetId: library.asset.id }),
      ).toBe(1);

      await expect(upload(scopeB, item.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      permissions.assertCan.mockImplementation(async () => {
        throw new ForbiddenException();
      });
      const before = await assets.countBy({ contentItemId: item.id });
      await expect(upload(scopeA, item.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(await assets.countBy({ contentItemId: item.id })).toBe(before);
      permissions.assertCan.mockImplementation(async () => undefined);
      await items.update({ id: item.id }, { archivedAt: new Date() });
      await expectCode(upload(scopeA, item.id), 'content_archived');
    });

    it('§17 Planner replacement: A selected/approved/handed off → B uploaded → B selected, A historical, destination stays A', async () => {
      const item = await seedItem(scopeA);
      const feed = await destination(scopeA, item.id);
      const a = await upload(scopeA, item.id);
      const sentA = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, sentA.approvalId);
      await approvals.clientApprove(scopeA, sentA.approvalId, clientUserActor);
      await production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
        organicAssetId,
      });
      expect(await statusOf(item.id)).toBe('ready');

      const b = await upload(scopeA, item.id, png(), 'planner');
      expect(b.versionId).not.toBe(a.versionId);
      // B is the explicit selection, recorded as the Planner's act.
      expect(b.production.selectedCreative?.versionId).toBe(b.versionId);
      const replaced = await events.findOneByOrFail({
        contentItemId: item.id,
        creativeVersionId: b.versionId,
        eventType: 'social.creative.version.selected',
      });
      expect(replaced.payload).toMatchObject({
        origin: 'planner',
        via: 'upload',
        previousVersionId: a.versionId,
      });
      // B needs its own approval; the Planner goes back to production.
      expect(b.production.readiness).toEqual({
        state: 'needs_approval',
        blockers: ['approval_not_sent'],
      });
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      // A is history: its version and approval are intact.
      await expect(
        versions.findOneByOrFail({ id: a.versionId }),
      ).resolves.toMatchObject({ versionNumber: 1 });
      await expect(
        requests.findOneByOrFail({ id: sentA.approvalId }),
      ).resolves.toMatchObject({
        status: 'approved',
        subjectRevisionId: a.versionId,
      });
      // The destination keeps A until an explicit handoff of approved B.
      expect(b.production.destinations[0]).toMatchObject({
        handoff: 'other_version',
        creatives: [{ creativeVersionId: a.versionId }],
      });
      await expectCode(
        production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
          organicAssetId,
          replaceExisting: true,
        }),
        'creative_not_ready',
      );
      const sentB = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, sentB.approvalId);
      await approvals.clientApprove(scopeA, sentB.approvalId, clientUserActor);
      await production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
        organicAssetId,
        replaceExisting: true,
      });
      expect(
        (await destinationCreatives.findOneByOrFail({ destinationId: feed.id }))
          .creativeVersionId,
      ).toBe(b.versionId);
    });
  });

  // ── Destination handoff (and the Campaigns path through it) ────────────

  describe('destination handoff', () => {
    it('hands the exact immutable version off, idempotently, and never follows a newer version', async () => {
      const item = await seedItem(agency);
      const { asset, v1 } = await produce(agency, item.id);
      const feed = await destination(agency, item.id);
      await expectCode(
        production.handoffToDestination(ctx(), agency, item.id, feed.id, {
          organicAssetId,
        }),
        'no_creative_selected',
      );
      await select(agency, item.id, v1);
      await approveOwn(agency, item.id);

      const [first, second] = await Promise.all([
        production.handoffToDestination(ctx(), agency, item.id, feed.id, {
          organicAssetId,
        }),
        production.handoffToDestination(ctx(), agency, item.id, feed.id, {
          organicAssetId,
        }),
      ]);
      expect([first.changed, second.changed].sort()).toEqual([false, true]);
      expect(first.destinationCreative.id).toBe(second.destinationCreative.id);
      const v1Media = (await versions.findOneByOrFail({ id: v1 })).mediaAssetId;
      const rows = await destinationCreatives.findBy({
        destinationId: feed.id,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        creativeVersionId: v1,
        mediaAssetId: v1Media,
        source: 'creative_studio',
        role: 'primary',
      });

      const v2 = await newVersion(agency, asset.id);
      await select(agency, item.id, v2);
      await approveOwn(agency, item.id);
      let state = await view(agency, item.id);
      // The destination keeps v1; only an explicit handoff moves it.
      expect(state.destinations[0]).toMatchObject({
        handoff: 'other_version',
        creatives: [{ creativeVersionId: v1 }],
      });
      await expectCode(
        production.handoffToDestination(ctx(), agency, item.id, feed.id, {
          organicAssetId,
        }),
        'destination_has_creative',
      );
      await production.handoffToDestination(ctx(), agency, item.id, feed.id, {
        organicAssetId,
        replaceExisting: true,
      });
      state = await view(agency, item.id);
      expect(state.destinations[0]).toMatchObject({
        handoff: 'selected_version',
        creatives: [{ creativeVersionId: v2 }],
      });
      expect(await eventsOf(item.id)).toContain(
        'social.creative.destination.linked',
      );
      expect(
        state.availableActions.find((a) => a.action === 'handoff_to_campaigns'),
      ).toEqual({
        action: 'handoff_to_campaigns',
        allowed: false,
        reason: 'campaigns_consume_publications',
      });
    });

    it('requires readiness, respects placement capability and the item boundary', async () => {
      const item = await seedItem(scopeA);
      const { v1 } = await produce(scopeA, item.id);
      const feed = await destination(scopeA, item.id);
      const reel = await destination(scopeA, item.id, 'reel');
      await select(scopeA, item.id, v1);
      await expectCode(
        production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
          organicAssetId,
        }),
        'creative_not_ready',
      );
      const a = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, a.approvalId);
      await approvals.clientApprove(scopeA, a.approvalId, clientUserActor);
      // An image cannot go to a Reel placement: the owner decides.
      await expect(
        production.handoffToDestination(ctx(), scopeA, item.id, reel.id, {
          organicAssetId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const otherItem = await seedItem(scopeA);
      const foreign = await destination(scopeA, otherItem.id);
      await expect(
        production.handoffToDestination(ctx(), scopeA, item.id, foreign.id, {
          organicAssetId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
          organicAssetId,
        }),
      ).resolves.toMatchObject({ changed: true });
    });

    it('§40: V1 approved and handed off, V2 created afterwards — V1 stays everywhere until V2 is approved and handed off', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      const feed = await destination(scopeA, item.id);
      await select(scopeA, item.id, v1);
      const a = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, a.approvalId);
      await approvals.clientApprove(scopeA, a.approvalId, clientUserActor);
      await production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
        organicAssetId,
      });
      const v2 = await newVersion(scopeA, asset.id);
      await select(scopeA, item.id, v2);
      const state = await view(scopeA, item.id);
      expect(state.readiness).toEqual({
        state: 'needs_approval',
        blockers: ['approval_not_sent'],
      });
      // Since CS5, `ready` means the SELECTED version is final: it follows V2.
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      expect(state.destinations[0].handoff).toBe('other_version');
      await expectCode(
        production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
          organicAssetId,
          replaceExisting: true,
        }),
        'creative_not_ready',
      );
      await expect(
        requests.findOneByOrFail({ id: a.approvalId }),
      ).resolves.toMatchObject({ status: 'approved', subjectRevisionId: v1 });
      const b = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      expect(await statusOf(item.id)).toBe('creative_ready');
      await toClient(scopeA, b.approvalId);
      await approvals.clientApprove(scopeA, b.approvalId, clientUserActor);
      expect(await statusOf(item.id)).toBe('ready');
      expect(await eventsOf(item.id)).toEqual(
        expect.arrayContaining(['social.creative.planner.reflected']),
      );
      await production.handoffToDestination(ctx(), scopeA, item.id, feed.id, {
        organicAssetId,
        replaceExisting: true,
      });
      expect(
        (await destinationCreatives.findOneByOrFail({ destinationId: feed.id }))
          .creativeVersionId,
      ).toBe(v2);
      // v1's approval is history, intact.
      await expect(
        requests.findOneByOrFail({ id: a.approvalId }),
      ).resolves.toMatchObject({ status: 'approved', subjectRevisionId: v1 });
    });
    it('V1 approved → V2 selected → V2 changes_requested → V3 approved: ready follows the selection', async () => {
      const item = await seedItem(scopeA);
      const { asset, v1 } = await produce(scopeA, item.id);
      await select(scopeA, item.id, v1);
      const a = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, a.approvalId);
      await approvals.clientApprove(scopeA, a.approvalId, clientUserActor);
      expect(await statusOf(item.id)).toBe('ready');

      const v2 = await newVersion(scopeA, asset.id);
      await select(scopeA, item.id, v2);
      expect(await statusOf(item.id)).toBe('creative_in_progress');
      const b = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      expect(await statusOf(item.id)).toBe('creative_ready');
      await toClient(scopeA, b.approvalId);
      await approvals.clientRequestChanges(
        scopeA,
        b.approvalId,
        clientUserActor,
        'Ajustar o texto da arte.',
      );
      expect(await statusOf(item.id)).toBe('creative_in_progress');

      const v3 = (
        await versionApprovals.startRevision(
          scopeA,
          operator,
          asset.id,
          v2,
          png(),
        )
      ).id;
      await select(scopeA, item.id, v3);
      const c = await production.sendSelectedForApproval(
        ctx(),
        scopeA,
        item.id,
      );
      await toClient(scopeA, c.approvalId);
      await approvals.clientApprove(scopeA, c.approvalId, clientUserActor);
      expect(await statusOf(item.id)).toBe('ready');
      // Re-selecting the historically approved V1 is final again, untouched.
      await select(scopeA, item.id, v1);
      expect(await statusOf(item.id)).toBe('ready');
      await expect(
        requests.findOneByOrFail({ id: a.approvalId }),
      ).resolves.toMatchObject({ status: 'approved', subjectRevisionId: v1 });
    });
  });

  // ── Archive guard ──────────────────────────────────────────────────────

  describe('archive guard', () => {
    it('blocks archiving the selected creative until the selection changes', async () => {
      const item = await seedItem(agency);
      const { asset, v1 } = await produce(agency, item.id);
      await select(agency, item.id, v1);
      await expectCode(
        assetService.archive(agency, asset.id),
        'creative_selected_for_content',
      );
      await production.clearSelection(ctx(), agency, item.id);
      await expect(
        assetService.archive(agency, asset.id),
      ).resolves.toMatchObject({ status: 'archived' });
      expect(await eventsOf(item.id)).toContain(
        'social.creative.selection.cleared',
      );
    });

    it('archive and select racing: exactly one wins, never an archived selection', async () => {
      const item = await seedItem(agency);
      const { asset, v1 } = await produce(agency, item.id);
      const [archived, selected] = await Promise.allSettled([
        assetService.archive(agency, asset.id),
        select(agency, item.id, v1),
      ]);
      const assetRow = await assets.findOneByOrFail({ id: asset.id });
      const row = await productions.findOneBy({ contentItemId: item.id });
      if (archived.status === 'fulfilled') {
        expect(selected.status).toBe('rejected');
        expect(row?.selectedVersionId ?? null).toBeNull();
      } else {
        expect(selected.status).toBe('fulfilled');
        expect(assetRow.status).toBe('ready');
        expect(row?.selectedVersionId).toBe(v1);
      }
    });

    it('reads a selection whose binary disappeared as unavailable', async () => {
      const item = await seedItem(agency);
      const { v1 } = await produce(agency, item.id);
      await select(agency, item.id, v1);
      const mediaId = (await versions.findOneByOrFail({ id: v1 })).mediaAssetId;
      await db.getRepository(MediaAssetEntity).softDelete({ id: mediaId });
      const state = await view(agency, item.id);
      expect(state.selectedCreative).toMatchObject({
        available: false,
        unavailableReason: 'media_unavailable',
      });
      expect(state.readiness).toEqual({
        state: 'needs_creative',
        blockers: ['selected_version_unavailable'],
      });
      await expect(
        production.handoffToDestination(ctx(), agency, item.id, randomUUID(), {
          organicAssetId,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('available actions', () => {
    it('reflect permissions and state', async () => {
      const item = await seedItem(scopeA);
      const { v1 } = await produce(scopeA, item.id);
      await select(scopeA, item.id, v1);
      permissions.can.mockImplementation(
        async (_: unknown, key: string) =>
          key !== 'agency.tasks.task.create.assigned',
      );
      const actions = Object.fromEntries(
        (await view(scopeA, item.id)).availableActions.map((a) => [
          a.action,
          a.reason,
        ]),
      );
      expect(actions).toMatchObject({
        select_creative: null,
        send_for_approval: null,
        create_task: 'forbidden',
        unlink_task: 'no_task_linked',
        handoff_to_publishing: 'creative_not_ready',
        handoff_to_campaigns: 'campaigns_consume_publications',
      });
    });
  });
});
