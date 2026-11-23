import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { SocialContentItemEntity } from '../social-planner/entities';
import {
  buildTablePayloads,
  EDITABLE_TABLE_COLUMNS,
} from './approval-content-snapshots';
import { approvalClientWhere } from './approval-scope';
import type { ApprovalTableEditDto } from './dto/social-approval-piece.dto';
import {
  SocialApprovalPieceEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStepEntity,
} from './entities';
import { SocialApprovalAuthorityService } from './social-approval-authority.service';
import {
  hashSnapshotPayload,
  SocialApprovalPiecesService,
} from './social-approval-pieces.service';
import { SocialApprovalSettingsService } from './social-approval-settings.service';
import {
  SocialApprovalsService,
  type ApprovalActor,
  type ApprovalOperation,
} from './social-approvals.service';

export const APPROVAL_TABLE_OUTDATED = 'approval_table_outdated';
export const APPROVAL_TABLE_EDIT_DISABLED = 'approval_table_edit_disabled';

const nullable = (value: string) => value.trim() || null;

/**
 * The internal approver edits the plan/campaign table inline. The edit lands
 * on the Planner items (the table is a picture of them, D-20) and the picture
 * that results becomes a new version of the same request, as a text edit does
 * (D-02/D-03): the previous request is superseded and nothing is decided.
 */
@Injectable()
export class SocialApprovalTableEditService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly approvals: SocialApprovalsService,
    private readonly pieces: SocialApprovalPiecesService,
    private readonly settings: SocialApprovalSettingsService,
    private readonly authority: SocialApprovalAuthorityService,
  ) {}

  /** Returns the id to read back: the new request when something changed. */
  async edit(
    scope: CompanyAwareScope,
    approvalId: string,
    input: ApprovalTableEditDto,
    editor: { userId: string; role?: string | null },
  ): Promise<{ approvalId: string; changed: boolean }> {
    const actor: ApprovalActor = { type: 'user', userId: editor.userId };
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const result = await this.dataSource.transaction(async (manager) => {
      const previous = await this.approvals.lockForEdit(
        manager,
        scope,
        approvalId,
        'awaiting_internal_review',
      );
      if (
        previous.subjectType !== 'approval_snapshot' ||
        previous.displayType !== 'table'
      )
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: APPROVAL_TABLE_EDIT_DISABLED,
          message: 'Só tabelas de planejamento podem ser editadas aqui.',
        });
      this.authority.assertInternalDecider(
        await this.settings.get(scope, manager),
        editor,
      );
      const step = await manager
        .getRepository(SocialApprovalStepEntity)
        .findOneOrFail({ where: { id: previous.subjectId } });
      const piece = await manager
        .getRepository(SocialApprovalPieceEntity)
        .findOneOrFail({ where: { id: step.pieceId } });
      if (
        (piece.kind !== 'plan_table' && piece.kind !== 'campaign_table') ||
        !piece.sourceId
      )
        throw new ConflictException('Esta peça não tem tabela de origem.');
      const source = {
        key: 'table',
        kind: piece.kind,
        sourceId: piece.sourceId,
      };
      const reviewed = await manager
        .getRepository(SocialApprovalSnapshotEntity)
        .findOneOrFail({ where: { id: previous.subjectRevisionId } });

      // Rows carry no ids, so they are matched by position on the live table,
      // which is only safe while it still is the picture under review.
      const rowItemIds = new Map<string, string[]>();
      const live = (
        await buildTablePayloads(manager, [source], rowItemIds)
      ).get('table')!;
      if (hashSnapshotPayload(live) !== reviewed.contentHash)
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: APPROVAL_TABLE_OUTDATED,
          message: 'A tabela mudou no Planner. Atualize a página.',
        });
      const ids = rowItemIds.get('table') ?? [];
      const wanted = new Map<string, ApprovalTableEditDto['rows'][number]>();
      for (const row of input.rows) {
        const id = ids[row.index];
        if (!id) throw new BadRequestException('Linha inexistente na tabela.');
        wanted.set(id, row);
      }
      const items = await manager.getRepository(SocialContentItemEntity).find({
        where: { ...approvalClientWhere(scope), id: In([...wanted.keys()]) },
        lock: { mode: 'pessimistic_write' },
      });
      if (items.length !== wanted.size)
        throw new ConflictException('Um item da tabela foi removido.');
      const changed: SocialContentItemEntity[] = [];
      for (const item of items) {
        const row = wanted.get(item.id)!;
        let dirty = false;
        for (const key of EDITABLE_TABLE_COLUMNS) {
          const raw = row[key];
          if (raw === undefined) continue;
          const next = key === 'title' ? raw.trim() : nullable(raw);
          if (key === 'title' && !next)
            throw new BadRequestException('O título não pode ficar vazio.');
          if ((item[key] ?? null) === next) continue;
          (item as unknown as Record<string, string | null>)[key] = next;
          dirty = true;
        }
        if (!dirty) continue;
        item.updatedById = editor.userId;
        changed.push(item);
      }
      if (!changed.length) return { approvalId: previous.id, changed: false };
      await manager.getRepository(SocialContentItemEntity).save(changed);

      const payload = (await buildTablePayloads(manager, [source])).get(
        'table',
      )!;
      const snapshot = await this.pieces.createSnapshot(
        manager,
        step,
        'table',
        payload,
        actor,
        'agency',
      );
      const reissued = await this.approvals.reissueAfterEditInTransaction(
        manager,
        scope,
        actor,
        previous,
        {
          subjectType: 'approval_snapshot',
          subjectId: step.id,
          subjectRevisionId: snapshot.id,
          sourceModule: 'social_approvals',
          displayType: 'table',
          title: previous.title,
          subjectVersionLabel: `r${snapshot.revisionNumber}`,
        },
        afterCommit,
        'agency',
        null,
      );
      return { approvalId: reissued.id, changed: true };
    });
    for (const run of afterCommit) await run();
    return result;
  }
}
