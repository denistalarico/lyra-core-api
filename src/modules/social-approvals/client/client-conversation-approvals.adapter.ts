import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import type {
  ClientConversationApprovalsPort,
  ConversationApprovalCardState,
  ConversationApprovalCommentItem,
} from '../../client-conversations/client-conversation-approvals.port';
import type { ClientConversationScope } from '../../client-conversations/services/client-conversation-access';
import {
  SocialApprovalCommentEntity,
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
} from '../entities';
import { SocialApprovalAuthorityService } from '../social-approval-authority.service';
import { SocialApprovalSettingsService } from '../social-approval-settings.service';
import { ClientApprovalsService } from './client-approvals.service';
import { buildClientApprovalListItem } from './client-approval.view';
import { resolveReplacementApproval } from './resolve-replacement-approval';

const AGENCY_CONNECTION = 'agency';
/** D-19: what a batch card lists; the board shows the rest. */
const MAX_BATCH_ITEMS = 50;

/**
 * CCOM2 §11/§16/§17 — the approvals side of the conversation timeline.
 *
 * Implements the port the conversations domain declared, using the *existing*
 * AP3 projection. Specifically:
 *
 *   cards     `buildClientApprovalListItem`, the same function the Client Area
 *             approvals list and the support preview render from, including
 *             AP4's `replacementApprovalId` resolution
 *   comments  the same `visibility='client'` query and the same author
 *             resolution (`Equipe da agência` for anyone without a membership
 *             in this company)
 *
 * §11 forbids a second projector, and the reason is concrete: the AP3
 * projection is built field by field and `client-approval.contract.spec.ts`
 * fails the build if an internal key appears in its output. A card-specific
 * projector would be a second place where a column added to the request entity
 * could start reaching customers, with no such test guarding it.
 *
 * THE VISIBILITY RULE IS NOT REIMPLEMENTED EITHER
 * -----------------------------------------------
 * Every read here goes through the same two fail-closed filters AP3 uses: the
 * full scope tuple, and `sent_to_client_at IS NOT NULL`. An approval that was
 * never sent to the client does not exist for this timeline whatever its id, so
 * a forged `metadata.card.approvalId` resolves to nothing (§15).
 */
@Injectable()
export class ClientConversationApprovalsAdapter implements ClientConversationApprovalsPort {
  constructor(
    @InjectRepository(SocialApprovalRequestEntity, AGENCY_CONNECTION)
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalCommentEntity, AGENCY_CONNECTION)
    private readonly comments: Repository<SocialApprovalCommentEntity>,
    @InjectRepository(SocialApprovalStepEntity, AGENCY_CONNECTION)
    private readonly steps: Repository<SocialApprovalStepEntity>,
    @InjectRepository(SocialApprovalPieceEntity, AGENCY_CONNECTION)
    private readonly pieces: Repository<SocialApprovalPieceEntity>,
    private readonly approvals: ClientApprovalsService,
    private readonly authority: SocialApprovalAuthorityService,
    private readonly settings: SocialApprovalSettingsService,
  ) {}

  /**
   * The conversation scope is already a narrower shape than
   * `CompanyAwareScope` — all four ids non-null, which is exactly what the
   * approvals queries require. `toConversationScope` proved that on the way in
   * (CCOM1 §6), so this widening is safe in the direction that matters.
   */
  private toApprovalScope(scope: ClientConversationScope): CompanyAwareScope {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
    } as CompanyAwareScope;
  }

  /** The visibility rule, stated once: scope tuple + sent phase. */
  private visibleWhere(scope: ClientConversationScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      sentToClientAt: Not(IsNull()),
    };
  }

  async resolveCards(
    scope: ClientConversationScope,
    approvalIds: readonly string[],
    reader: { userId: string | null },
  ): Promise<Map<string, ConversationApprovalCardState>> {
    const resolved = new Map<string, ConversationApprovalCardState>();
    if (approvalIds.length === 0) return resolved;

    const approvals = await this.requests.find({
      where: { ...this.visibleWhere(scope), id: In([...approvalIds]) },
    });
    if (approvals.length === 0) return resolved;

    const approvalScope = this.toApprovalScope(scope);
    const [pieces, batches, settings] = await Promise.all([
      this.pieceFacts(approvals),
      this.batchMembers(scope, approvals),
      reader.userId ? this.settings.get(approvalScope) : null,
    ]);

    /** D-17, re-read per request, so a revoked person loses it immediately. */
    const designatedFor = async (approval: SocialApprovalRequestEntity) =>
      reader.userId && settings && approval.status === 'awaiting_client'
        ? this.authority.canDecideClient(
            this.requests.manager,
            approvalScope,
            approval,
            settings,
            reader.userId,
          )
        : false;

    for (const approval of approvals) {
      // AP4 — only a `superseded` row can carry a replacement, and the
      // resolver proves it is itself client-visible in this same company
      // before the id is offered as navigation (§39).
      const replacement =
        approval.status === 'superseded'
          ? await resolveReplacementApproval(
              this.requests,
              approvalScope,
              approval,
            )
          : null;

      const item = buildClientApprovalListItem(
        approval,
        [],
        replacement?.id ?? null,
      );

      const members = approval.batchId
        ? (batches.get(approval.batchId) ?? [])
        : [];
      const batched = members.length > 1;
      const open = batched
        ? members.find((member) => member.status === 'awaiting_client')
        : approval;
      const designated = reader.userId
        ? await designatedFor(open ?? approval)
        : undefined;
      const batch = batched ? this.batchState(members) : undefined;
      const status = batch
        ? batch.pending > 0
          ? ('awaiting_your_review' as const)
          : batch.items.every((entry) => entry.status === 'approved')
            ? ('approved' as const)
            : item.status
        : item.status;

      resolved.set(approval.id, {
        approvalId: item.id,
        title: item.title,
        displayType: item.displayType,
        versionLabel: item.versionLabel,
        status,
        needsAction:
          (batch ? batch.pending > 0 : item.needsYou) && designated !== false,
        sentToClientAt: item.sentToClientAt,
        ...(item.replacementApprovalId
          ? { replacementApprovalId: item.replacementApprovalId }
          : {}),
        ...(pieces.has(approval.id) ? { piece: pieces.get(approval.id)! } : {}),
        ...(designated === undefined ? {} : { designated }),
        ...(batch ? { batch } : {}),
      });
    }

    return resolved;
  }

  /** Field by field, through the same projector as a single card (§11). */
  private batchState(members: readonly SocialApprovalRequestEntity[]) {
    const items = members.map((member) => {
      const item = buildClientApprovalListItem(member, [], null);
      return {
        approvalId: item.id,
        title: item.title,
        displayType: item.displayType,
        versionLabel: item.versionLabel,
        status: item.status,
        needsAction: item.needsYou,
      };
    });
    return {
      total: items.length,
      pending: items.filter((entry) => entry.needsAction).length,
      items: items.slice(0, MAX_BATCH_ITEMS),
    };
  }

  /** Visible members of each batch, under the same rule as the cards. */
  private async batchMembers(
    scope: ClientConversationScope,
    approvals: readonly SocialApprovalRequestEntity[],
  ) {
    const batchIds = [
      ...new Set(
        approvals
          .map((approval) => approval.batchId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const byBatch = new Map<string, SocialApprovalRequestEntity[]>();
    if (batchIds.length === 0) return byBatch;
    const members = await this.requests.find({
      where: { ...this.visibleWhere(scope), batchId: In(batchIds) },
      order: { sentToClientAt: 'ASC', id: 'ASC' },
    });
    for (const member of members) {
      const bucket = byBatch.get(member.batchId!) ?? [];
      bucket.push(member);
      byBatch.set(member.batchId!, bucket);
    }
    return byBatch;
  }

  /** The piece and step of each approval; absent for an unbackfilled row. */
  private async pieceFacts(approvals: readonly SocialApprovalRequestEntity[]) {
    const facts = new Map<
      string,
      NonNullable<ConversationApprovalCardState['piece']>
    >();
    const stepIds = [
      ...new Set(
        approvals
          .map((approval) => approval.stepId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (stepIds.length === 0) return facts;
    const steps = await this.steps.find({ where: { id: In(stepIds) } });
    const pieces = steps.length
      ? await this.pieces.find({
          where: { id: In(steps.map((step) => step.pieceId)) },
        })
      : [];
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
    for (const approval of approvals) {
      const step = approval.stepId ? stepById.get(approval.stepId) : undefined;
      const piece = step ? pieceById.get(step.pieceId) : undefined;
      if (step && piece)
        facts.set(approval.id, {
          id: piece.id,
          kind: piece.kind,
          stepKind: step.kind,
          stepTitle: step.title,
        });
    }
    return facts;
  }

  /**
   * Client-visible comments of this company's visible approvals.
   *
   * Two-step by necessity: `social_approval_comments` carries no scope columns
   * of its own (its scope is its approval's), so the approvals are selected
   * under the visibility rule first and the comments are then restricted to
   * those ids. Querying comments first and filtering afterwards would mean a
   * moment where an internal or out-of-scope row was in hand.
   */
  async listClientVisibleComments(
    scope: ClientConversationScope,
    query: {
      before?: Date | null;
      limit: number;
      readerUserId?: string | null;
    },
  ): Promise<ConversationApprovalCommentItem[]> {
    const approvals = await this.requests.find({
      where: this.visibleWhere(scope),
      select: { id: true, title: true, subjectVersionLabel: true },
    });
    if (approvals.length === 0) return [];

    const byId = new Map(approvals.map((approval) => [approval.id, approval]));

    const rows = await this.comments.find({
      where: {
        approvalRequestId: In([...byId.keys()]),
        // §16/§49 — audience is `visibility`, never `stage`. An agency note
        // taken while the request waits on the client is `stage='client'` with
        // `visibility='internal'`, and reading `stage` here would publish it.
        visibility: 'client',
        /**
         * `<=`, not `<`, and that is deliberate (CCOM2 §23).
         *
         * The caller's cursor key is `(created_at, source, id)`, and this query
         * can only narrow by timestamp — the conversations domain owns the key
         * and this module should not learn its shape. A strict `<` here would
         * drop a comment sharing the cursor's exact timestamp *before* the
         * caller's full-key filter ever saw it, which is a skipped line.
         * Over-fetching the boundary timestamp and letting the caller cut by
         * the whole key is the direction that cannot lose a row.
         */
        ...(query.before ? { createdAt: LessThanOrEqual(query.before) } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      /**
       * One extra row beyond what the caller asked for, because the `<=` above
       * can return rows at the boundary timestamp that the caller's full-key
       * filter will then discard. Without the margin, a discarded boundary row
       * would shrink this source's window below `limit + 1` and the merge could
       * report "no more" while older comments remained.
       */
      take: query.limit + 1,
    });
    if (rows.length === 0) return [];

    // §17 — the same author resolution as the AP3 detail: a person with a
    // membership in *this* company is named, and everyone else is the agency
    // team label. No operator name and no user id ever reaches the output.
    const authors = await this.approvals.resolveTimelineAuthors(
      this.toApprovalScope(scope),
      rows.map((row) => row.actorUserId),
    );

    return rows.map((row) => {
      const approval = byId.get(row.approvalRequestId)!;
      const author = authors.authorFor(row.actorUserId);
      return {
        id: row.id,
        approvalId: row.approvalRequestId,
        authorName: author.name,
        authorSide: author.side,
        body: row.body,
        createdAt: row.createdAt,
        approvalTitle: approval.title,
        approvalVersion: approval.subjectVersionLabel,
        mine: Boolean(
          query.readerUserId &&
          author.side === 'client' &&
          row.actorUserId === query.readerUserId,
        ),
      };
    });
  }

  /**
   * §13/§14 — what the reader may do right now.
   *
   * Three independent conditions, all re-evaluated per request:
   *
   *   module      the **approvals** module, not conversations (CCOM0 §11). A
   *               client with conversations on and approvals off sees the card
   *               as a record and gets no action — never a button that 403s.
   *   state       only an approval still `awaiting_your_review` is actionable;
   *               the domain re-checks this on the mutation and would answer
   *               409, so offering it would be a lie.
   *   permission  the role preset's own keys, which is why a viewer reads the
   *               card and cannot decide (§48).
   *
   * `canOpenPreview` follows the module and the view right: the drawer fetches
   * through the AP3 routes, so without the module there is nothing to open.
   */
  resolveActions(input: {
    state: ConversationApprovalCardState;
    approvalsModuleEnabled: boolean;
    permissions: { comment: boolean; decide: boolean };
  }): { canComment: boolean; canDecide: boolean; canOpenPreview: boolean } {
    if (!input.approvalsModuleEnabled) {
      return { canComment: false, canDecide: false, canOpenPreview: false };
    }

    const open = input.state.status === 'awaiting_your_review';
    return {
      canComment: open && input.permissions.comment,
      // D-17: the role grants the right, and the designation narrows it.
      canDecide:
        open && input.permissions.decide && input.state.designated !== false,
      canOpenPreview: true,
    };
  }
}
