import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import type { ClientApprovalBoardQueryDto } from '../dto/social-approval-piece.dto';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
} from '../entities';
import { approvalScopeWhere } from '../approval-scope';
import { SocialApprovalPieceSyncService } from '../social-approval-piece-sync.service';
import { parseBoardCursor } from '../social-approval-board.service';
import {
  agencyColumnsFor,
  buildClientBoardCard,
  buildClientBoardStep,
  CLIENT_BOARD_COLUMNS,
  type ClientPieceDetail,
} from './client-approval-board.view';
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

  private visible(scope: CompanyAwareScope) {
    return this.pieces
      .createQueryBuilder('piece')
      .where(
        'piece.tenantId = :tenantId AND piece.workspaceId = :workspaceId AND piece.agencyClientId = :clientId AND piece.companyContextId = :companyId',
        {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          clientId: scope.agencyClientId,
          companyId: scope.companyContextId,
        },
      )
      .andWhere(`piece.sourceState <> 'hidden'`)
      .andWhere(SENT_TO_CLIENT);
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

  async board(scope: CompanyAwareScope, query: ClientApprovalBoardQueryDto) {
    await this.sync.syncContexts(scope, [
      {
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      },
    ]);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = parseBoardCursor(query.cursor);
    const columns = query.column ? [query.column] : [...CLIENT_BOARD_COLUMNS];
    const result: Record<string, unknown> = {};
    await Promise.all(
      columns.map(async (column) => {
        const [pieces, total] = await this.visible(scope)
          .andWhere('piece.boardColumn IN (:...columns)', {
            columns: agencyColumnsFor(column),
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
        const latest = await this.latestSent(scope, steps);
        result[column] = {
          items: pieces.map((piece) =>
            buildClientBoardCard(
              piece,
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

  async piece(
    scope: CompanyAwareScope,
    pieceId: string,
    reader: ClientApprovalReader,
  ): Promise<ClientPieceDetail> {
    const piece = await this.visible(scope)
      .andWhere('piece.id = :pieceId', { pieceId })
      .getOne();
    if (!piece) throw new NotFoundException('Aprovação não encontrada.');
    const steps = await this.steps.find({
      where: { pieceId: piece.id },
      order: { position: 'ASC' },
    });
    const latest = await this.latestSent(scope, steps);
    return {
      ...buildClientBoardCard(piece, steps, latest),
      steps: await Promise.all(
        steps.map(async (step) => {
          const request = latest.get(step.id);
          return {
            ...buildClientBoardStep(step, request),
            approval: request
              ? await this.approvals.detail(scope, request.id, reader)
              : null,
          };
        }),
      ),
    };
  }
}
