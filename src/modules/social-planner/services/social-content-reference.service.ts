import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  durableMediaAssetSource,
  MediaAssetEntity,
  mediaAssetScopeWhere,
} from '../../../common/media-assets';
import {
  MAX_SOCIAL_CONTENT_REFERENCES,
  SocialContentItemEntity,
  SocialContentReferenceEntity,
  type SocialContentReferenceKind,
} from '../entities';
import {
  SocialPlannerService,
  type SocialPlannerScope,
} from './social-planner.service';

export type SocialContentReferenceView = {
  id: string;
  mediaAssetId: string;
  kind: string;
  label: string | null;
  sortOrder: number;
  /** NULL only if the media row is no longer readable in this scope. */
  media: {
    mimeType: string;
    width: number | null;
    height: number | null;
    byteSize: string;
    contentPath: string;
  } | null;
  createdAt: Date;
};

/**
 * Public contract for other modules (Creative Studio's Generation Context):
 * identities only — no label, no storage, no scope.
 */
export type SocialContentReferenceIdentity = {
  referenceId: string;
  mediaAssetId: string;
  kind: string;
  sortOrder: number;
};

/**
 * Planner Visual References: images specific to one content item.
 *
 * Every operation first proves the item through the Planner's own visibility
 * rule (`SocialPlannerService.requireContent`: scope, not soft-deleted, plan
 * in the caller's company). A soft-deleted item therefore hides its
 * references from every path and a restore brings them back untouched.
 *
 * Writes to one item are serialized by locking the item row, so the count
 * (max 10), the position and the "already linked" check cannot race. The
 * database still re-proves scope and eligibility (migration 1798200000000).
 *
 * Removing a reference removes the LINK only. The media stays: it may have
 * other owners, and orphan binaries are the media lifecycle's concern (CS3.6).
 */
@Injectable()
export class SocialContentReferenceService {
  constructor(
    @InjectRepository(SocialContentReferenceEntity, 'agency')
    private readonly references: Repository<SocialContentReferenceEntity>,
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly media: Repository<MediaAssetEntity>,
    private readonly planner: SocialPlannerService,
  ) {}

  async list(
    scope: SocialPlannerScope,
    contentId: string,
  ): Promise<SocialContentReferenceView[]> {
    await this.planner.requireContent(scope, contentId);
    const rows = await this.rows(this.references.manager, scope, contentId);
    return this.views(scope, rows);
  }

  /** Contract for the Creative Studio. Same visibility rule as `list`. */
  async listContentReferences(
    scope: SocialPlannerScope,
    contentId: string,
  ): Promise<SocialContentReferenceIdentity[]> {
    await this.planner.requireContent(scope, contentId);
    const rows = await this.rows(this.references.manager, scope, contentId);
    return rows.map((row) => ({
      referenceId: row.id,
      mediaAssetId: row.mediaAssetId,
      kind: row.kind,
      sortOrder: row.sortOrder,
    }));
  }

  async link(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    contentId: string,
    input: {
      mediaAssetId: string;
      kind: SocialContentReferenceKind;
      label?: string | null;
    },
  ): Promise<SocialContentReferenceView> {
    assertReferenceScope(scope);
    await this.planner.requireContent(scope, contentId);
    await this.requireEligibleMedia(scope, input.mediaAssetId);

    const saved = await this.withLockedItem(
      contentId,
      async (manager, existing) => {
        if (existing.some((row) => row.mediaAssetId === input.mediaAssetId))
          throw new ConflictException({
            code: 'reference_already_linked',
            message: 'Esta imagem já é referência deste conteúdo.',
          });
        if (existing.length >= MAX_SOCIAL_CONTENT_REFERENCES)
          throw new ConflictException({
            code: 'reference_limit_reached',
            message: `Cada conteúdo aceita até ${MAX_SOCIAL_CONTENT_REFERENCES} referências.`,
          });
        const repository = manager.getRepository(SocialContentReferenceEntity);
        return repository.save(
          repository.create({
            ...scopeValues(scope),
            contentItemId: contentId,
            mediaAssetId: input.mediaAssetId,
            kind: input.kind,
            label: normalizeLabel(input.label),
            sortOrder: existing.length,
            createdById: actorUserId,
          }),
        );
      },
    );
    const [view] = await this.views(scope, [saved]);
    return view;
  }

  async update(
    scope: SocialPlannerScope,
    contentId: string,
    referenceId: string,
    input: { kind?: SocialContentReferenceKind; label?: string | null },
  ): Promise<SocialContentReferenceView> {
    await this.planner.requireContent(scope, contentId);
    const row = await this.requireReference(scope, contentId, referenceId);
    if (input.kind !== undefined) row.kind = input.kind;
    if (input.label !== undefined) row.label = normalizeLabel(input.label);
    const saved = await this.references.save(row);
    const [view] = await this.views(scope, [saved]);
    return view;
  }

  /** `referenceIds` must be exactly the item's current references, in the new order. */
  async reorder(
    scope: SocialPlannerScope,
    contentId: string,
    referenceIds: string[],
  ): Promise<SocialContentReferenceView[]> {
    await this.planner.requireContent(scope, contentId);
    const rows = await this.withLockedItem(
      contentId,
      async (manager, existing) => {
        const current = new Set(existing.map((row) => row.id));
        if (
          referenceIds.length !== existing.length ||
          new Set(referenceIds).size !== referenceIds.length ||
          !referenceIds.every((id) => current.has(id))
        )
          throw new BadRequestException({
            code: 'reference_order_mismatch',
            message:
              'A nova ordem precisa conter exatamente as referências atuais.',
          });
        await setPositions(manager, referenceIds);
        return this.rows(manager, scope, contentId);
      },
    );
    return this.views(scope, rows);
  }

  /** Deletes the link only — never the media (see class doc). */
  async remove(
    scope: SocialPlannerScope,
    contentId: string,
    referenceId: string,
  ): Promise<void> {
    await this.planner.requireContent(scope, contentId);
    await this.withLockedItem(contentId, async (manager, existing) => {
      const target = existing.find((row) => row.id === referenceId);
      if (!target) throw new NotFoundException('Referência não encontrada.');
      const repository = manager.getRepository(SocialContentReferenceEntity);
      await repository.delete({ id: target.id });
      // Keep positions contiguous (0..n-1) so the next link appends at n.
      await setPositions(
        manager,
        existing.filter((row) => row.id !== target.id).map((row) => row.id),
      );
    });
  }

  private rows(
    manager: EntityManager,
    scope: SocialPlannerScope,
    contentId: string,
  ) {
    return manager.getRepository(SocialContentReferenceEntity).find({
      where: { ...scopeWhere(scope), contentItemId: contentId },
      order: { sortOrder: 'ASC' },
    });
  }

  private async requireReference(
    scope: SocialPlannerScope,
    contentId: string,
    referenceId: string,
  ) {
    const row = await this.references.findOne({
      where: {
        ...scopeWhere(scope),
        contentItemId: contentId,
        id: referenceId,
      },
    });
    if (!row) throw new NotFoundException('Referência não encontrada.');
    return row;
  }

  /** Same scope, durable (never a temporary generation candidate), an image. */
  private async requireEligibleMedia(
    scope: SocialPlannerScope,
    mediaAssetId: string,
  ) {
    const media = await this.media.findOne({
      where: {
        id: mediaAssetId,
        ...mediaAssetScopeWhere(scope),
        source: durableMediaAssetSource(),
      },
    });
    if (!media)
      throw new BadRequestException({
        code: 'reference_media_not_found',
        message: 'Imagem não encontrada.',
      });
    if (!media.mimeType.startsWith('image/'))
      throw new BadRequestException({
        code: 'reference_media_not_image',
        message: 'Use uma imagem como referência.',
      });
    return media;
  }

  private withLockedItem<T>(
    contentId: string,
    work: (
      manager: EntityManager,
      existing: SocialContentReferenceEntity[],
    ) => Promise<T>,
  ): Promise<T> {
    return this.references.manager.transaction(async (manager) => {
      await manager.getRepository(SocialContentItemEntity).findOne({
        where: { id: contentId },
        lock: { mode: 'pessimistic_write' },
      });
      const existing = await manager
        .getRepository(SocialContentReferenceEntity)
        .find({
          where: { contentItemId: contentId },
          order: { sortOrder: 'ASC' },
        });
      return work(manager, existing);
    });
  }

  private async views(
    scope: SocialPlannerScope,
    rows: SocialContentReferenceEntity[],
  ): Promise<SocialContentReferenceView[]> {
    const ids = [...new Set(rows.map((row) => row.mediaAssetId))];
    const media = ids.length
      ? await this.media.find({
          where: {
            id: In(ids),
            ...mediaAssetScopeWhere(scope),
            source: durableMediaAssetSource(),
          },
        })
      : [];
    const byId = new Map(media.map((asset) => [asset.id, asset]));
    return rows.map((row) => {
      const asset = byId.get(row.mediaAssetId);
      return {
        id: row.id,
        mediaAssetId: row.mediaAssetId,
        kind: row.kind,
        label: row.label,
        sortOrder: row.sortOrder,
        media: asset
          ? {
              mimeType: asset.mimeType,
              width: asset.width,
              height: asset.height,
              byteSize: asset.byteSize,
              contentPath: `/social/publishing/media/${asset.id}/content`,
            }
          : null,
        createdAt: row.createdAt,
      };
    });
  }
}

/**
 * E6 duplicate: the clone gets the same references — same media (never a
 * copy of the binary), kind, label and order. Runs inside the duplicate's
 * transaction; the database re-proves scope on every inserted row.
 */
export async function cloneContentReferences(
  manager: EntityManager,
  scope: SocialPlannerScope,
  input: {
    sourceContentId: string;
    targetContentId: string;
    actorUserId: string | null;
  },
): Promise<void> {
  const repository = manager.getRepository(SocialContentReferenceEntity);
  const rows = await repository.find({
    where: { ...scopeWhere(scope), contentItemId: input.sourceContentId },
    order: { sortOrder: 'ASC' },
  });
  if (!rows.length) return;
  await repository.save(
    rows.map((row) =>
      repository.create({
        ...scopeValues(scope),
        contentItemId: input.targetContentId,
        mediaAssetId: row.mediaAssetId,
        kind: row.kind,
        label: row.label,
        sortOrder: row.sortOrder,
        createdById: input.actorUserId,
      }),
    ),
  );
}

/**
 * Writes `sort_order = index` for each id, one statement at a time (a
 * transaction is one connection). UQ (item, sort_order) is DEFERRABLE, so
 * intermediate collisions during a swap settle at commit.
 */
async function setPositions(manager: EntityManager, orderedIds: string[]) {
  const repository = manager.getRepository(SocialContentReferenceEntity);
  for (const [index, id] of orderedIds.entries())
    await repository.update({ id }, { sortOrder: index });
}

/** Legacy scopes (client without company) are invisible in the product (CC2G). */
function assertReferenceScope(scope: SocialPlannerScope) {
  if (scope.agencyClientId !== null && scope.companyContextId === null)
    throw new BadRequestException({
      code: 'company_context_required',
      message: 'Selecione uma empresa para usar referências.',
    });
}

function scopeValues(scope: SocialPlannerScope) {
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId: scope.agencyClientId,
    companyContextId: scope.companyContextId,
  };
}

function scopeWhere(scope: SocialPlannerScope) {
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId:
      scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    companyContextId:
      scope.companyContextId === null ? IsNull() : scope.companyContextId,
  };
}

function normalizeLabel(label: string | null | undefined) {
  const text = label?.trim();
  return text ? text : null;
}
