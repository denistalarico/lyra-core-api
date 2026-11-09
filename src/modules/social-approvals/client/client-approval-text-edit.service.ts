import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import {
  SocialContentItemEntity,
  SocialContentRevisionEntity,
} from '../../social-planner/entities';
import { SocialPlannerService } from '../../social-planner/services/social-planner.service';
import { isTextEditableApproval } from '../approval-content-snapshots';
import { approvalClientWhere } from '../approval-scope';
import {
  SocialApprovalSnapshotEntity,
  SocialApprovalStepEntity,
  type ApprovalTextSnapshotPayload,
  type SocialApprovalRequestEntity,
} from '../entities';
import { SocialApprovalAuthorityService } from '../social-approval-authority.service';
import { SocialApprovalPiecesService } from '../social-approval-pieces.service';
import { SocialApprovalSettingsService } from '../social-approval-settings.service';
import {
  SocialApprovalsService,
  type ApprovalActor,
  type ApprovalOperation,
} from '../social-approvals.service';
import type { ResolvedApprovalSubject } from '../subjects/approval-subject-resolver';
import type { ClientApprovalEditTextDto } from './client-approval.dto';

export const APPROVAL_TEXT_EDIT_DISABLED = 'approval_text_edit_disabled';
export const APPROVAL_TEXT_OUTDATED = 'approval_text_outdated';

export type ApprovalTextEditor = {
  userId: string;
  surface: 'client_area' | 'self';
  /** The Agency role, for the internal decision of the self area. */
  role?: string | null;
};

const nullableText = (next: string | null | undefined, base: string | null) =>
  next === undefined ? base : next?.trim() || null;

/**
 * D-02 — the client edits the text under approval. One transaction, so
 * "Salvar e aprovar" by someone who may not decide leaves nothing behind: the
 * new revision, the replaced request and the decision commit or fail together.
 *
 * The edited text is the item's current text, which is what gets published.
 * The identity recorded as author is the Client Area person (CA0 §S).
 */
@Injectable()
export class ClientApprovalTextEditService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly approvals: SocialApprovalsService,
    private readonly pieces: SocialApprovalPiecesService,
    private readonly settings: SocialApprovalSettingsService,
    private readonly authority: SocialApprovalAuthorityService,
    private readonly planner: SocialPlannerService,
  ) {}

  /** Returns the id to read back: the new request when the text changed. */
  async edit(
    scope: CompanyAwareScope,
    approvalId: string,
    input: ClientApprovalEditTextDto,
    editor: ApprovalTextEditor,
  ): Promise<string> {
    const actor: ApprovalActor = { type: 'user', userId: editor.userId };
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const finalId = await this.dataSource.transaction(async (manager) => {
      const previous = await this.approvals.lockForEdit(
        manager,
        scope,
        approvalId,
        editor.surface === 'self'
          ? 'awaiting_internal_review'
          : 'awaiting_client',
      );
      const settings = await this.settings.get(scope, manager);
      if (!settings.clientCanEditText || !isTextEditableApproval(previous))
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: APPROVAL_TEXT_EDIT_DISABLED,
          message: 'A edição de texto não está disponível nesta aprovação.',
        });

      const subject =
        previous.subjectType === 'planner_content_revision'
          ? await this.reviseContent(manager, scope, previous, input, editor)
          : await this.reviseText(manager, previous, input, actor, editor);
      const operation = { manager, afterCommit };
      if (!subject) {
        // Nothing changed: "Salvar e aprovar" is just the approval.
        if (input.approve)
          await this.approve(scope, previous.id, editor, operation);
        return previous.id;
      }

      const reissued = await this.approvals.reissueAfterEditInTransaction(
        manager,
        scope,
        actor,
        previous,
        subject,
        afterCommit,
        editor.surface,
        editor.surface === 'self'
          ? null
          : await this.authority.requiredClientApprovers(
              manager,
              scope,
              settings,
            ),
      );
      const final = input.approve
        ? await this.approve(scope, reissued.id, editor, operation)
        : reissued;
      afterCommit.push(() =>
        this.approvals.announceClientEdit(final, editor.userId),
      );
      return final.id;
    });
    for (const run of afterCommit) await run();
    return finalId;
  }

  private approve(
    scope: CompanyAwareScope,
    requestId: string,
    editor: ApprovalTextEditor,
    operation: ApprovalOperation,
  ) {
    return editor.surface === 'self'
      ? this.approvals.approveInternal(
          scope,
          requestId,
          editor.userId,
          editor.role,
          'self',
          operation,
        )
      : this.approvals.clientApprove(
          scope,
          requestId,
          { type: 'user', userId: editor.userId },
          operation,
        );
  }

  /** The Planner writes its own revision; null when nothing actually changed. */
  private async reviseContent(
    manager: EntityManager,
    scope: CompanyAwareScope,
    previous: SocialApprovalRequestEntity,
    input: ClientApprovalEditTextDto,
    editor: ApprovalTextEditor,
  ): Promise<ResolvedApprovalSubject | null> {
    const item = await manager.getRepository(SocialContentItemEntity).findOne({
      where: { ...approvalClientWhere(scope), id: previous.subjectId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !item ||
      item.deletedAt ||
      item.archivedAt ||
      item.planningStatus === 'posted'
    )
      throw new ConflictException('O conteúdo desta aprovação foi removido.');
    // Editing an older text would silently throw away the agency's newer one.
    if (item.currentRevisionId !== previous.subjectRevisionId)
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: APPROVAL_TEXT_OUTDATED,
        message: 'A agência alterou este texto. Atualize a página.',
      });
    const base = await manager
      .getRepository(SocialContentRevisionEntity)
      .findOneOrFail({
        where: {
          ...approvalClientWhere(scope),
          id: previous.subjectRevisionId,
        },
      });
    const hashtags = input.hashtags?.map((tag) => tag.trim()).filter(Boolean);
    const changed =
      nullableText(input.copy, base.copy) !== base.copy ||
      nullableText(input.caption, base.caption) !== base.caption ||
      nullableText(input.script, base.script) !== base.script ||
      nullableText(input.cta, base.cta) !== base.cta ||
      nullableText(input.firstComment, base.firstComment) !==
        base.firstComment ||
      (hashtags !== undefined && hashtags.join() !== base.hashtags.join());
    if (!changed) return null;

    const { revision } = await this.planner.createRevisionInTransaction(
      manager,
      scope,
      item.id,
      editor.userId,
      {
        copy: input.copy,
        caption: input.caption,
        script: input.script,
        cta: input.cta,
        firstComment: input.firstComment,
        hashtags,
        source: 'client_edit',
      },
    );
    return {
      subjectType: 'planner_content_revision',
      subjectId: item.id,
      subjectRevisionId: revision.id,
      sourceModule: 'social_planner',
      displayType: 'content_revision',
      title: item.title,
      subjectVersionLabel: `r${revision.revisionNumber}`,
    };
  }

  /** Text pieces carry a single body, addressed as `copy` by the screen. */
  private async reviseText(
    manager: EntityManager,
    previous: SocialApprovalRequestEntity,
    input: ClientApprovalEditTextDto,
    actor: ApprovalActor,
    editor: ApprovalTextEditor,
  ): Promise<ResolvedApprovalSubject | null> {
    if (input.copy === undefined) return null;
    const body = input.copy?.trim();
    if (!body) throw new BadRequestException('Informe o texto.');
    const current = await manager
      .getRepository(SocialApprovalSnapshotEntity)
      .findOneOrFail({ where: { id: previous.subjectRevisionId } });
    if ((current.payload as ApprovalTextSnapshotPayload).body === body)
      return null;
    const step = await manager
      .getRepository(SocialApprovalStepEntity)
      .findOneOrFail({ where: { id: previous.subjectId } });
    const snapshot = await this.pieces.createSnapshot(
      manager,
      step,
      'text',
      { body },
      actor,
      editor.surface,
    );
    return {
      subjectType: 'approval_snapshot',
      subjectId: step.id,
      subjectRevisionId: snapshot.id,
      sourceModule: 'social_approvals',
      displayType: 'text',
      title: previous.title,
      subjectVersionLabel: `r${snapshot.revisionNumber}`,
    };
  }
}
