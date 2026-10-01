import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { ClientAreaMembershipEntity } from '../../client-area/entities/client-area-membership.entity';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from '../entities';
import { ApprovalSubjectResolver } from '../subjects/approval-subject-resolver';
import {
  buildClientApprovalActions,
  buildClientApprovalComment,
  buildClientApprovalHistory,
  buildClientApprovalListItem,
  buildClientApprovalPreview,
  type ClientApprovalAuthor,
  type ClientApprovalDetail,
  type ClientApprovalListItem,
  type ClientApprovalPreview,
} from './client-approval.view';
import { resolveReplacementApproval } from './resolve-replacement-approval';

const AGENCY_CONNECTION = 'agency';

/** §17 — the agency side never shows an operator's identifiers to a client. */
const AGENCY_TEAM_LABEL = 'Equipe da agência';

export type ClientApprovalReader = {
  userId: string;
  permissions: { comment: boolean; decide: boolean };
};

/**
 * AP3 — the read side of the Client Area approvals surface.
 *
 * Reads only. Every mutation (view, comment, approve, request changes) goes
 * through `ApprovalClientReviewService` into the existing AP1/AP2 domain, so
 * there is exactly one state machine.
 *
 * TWO INDEPENDENT FILTERS, BOTH FAIL-CLOSED
 * -----------------------------------------
 *  1. Scope: the full `CompanyAwareScope` tuple, which the Client Area derives
 *     from the validated membership (`toCompanyAwareScope`), never from the
 *     path or a header.
 *  2. Phase: `sent_to_client_at IS NOT NULL`. A draft or an
 *     `awaiting_internal_review` request that was never sent does not exist
 *     for a client, whatever its id.
 *
 * A forged approval id therefore 404s the same way an id from another company
 * does — the same generic answer, so nothing is enumerable.
 */
@Injectable()
export class ClientApprovalsService {
  constructor(
    @InjectRepository(SocialApprovalRequestEntity, AGENCY_CONNECTION)
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalCommentEntity, AGENCY_CONNECTION)
    private readonly comments: Repository<SocialApprovalCommentEntity>,
    @InjectRepository(SocialApprovalStageDecisionEntity, AGENCY_CONNECTION)
    private readonly decisions: Repository<SocialApprovalStageDecisionEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profiles: Repository<AgencyUserProfileEntity>,
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly memberships: Repository<ClientAreaMembershipEntity>,
    private readonly subjects: ApprovalSubjectResolver,
  ) {}

  private scopeWhere(scope: CompanyAwareScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId!,
      companyContextId: scope.companyContextId!,
      // The phase filter is part of the scope, not an afterthought a caller
      // could forget: nothing in this service can read an unsent approval.
      sentToClientAt: Not(IsNull()),
    };
  }

  /** The one place an approval id becomes an entity for a client. */
  async findVisible(scope: CompanyAwareScope, approvalId: string) {
    const approval = await this.requests.findOne({
      where: { ...this.scopeWhere(scope), id: approvalId },
    });
    if (!approval) {
      throw new NotFoundException('Aprovação não encontrada.');
    }
    return approval;
  }

  /**
   * The list needs no reader: it carries no per-person field. Actions and
   * comment authorship are detail concerns, and `needsYou` is a property of
   * the approval's state, not of who is asking.
   */
  async list(
    scope: CompanyAwareScope,
  ): Promise<{ items: ClientApprovalListItem[] }> {
    const approvals = await this.requests.find({
      where: this.scopeWhere(scope),
      order: { sentToClientAt: 'DESC' },
    });
    if (approvals.length === 0) return { items: [] };

    // One query for the whole page: the list needs `lastActivityAt`, which
    // depends on client-visible comments.
    const comments = await this.comments.find({
      where: {
        approvalRequestId: In(approvals.map((approval) => approval.id)),
        visibility: 'client',
      },
      order: { createdAt: 'ASC' },
    });
    const commentsByApproval = new Map<string, SocialApprovalCommentEntity[]>();
    for (const comment of comments) {
      const bucket = commentsByApproval.get(comment.approvalRequestId) ?? [];
      bucket.push(comment);
      commentsByApproval.set(comment.approvalRequestId, bucket);
    }

    // AP4 §17 — resolved per superseded row; cheap in practice because a
    // client's list is small and only `replaced` rows ever need the lookup.
    const replacementIds = new Map<string, string>();
    await Promise.all(
      approvals
        .filter((approval) => approval.status === 'superseded')
        .map(async (approval) => {
          const replacement = await resolveReplacementApproval(
            this.requests,
            scope,
            approval,
          );
          if (replacement) replacementIds.set(approval.id, replacement.id);
        }),
    );

    const items = approvals.map((approval) =>
      buildClientApprovalListItem(
        approval,
        commentsByApproval.get(approval.id) ?? [],
        replacementIds.get(approval.id) ?? null,
      ),
    );

    // §33 — "what needs my attention?" is answered by the order, not by a
    // dashboard. Pending first, then most recent activity.
    items.sort((a, b) => {
      if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });

    return { items };
  }

  async detail(
    scope: CompanyAwareScope,
    approvalId: string,
    reader: ClientApprovalReader,
  ): Promise<ClientApprovalDetail> {
    const approval = await this.findVisible(scope, approvalId);
    const [comments, decisions, preview] = await Promise.all([
      this.comments.find({
        where: { approvalRequestId: approval.id, visibility: 'client' },
        order: { createdAt: 'ASC' },
      }),
      this.decisions.find({
        // Internal decisions never reach a client, by query, not by filtering
        // a fuller result afterwards.
        where: { approvalRequestId: approval.id, stage: 'client' },
        order: { createdAt: 'ASC' },
      }),
      // Reuses the entity already fetched above instead of calling the
      // public `preview()` method, which would re-run `findVisible` a second
      // time for the same id (AP4 — keeps `findOne` call count predictable
      // now that a `replaced` detail also needs a lookup of its own).
      this.subjects
        .getPreview(scope, {
          subjectType: approval.subjectType as
            | 'creative_version'
            | 'planner_content_revision',
          subjectId: approval.subjectId,
          subjectRevisionId: approval.subjectRevisionId,
          title: approval.title,
          subjectVersionLabel: approval.subjectVersionLabel,
        })
        .then(buildClientApprovalPreview),
    ]);

    const names = await this.resolveAuthors(scope, [
      ...comments.map((comment) => comment.actorUserId),
      ...decisions.map((decision) => decision.actorUserId),
      approval.clientViewedByUserId,
    ]);

    const replacement =
      approval.status === 'superseded'
        ? await resolveReplacementApproval(this.requests, scope, approval)
        : null;

    return {
      ...buildClientApprovalListItem(
        approval,
        comments,
        replacement?.id ?? null,
      ),
      preview,
      comments: comments.map((comment) =>
        buildClientApprovalComment(
          comment,
          names.authorFor(comment.actorUserId),
          reader.userId,
        ),
      ),
      history: buildClientApprovalHistory(
        approval,
        decisions,
        comments,
        (userId) => names.authorFor(userId).name,
      ),
      actions: buildClientApprovalActions(approval, reader.permissions),
    };
  }

  /**
   * §23 — always the immutable `subject_revision_id` recorded on the approval,
   * never the current item, latest creative version or newest planner value.
   */
  async preview(
    scope: CompanyAwareScope,
    approvalId: string,
  ): Promise<ClientApprovalPreview> {
    const approval = await this.findVisible(scope, approvalId);
    const resolved = await this.subjects.getPreview(scope, {
      subjectType: approval.subjectType as
        | 'creative_version'
        | 'planner_content_revision',
      subjectId: approval.subjectId,
      subjectRevisionId: approval.subjectRevisionId,
      title: approval.title,
      subjectVersionLabel: approval.subjectVersionLabel,
    });
    return buildClientApprovalPreview(resolved);
  }

  /**
   * Display names for the people in a thread (§17).
   *
   * A client author is someone with a membership in *this* company: their name
   * comes from the shared identity profile, and the `side` is `client`.
   * Anyone else is the agency, and is shown as the agency team label rather
   * than an operator's name — a support rota is not something a customer
   * should learn from a comment thread. Either way no user id is emitted.
   */
  private async resolveAuthors(
    scope: CompanyAwareScope,
    userIds: readonly (string | null)[],
  ) {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) {
      return { authorFor: () => agencyAuthor() };
    }

    const [clientMemberships, profiles] = await Promise.all([
      this.memberships.find({
        where: {
          tenantId: scope.tenantId,
          companyContextId: scope.companyContextId!,
          userId: In(ids),
        },
      }),
      this.profiles.find({
        where: ids.map((userId) => ({ tenantId: scope.tenantId, userId })),
      }),
    ]);

    // Membership status is deliberately ignored here: a person who commented
    // and later lost access keeps their name on what they already wrote.
    const clientUserIds = new Set(
      clientMemberships.map((membership) => membership.userId),
    );
    const nameByUserId = new Map(
      profiles
        .filter((profile) => profile.displayName?.trim())
        .map((profile) => [profile.userId, profile.displayName.trim()]),
    );

    return {
      authorFor: (userId: string | null): ClientApprovalAuthor => {
        if (!userId || !clientUserIds.has(userId)) return agencyAuthor();
        return {
          name: nameByUserId.get(userId) ?? 'Usuário',
          side: 'client',
        };
      },
    };
  }
}

function agencyAuthor(): ClientApprovalAuthor {
  return { name: AGENCY_TEAM_LABEL, side: 'agency' };
}
