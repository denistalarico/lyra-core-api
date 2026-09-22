import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { SocialApprovalCommentEntity, SocialApprovalRequestEntity, SocialApprovalStageDecisionEntity, type SocialApprovalActorType, type SocialApprovalStage, type SocialApprovalStatus } from './entities';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';

export type ApprovalActor = { type: SocialApprovalActorType; userId: string | null };
const ACTIVE = ['draft', 'awaiting_internal_review', 'awaiting_client', 'changes_requested'] as const;

@Injectable()
export class SocialApprovalsService {
  constructor(
    @InjectRepository(SocialApprovalRequestEntity, 'agency') private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalCommentEntity, 'agency') private readonly comments: Repository<SocialApprovalCommentEntity>,
    @InjectRepository(SocialApprovalStageDecisionEntity, 'agency') private readonly decisions: Repository<SocialApprovalStageDecisionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly subjects: ApprovalSubjectResolver,
  ) {}
  private scopeWhere(scope: CompanyAwareScope) { return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, agencyClientId: scope.agencyClientId!, companyContextId: scope.companyContextId! }; }
  private user(actorUserId: string | null | undefined): ApprovalActor { if (!actorUserId) throw new BadRequestException('Usuário autenticado é obrigatório para esta ação.'); return { type: 'user', userId: actorUserId }; }
  private validateActor(actor: ApprovalActor) { if ((actor.type === 'user' && !actor.userId) || (actor.type === 'system' && actor.userId)) throw new BadRequestException('Ator de aprovação inválido.'); }
  private async find(scope: CompanyAwareScope, id: string) { const item = await this.requests.findOne({ where: { ...this.scopeWhere(scope), id } }); if (!item) throw new NotFoundException('Aprovação não encontrada no contexto atual.'); return item; }
  private assertStatus(item: SocialApprovalRequestEntity, allowed: readonly SocialApprovalStatus[]) { if (!allowed.includes(item.status)) throw new ConflictException('A aprovação não está em um estado que permite esta ação.'); }
  private async addCommentEntity(manager: DataSource['manager'], request: SocialApprovalRequestEntity, actor: ApprovalActor, body: string, stage: SocialApprovalStage | null) {
    const normalized = typeof body === 'string' ? body.trim() : '';
    if (!normalized) throw new BadRequestException('O comentário não pode estar vazio.');
    return manager.getRepository(SocialApprovalCommentEntity).save({ approvalRequestId: request.id, stage, actorType: actor.type, actorUserId: actor.userId, body: normalized });
  }
  private async decision(manager: DataSource['manager'], request: SocialApprovalRequestEntity, stage: SocialApprovalStage, decision: 'approved' | 'changes_requested', actor: ApprovalActor, commentId: string | null) {
    return manager.getRepository(SocialApprovalStageDecisionEntity).save({ approvalRequestId: request.id, stage, decision, actorType: actor.type, actorUserId: actor.userId, commentId });
  }
  async create(scope: CompanyAwareScope, actorUserId: string | null | undefined, input: { subjectType: string; subjectId: string; subjectRevisionId: string }) {
    const actor = this.user(actorUserId); const subject = await this.subjects.resolve(scope, input);
    try { return await this.requests.save(this.requests.create({ ...this.scopeWhere(scope), ...subject, status: 'draft', currentStage: 'internal', requestedByUserId: actor.userId!, requestedAt: new Date(), sentToClientAt: null, clientFirstViewedAt: null, clientLastViewedAt: null, approvedAt: null, cancelledAt: null, supersededAt: null })); }
    catch (error: unknown) { if (this.isActiveUnique(error)) throw new ConflictException('Já existe uma aprovação ativa para esta revisão neste contexto.'); throw error; }
  }
  async list(scope: CompanyAwareScope, filters: { status?: string; stage?: string; subjectType?: string; search?: string }) {
    const qb = this.requests.createQueryBuilder('request').where('request.tenantId = :tenantId AND request.workspaceId = :workspaceId AND request.agencyClientId = :agencyClientId AND request.companyContextId = :companyContextId', this.scopeWhere(scope));
    if (filters.status) qb.andWhere('request.status = :status', { status: filters.status });
    if (filters.stage) qb.andWhere('request.currentStage = :stage', { stage: filters.stage });
    if (filters.subjectType) qb.andWhere('request.subjectType = :subjectType', { subjectType: filters.subjectType });
    if (filters.search?.trim()) qb.andWhere('request.title ILIKE :search', { search: `%${filters.search.trim()}%` });
    const items = await qb.orderBy('request.createdAt', 'DESC').getMany(); return { items, total: items.length };
  }
  async detail(scope: CompanyAwareScope, id: string) { const request = await this.find(scope, id); const [comments, decisions] = await Promise.all([this.comments.find({ where: { approvalRequestId: id }, order: { createdAt: 'ASC' } }), this.decisions.find({ where: { approvalRequestId: id }, order: { createdAt: 'ASC' } })]); return { ...request, comments, decisions }; }
  async submit(scope: CompanyAwareScope, id: string, actorUserId: string | null | undefined) { this.user(actorUserId); const item = await this.find(scope, id); this.assertStatus(item, ['draft', 'changes_requested']); item.status = 'awaiting_internal_review'; item.currentStage = 'internal'; return this.requests.save(item); }
  async comment(scope: CompanyAwareScope, id: string, actorUserId: string | null | undefined, body: string) { const actor = this.user(actorUserId); const request = await this.find(scope, id); if (!ACTIVE.includes(request.status as (typeof ACTIVE)[number])) throw new ConflictException('Não é possível comentar em uma aprovação encerrada.'); return this.dataSource.transaction((manager) => this.addCommentEntity(manager, request, actor, body, request.currentStage)); }
  async approveInternal(scope: CompanyAwareScope, id: string, actorUserId: string | null | undefined) { const actor = this.user(actorUserId); return this.dataSource.transaction(async (manager) => { const request = await manager.getRepository(SocialApprovalRequestEntity).findOne({ where: { ...this.scopeWhere(scope), id } }); if (!request) throw new NotFoundException('Aprovação não encontrada no contexto atual.'); this.assertStatus(request, ['awaiting_internal_review']); await this.decision(manager, request, 'internal', 'approved', actor, null); request.status = 'awaiting_client'; request.currentStage = 'client'; request.sentToClientAt = new Date(); return manager.save(request); }); }
  /** The Agency boundary can decide only the internal stage. */
  async requestChanges(scope: CompanyAwareScope, id: string, actorUserId: string | null | undefined, body: string) { const actor = this.user(actorUserId); return this.requestChangesAs(scope, id, actor, body, 'internal'); }
  /** Client Area will call this domain method with its authenticated real user; AP1 intentionally exposes no client route. */
  async clientApprove(scope: CompanyAwareScope, id: string, actor: ApprovalActor) { this.validateActor(actor); return this.dataSource.transaction(async (manager) => { const request = await manager.getRepository(SocialApprovalRequestEntity).findOne({ where: { ...this.scopeWhere(scope), id } }); if (!request) throw new NotFoundException('Aprovação não encontrada no contexto atual.'); this.assertStatus(request, ['awaiting_client']); await this.decision(manager, request, 'client', 'approved', actor, null); request.status = 'approved'; request.approvedAt = new Date(); return manager.save(request); }); }
  async clientRequestChanges(scope: CompanyAwareScope, id: string, actor: ApprovalActor, body: string) { this.validateActor(actor); return this.requestChangesAs(scope, id, actor, body, 'client'); }
  private async requestChangesAs(scope: CompanyAwareScope, id: string, actor: ApprovalActor, body: string, stage: SocialApprovalStage) { return this.dataSource.transaction(async (manager) => { const request = await manager.getRepository(SocialApprovalRequestEntity).findOne({ where: { ...this.scopeWhere(scope), id } }); if (!request) throw new NotFoundException('Aprovação não encontrada no contexto atual.'); this.assertStatus(request, stage === 'client' ? ['awaiting_client'] : ['awaiting_internal_review']); const comment = await this.addCommentEntity(manager, request, actor, body, stage); await this.decision(manager, request, stage, 'changes_requested', actor, comment.id); request.status = 'changes_requested'; request.currentStage = 'internal'; return manager.save(request); }); }
  async cancel(scope: CompanyAwareScope, id: string, actorUserId: string | null | undefined) { this.user(actorUserId); const item = await this.find(scope, id); this.assertStatus(item, ACTIVE); item.status = 'cancelled'; item.cancelledAt = new Date(); return this.requests.save(item); }
  async supersede(scope: CompanyAwareScope, id: string, actorUserId: string | null | undefined) { this.user(actorUserId); const item = await this.find(scope, id); this.assertStatus(item, ACTIVE); item.status = 'superseded'; item.supersededAt = new Date(); return this.requests.save(item); }
  private isActiveUnique(error: unknown) { return typeof error === 'object' && error !== null && ('code' in error && (error as { code?: string }).code === '23505'); }
}
