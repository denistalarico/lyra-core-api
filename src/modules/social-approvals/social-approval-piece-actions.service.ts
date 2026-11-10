import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { FilesService } from '../../common/files/files.service';
import {
  MediaAssetResolverService,
  type ResolvedMediaAsset,
} from '../../common/media-assets/media-asset-resolver.service';
import { approvalScopeWhere, assertApprovalScope } from './approval-scope';
import { SocialApprovalTransitionRegistry } from './approval-transition.port';
import type {
  CreateStandalonePieceDto,
  UpdateApprovalPieceCardDto,
} from './dto/social-approval-piece.dto';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
  type SocialApprovalPieceOrigin,
  type ApprovalFileSnapshotPayload,
  type ApprovalMediaSetSnapshotPayload,
  type ApprovalSnapshotPayload,
  type SocialApprovalSnapshotKind,
} from './entities';
import { SocialApprovalPiecesService } from './social-approval-pieces.service';
import {
  SocialApprovalsService,
  type ApprovalOperation,
} from './social-approvals.service';

/** Copies are buffered in memory, so a generous but finite ceiling. */
const MAX_FILE_COPY_BYTES = 100 * 1024 * 1024;
const OPEN_STATUSES = new Set([
  'draft',
  'awaiting_internal_review',
  'awaiting_client',
  'changes_requested',
]);

/** AR4: how an avulsa sent from Projects differs from one sent here. */
export type StandalonePieceOptions = {
  origin?: SocialApprovalPieceOrigin;
  work?: {
    projectId: string | null;
    taskId: string | null;
    subtaskId: string | null;
  };
  /** A task attachment: stored in the public bucket, unlike a media asset. */
  attachment?: { assetPath: string; fileName: string; mimeType: string };
};

/** Trims, drops empties and repeats (ignoring case), keeps the first spelling. */
export function normalizeCardTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLocaleLowerCase('pt-BR');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    kept.push(tag);
  }
  return kept.slice(0, 10);
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** Writes that span a whole piece: creating an avulsa and finishing one. */
@Injectable()
export class SocialApprovalPieceActionsService {
  private readonly logger = new Logger(SocialApprovalPieceActionsService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly approvals: SocialApprovalsService,
    private readonly pieces: SocialApprovalPiecesService,
    private readonly mediaAssets: MediaAssetResolverService,
    private readonly files: FilesService,
    @Optional() private readonly transitions?: SocialApprovalTransitionRegistry,
  ) {}

  /** R-18: an avulsa is born when it is sent, as one atomic write. */
  async createStandalone(
    scope: CompanyAwareScope,
    actorUserId: string,
    input: CreateStandalonePieceDto,
    options: StandalonePieceOptions = {},
  ) {
    assertApprovalScope(scope);
    const actor = { type: 'user' as const, userId: actorUserId };
    const title = input.title.trim();
    if (!title) throw new BadRequestException('O título é obrigatório.');
    // Bytes first: storage cannot join the transaction, and an orphaned
    // private copy is harmless while a request without its file is not.
    const { kind, payload } = await this.snapshotInput(
      scope,
      input,
      options.attachment,
    );

    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const piece = await this.dataSource.transaction(async (manager) => {
      const created = await this.pieces.createStandalone(manager, scope, {
        title,
        stepKind: input.stepKind,
        origin: options.origin ?? 'approvals',
        description: input.description?.trim() || null,
        work: options.work,
      });
      const snapshot = await this.pieces.createSnapshot(
        manager,
        created.step,
        kind,
        payload,
        actor,
        'agency',
      );
      const request = await this.approvals.createInTransaction(
        manager,
        scope,
        actor,
        {
          subjectType: 'approval_snapshot',
          subjectId: created.step.id,
          subjectRevisionId: snapshot.id,
          sourceModule: 'social_approvals',
          displayType: snapshot.kind,
          title,
          subjectVersionLabel: `r${snapshot.revisionNumber}`,
        },
        afterCommit,
      );
      await this.approvals.submitInTransaction(
        manager,
        scope,
        actor,
        request.id,
        afterCommit,
      );
      return created.piece;
    });
    for (const run of afterCommit) await run();
    return { id: piece.id };
  }

  private async snapshotInput(
    scope: CompanyAwareScope,
    input: CreateStandalonePieceDto,
    attachment?: StandalonePieceOptions['attachment'],
  ): Promise<{
    kind: SocialApprovalSnapshotKind;
    payload: ApprovalSnapshotPayload;
  }> {
    switch (input.stepKind) {
      case 'text': {
        const body = input.text?.trim();
        if (!body) throw new BadRequestException('Informe o texto.');
        return { kind: 'text', payload: { body } };
      }
      case 'link': {
        if (!input.url) throw new BadRequestException('Informe o link.');
        // Parsed again here: D-29 is a domain rule, not only a DTO rule.
        const url = new URL(input.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
          throw new BadRequestException('O link precisa usar http ou https.');
        return {
          kind: 'link',
          payload: {
            url: url.toString(),
            label: input.linkLabel?.trim() || null,
          },
        };
      }
      case 'file': {
        if (attachment)
          return {
            kind: 'file',
            payload: await this.copyAttachment(
              scope,
              attachment,
              input.fileName,
            ),
          };
        if (!input.mediaAssetId)
          throw new BadRequestException('Informe o arquivo.');
        return {
          kind: 'file',
          payload: await this.copyFile(
            scope,
            input.mediaAssetId,
            input.fileName,
          ),
        };
      }
      default: {
        if (!input.mediaAssetIds?.length)
          throw new BadRequestException('Informe ao menos uma mídia.');
        return {
          kind: 'media_set',
          payload: await this.mediaSet(scope, input.mediaAssetIds),
        };
      }
    }
  }

  private async resolveMedia(
    scope: CompanyAwareScope,
    mediaAssetId: string,
  ): Promise<ResolvedMediaAsset> {
    return this.mediaAssets.resolve({ ...scope, mediaAssetId });
  }

  /** Also the media_set of a Planner direct upload (D-23). */
  async mediaSet(
    scope: CompanyAwareScope,
    mediaAssetIds: readonly string[],
  ): Promise<ApprovalMediaSetSnapshotPayload> {
    const items = await Promise.all(
      mediaAssetIds.map(async (mediaAssetId) => {
        const media = await this.resolveMedia(scope, mediaAssetId);
        const assetType = media.mimeType.startsWith('video/')
          ? ('video' as const)
          : media.mimeType.startsWith('image/')
            ? ('image' as const)
            : null;
        if (!assetType)
          throw new BadRequestException(
            'Só imagens e vídeos entram em um conjunto de mídias.',
          );
        return {
          mediaAssetId: media.id,
          assetType,
          mimeType: media.mimeType,
          thumbnailMediaAssetId: null,
        };
      }),
    );
    return { items };
  }

  /** D-29: the approved bytes must outlive the attachment they came from. */
  private async copyFile(
    scope: CompanyAwareScope,
    mediaAssetId: string,
    fileName?: string,
  ): Promise<ApprovalFileSnapshotPayload> {
    const media = await this.resolveMedia(scope, mediaAssetId);
    if (Number(media.byteSize) > MAX_FILE_COPY_BYTES)
      throw new PayloadTooLargeException(
        'O arquivo excede o limite de 100 MB.',
      );
    const source = await this.files.getPrivateAsset(media.storagePath);
    const body = await readAll(source.body);
    const extension = extname(media.storagePath).toLowerCase();
    const { path } = await this.files.uploadPrivateBuffer({
      body,
      path: `social-approvals/${scope.tenantId}/${randomUUID()}${extension}`,
      contentType: media.mimeType,
    });
    return {
      fileName: fileName?.trim() || `arquivo${extension}`,
      mimeType: media.mimeType,
      byteSize: String(body.length),
      storagePath: path,
    };
  }

  /**
   * D-29 for a task attachment, which AR1 left open. Attachments are public
   * bucket objects: read from there and copied into the private one, so the
   * approved file survives the attachment and the client only reaches it by
   * opaque reference.
   */
  private async copyAttachment(
    scope: CompanyAwareScope,
    attachment: NonNullable<StandalonePieceOptions['attachment']>,
    fileName?: string,
  ): Promise<ApprovalFileSnapshotPayload> {
    const source = await this.files.getAsset(attachment.assetPath);
    const body = await readAll(source.body);
    if (body.length > MAX_FILE_COPY_BYTES)
      throw new PayloadTooLargeException(
        'O arquivo excede o limite de 100 MB.',
      );
    const extension = extname(attachment.fileName).toLowerCase();
    const { path } = await this.files.uploadPrivateBuffer({
      body,
      path: `social-approvals/${scope.tenantId}/${randomUUID()}${extension}`,
      contentType: attachment.mimeType || 'application/octet-stream',
    });
    return {
      fileName: fileName?.trim() || attachment.fileName,
      mimeType: attachment.mimeType || 'application/octet-stream',
      byteSize: String(body.length),
      storagePath: path,
    };
  }

  /**
   * D-15. Pending steps need the Owner, checked only when one exists, and the
   * check runs inside the transaction so it sees the state being finished.
   * Requests are locked before the piece, the same order every transition
   * uses, so a finish and a decision cannot deadlock.
   */
  async finish(
    scope: CompanyAwareScope,
    pieceId: string,
    actorUserId: string,
    reason: string | undefined,
    assertOwnerOverride: () => Promise<void>,
  ) {
    const actor = { type: 'user' as const, userId: actorUserId };
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const finished = await this.dataSource.transaction(async (manager) => {
      const pieces = manager.getRepository(SocialApprovalPieceEntity);
      const steps = await manager
        .getRepository(SocialApprovalStepEntity)
        .find({ where: { pieceId }, order: { position: 'ASC' } });
      const probe = await pieces.findOne({
        where: { ...approvalScopeWhere(scope), id: pieceId },
      });
      if (!probe)
        throw new NotFoundException('Peça não encontrada no contexto atual.');
      if (probe.finishedAt)
        throw new ConflictException('Esta peça já foi finalizada.');
      if (probe.sourceState === 'hidden')
        throw new ConflictException('O conteúdo desta peça foi removido.');

      const requestIds = steps
        .map((step) => step.currentRequestId)
        .filter((id): id is string => Boolean(id));
      const requests = requestIds.length
        ? await manager
            .getRepository(SocialApprovalRequestEntity)
            .find({ where: { id: In(requestIds) } })
        : [];
      const requestById = new Map(requests.map((item) => [item.id, item]));
      const pending = steps.filter((step) => {
        const request = step.currentRequestId
          ? requestById.get(step.currentRequestId)
          : undefined;
        return !(request?.status === 'approved' && !step.isStale);
      });
      if (pending.length) await assertOwnerOverride();

      for (const step of pending) {
        const request = step.currentRequestId
          ? requestById.get(step.currentRequestId)
          : undefined;
        if (request && OPEN_STATUSES.has(request.status))
          await this.approvals.agencyOverride(scope, request.id, actorUserId, {
            manager,
            afterCommit,
          });
        else
          // Nothing open to decide (R-04: never sent, or already stale): the
          // override exists only in the trail.
          await this.pieces.recordEvent(
            manager,
            {
              ...scope,
              pieceId,
              stepId: step.id,
              requestId: request?.id ?? null,
            },
            'agency_override',
            actor,
            'agency',
            { withoutRequest: true },
          );
      }

      const piece = await pieces.findOne({
        where: { ...approvalScopeWhere(scope), id: pieceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!piece)
        throw new NotFoundException('Peça não encontrada no contexto atual.');
      // Read again under the lock: this is what stops a double finish.
      if (piece.finishedAt)
        throw new ConflictException('Esta peça já foi finalizada.');
      piece.finishedAt = new Date();
      piece.finishedByUserId = actorUserId;
      piece.finishReason = reason?.trim() || null;
      await pieces.save(piece);
      await this.pieces.recordEvent(
        manager,
        { ...scope, pieceId, stepId: null, requestId: null },
        'finished',
        actor,
        'agency',
        { pendingSteps: pending.length },
      );
      await this.pieces.recompute(manager, pieceId);
      return piece;
    });
    for (const run of afterCommit) await run();
    await this.notifyFinished(finished);
    return {
      id: finished.id,
      finishedAt: finished.finishedAt?.toISOString() ?? null,
    };
  }

  /** Presentation only: keeps `updated_at`, so restyling never reorders a column. */
  async updateCard(
    scope: CompanyAwareScope,
    pieceId: string,
    input: UpdateApprovalPieceCardDto,
  ) {
    const pieces = this.dataSource.getRepository(SocialApprovalPieceEntity);
    const piece = await this.pieceInScope(scope, pieceId);
    const title = input.title?.trim();
    if (input.title !== undefined && (!title || piece.kind !== 'standalone'))
      throw new BadRequestException(
        'Só o título de uma peça avulsa pode ser editado aqui.',
      );
    await pieces
      .createQueryBuilder()
      .update()
      .set({
        ...(title ? { title } : {}),
        ...(input.cardColor ? { cardColor: input.cardColor } : {}),
        ...(input.tags ? { tags: normalizeCardTags(input.tags) } : {}),
        ...(input.display
          ? { cardDisplay: { ...piece.cardDisplay, ...input.display } }
          : {}),
        updatedAt: () => '"updated_at"',
      })
      .where('id = :id', { id: piece.id })
      .execute();
    return { id: piece.id };
  }

  /**
   * Removes the send, never the work. An avulsa exists only as this send, so
   * it leaves the board. A Planner piece would be recreated by the sync
   * (D-31), so its card stays and returns to Em preparação, with no current
   * request. Requests, decisions and the trail are kept. Same lock order as
   * `finish`: requests before the piece.
   */
  async withdraw(
    scope: CompanyAwareScope,
    pieceId: string,
    actorUserId: string,
    canOverride: boolean,
  ) {
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const result = await this.dataSource.transaction(async (manager) => {
      const pieces = manager.getRepository(SocialApprovalPieceEntity);
      const stepRepository = manager.getRepository(SocialApprovalStepEntity);
      const probe = await this.pieceInScope(scope, pieceId, manager);
      const steps = await stepRepository.find({ where: { pieceId } });
      const requestIds = steps
        .map((step) => step.currentRequestId)
        .filter((id): id is string => Boolean(id));
      const requests = requestIds.length
        ? await manager
            .getRepository(SocialApprovalRequestEntity)
            .find({ where: { id: In(requestIds) } })
        : [];
      if (
        !canOverride &&
        !requests.some((item) => item.requestedByUserId === actorUserId)
      )
        throw new ForbiddenException(
          'Só quem enviou, um Admin ou o Owner pode excluir esta peça.',
        );
      const standalone = probe.kind === 'standalone';
      if (!standalone && requests.length === 0)
        throw new ConflictException('Esta peça ainda não foi enviada.');
      if (!standalone && (probe.finishedAt || probe.sourceState === 'posted'))
        throw new ConflictException('Esta peça já foi finalizada.');

      for (const request of requests)
        if (OPEN_STATUSES.has(request.status))
          await this.approvals.cancel(scope, request.id, actorUserId, {
            manager,
            afterCommit,
          });

      const piece = await pieces.findOneOrFail({
        where: { ...approvalScopeWhere(scope), id: pieceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (standalone) {
        piece.sourceState = 'hidden';
        await pieces.save(piece);
      } else if (steps.length) {
        await stepRepository.update(
          { id: In(steps.map((step) => step.id)) },
          { currentRequestId: null, isStale: false },
        );
      }
      await this.pieces.recordEvent(
        manager,
        { ...scope, pieceId, stepId: null, requestId: null },
        'withdrawn',
        { type: 'user', userId: actorUserId },
        'agency',
        { requests: requests.length },
      );
      await this.pieces.recompute(manager, pieceId);
      return { id: piece.id, removed: standalone };
    });
    for (const run of afterCommit) await run();
    return result;
  }

  /** A removed avulsa answers like one that never existed. */
  private async pieceInScope(
    scope: CompanyAwareScope,
    pieceId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({ where: { ...approvalScopeWhere(scope), id: pieceId } });
    if (
      !piece ||
      (piece.kind === 'standalone' && piece.sourceState === 'hidden')
    )
      throw new NotFoundException('Peça não encontrada no contexto atual.');
    return piece;
  }

  /** After commit, like every observer: a finish never fails because of one. */
  private async notifyFinished(piece: SocialApprovalPieceEntity) {
    for (const observer of this.transitions?.listPieceFinished() ?? [])
      await observer(piece).catch((error: unknown) =>
        this.logger.warn(
          `piece finished observer failed for ${piece.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
  }
}
