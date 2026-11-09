import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
  type SocialApprovalActorType,
  type SocialApprovalCommentVisibility,
  type SocialApprovalStage,
  type SocialApprovalChangesKind,
  type SocialApprovalStatus,
  type SocialApprovalSurface,
} from './entities';
import { approvalScopeWhere, assertApprovalScope } from './approval-scope';
import {
  approvalScopeKind,
  internalApprovalIsFinal,
} from './approval-stage.policy';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';
import type { ResolvedApprovalSubject } from './subjects/approval-subject-resolver';
import { SocialApprovalAuthorityService } from './social-approval-authority.service';
import {
  SocialApprovalPiecesService,
  type RecordedApprovalEvent,
} from './social-approval-pieces.service';
import { SocialApprovalSettingsService } from './social-approval-settings.service';
import { SocialApprovalNotificationPublisher } from './social-approval-notification.publisher';
import type { SocialApprovalStateProjection } from './approval-state.projection';
import { SocialApprovalTransitionRegistry } from './approval-transition.port';

export type ApprovalActor = {
  type: SocialApprovalActorType;
  userId: string | null;
};
export type ApprovalOperation = {
  manager: EntityManager;
  afterCommit: Array<() => Promise<unknown>>;
};
const ACTIVE = [
  'draft',
  'awaiting_internal_review',
  'awaiting_client',
  'changes_requested',
] as const;

@Injectable()
export class SocialApprovalsService {
  private readonly logger = new Logger(SocialApprovalsService.name);
  constructor(
    @InjectRepository(SocialApprovalRequestEntity, 'agency')
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalCommentEntity, 'agency')
    private readonly comments: Repository<SocialApprovalCommentEntity>,
    @InjectRepository(SocialApprovalStageDecisionEntity, 'agency')
    private readonly decisions: Repository<SocialApprovalStageDecisionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly subjects: ApprovalSubjectResolver,
    private readonly pieces: SocialApprovalPiecesService,
    private readonly authority: SocialApprovalAuthorityService,
    private readonly settings: SocialApprovalSettingsService,
    private readonly notifications?: SocialApprovalNotificationPublisher,
    /** CS5-B: owner projections told after a transition commits. */
    private readonly transitions?: SocialApprovalTransitionRegistry,
  ) {}
  /**
   * CS5-B — best-effort, after commit: a decision never fails because an
   * observer did. Observers re-read their owners, so a swallowed failure is
   * repaired by their own reconciliation.
   */
  private async observeTransition(
    ...requests: SocialApprovalRequestEntity[]
  ): Promise<void> {
    for (const observer of this.transitions?.list() ?? [])
      for (const request of requests)
        try {
          await observer(request);
        } catch (error) {
          this.logger.warn(
            `approval transition observer failed for ${request.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
    // R-21: whatever surface moved it, an open channel re-reads the card.
    const publisher = this.notifications;
    if (typeof publisher?.announceTeamChatCardChanged !== 'function') return;
    for (const request of requests)
      if (request.status !== 'draft')
        await publisher.announceTeamChatCardChanged(request);
  }
  /** AR5 — a decision written down where people follow it. Never throws. */
  private async recordDecision(
    request: SocialApprovalRequestEntity,
    event: RecordedApprovalEvent | null,
    decision: 'approved' | 'changes_requested' | 'agency_override',
    stage: SocialApprovalStage,
    surface: SocialApprovalSurface,
  ): Promise<void> {
    const publisher = this.notifications;
    if (!event || typeof publisher?.publishDecisionRecord !== 'function')
      return;
    try {
      await publisher.publishDecisionRecord(request, {
        eventId: event.id,
        decision,
        stage,
        actorName: event.actorName,
        surface,
      });
    } catch {
      // The publisher already logs; the decision is committed.
    }
  }
  private scopeWhere(scope: CompanyAwareScope) {
    return approvalScopeWhere(scope);
  }
  private user(actorUserId: string | null | undefined): ApprovalActor {
    if (!actorUserId)
      throw new BadRequestException(
        'Usuário autenticado é obrigatório para esta ação.',
      );
    return { type: 'user', userId: actorUserId };
  }
  private validateActor(actor: ApprovalActor) {
    if (
      (actor.type === 'user' && !actor.userId) ||
      (actor.type === 'system' && actor.userId)
    )
      throw new BadRequestException('Ator de aprovação inválido.');
  }
  private async find(scope: CompanyAwareScope, id: string) {
    const item = await this.requests.findOne({
      where: { ...this.scopeWhere(scope), id },
    });
    if (!item)
      throw new NotFoundException(
        'Aprovação não encontrada no contexto atual.',
      );
    return item;
  }
  /** F-06: every decision reads the request under a row lock. */
  private async lockRequest(
    manager: EntityManager,
    scope: CompanyAwareScope,
    id: string,
  ) {
    const request = await manager
      .getRepository(SocialApprovalRequestEntity)
      .findOne({
        where: { ...this.scopeWhere(scope), id },
        lock: { mode: 'pessimistic_write' },
      });
    if (!request)
      throw new NotFoundException(
        'Aprovação não encontrada no contexto atual.',
      );
    return request;
  }
  private assertStatus(
    item: SocialApprovalRequestEntity,
    allowed: readonly SocialApprovalStatus[],
  ) {
    if (!allowed.includes(item.status))
      throw new ConflictException(
        'A aprovação não está em um estado que permite esta ação.',
      );
  }
  /**
   * `visibility` is always explicit at the call site: `stage` says when the
   * comment happened, never who may read it (CA0 §AC). Every Agency path
   * passes `internal`, even during `awaiting_client`; only Client Area
   * authorship and an explicit Agency reply-to-client pass `client`.
   */
  private async addCommentEntity(
    manager: DataSource['manager'],
    request: SocialApprovalRequestEntity,
    actor: ApprovalActor,
    body: string,
    stage: SocialApprovalStage | null,
    visibility: SocialApprovalCommentVisibility,
  ) {
    const normalized = typeof body === 'string' ? body.trim() : '';
    if (!normalized)
      throw new BadRequestException('O comentário não pode estar vazio.');
    return manager.getRepository(SocialApprovalCommentEntity).save({
      approvalRequestId: request.id,
      stage,
      actorType: actor.type,
      actorUserId: actor.userId,
      body: normalized,
      visibility,
    });
  }
  private async decision(
    manager: DataSource['manager'],
    request: SocialApprovalRequestEntity,
    stage: SocialApprovalStage,
    decision: 'approved' | 'changes_requested' | 'agency_override',
    actor: ApprovalActor,
    commentId: string | null,
  ) {
    return manager.getRepository(SocialApprovalStageDecisionEntity).save({
      approvalRequestId: request.id,
      stage,
      decision,
      actorType: actor.type,
      actorUserId: actor.userId,
      commentId,
    });
  }
  async create(
    scope: CompanyAwareScope,
    actorUserId: string | null | undefined,
    input: {
      subjectType: string;
      subjectId: string;
      subjectRevisionId: string;
    },
  ) {
    const actor = this.user(actorUserId);
    assertApprovalScope(scope);
    const subject = await this.subjects.resolve(scope, input);
    try {
      const afterCommit: ApprovalOperation['afterCommit'] = [];
      const saved = await this.dataSource.transaction((manager) =>
        this.createInTransaction(manager, scope, actor, subject, afterCommit),
      );
      for (const run of afterCommit) await run();
      return saved;
    } catch (error: unknown) {
      if (this.isActiveUnique(error))
        throw new ConflictException(
          'Já existe uma aprovação ativa para esta revisão neste contexto.',
        );
      throw error;
    }
  }
  /**
   * The body of `create`, usable from a larger transaction. The caller has
   * already resolved the subject inside this scope and runs `afterCommit`.
   */
  async createInTransaction(
    manager: EntityManager,
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    subject: ResolvedApprovalSubject,
    afterCommit: ApprovalOperation['afterCommit'],
  ) {
    const requests = manager.getRepository(SocialApprovalRequestEntity);
    await this.lockSubject(manager, scope, subject);
    const previous = await requests.find({
      where: {
        ...this.scopeWhere(scope),
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    const supersededAt = new Date();
    const superseded = previous.filter(
      (request) =>
        request.subjectRevisionId !== subject.subjectRevisionId &&
        ACTIVE.includes(request.status as (typeof ACTIVE)[number]),
    );
    for (const request of superseded) {
      request.status = 'superseded';
      request.supersededAt = supersededAt;
      await requests.save(request);
      await this.pieces.recordRequestEvent(
        manager,
        request,
        'superseded',
        actor,
        'agency',
      );
    }
    const step = await this.pieces.resolveStep(manager, scope, subject);
    // A step shows one attempt: a different subject taking the slot (Studio
    // version over a direct upload, or the reverse) closes the one it replaces.
    const replaced = step.currentRequestId
      ? await requests.findOne({
          where: { id: step.currentRequestId },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    if (
      replaced &&
      ACTIVE.includes(replaced.status as (typeof ACTIVE)[number]) &&
      (replaced.subjectType !== subject.subjectType ||
        replaced.subjectId !== subject.subjectId)
    ) {
      replaced.status = 'superseded';
      replaced.supersededAt = supersededAt;
      await requests.save(replaced);
      await this.pieces.recordRequestEvent(
        manager,
        replaced,
        'superseded',
        actor,
        'agency',
      );
      superseded.push(replaced);
    }
    const saved = await requests.save(
      requests.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        ...subject,
        status: 'draft',
        currentStage: 'internal',
        requestedByUserId: actor.userId!,
        requestedAt: new Date(),
        sentToClientAt: null,
        clientFirstViewedAt: null,
        clientLastViewedAt: null,
        internalFirstViewedAt: null,
        internalLastViewedAt: null,
        internalViewedByUserId: null,
        clientViewedByUserId: null,
        approvedAt: null,
        cancelledAt: null,
        supersededAt: null,
        stepId: step.id,
        batchId: null,
        resolution: null,
        requiredClientApproverIds: null,
      }),
    );
    await this.pieces.attachRequest(manager, step, saved);
    afterCommit.push(async () => {
      await Promise.all(
        superseded.map(
          (request) =>
            this.notifications?.publish('superseded', request, actor.userId) ??
            Promise.resolve(),
        ),
      );
      // R-21: the replaced request's card loses its actions now.
      for (const request of superseded)
        await this.announceTimeline(request, 'decision_changed');
      await this.observeTransition(...superseded, saved);
    });
    return saved;
  }
  /**
   * PostgreSQL serializes replacement workflows per logical subject root. It
   * prevents concurrent submissions of r2/r3 from both surviving active.
   */
  private async lockSubject(
    manager: EntityManager,
    scope: CompanyAwareScope,
    subject: Pick<ResolvedApprovalSubject, 'subjectType' | 'subjectId'>,
  ) {
    if ('query' in manager && typeof manager.query === 'function')
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `social-approval:${scope.tenantId}:${scope.workspaceId}:${scope.agencyClientId}:${scope.companyContextId}:${subject.subjectType}:${subject.subjectId}`,
      ]);
  }
  /**
   * AR3 — create and submit as one step, so the Planner's send never leaves a
   * draft behind (F-08). Repeating it for a revision already under review is
   * a no-op, which is what makes a retried send safe.
   */
  async sendInTransaction(
    manager: EntityManager,
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    subject: ResolvedApprovalSubject,
    afterCommit: ApprovalOperation['afterCommit'],
    options: { batchId?: string | null; surface?: SocialApprovalSurface } = {},
  ): Promise<{ request: SocialApprovalRequestEntity; changed: boolean }> {
    await this.lockSubject(manager, scope, subject);
    const requests = manager.getRepository(SocialApprovalRequestEntity);
    const current = await requests.findOne({
      where: {
        ...this.scopeWhere(scope),
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        subjectRevisionId: subject.subjectRevisionId,
        status: In([...ACTIVE]),
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      current?.status === 'awaiting_internal_review' ||
      current?.status === 'awaiting_client'
    )
      return { request: current, changed: false };
    const request =
      current ??
      (await this.createInTransaction(
        manager,
        scope,
        actor,
        subject,
        afterCommit,
      ));
    return {
      request: await this.submitWithBatch(
        manager,
        scope,
        actor,
        request.id,
        afterCommit,
        options,
      ),
      changed: true,
    };
  }
  /**
   * AR3 — the Studio's send creates a draft in its own transaction, so the
   * Planner hands it over here. Anything past `draft` is left as it is.
   */
  async submitExisting(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    options: { batchId?: string | null; surface?: SocialApprovalSurface } = {},
  ): Promise<{ request: SocialApprovalRequestEntity; changed: boolean }> {
    const actor = this.user(actorUserId);
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const outcome = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, scope, id);
      if (request.status !== 'draft') return { request, changed: false };
      return {
        request: await this.submitWithBatch(
          manager,
          scope,
          actor,
          id,
          afterCommit,
          options,
        ),
        changed: true,
      };
    });
    for (const run of afterCommit) await run();
    return outcome;
  }
  /** The batch is on the row before the transition is announced (D-19). */
  private async submitWithBatch(
    manager: EntityManager,
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    id: string,
    afterCommit: ApprovalOperation['afterCommit'],
    options: { batchId?: string | null; surface?: SocialApprovalSurface },
  ) {
    if (options.batchId)
      await manager
        .getRepository(SocialApprovalRequestEntity)
        .update({ id }, { batchId: options.batchId });
    return this.submitInTransaction(
      manager,
      scope,
      actor,
      id,
      afterCommit,
      options.surface,
      options.batchId,
    );
  }
  /** Locked and in the status an edit may start from; 409 otherwise. */
  async lockForEdit(
    manager: EntityManager,
    scope: CompanyAwareScope,
    id: string,
    status: SocialApprovalStatus,
  ) {
    const request = await this.lockRequest(manager, scope, id);
    this.assertStatus(request, [status]);
    return request;
  }
  /**
   * D-02/D-03 — the edited text becomes a new revision and a new request in
   * the same stage, with no decision carried over, which is what restarts a
   * "Todos" round. `now()` is the transaction's own clock: a decision made in
   * this same transaction ("Salvar e aprovar") is stamped with it, and it has
   * to count as inside the round it opens.
   */
  async reissueAfterEditInTransaction(
    manager: EntityManager,
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    previous: SocialApprovalRequestEntity,
    subject: ResolvedApprovalSubject,
    afterCommit: ApprovalOperation['afterCommit'],
    surface: SocialApprovalSurface,
    requiredClientApproverIds: string[] | null,
  ) {
    const requests = manager.getRepository(SocialApprovalRequestEntity);
    const [{ now }] = await manager.query<Array<{ now: Date }>>(
      'SELECT now() AS now',
    );
    const status = previous.status;
    const toClient = status === 'awaiting_client';
    previous.status = 'superseded';
    previous.supersededAt = now;
    await requests.save(previous);
    await this.pieces.recordRequestEvent(
      manager,
      previous,
      'superseded',
      actor,
      surface,
    );
    const step = await this.pieces.resolveStep(manager, scope, subject);
    const saved = await requests.save(
      requests.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        ...subject,
        status,
        currentStage: previous.currentStage,
        // The Agency person who sent it: they are who D-02 notifies.
        requestedByUserId: previous.requestedByUserId,
        requestedAt: now,
        sentToClientAt: toClient ? now : null,
        clientFirstViewedAt: null,
        clientLastViewedAt: null,
        internalFirstViewedAt: null,
        internalLastViewedAt: null,
        internalViewedByUserId: null,
        clientViewedByUserId: null,
        approvedAt: null,
        cancelledAt: null,
        supersededAt: null,
        stepId: step.id,
        batchId: null,
        resolution: null,
        requiredClientApproverIds,
      }),
    );
    await this.pieces.attachRequest(manager, step, saved);
    await this.pieces.recordRequestEvent(
      manager,
      saved,
      'edited',
      actor,
      surface,
      {
        previousRequestId: previous.id,
        previousRevisionId: previous.subjectRevisionId,
      },
    );
    afterCommit.push(() => this.observeTransition(previous, saved));
    return saved;
  }
  /** Runs last, on the row as the operation left it. */
  async announceClientEdit(
    approval: SocialApprovalRequestEntity,
    actorUserId: string | null,
  ): Promise<void> {
    await this.notifications?.publishClientEdited(approval, actorUserId);
    await this.announceTimeline(approval, 'decision_changed');
  }
  async list(
    scope: CompanyAwareScope,
    filters: {
      status?: string;
      stage?: string;
      subjectType?: string;
      search?: string;
    },
  ) {
    const qb = this.requests
      .createQueryBuilder('request')
      .where(
        'request.tenantId = :tenantId AND request.workspaceId = :workspaceId',
        { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      )
      .andWhere(
        scope.agencyClientId === null
          ? 'request.agencyClientId IS NULL'
          : 'request.agencyClientId = :agencyClientId',
        { agencyClientId: scope.agencyClientId },
      )
      .andWhere(
        scope.companyContextId === null
          ? 'request.companyContextId IS NULL'
          : 'request.companyContextId = :companyContextId',
        { companyContextId: scope.companyContextId },
      );
    if (filters.status)
      qb.andWhere('request.status = :status', { status: filters.status });
    if (filters.stage)
      qb.andWhere('request.currentStage = :stage', { stage: filters.stage });
    if (filters.subjectType)
      qb.andWhere('request.subjectType = :subjectType', {
        subjectType: filters.subjectType,
      });
    if (filters.search?.trim())
      qb.andWhere('request.title ILIKE :search', {
        search: `%${filters.search.trim()}%`,
      });
    const items = await qb.orderBy('request.createdAt', 'DESC').getMany();
    return { items, total: items.length };
  }
  /**
   * The owner domain must authorize its root and immutable revision first.
   * Prefer an active request of that exact revision; otherwise the latest
   * historical request. Equal creation timestamps are broken by id DESC.
   * One bounded read, with no viewed audit or workflow side effects.
   */
  async findStateForSubjectRevision(
    scope: CompanyAwareScope,
    subject: {
      subjectType: string;
      subjectId: string;
      subjectRevisionId: string;
    },
  ): Promise<SocialApprovalStateProjection | null> {
    const request = await this.requests
      .createQueryBuilder('request')
      .select([
        'request.id',
        'request.status',
        'request.currentStage',
        'request.createdAt',
        'request.sentToClientAt',
        'request.approvedAt',
        'request.cancelledAt',
        'request.supersededAt',
      ])
      .where({
        ...this.scopeWhere(scope),
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        subjectRevisionId: subject.subjectRevisionId,
      })
      .orderBy(
        'CASE WHEN request.status IN (:...activeStatuses) THEN 0 ELSE 1 END',
        'ASC',
      )
      .setParameter('activeStatuses', ACTIVE)
      .addOrderBy('request.createdAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .limit(1)
      .getOne();
    if (!request) return null;
    return {
      approvalId: request.id,
      status: request.status,
      currentStage: request.currentStage,
      createdAt: request.createdAt,
      sentToClientAt: request.sentToClientAt,
      approvedAt: request.approvedAt,
      cancelledAt: request.cancelledAt,
      supersededAt: request.supersededAt,
    };
  }
  async detail(scope: CompanyAwareScope, id: string) {
    const request = await this.find(scope, id);
    const [comments, decisions] = await Promise.all([
      this.comments.find({
        where: { approvalRequestId: id },
        order: { createdAt: 'ASC' },
      }),
      this.decisions.find({
        where: { approvalRequestId: id },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return { ...request, comments, decisions };
  }
  /** R-08: agency view of the text history of this approval's step. */
  async textVersions(scope: CompanyAwareScope, id: string) {
    return this.pieces.textVersions(
      scope,
      await this.find(scope, id),
      'agency',
    );
  }
  async preview(scope: CompanyAwareScope, id: string) {
    const request = await this.find(scope, id);
    return this.subjects.getPreview(scope, {
      subjectType:
        request.subjectType as ResolvedApprovalSubject['subjectType'],
      subjectId: request.subjectId,
      subjectRevisionId: request.subjectRevisionId,
      title: request.title,
      subjectVersionLabel: request.subjectVersionLabel,
    });
  }
  async markAgencyViewed(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    surface: SocialApprovalSurface = 'agency',
  ) {
    const actor = this.user(actorUserId);
    const request = await this.find(scope, id);
    const now = new Date();
    const firstView = !request.internalFirstViewedAt;
    request.internalFirstViewedAt ??= now;
    request.internalLastViewedAt = now;
    request.internalViewedByUserId = actor.userId;
    const saved = await this.requests.save(request);
    // D-24: in the self area this view plays the part of the client's.
    if (firstView && surface === 'self')
      await this.pieces.recordRequestEvent(
        this.dataSource.manager,
        saved,
        'viewed',
        actor,
        surface,
      );
    return saved;
  }
  async markClientViewed(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
  ) {
    const actor = this.user(actorUserId);
    const request = await this.find(scope, id);
    this.assertStatus(request, ['awaiting_client']);
    const now = new Date();
    const firstView = !request.clientFirstViewedAt;
    request.clientFirstViewedAt ??= now;
    request.clientLastViewedAt = now;
    request.clientViewedByUserId = actor.userId;
    const saved = await this.requests.save(request);
    // Only the first one: a reopened tab is not a fact of the trail.
    if (firstView)
      await this.pieces.recordRequestEvent(
        this.dataSource.manager,
        saved,
        'viewed',
        actor,
        'client_area',
      );
    return saved;
  }
  async submit(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
  ) {
    const actor = this.user(actorUserId);
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const saved = await this.dataSource.transaction((manager) =>
      this.submitInTransaction(manager, scope, actor, id, afterCommit),
    );
    for (const run of afterCommit) await run();
    return saved;
  }
  /**
   * D-14: with the internal stage off, the request goes straight to the
   * client. The own scope always passes through it, since it is the final
   * decision there.
   */
  async submitInTransaction(
    manager: EntityManager,
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    id: string,
    afterCommit: ApprovalOperation['afterCommit'],
    surface: SocialApprovalSurface = 'agency',
    batchId?: string | null,
  ) {
    const item = await this.lockRequest(manager, scope, id);
    this.assertStatus(item, ['draft', 'changes_requested']);
    // D-19: resending one item is its own send. Keeping the old batch id would
    // land on the batch's card and notification, and nobody would hear of it.
    if (item.status === 'changes_requested' && !batchId) item.batchId = null;
    const settings = await this.settings.get(scope, manager);
    const skipInternal =
      approvalScopeKind(scope) === 'managed_client' &&
      !settings.internalApprovalEnabled;
    if (skipInternal) {
      item.requiredClientApproverIds =
        await this.authority.requiredClientApprovers(manager, scope, settings);
      item.status = 'awaiting_client';
      item.currentStage = 'client';
      item.sentToClientAt = new Date();
    } else {
      item.status = 'awaiting_internal_review';
      item.currentStage = 'internal';
      item.requiredClientApproverIds = null;
    }
    const saved = await manager
      .getRepository(SocialApprovalRequestEntity)
      .save(item);
    if (skipInternal)
      await this.pieces.recordRequestEvent(
        manager,
        saved,
        'internal_skipped',
        actor,
        surface,
      );
    const sent = await this.pieces.recordRequestEvent(
      manager,
      saved,
      'sent',
      actor,
      surface,
      {
        to: skipInternal ? 'client' : 'internal',
      },
    );
    await this.pieces.afterTransition(manager, saved);
    afterCommit.push(async () => {
      if (skipInternal)
        await this.notifications?.publish(
          'awaiting_client',
          saved,
          actor.userId,
        );
      else if (typeof this.notifications?.publishInternalReview === 'function')
        await this.notifications.publishInternalReview(
          saved,
          actor.userId,
          sent?.id ?? null,
        );
      await this.observeTransition(saved);
    });
    return saved;
  }
  /**
   * Agency comment. `visibility` is `internal` unless the operator explicitly
   * addresses the client: an operator writing while the request sits in
   * `awaiting_client` is taking an internal note, and inferring otherwise from
   * `stage` is what CA0 §AC forbids.
   */
  async comment(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    body: string,
    visibility: SocialApprovalCommentVisibility = 'internal',
    surface: SocialApprovalSurface = 'agency',
  ) {
    const actor = this.user(actorUserId);
    const request = await this.find(scope, id);
    if (!ACTIVE.includes(request.status as (typeof ACTIVE)[number]))
      throw new ConflictException(
        'Não é possível comentar em uma aprovação encerrada.',
      );
    if (visibility === 'client' && !request.sentToClientAt)
      throw new ConflictException(
        'Esta aprovação ainda não foi enviada ao cliente.',
      );
    const saved = await this.dataSource.transaction(async (manager) => {
      const comment = await this.addCommentEntity(
        manager,
        request,
        actor,
        body,
        request.currentStage,
        visibility,
      );
      await this.pieces.recordRequestEvent(
        manager,
        request,
        'commented',
        actor,
        surface,
        { visibility, commentId: comment.id },
      );
      return comment;
    });
    // AP4 §24 — an explicit Agency reply to the client is worth an email,
    // same as any other "something changed, go look" moment. Never for an
    // internal note: `visibility` already gates everything above this line.
    // The comment's own id/createdAt disambiguates the ledger event so two
    // separate replies on the same approval both deliver (§28).
    if (visibility === 'client') {
      await this.notifications?.publishClientOnly('agency_reply', request, {
        id: saved.id,
        occurredAt: saved.createdAt,
      });
      // CCOM2 §43 — the comment is now part of the conversation timeline
      // (projected, never copied), so open timelines are told to re-read.
      await this.announceTimeline(request, 'comment_created');
    }
    return saved;
  }

  /**
   * CCOM2 §43/§45 — tells open conversation timelines to re-read.
   *
   * Defensive on purpose, on two axes. The publisher is an optional injection,
   * and it may also be a stub that predates this method — several specs build
   * one with just the fields they assert on. More importantly, this is a
   * *signal about an effect*: the comment is already written and the decision
   * already taken, so a missing re-read must never turn a committed transition
   * into a thrown error (§10, §42: no approval rule may contaminate the
   * conversation path, and no conversation effect may contaminate approvals).
   */
  private async announceTimeline(
    request: SocialApprovalRequestEntity,
    reason: 'comment_created' | 'decision_changed',
  ): Promise<void> {
    const publisher = this.notifications;
    // Probed rather than called blind, and never detached from its object: a
    // partially-stubbed publisher must be a no-op, not a TypeError.
    if (typeof publisher?.announceConversationActivity !== 'function') return;

    try {
      await publisher.announceConversationActivity(request, reason);
    } catch {
      // The publisher already logs; swallowing here keeps the transition whole.
    }
  }
  /**
   * The internal decision. Where the stage policy has a client stage (managed
   * client) it hands the request to the client; where it does not (the
   * tenant's own content) it is the final approval and the request never
   * enters `awaiting_client`.
   */
  async approveInternal(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    role?: string | null,
    surface: SocialApprovalSurface = 'agency',
    operation?: ApprovalOperation,
  ) {
    const actor = this.user(actorUserId);
    let decided: RecordedApprovalEvent | null = null;
    const run = async (manager: EntityManager) => {
      const request = await this.lockRequest(manager, scope, id);
      this.assertStatus(request, ['awaiting_internal_review']);
      const settings = await this.settings.get(scope, manager);
      this.authority.assertInternalDecider(settings, {
        userId: actor.userId!,
        role,
      });
      const final = internalApprovalIsFinal(request);
      const required = final
        ? null
        : await this.authority.requiredClientApprovers(
            manager,
            scope,
            settings,
          );
      await this.decision(
        manager,
        request,
        'internal',
        'approved',
        actor,
        null,
      );
      if (final) {
        request.status = 'approved';
        request.approvedAt = new Date();
        request.resolution = 'internal_final';
      } else {
        request.status = 'awaiting_client';
        request.currentStage = 'client';
        request.sentToClientAt = new Date();
        request.requiredClientApproverIds = required;
      }
      const updated = await manager.save(request);
      decided = await this.pieces.recordRequestEvent(
        manager,
        updated,
        'approved',
        actor,
        surface,
        { stage: 'internal' },
      );
      if (!final)
        await this.pieces.recordRequestEvent(
          manager,
          updated,
          'sent',
          actor,
          surface,
          { to: 'client' },
        );
      await this.pieces.afterTransition(manager, updated);
      return updated;
    };
    const announce = async (saved: SocialApprovalRequestEntity) => {
      await this.notifications?.publish(
        saved.status === 'approved' ? 'approved' : 'awaiting_client',
        saved,
        actor.userId,
      );
      await this.recordDecision(
        saved,
        decided,
        'approved',
        'internal',
        surface,
      );
      await this.observeTransition(saved);
    };
    if (operation) {
      const saved = await run(operation.manager);
      operation.afterCommit.push(() => announce(saved));
      return saved;
    }
    const saved = await this.dataSource.transaction(run);
    await announce(saved);
    return saved;
  }
  /** The Agency boundary can decide only the internal stage. */
  async requestChanges(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    body: string,
    role?: string | null,
    surface: SocialApprovalSurface = 'agency',
    kind: SocialApprovalChangesKind = 'revise',
  ) {
    const actor = this.user(actorUserId);
    return this.requestChangesAs(
      scope,
      id,
      actor,
      body,
      'internal',
      role,
      surface,
      kind,
    );
  }
  /**
   * D-15 — the Owner approves on behalf of whoever was left to decide. Status
   * becomes `approved` (no new status, D-12); `resolution` carries how. The
   * route's permission key is the authorization, and D-17 lists do not narrow
   * it.
   */
  async agencyOverride(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    operation?: ApprovalOperation,
  ) {
    const actor = this.user(actorUserId);
    let decided: RecordedApprovalEvent | null = null;
    let decidedStage: SocialApprovalStage = 'internal';
    const run = async (manager: EntityManager) => {
      const request = await this.lockRequest(manager, scope, id);
      this.assertStatus(request, ACTIVE);
      decidedStage = request.currentStage;
      await this.decision(
        manager,
        request,
        request.currentStage,
        'agency_override',
        actor,
        null,
      );
      request.status = 'approved';
      request.approvedAt = new Date();
      request.resolution = 'agency_override';
      const updated = await manager.save(request);
      decided = await this.pieces.recordRequestEvent(
        manager,
        updated,
        'agency_override',
        actor,
        'agency',
        { stage: request.currentStage },
      );
      await this.pieces.afterTransition(manager, updated);
      return updated;
    };
    const announce = async (saved: SocialApprovalRequestEntity) => {
      await this.notifications?.publish('approved', saved, actor.userId);
      await this.announceTimeline(saved, 'decision_changed');
      await this.recordDecision(
        saved,
        decided,
        'agency_override',
        decidedStage,
        'agency',
      );
      await this.observeTransition(saved);
    };
    if (operation) {
      const saved = await run(operation.manager);
      operation.afterCommit.push(() => announce(saved));
      return saved;
    }
    const saved = await this.dataSource.transaction(run);
    await announce(saved);
    return saved;
  }
  /** Client Area will call this domain method with its authenticated real user; AP1 intentionally exposes no client route. */
  async clientApprove(
    scope: CompanyAwareScope,
    id: string,
    actor: ApprovalActor,
    operation?: ApprovalOperation,
    surface: SocialApprovalSurface = 'client_area',
  ) {
    this.validateActor(actor);
    const run = async (manager: EntityManager) => {
      const request = await this.lockRequest(manager, scope, id);
      this.assertStatus(request, ['awaiting_client']);
      const settings = await this.settings.get(scope, manager);
      await this.authority.assertClientDecider(
        manager,
        scope,
        request,
        settings,
        actor.userId,
      );
      await this.decision(manager, request, 'client', 'approved', actor, null);
      const completed = await this.roundIsComplete(
        manager,
        scope,
        request,
        actor.userId,
      );
      if (completed) {
        request.status = 'approved';
        request.approvedAt = new Date();
        request.resolution = 'client_approved';
      }
      const updated = completed ? await manager.save(request) : request;
      const decided = await this.pieces.recordRequestEvent(
        manager,
        updated,
        'approved',
        actor,
        surface,
        { stage: 'client', roundCompleted: completed },
      );
      if (completed) await this.pieces.afterTransition(manager, updated);
      return { saved: updated, completed, decided };
    };
    const announce = async (outcome: Awaited<ReturnType<typeof run>>) => {
      await this.recordDecision(
        outcome.saved,
        outcome.decided,
        'approved',
        'client',
        surface,
      );
      if (outcome.completed) {
        await this.notifications?.publish(
          'approved',
          outcome.saved,
          actor.userId,
        );
        // CCOM2 §45 — the card's status is resolved on read, never persisted, so
        // a decision only needs the timeline to re-read. No second card is created.
        await this.announceTimeline(outcome.saved, 'decision_changed');
        await this.observeTransition(outcome.saved);
      } else {
        // D-03: the person who just decided loses the actions; the rest keep them.
        await this.announceTimeline(outcome.saved, 'decision_changed');
      }
    };
    if (operation) {
      const outcome = await run(operation.manager);
      operation.afterCommit.push(() => announce(outcome));
      return outcome.saved;
    }
    const outcome = await this.dataSource.transaction(run);
    await announce(outcome);
    return outcome.saved;
  }
  /**
   * D-03. "Primeira" closes on the first approval. "Todos" closes when every
   * required person still eligible has approved; a revoked membership simply
   * no longer counts, and an empty remainder never closes a round on its own.
   */
  private async roundIsComplete(
    manager: EntityManager,
    scope: CompanyAwareScope,
    request: SocialApprovalRequestEntity,
    justApprovedUserId: string | null,
  ): Promise<boolean> {
    if (!request.requiredClientApproverIds) return true;
    const [eligible, approved] = await Promise.all([
      this.authority.eligibleClientApprovers(
        manager,
        scope,
        request.requiredClientApproverIds,
      ),
      this.authority.roundApprovals(manager, request),
    ]);
    if (justApprovedUserId) approved.add(justApprovedUserId);
    return (
      eligible.length > 0 &&
      eligible.every((approver) => approved.has(approver.userId))
    );
  }
  /**
   * A round waiting only on someone revoked has nobody left to trigger an
   * evaluation. The reconciliation route is that trigger. Returns how many
   * rounds it closed.
   */
  async reconcileOpenRounds(scope: CompanyAwareScope): Promise<number> {
    const open = await this.requests.find({
      where: { ...this.scopeWhere(scope), status: 'awaiting_client' },
    });
    let closed = 0;
    for (const candidate of open) {
      if (!candidate.requiredClientApproverIds) continue;
      const saved = await this.dataSource.transaction(async (manager) => {
        const request = await this.lockRequest(manager, scope, candidate.id);
        if (
          request.status !== 'awaiting_client' ||
          !(await this.roundIsComplete(manager, scope, request, null))
        )
          return null;
        request.status = 'approved';
        request.approvedAt = new Date();
        request.resolution = 'client_approved';
        const updated = await manager.save(request);
        await this.pieces.recordRequestEvent(
          manager,
          updated,
          'approved',
          { type: 'system', userId: null },
          'system',
          { stage: 'client', roundCompleted: true, reason: 'approver_revoked' },
        );
        await this.pieces.afterTransition(manager, updated);
        return updated;
      });
      if (!saved) continue;
      closed += 1;
      await this.notifications?.publish('approved', saved, null);
      await this.announceTimeline(saved, 'decision_changed');
      await this.observeTransition(saved);
    }
    return closed;
  }
  async clientRequestChanges(
    scope: CompanyAwareScope,
    id: string,
    actor: ApprovalActor,
    body: string,
    surface: SocialApprovalSurface = 'client_area',
    kind: SocialApprovalChangesKind = 'revise',
  ) {
    this.validateActor(actor);
    return this.requestChangesAs(
      scope,
      id,
      actor,
      body,
      'client',
      undefined,
      surface,
      kind,
    );
  }
  async clientComment(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    body: string,
  ) {
    const actor = this.user(actorUserId);
    const request = await this.find(scope, id);
    this.assertStatus(request, ['awaiting_client']);
    const saved = await this.dataSource.transaction(async (manager) => {
      const comment = await this.addCommentEntity(
        manager,
        request,
        actor,
        body,
        'client',
        'client',
      );
      await this.pieces.recordRequestEvent(
        manager,
        request,
        'commented',
        actor,
        'client_area',
        { visibility: 'client', commentId: comment.id },
      );
      return comment;
    });
    // CCOM2 §43 — a client comment is client-visible by construction here, so
    // the Agency "Clientes" timeline and the client's own both re-read.
    await this.announceTimeline(request, 'comment_created');
    return saved;
  }
  private async requestChangesAs(
    scope: CompanyAwareScope,
    id: string,
    actor: ApprovalActor,
    body: string,
    stage: SocialApprovalStage,
    role?: string | null,
    surface: SocialApprovalSurface = stage === 'client'
      ? 'client_area'
      : 'agency',
    kind: SocialApprovalChangesKind = 'revise',
  ) {
    let decided: RecordedApprovalEvent | null = null;
    const saved = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, scope, id);
      this.assertStatus(
        request,
        stage === 'client' ? ['awaiting_client'] : ['awaiting_internal_review'],
      );
      const settings = await this.settings.get(scope, manager);
      if (stage === 'client')
        await this.authority.assertClientDecider(
          manager,
          scope,
          request,
          settings,
          actor.userId,
        );
      else
        this.authority.assertInternalDecider(settings, {
          userId: actor.userId!,
          role,
        });
      // The client's own reason is client-visible: they wrote it, and it is
      // the anchor of the thread they see. An internal request-changes note
      // stays internal.
      const comment = await this.addCommentEntity(
        manager,
        request,
        actor,
        body,
        stage,
        stage === 'client' ? 'client' : 'internal',
      );
      await this.decision(
        manager,
        request,
        stage,
        'changes_requested',
        actor,
        comment.id,
      );
      request.status = 'changes_requested';
      request.changesKind = kind;
      request.currentStage = 'internal';
      // D-03: under "Todos" one request for changes closes the round at once.
      request.requiredClientApproverIds = null;
      const updated = await manager.save(request);
      decided = await this.pieces.recordRequestEvent(
        manager,
        updated,
        'changes_requested',
        actor,
        surface,
        { stage, commentId: comment.id, changesKind: kind },
      );
      await this.pieces.afterTransition(manager, updated);
      return updated;
    });
    if (stage === 'client') {
      await this.notifications?.publish(
        'changes_requested',
        saved,
        actor.userId,
      );
      // CCOM2 §40/§45 — the card now resolves as `in_revision` and its actions
      // fall away; the client's reason is a client-visible comment that the
      // timeline projects. Both are read-time facts, so this is a re-read.
      await this.announceTimeline(saved, 'decision_changed');
    }
    await this.recordDecision(
      saved,
      decided,
      'changes_requested',
      stage,
      surface,
    );
    await this.observeTransition(saved);
    return saved;
  }
  async cancel(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    operation?: {
      manager: EntityManager;
      afterCommit: Array<() => Promise<unknown>>;
    },
  ) {
    const actor: ApprovalActor = operation
      ? actorUserId
        ? { type: 'user', userId: actorUserId }
        : { type: 'system', userId: null }
      : this.user(actorUserId);
    const run = async (manager: EntityManager) => {
      const item = await this.lockRequest(manager, scope, id);
      this.assertStatus(item, ACTIVE);
      item.status = 'cancelled';
      item.cancelledAt = new Date();
      const updated = await manager
        .getRepository(SocialApprovalRequestEntity)
        .save(item);
      await this.pieces.recordRequestEvent(
        manager,
        updated,
        'cancelled',
        actor,
        actor.userId ? 'agency' : 'system',
      );
      await this.pieces.afterTransition(manager, updated);
      return updated;
    };
    const saved = operation
      ? await run(operation.manager)
      : await this.dataSource.transaction(run);
    // §49 — only the client channel, and only for something the client
    // already saw. `cancelled` has no Agency catalog event in AP2, and
    // inventing one would be a duplicated taxonomy for no reader.
    const announce = async () => {
      await this.notifications?.publishClientOnly('cancelled', saved);
      await this.announceTimeline(saved, 'decision_changed');
      await this.observeTransition(saved);
    };
    if (operation) operation.afterCommit.push(announce);
    else await announce();
    return saved;
  }
  async supersede(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
  ) {
    const actor = this.user(actorUserId);
    const saved = await this.dataSource.transaction(async (manager) => {
      const item = await this.lockRequest(manager, scope, id);
      this.assertStatus(item, ACTIVE);
      item.status = 'superseded';
      item.supersededAt = new Date();
      const updated = await manager
        .getRepository(SocialApprovalRequestEntity)
        .save(item);
      await this.pieces.recordRequestEvent(
        manager,
        updated,
        'superseded',
        actor,
        'agency',
      );
      await this.pieces.afterTransition(manager, updated);
      return updated;
    });
    await this.notifications?.publish('superseded', saved, actorUserId ?? null);
    await this.announceTimeline(saved, 'decision_changed');
    await this.observeTransition(saved);
    return saved;
  }
  private isActiveUnique(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }
}
