import { Injectable, NotFoundException } from '@nestjs/common';
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
import { approvalScopeWhere } from '../approval-scope';
import { SocialApprovalPieceSyncService } from '../social-approval-piece-sync.service';
import { parseBoardCursor } from '../social-approval-board.service';
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
const SENT_TO_CLIENT = `EXISTS (
  SELECT 1 FROM "social_approval_requests" sent
    JOIN "social_approval_steps" sent_step ON sent_step.id = sent.step_id
   WHERE sent_step.piece_id = piece.id AND sent.sent_to_client_at IS NOT NULL
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
  ) {}

  private companySource(
    scope: CompanyAwareScope,
    reader?: ClientApprovalReader,
  ): ClientBoardSource {
    return {
      scope,
      visibleSql: SENT_TO_CLIENT,
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
      .andWhere(source.visibleSql);
  }

  private async latestSent(
    scope: CompanyAwareScope,
    steps: readonly SocialApprovalStepEntity[],
  ) {
    const latest = new Map<string, SocialApprovalRequestEntity>();
    if (steps.length === 0) return latest;
    const requests = await this.requests.find({
      where: {
        ...approvalScopeWhere(scope),
        stepId: In(steps.map((step) => step.id)),
        sentToClientAt: Not(IsNull()),
      },
      order: { sentToClientAt: 'ASC' },
    });
    for (const request of requests) latest.set(request.stepId!, request);
    return latest;
  }

  board(scope: CompanyAwareScope, query: ClientApprovalBoardQueryDto) {
    return this.boardFor(this.companySource(scope), query);
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
        result[column] = {
          items: pieces.map((piece) =>
            buildClientBoardCard(
              present(piece),
              steps.filter((step) => step.pieceId === piece.id),
              latest,
            ),
          ),
          total,
          nextCursor:
            offset + pieces.length < total
              ? String(offset + pieces.length)
              : null,
        };
      }),
    );
    return { columns: result };
  }

  async pieceFor(
    source: ClientBoardSource,
    pieceId: string,
  ): Promise<ClientPieceDetail> {
    const piece = await this.visible(source)
      .andWhere('piece.id = :pieceId', { pieceId })
      .getOne();
    if (!piece) throw new NotFoundException('Aprovação não encontrada.');
    const steps = await this.steps.find({
      where: { pieceId: piece.id },
      order: { position: 'ASC' },
    });
    const latest = await source.latestVisible(steps);
    const present = source.presentPiece ?? ((item) => item);
    return {
      ...buildClientBoardCard(present(piece), steps, latest),
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
