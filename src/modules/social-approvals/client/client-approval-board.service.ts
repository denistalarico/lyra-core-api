import { approvalPiecePost } from '../approval-piece-post';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import type { ClientApprovalBoardQueryDto } from '../dto/social-approval-piece.dto';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
  type SocialApprovalBoardColumn,
} from '../entities';
import { SocialContentItemEntity } from '../../social-planner/entities';
import { ApprovalSubjectResolver } from '../subjects/approval-subject-resolver';
import { approvalScopeWhere } from '../approval-scope';
import { SocialApprovalPieceSyncService } from '../social-approval-piece-sync.service';
import {
  parseBoardCursor,
  SocialApprovalBoardService,
} from '../social-approval-board.service';
import { SocialApprovalPieceActionsService } from '../social-approval-piece-actions.service';
import {
  agencyColumnsFor,
  buildClientBoardCard,
  buildClientBoardStep,
  CLIENT_BOARD_COLUMNS,
  type ClientBoardColumn,
  type ClientPieceDetail,
} from './client-approval-board.view';
import type { ClientApprovalDetail } from './client-approval.view';
import {
  ClientApprovalsService,
  type ClientApprovalReader,
} from './client-approvals.service';

const DEFAULT_LIMIT = 30;
const WORK_ITEMS_LIMIT = 50;

export type ClientPieceAction = 'finish' | 'archive' | 'unarchive' | 'delete';

export type ClientWorkItemsQuery = { taskId: string; subtaskId?: string };
const SENT_TO_CLIENT = `EXISTS (
  SELECT 1 FROM "social_approval_requests" sent
    JOIN "social_approval_steps" sent_step ON sent_step.id = sent.step_id
   WHERE sent_step.piece_id = piece.id AND sent.sent_to_client_at IS NOT NULL
     AND sent_step.current_request_id IS NOT NULL
)`;

/**
 * What differs between a company's board and the agency's own (D-24): which
 * pieces exist for the reader and which request each step shows. The board
 * itself, its columns and its projection are the same code.
 */
export type ClientBoardSource = {
  scope: CompanyAwareScope;
  /** Piece-level phase rule, over the alias `piece`. */
  visibleSql: string;
  canManage?: boolean;
  columnsFor: (column: ClientBoardColumn) => SocialApprovalBoardColumn[];
  latestVisible: (
    steps: readonly SocialApprovalStepEntity[],
  ) => Promise<Map<string, SocialApprovalRequestEntity>>;
  /** Maps a piece to the client vocabulary before it is projected. */
  presentPiece?: (
    piece: SocialApprovalPieceEntity,
  ) => SocialApprovalPieceEntity;
  detail: (approvalId: string) => Promise<ClientApprovalDetail>;
};

/**
 * AR1 — the client's board and piece. Same two fail-closed filters as
 * `ClientApprovalsService`: the company scope from the membership, and the
 * phase rule. A piece nothing of which was ever sent does not exist here
 * (AP3), and a forged id answers the same 404 as one from another company.
 */
@Injectable()
export class ClientApprovalBoardService {
  constructor(
    @InjectRepository(SocialApprovalPieceEntity, 'agency')
    private readonly pieces: Repository<SocialApprovalPieceEntity>,
    @InjectRepository(SocialApprovalStepEntity, 'agency')
    private readonly steps: Repository<SocialApprovalStepEntity>,
    @InjectRepository(SocialApprovalRequestEntity, 'agency')
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    private readonly approvals: ClientApprovalsService,
    private readonly sync: SocialApprovalPieceSyncService,
    private readonly subjects: ApprovalSubjectResolver,
    private readonly agencyBoard: SocialApprovalBoardService,
    private readonly pieceActions: SocialApprovalPieceActionsService,
  ) {}

  private companySource(
    scope: CompanyAwareScope,
    reader?: ClientApprovalReader,
  ): ClientBoardSource {
    return {
      scope,
      visibleSql: SENT_TO_CLIENT,
      canManage: reader?.permissions.manage,
      columnsFor: agencyColumnsFor,
      latestVisible: (steps) => this.latestSent(scope, steps),
      detail: (approvalId) =>
        this.approvals.detail(
          scope,
          approvalId,
          reader as ClientApprovalReader,
        ),
    };
  }

  private visible(source: ClientBoardSource) {
    return this.pieces
      .createQueryBuilder('piece')
      .where(approvalScopeWhere(source.scope))
      .andWhere(`piece.sourceState <> 'hidden'`)
      .andWhere('piece.deletedAt IS NULL')
      .andWhere(source.visibleSql);
  }

  private async latestSent(
    scope: CompanyAwareScope,
    steps: readonly SocialApprovalStepEntity[],
  ) {
    const latest = new Map<string, SocialApprovalRequestEntity>();
    // A withdrawn step has no current request and shows nothing to the client.
    const attached = steps.filter((step) => step.currentRequestId);
    if (attached.length === 0) return latest;
    const requests = await this.requests.find({
      where: {
        ...approvalScopeWhere(scope),
        stepId: In(attached.map((step) => step.id)),
        sentToClientAt: Not(IsNull()),
      },
      order: { sentToClientAt: 'ASC' },
    });
    for (const request of requests) latest.set(request.stepId!, request);
    return latest;
  }

  board(
    scope: CompanyAwareScope,
    query: ClientApprovalBoardQueryDto,
    canManage = false,
  ) {
    return this.boardFor({ ...this.companySource(scope), canManage }, query);
  }

  managePiece(
    scope: CompanyAwareScope,
    pieceId: string,
    action: ClientPieceAction,
    reader: ClientApprovalReader,
  ) {
    return this.managePieceFor(
      this.companySource(scope, reader),
      pieceId,
      action,
      reader.userId,
    );
  }

  archiveColumn(
    scope: CompanyAwareScope,
    column: unknown,
    reader: ClientApprovalReader,
  ) {
    return this.archiveColumnFor(
      this.companySource(scope, reader),
      column,
      reader.userId,
    );
  }

  async managePieceFor(
    source: ClientBoardSource,
    pieceId: string,
    action: ClientPieceAction,
    actorUserId: string,
  ) {
    this.requireManage(source);
    await this.findVisiblePiece(source, pieceId);
    try {
      switch (action) {
        case 'finish':
          return await this.pieceActions.finish(
            source.scope,
            pieceId,
            actorUserId,
            undefined,
            () =>
              Promise.reject(
                new ConflictException(
                  'A peça precisa estar aprovada para finalizar.',
                ),
              ),
          );
        case 'archive':
        case 'unarchive':
          return await this.pieceActions.setArchived(
            source.scope,
            pieceId,
            actorUserId,
            action === 'archive',
          );
        case 'delete':
          return await this.pieceActions.remove(
            source.scope,
            pieceId,
            actorUserId,
            true,
          );
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new ConflictException({
          code: `approval_piece_${action}_conflict`,
          message: error.message,
        });
      }
      throw error;
    }
  }

  async archiveColumnFor(
    source: ClientBoardSource,
    column: unknown,
    actorUserId: string,
  ) {
    this.requireManage(source);
    const target = CLIENT_BOARD_COLUMNS.find((option) => option === column);
    if (!target)
      throw new BadRequestException({
        code: 'approval_invalid_board_column',
        message: 'Coluna de aprovações inválida.',
      });
    const cards = await this.visible(source)
      .andWhere('piece.boardColumn IN (:...columns)', {
        columns: source.columnsFor(target),
      })
      .andWhere('piece.archivedAt IS NULL')
      .getMany();
    return this.agencyBoard.archiveCards(cards, actorUserId);
  }

  private requireManage(source: ClientBoardSource) {
    if (!source.canManage)
      throw new BadRequestException({
        code: 'approval_manage_requires_owner',
        message: 'Só o Owner pode gerenciar as peças de aprovação.',
      });
  }

  workItems(scope: CompanyAwareScope, query: ClientWorkItemsQuery) {
    return this.workItemsFor(this.companySource(scope), query);
  }

  piece(
    scope: CompanyAwareScope,
    pieceId: string,
    reader: ClientApprovalReader,
  ): Promise<ClientPieceDetail> {
    return this.pieceFor(this.companySource(scope, reader), pieceId);
  }

  async boardFor(
    source: ClientBoardSource,
    query: ClientApprovalBoardQueryDto,
  ) {
    await this.sync.syncContexts(source.scope, [
      {
        clientId: source.scope.agencyClientId,
        companyContextId: source.scope.companyContextId,
      },
    ]);
    const present = source.presentPiece ?? ((piece) => piece);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = parseBoardCursor(query.cursor);
    const columns = query.column ? [query.column] : [...CLIENT_BOARD_COLUMNS];
    const result: Record<string, unknown> = {};
    await Promise.all(
      columns.map(async (column) => {
        const [pieces, total] = await this.visible(source)
          .andWhere('piece.boardColumn IN (:...columns)', {
            columns: source.columnsFor(column),
          })
          .orderBy('piece.updatedAt', 'DESC')
          .addOrderBy('piece.id', 'DESC')
          .skip(offset)
          .take(limit)
          .getManyAndCount();
        const steps = pieces.length
          ? await this.steps.find({
              where: { pieceId: In(pieces.map((piece) => piece.id)) },
              order: { position: 'ASC' },
            })
          : [];
        const latest = await source.latestVisible(steps);
        const thumbnails = await this.subjects.thumbnailPaths([
          ...latest.values(),
        ]);
        const itemIds = pieces
          .filter((piece) => piece.kind === 'content_item' && piece.sourceId)
          .map((piece) => piece.sourceId as string);
        const inCampaign = new Set(
          itemIds.length
            ? (
                await this.pieces.manager.find(SocialContentItemEntity, {
                  where: {
                    id: In(itemIds),
                    campaignInstanceId: Not(IsNull()),
                  },
                  select: { id: true },
                })
              ).map((item) => item.id)
            : [],
        );
        result[column] = {
          items: pieces.map((piece) => {
            const pieceSteps = steps.filter(
              (step) => step.pieceId === piece.id,
            );
            const request = pieceSteps
              .map((step) => latest.get(step.id))
              .find((item) => item && thumbnails.has(item.id));
            return buildClientBoardCard(present(piece), pieceSteps, latest, {
              canManage: source.canManage,
              inCampaign: Boolean(
                piece.sourceId && inCampaign.has(piece.sourceId),
              ),
              thumbnail: request
                ? {
                    approvalId: request.id,
                    ref: thumbnails.get(request.id)!.ref,
                  }
                : null,
            });
          }),
          total,
          nextCursor:
            offset + pieces.length < total
              ? String(offset + pieces.length)
              : null,
        };
      }),
    );
    return { columns: result, ...(source.canManage && { canArchive: true }) };
  }

  /**
   * AR4 / D-06 — the read-only section of a task or subtask. The company rule
   * and the phase rule are the same as the board: an id from another company
   * or a piece never sent to the client simply matches nothing.
   */
  async workItemsFor(source: ClientBoardSource, query: ClientWorkItemsQuery) {
    const subtask = query.subtaskId
      ? 'AND work_step.work_subtask_id = :workSubtaskId'
      : '';
    const linkSubtask = query.subtaskId
      ? 'AND work_link.subtask_id = :workSubtaskId'
      : '';
    const pieces = await this.visible(source)
      .andWhere(
        `(EXISTS (
            SELECT 1 FROM "social_approval_steps" work_step
             WHERE work_step.piece_id = piece.id
               AND work_step.work_task_id = :workTaskId ${subtask}
          ) OR (piece.kind = 'content_item' AND piece.source_id IN (
            SELECT work_link.content_item_id FROM "social_content_work_links" work_link
             WHERE work_link.task_id = :workTaskId
               AND work_link.cancelled_at IS NULL ${linkSubtask}
          )))`,
        {
          workTaskId: query.taskId,
          ...(query.subtaskId ? { workSubtaskId: query.subtaskId } : {}),
        },
      )
      .orderBy('piece.updatedAt', 'DESC')
      .addOrderBy('piece.id', 'DESC')
      .take(WORK_ITEMS_LIMIT)
      .getMany();
    if (pieces.length === 0) return { items: [] };
    const steps = await this.steps.find({
      where: { pieceId: In(pieces.map((piece) => piece.id)) },
      order: { position: 'ASC' },
    });
    const latest = await source.latestVisible(steps);
    const present = source.presentPiece ?? ((piece) => piece);
    return {
      items: pieces.map((piece) =>
        buildClientBoardCard(
          present(piece),
          steps.filter((step) => step.pieceId === piece.id),
          latest,
        ),
      ),
    };
  }

  private async findVisiblePiece(source: ClientBoardSource, pieceId: string) {
    const piece = await this.visible(source)
      .andWhere('piece.id = :pieceId', { pieceId })
      .getOne();
    if (!piece) throw new NotFoundException('Aprovação não encontrada.');
    return piece;
  }

  async pieceFor(
    source: ClientBoardSource,
    pieceId: string,
  ): Promise<ClientPieceDetail> {
    const piece = await this.findVisiblePiece(source, pieceId);
    const steps = await this.steps.find({
      where: { pieceId: piece.id },
      order: { position: 'ASC' },
    });
    const latest = await source.latestVisible(steps);
    const present = source.presentPiece ?? ((item) => item);
    return {
      ...buildClientBoardCard(present(piece), steps, latest, {
        canManage: source.canManage,
      }),
      description: piece.description,
      post: await approvalPiecePost(this.pieces.manager, piece),
      steps: await Promise.all(
        steps.map(async (step) => {
          const request = latest.get(step.id);
          return {
            ...buildClientBoardStep(step, request),
            approval: request ? await source.detail(request.id) : null,
          };
        }),
      ),
    };
  }
}
