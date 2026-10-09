import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { ManagedContextDirectoryService } from '../../common/context/managed-context-directory.service';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  approvalScopeKind,
  approvalStagesFor,
  type ApprovalScopeKind,
} from './approval-stage.policy';
import type { ListSocialApprovalInboxDto } from './dto/social-approval.dto';
import {
  SocialApprovalRequestEntity,
  type SocialApprovalStage,
} from './entities';

const DEFAULT_LIMIT = 50;

/** Where an inbox row lives: what the frontend sends as context to act on it. */
export type SocialApprovalInboxContext =
  | { kind: 'own' }
  | {
      kind: 'managed_client';
      clientId: string;
      clientName: string | null;
      companyContextId: string;
      companyName: string | null;
    };

export type SocialApprovalInboxItem = {
  id: string;
  subjectType: string;
  subjectId: string;
  subjectRevisionId: string;
  sourceModule: string;
  displayType: string;
  title: string;
  subjectVersionLabel: string;
  status: string;
  currentStage: SocialApprovalStage;
  stages: readonly SocialApprovalStage[];
  requestedByUserId: string;
  requestedAt: string;
  sentToClientAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  context: SocialApprovalInboxContext;
};

type ContextEntry = Extract<
  SocialApprovalInboxContext,
  { kind: 'managed_client' }
>;

/**
 * CS5 Closeout — one approvals list across every context the caller may
 * operate, so Approvals no longer requires entering Agency → Clients first.
 *
 * Read-only and additive. In agency mode it covers the own scope `(null,
 * null)` plus every (client, company) pair `ManagedContextDirectoryService`
 * authorizes for `social` — the same single source of truth the permission
 * guard and the context switcher use, so nothing appears here that the
 * caller could not open by switching context. In client mode it is exactly
 * the current context. Decisions are NOT taken here: each row carries its
 * `context`, and the existing per-context endpoints (with that context's
 * headers) stay the only way to act, so every scope rule still applies.
 */
@Injectable()
export class SocialApprovalInboxService {
  constructor(
    @InjectRepository(SocialApprovalRequestEntity, 'agency')
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    private readonly directory: ManagedContextDirectoryService,
  ) {}

  async list(
    ctx: RequestContext,
    filters: ListSocialApprovalInboxDto,
  ): Promise<{ items: SocialApprovalInboxItem[]; nextCursor: string | null }> {
    const scope = resolveCompanyAwareScope(ctx);
    const includeOwn =
      approvalScopeKind(scope) === 'own' && filters.scope !== 'managed';
    const companies =
      filters.scope === 'own' ? [] : await this.companies(ctx, scope);
    if (!includeOwn && companies.length === 0)
      return { items: [], nextCursor: null };

    const qb = this.requests
      .createQueryBuilder('request')
      .where(
        'request.tenantId = :tenantId AND request.workspaceId = :workspaceId',
        { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      )
      .andWhere(
        new Brackets((where) => {
          if (includeOwn)
            where.orWhere(
              'request.agencyClientId IS NULL AND request.companyContextId IS NULL',
            );
          companies.forEach((company, index) =>
            where.orWhere(
              `request.agencyClientId = :client${index} AND request.companyContextId = :company${index}`,
              {
                [`client${index}`]: company.clientId,
                [`company${index}`]: company.companyContextId,
              },
            ),
          );
        }),
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
    if (filters.cursor) {
      const cursor = new Date(filters.cursor);
      if (Number.isNaN(cursor.getTime()))
        throw new BadRequestException('Cursor inválido.');
      qb.andWhere('request.createdAt < :cursor', { cursor });
    }
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const rows = await qb
      .orderBy('request.createdAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .take(limit + 1)
      .getMany();
    const page = rows.slice(0, limit);
    const byPair = new Map(
      companies.map((company) => [
        `${company.clientId}:${company.companyContextId}`,
        company,
      ]),
    );
    return {
      items: page.map((request) => this.toItem(request, byPair)),
      nextCursor:
        rows.length > limit
          ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
          : null,
    };
  }

  /** The (client, company) pairs this caller may operate Social in. */
  private async companies(
    ctx: RequestContext,
    scope: ReturnType<typeof resolveCompanyAwareScope>,
  ): Promise<ContextEntry[]> {
    if (scope.agencyClientId && scope.companyContextId)
      return [
        {
          kind: 'managed_client',
          clientId: scope.agencyClientId,
          clientName: ctx.managedContext?.clientName ?? null,
          companyContextId: scope.companyContextId,
          companyName: ctx.managedContext?.companyName ?? null,
        },
      ];
    if (!ctx.userId) return [];
    const clients = await this.directory.listAuthorizedClients(
      {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId: ctx.userId,
        role: ctx.role ?? 'member',
      },
      'social',
    );
    return clients.flatMap((client) =>
      client.companies.map((company) => ({
        kind: 'managed_client' as const,
        clientId: client.clientId,
        clientName: client.displayName,
        companyContextId: company.companyContextId,
        companyName: company.displayName,
      })),
    );
  }

  private toItem(
    request: SocialApprovalRequestEntity,
    byPair: Map<string, ContextEntry>,
  ): SocialApprovalInboxItem {
    const kind: ApprovalScopeKind = approvalScopeKind(request);
    return {
      id: request.id,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      subjectRevisionId: request.subjectRevisionId,
      sourceModule: request.sourceModule,
      displayType: request.displayType,
      title: request.title,
      subjectVersionLabel: request.subjectVersionLabel,
      status: request.status,
      currentStage: request.currentStage,
      stages: approvalStagesFor(request),
      requestedByUserId: request.requestedByUserId,
      requestedAt: request.requestedAt.toISOString(),
      sentToClientAt: request.sentToClientAt?.toISOString() ?? null,
      approvedAt: request.approvedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      context:
        kind === 'own'
          ? { kind: 'own' }
          : byPair.get(
              `${request.agencyClientId}:${request.companyContextId}`,
            )!,
    };
  }
}
