import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { FilesService } from '../../common/files/files.service';
import {
  MediaAssetResolverService,
  type ResolvedMediaAsset,
} from '../../common/media-assets/media-asset-resolver.service';
import { approvalScopeWhere, assertApprovalScope } from './approval-scope';
import type { CreateStandalonePieceDto } from './dto/social-approval-piece.dto';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
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

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** Writes that span a whole piece: creating an avulsa and finishing one. */
@Injectable()
export class SocialApprovalPieceActionsService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly approvals: SocialApprovalsService,
    private readonly pieces: SocialApprovalPiecesService,
    private readonly mediaAssets: MediaAssetResolverService,
    private readonly files: FilesService,
  ) {}

  /** R-18: an avulsa is born when it is sent, as one atomic write. */
  async createStandalone(
    scope: CompanyAwareScope,
    actorUserId: string,
    input: CreateStandalonePieceDto,
  ) {
    assertApprovalScope(scope);
    const actor = { type: 'user' as const, userId: actorUserId };
    const title = input.title.trim();
    if (!title) throw new BadRequestException('O título é obrigatório.');
    // Bytes first: storage cannot join the transaction, and an orphaned
    // private copy is harmless while a request without its file is not.
    const { kind, payload } = await this.snapshotInput(scope, input);

    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const piece = await this.dataSource.transaction(async (manager) => {
      const created = await this.pieces.createStandalone(manager, scope, {
        title,
        stepKind: input.stepKind,
        origin: 'approvals',
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

  private async mediaSet(
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
    return {
      id: finished.id,
      finishedAt: finished.finishedAt?.toISOString() ?? null,
    };
  }
}
