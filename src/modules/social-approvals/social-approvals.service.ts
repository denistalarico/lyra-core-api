import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
  type SocialApprovalActorType,
  type SocialApprovalCommentVisibility,
  type SocialApprovalStage,
  type SocialApprovalStatus,
} from './entities';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';
import { SocialApprovalNotificationPublisher } from './social-approval-notification.publisher';

export type ApprovalActor = {
  type: SocialApprovalActorType;
  userId: string | null;
};
const ACTIVE = [
  'draft',
  'awaiting_internal_review',
  'awaiting_client',
  'changes_requested',
] as const;

@Injectable()
export class SocialApprovalsService {
  constructor(
    @InjectRepository(SocialApprovalRequestEntity, 'agency')
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalCommentEntity, 'agency')
    private readonly comments: Repository<SocialApprovalCommentEntity>,
    @InjectRepository(SocialApprovalStageDecisionEntity, 'agency')
    private readonly decisions: Repository<SocialApprovalStageDecisionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly subjects: ApprovalSubjectResolver,
    private readonly notifications?: SocialApprovalNotificationPublisher,
  ) {}
  private scopeWhere(scope: CompanyAwareScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId!,
      companyContextId: scope.companyContextId!,
    };
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
    decision: 'approved' | 'changes_requested',
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
    const subject = await this.subjects.resolve(scope, input);
    try {
      const created = await this.dataSource.transaction(async (manager) => {
        const requests = manager.getRepository(SocialApprovalRequestEntity);
        // PostgreSQL serializes replacement workflows per logical subject root.
        // It prevents concurrent submissions of r2/r3 from both surviving active.
        if ('query' in manager && typeof manager.query === 'function') {
          await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `social-approval:${scope.tenantId}:${scope.workspaceId}:${scope.agencyClientId}:${scope.companyContextId}:${subject.subjectType}:${subject.subjectId}`,
          ]);
        }
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
        }
        const saved = await requests.save(
          requests.create({
          ...this.scopeWhere(scope),
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
          }),
        );
        return { saved, superseded };
      });
      await Promise.all(
        created.superseded.map((request) =>
          this.notifications?.publish('superseded', request, actor.userId) ??
          Promise.resolve(),
        ),
      );
      return created.saved;
    } catch (error: unknown) {
      if (this.isActiveUnique(error))
        throw new ConflictException(
          'Já existe uma aprovação ativa para esta revisão neste contexto.',
        );
      throw error;
    }
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
        'request.tenantId = :tenantId AND request.workspaceId = :workspaceId AND request.agencyClientId = :agencyClientId AND request.companyContextId = :companyContextId',
        this.scopeWhere(scope),
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
  async preview(scope: CompanyAwareScope, id: string) {
    const request = await this.find(scope, id);
    return this.subjects.getPreview(scope, {
      subjectType: request.subjectType as 'creative_version' | 'planner_content_revision',
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
  ) {
    const actor = this.user(actorUserId);
    const request = await this.find(scope, id);
    const now = new Date();
    request.internalFirstViewedAt ??= now;
    request.internalLastViewedAt = now;
    request.internalViewedByUserId = actor.userId;
    return this.requests.save(request);
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
    request.clientFirstViewedAt ??= now;
    request.clientLastViewedAt = now;
    request.clientViewedByUserId = actor.userId;
    return this.requests.save(request);
  }
  async submit(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
  ) {
    this.user(actorUserId);
    const item = await this.find(scope, id);
    this.assertStatus(item, ['draft', 'changes_requested']);
    item.status = 'awaiting_internal_review';
    item.currentStage = 'internal';
    return this.requests.save(item);
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
    const saved = await this.dataSource.transaction((manager) =>
      this.addCommentEntity(
        manager,
        request,
        actor,
        body,
        request.currentStage,
        visibility,
      ),
    );
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
  async approveInternal(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
  ) {
    const actor = this.user(actorUserId);
    const saved = await this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(SocialApprovalRequestEntity)
        .findOne({ where: { ...this.scopeWhere(scope), id } });
      if (!request)
        throw new NotFoundException(
          'Aprovação não encontrada no contexto atual.',
        );
      this.assertStatus(request, ['awaiting_internal_review']);
      await this.decision(
        manager,
        request,
        'internal',
        'approved',
        actor,
        null,
      );
      request.status = 'awaiting_client';
      request.currentStage = 'client';
      request.sentToClientAt = new Date();
      return manager.save(request);
    });
    await this.notifications?.publish('awaiting_client', saved, actor.userId);
    return saved;
  }
  /** The Agency boundary can decide only the internal stage. */
  async requestChanges(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
    body: string,
  ) {
    const actor = this.user(actorUserId);
    return this.requestChangesAs(scope, id, actor, body, 'internal');
  }
  /** Client Area will call this domain method with its authenticated real user; AP1 intentionally exposes no client route. */
  async clientApprove(
    scope: CompanyAwareScope,
    id: string,
    actor: ApprovalActor,
  ) {
    this.validateActor(actor);
    const saved = await this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(SocialApprovalRequestEntity)
        .findOne({ where: { ...this.scopeWhere(scope), id } });
      if (!request)
        throw new NotFoundException(
          'Aprovação não encontrada no contexto atual.',
        );
      this.assertStatus(request, ['awaiting_client']);
      await this.decision(manager, request, 'client', 'approved', actor, null);
      request.status = 'approved';
      request.approvedAt = new Date();
      return manager.save(request);
    });
    await this.notifications?.publish('approved', saved, actor.userId);
    // CCOM2 §45 — the card's status is resolved on read, never persisted, so
    // a decision only needs the timeline to re-read. No second card is created.
    await this.announceTimeline(saved, 'decision_changed');
    return saved;
  }
  async clientRequestChanges(
    scope: CompanyAwareScope,
    id: string,
    actor: ApprovalActor,
    body: string,
  ) {
    this.validateActor(actor);
    return this.requestChangesAs(scope, id, actor, body, 'client');
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
    const saved = await this.dataSource.transaction((manager) =>
      this.addCommentEntity(manager, request, actor, body, 'client', 'client'),
    );
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
  ) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(SocialApprovalRequestEntity)
        .findOne({ where: { ...this.scopeWhere(scope), id } });
      if (!request)
        throw new NotFoundException(
          'Aprovação não encontrada no contexto atual.',
        );
      this.assertStatus(
        request,
        stage === 'client' ? ['awaiting_client'] : ['awaiting_internal_review'],
      );
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
      request.currentStage = 'internal';
      return manager.save(request);
    });
    if (stage === 'client') {
      await this.notifications?.publish('changes_requested', saved, actor.userId);
      // CCOM2 §40/§45 — the card now resolves as `in_revision` and its actions
      // fall away; the client's reason is a client-visible comment that the
      // timeline projects. Both are read-time facts, so this is a re-read.
      await this.announceTimeline(saved, 'decision_changed');
    }
    return saved;
  }
  async cancel(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
  ) {
    this.user(actorUserId);
    const item = await this.find(scope, id);
    this.assertStatus(item, ACTIVE);
    item.status = 'cancelled';
    item.cancelledAt = new Date();
    const saved = await this.requests.save(item);
    // §49 — only the client channel, and only for something the client
    // already saw. `cancelled` has no Agency catalog event in AP2, and
    // inventing one would be a duplicated taxonomy for no reader.
    await this.notifications?.publishClientOnly('cancelled', saved);
    return saved;
  }
  async supersede(
    scope: CompanyAwareScope,
    id: string,
    actorUserId: string | null | undefined,
  ) {
    this.user(actorUserId);
    const item = await this.find(scope, id);
    this.assertStatus(item, ACTIVE);
    item.status = 'superseded';
    item.supersededAt = new Date();
    const saved = await this.requests.save(item);
    await this.notifications?.publish('superseded', saved, actorUserId ?? null);
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
