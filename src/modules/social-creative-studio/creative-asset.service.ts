import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import {
  detectMediaAssetMimeType,
  MediaAssetEntity,
  MediaAssetResolverService,
  MediaAssetUploadService,
} from '../../common/media-assets';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from './entities';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { copyCreativeAssetRecords } from './creative-asset-copy';
import { SocialContentProductionStatusService } from '../social-planner/services/social-content-production-status.service';

/** Studio-level image ceiling; generated outputs are held to it too (CS3.1). */
export const CREATIVE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX = 300 * 1024 * 1024;
const PAGE_SIZE = 50;
const CREATIVE_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
const MEDIA_VERSION_REF = `SELECT 1 FROM social_creative_asset_versions v
  JOIN social_creative_assets a ON a.id = v.creative_asset_id
  WHERE (v.media_asset_id = media.id OR v.thumbnail_media_asset_id = media.id)`;
type UploadFile = {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
  /**
   * CS4-B — a video has no thumbnail of its own (no FFmpeg in the stack); a
   * caller that holds a poster image (a generated Reel's provider cover)
   * passes it here and it becomes the version's thumbnail, through the same
   * image thumbnail path. Ignored for images.
   */
  videoPoster?: { buffer: Buffer; originalname: string; mimetype?: string };
};

/**
 * CS3.2: runs inside the transaction that creates a version, once the version
 * row exists. A throw rolls the version back and compensates its binaries —
 * which is how a generation output records its promotion exactly once.
 */
export type CreativeVersionCreatedHook = (
  manager: EntityManager,
  created: { creativeAssetId: string; versionId: string },
) => Promise<void>;

/** ISO date first, so the subfolders of a plan sort chronologically by name. */
export function contentFolderName(item: {
  title: string;
  plannedDate: string | null;
}) {
  return (
    item.plannedDate ? `${item.plannedDate} · ${item.title}` : item.title
  ).slice(0, 160);
}

/** The constraint (or guard trigger) named by a PostgreSQL error, if any. */
export function databaseConstraint(error: unknown): string | undefined {
  const candidate = error as {
    constraint?: string;
    driverError?: { constraint?: string };
  } | null;
  return candidate?.constraint ?? candidate?.driverError?.constraint;
}

@Injectable()
export class CreativeAssetService {
  constructor(
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly assets: Repository<CreativeAssetEntity>,
    @InjectRepository(CreativeAssetVersionEntity, 'agency')
    private readonly versions: Repository<CreativeAssetVersionEntity>,
    @InjectRepository(CreativeFolderEntity, 'agency')
    private readonly folders: Repository<CreativeFolderEntity>,
    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentItems: Repository<SocialContentItemEntity>,
    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plans: Repository<SocialPlanEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly mediaUpload: MediaAssetUploadService,
    private readonly mediaResolver: MediaAssetResolverService,
    private readonly thumbnails: CreativeThumbnailService,
    private readonly plannerStatus: SocialContentProductionStatusService,
  ) {}
  private get mediaAssets() {
    return this.dataSource.getRepository(MediaAssetEntity);
  }
  private scopeWhere(scope: CreativeStudioScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    };
  }
  private scopeValues(scope: CreativeStudioScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
    };
  }
  private async assertFolder(
    scope: CreativeStudioScope,
    folderId: string | undefined,
  ) {
    if (!folderId) return;
    const exists = await this.folders.exists({
      where: { ...this.scopeWhere(scope), id: folderId },
    });
    if (!exists) throw new BadRequestException('Pasta não encontrada.');
  }
  private async assertContentItem(
    scope: CreativeStudioScope,
    contentItemId: string | undefined,
  ) {
    if (!contentItemId) return null;
    // Soft-deleted items and plans are invisible to every Planner read (E6);
    // linking one here would attach a creative to content nobody can open.
    const item = await this.contentItems.findOne({
      where: {
        id: contentItemId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        deletedAt: IsNull(),
      },
      select: { id: true, planId: true, title: true, plannedDate: true },
    });
    if (!item) throw new BadRequestException('Conteúdo não encontrado.');
    const plan = await this.plans.findOne({
      where: {
        id: item.planId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        companyContextId:
          scope.companyContextId === null ? IsNull() : scope.companyContextId,
        deletedAt: IsNull(),
      },
      select: { id: true, title: true },
    });
    if (!plan) throw new BadRequestException('Conteúdo não encontrado.');
    return { item, plan };
  }
  private async linkedFolder(
    scope: CreativeStudioScope,
    actor: string | null,
    link: { socialPlanId: string } | { contentItemId: string },
    name: string,
    parentId: string | null,
  ) {
    const where = { ...this.scopeWhere(scope), ...link };
    const existing = await this.folders.findOne({ where });
    if (existing) return existing;
    try {
      return await this.folders.save(
        this.folders.create({
          ...this.scopeValues(scope),
          ...link,
          name: name.slice(0, 160),
          parentId,
          createdById: actor,
        }),
      );
    } catch (error) {
      // A concurrent upload for the same item created it first.
      const created = await this.folders.findOne({ where });
      if (created) return created;
      throw error;
    }
  }
  /** The item's subfolder inside its plan's folder, created on first use. */
  private async plannerFolder(
    scope: CreativeStudioScope,
    actor: string | null,
    link: NonNullable<
      Awaited<ReturnType<CreativeAssetService['assertContentItem']>>
    >,
  ) {
    const parent = await this.linkedFolder(
      scope,
      actor,
      { socialPlanId: link.plan.id },
      link.plan.title,
      null,
    );
    const folder = await this.linkedFolder(
      scope,
      actor,
      { contentItemId: link.item.id },
      contentFolderName(link.item),
      parent.id,
    );
    return folder.id;
  }
  private async plannerLink(
    scope: CreativeStudioScope,
    contentItemId: string | null,
  ) {
    if (!contentItemId) return null;
    try {
      const link = await this.assertContentItem(scope, contentItemId);
      return (
        link && {
          planId: link.plan.id,
          planTitle: link.plan.title,
          contentItemId: link.item.id,
          contentTitle: link.item.title,
          plannedDate: link.item.plannedDate,
        }
      );
    } catch (error) {
      if (error instanceof BadRequestException) return null;
      throw error;
    }
  }
  /**
   * CS2B.4: a version now exists for the linked Planner item. The Planner
   * decides whether that moves it to `creative_in_progress`; an asset without
   * `contentItemId` never reaches the Planner. Runs inside the version's
   * transaction so both commit or roll back together.
   */
  private async reflectProductionStarted(
    scope: CreativeStudioScope,
    actor: string | null,
    asset: CreativeAssetEntity,
    manager: EntityManager,
  ) {
    if (!asset.contentItemId) return;
    await this.plannerStatus.reflectCreativeStatus(
      scope,
      {
        contentItemId: asset.contentItemId,
        status: 'creative_in_progress',
        actorUserId: actor,
      },
      manager,
    );
  }
  private kind(file: UploadFile | undefined): 'image' | 'video' {
    if (!file?.buffer?.length)
      throw new BadRequestException('Nenhum arquivo foi enviado.');
    const mime = detectMediaAssetMimeType(file.buffer);
    if (!mime)
      throw new BadRequestException('Envie uma imagem ou vídeo aceito.');
    return mime.startsWith('image/') ? 'image' : 'video';
  }
  private assertDomainLimit(file: UploadFile, type: 'image' | 'video') {
    const bytes = Math.max(file.size ?? 0, file.buffer.length);
    if (bytes > (type === 'image' ? CREATIVE_IMAGE_MAX_BYTES : VIDEO_MAX))
      throw new BadRequestException(
        type === 'image'
          ? 'A imagem excede o limite de 20 MB.'
          : 'O vídeo excede o limite de 300 MB.',
      );
  }
  /**
   * Lists a file sent in the Planner, sharing its binary rather than copying
   * it. A thumbnail is a convenience and never blocks the listing.
   */
  async adoptPlannerUpload(
    scope: CreativeStudioScope,
    actor: string | null,
    input: { mediaAssetId: string; contentItemId: string },
  ) {
    const link = await this.assertContentItem(scope, input.contentItemId);
    if (!link) return null;
    const folderId = await this.plannerFolder(scope, actor, link);
    const { asset: media, file } = await this.mediaUpload.getContent(
      scope,
      input.mediaAssetId,
    );
    const assetType = media.mimeType.startsWith('image/') ? 'image' : 'video';
    let thumbnailId: string | null = null;
    if (assetType === 'image') {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of file.body)
          chunks.push(Buffer.from(chunk as Uint8Array));
        thumbnailId = await this.thumbnailFor(
          scope,
          actor,
          {
            buffer: Buffer.concat(chunks),
            originalname: media.originalFilename ?? 'imagem',
            mimetype: media.mimeType,
          },
          assetType,
        );
      } catch {
        thumbnailId = null;
      }
    } else file.body.destroy();
    return this.dataSource.transaction(async (manager) => {
      const assets = manager.getRepository(CreativeAssetEntity);
      const versions = manager.getRepository(CreativeAssetVersionEntity);
      const asset = await assets.save(
        assets.create({
          ...this.scopeValues(scope),
          name: (media.originalFilename || 'Criativo').slice(0, 255),
          assetType,
          sourceType: 'planner_upload',
          status: 'ready',
          folderId,
          contentItemId: input.contentItemId,
          currentVersionId: null,
          metadata: {},
          createdById: actor,
          archivedAt: null,
        }),
      );
      const version = await versions.save(
        versions.create({
          creativeAssetId: asset.id,
          versionNumber: 1,
          mediaAssetId: media.id,
          thumbnailMediaAssetId: thumbnailId,
          source: 'upload',
          createdById: actor,
        }),
      );
      asset.currentVersionId = version.id;
      return assets.save(asset);
    });
  }
  private async thumbnailFor(
    scope: CreativeStudioScope,
    actor: string | null,
    file: UploadFile,
    assetType: 'image' | 'video',
  ): Promise<string | null> {
    if (assetType === 'image')
      return (await this.thumbnails.create(scope, actor, file)).id;
    if (!file.videoPoster) return null;
    // A poster is a convenience: an unreadable one never blocks the video.
    try {
      return (await this.thumbnails.create(scope, actor, file.videoPoster)).id;
    } catch {
      return null;
    }
  }
  async upload(
    scope: CreativeStudioScope,
    actor: string | null,
    input: {
      file: UploadFile;
      name?: string;
      folderId?: string;
      contentItemId?: string;
      /** `generated` when a CS3 output is promoted; the column has no CHECK. */
      sourceType?: 'upload' | 'generated';
      onVersionCreated?: CreativeVersionCreatedHook;
    },
  ) {
    const assetType = this.kind(input.file);
    this.assertDomainLimit(input.file, assetType);
    await this.assertFolder(scope, input.folderId);
    const link = await this.assertContentItem(scope, input.contentItemId);
    const folderId =
      input.folderId ??
      (link ? await this.plannerFolder(scope, actor, link) : null);
    const original = await this.mediaUpload.upload(scope, actor, {
      file: input.file,
      source: 'creative_studio',
    });
    let thumbnailId: string | null = null;
    try {
      thumbnailId = await this.thumbnailFor(
        scope,
        actor,
        input.file,
        assetType,
      );
      return await this.dataSource.transaction(async (manager) => {
        const assets = manager.getRepository(CreativeAssetEntity);
        const versions = manager.getRepository(CreativeAssetVersionEntity);
        const asset = await assets.save(
          assets.create({
            ...this.scopeValues(scope),
            name: (
              input.name?.trim() ||
              original.originalFilename ||
              'Criativo'
            ).slice(0, 255),
            assetType,
            sourceType: input.sourceType ?? 'upload',
            status: 'ready',
            folderId,
            contentItemId: input.contentItemId ?? null,
            currentVersionId: null,
            metadata: {},
            createdById: actor,
            archivedAt: null,
          }),
        );
        const version = await versions.save(
          versions.create({
            creativeAssetId: asset.id,
            versionNumber: 1,
            mediaAssetId: original.id,
            thumbnailMediaAssetId: thumbnailId,
            source: 'upload',
            createdById: actor,
          }),
        );
        asset.currentVersionId = version.id;
        const saved = await assets.save(asset);
        await this.reflectProductionStarted(scope, actor, saved, manager);
        await input.onVersionCreated?.(manager, {
          creativeAssetId: asset.id,
          versionId: version.id,
        });
        return saved;
      });
    } catch (error) {
      if (thumbnailId)
        await this.mediaUpload.removeAfterFailedConsumerOperation(
          scope,
          thumbnailId,
        );
      await this.mediaUpload.removeAfterFailedConsumerOperation(
        scope,
        original.id,
      );
      throw error;
    }
  }
  /**
   * `revision` (CS2B.6) marks a version produced in answer to a client's
   * request for changes on `revisesVersionId`. The caller
   * (`CreativeVersionApprovalService.startRevision`) has already proven that
   * against Approvals; here the Studio enforces its own part: a live asset,
   * and only the current version can be revised — once, even under races.
   */
  async createVersion(
    scope: CreativeStudioScope,
    actor: string | null,
    assetId: string,
    file: UploadFile,
    revision?: { revisesVersionId: string },
    onVersionCreated?: CreativeVersionCreatedHook,
  ) {
    const asset = await this.findWritable(scope, assetId);
    if (revision) this.assertRevisable(asset, revision.revisesVersionId);
    const assetType = this.kind(file);
    if (asset.assetType !== assetType)
      throw new BadRequestException(
        'A nova versão deve manter o tipo do criativo.',
      );
    this.assertDomainLimit(file, assetType);
    const original = await this.mediaUpload.upload(scope, actor, {
      file,
      source: 'creative_studio',
    });
    let thumbnailId: string | null = null;
    try {
      thumbnailId = await this.thumbnailFor(scope, actor, file, assetType);
      return await this.dataSource.transaction(async (manager) => {
        const versions = manager.getRepository(CreativeAssetVersionEntity);
        const assets = manager.getRepository(CreativeAssetEntity);
        const latest = await versions
          .createQueryBuilder('v')
          .select('MAX(v.versionNumber)', 'max')
          .where('v.creativeAssetId = :id', { id: asset.id })
          .getRawOne<{ max: string | null }>();
        const version = await versions.save(
          versions.create({
            creativeAssetId: asset.id,
            versionNumber: Number(latest?.max ?? 0) + 1,
            mediaAssetId: original.id,
            thumbnailMediaAssetId: thumbnailId,
            source: 'replace',
            createdById: actor,
          }),
        );
        const created = { creativeAssetId: asset.id, versionId: version.id };
        if (!revision) {
          await assets.update(
            { id: asset.id },
            { currentVersionId: version.id },
          );
          await this.reflectProductionStarted(scope, actor, asset, manager);
          await onVersionCreated?.(manager, created);
          return this.versionView(version);
        }
        // Compare-and-set: of two revisions of the same version (double
        // click, two operators) only the first moves the pointer; the other
        // rolls back here and its binaries are compensated below.
        const moved = await assets.update(
          { id: asset.id, currentVersionId: revision.revisesVersionId },
          { currentVersionId: version.id },
        );
        if ((moved.affected ?? 0) !== 1) throw this.revisionAlreadyStarted();
        if (asset.contentItemId)
          await this.plannerStatus.reflectCreativeRevisionStarted(
            scope,
            { contentItemId: asset.contentItemId, actorUserId: actor },
            manager,
          );
        await onVersionCreated?.(manager, created);
        return this.versionView(version);
      });
    } catch (error) {
      if (thumbnailId)
        await this.mediaUpload.removeAfterFailedConsumerOperation(
          scope,
          thumbnailId,
        );
      await this.mediaUpload.removeAfterFailedConsumerOperation(
        scope,
        original.id,
      );
      // Two versions racing for the same number: the unique constraint already
      // serializes them; report the loser as a conflict instead of a 500.
      if (this.isVersionNumberConflict(error))
        throw revision
          ? this.revisionAlreadyStarted()
          : new ConflictException(
              'Outra versão deste criativo foi criada ao mesmo tempo. Atualize e tente novamente.',
            );
      throw error;
    }
  }
  private assertRevisable(
    asset: CreativeAssetEntity,
    revisesVersionId: string,
  ) {
    if (asset.status === 'archived' || asset.archivedAt)
      throw new ConflictException(
        'Criativo arquivado: não é possível iniciar uma revisão.',
      );
    if (asset.currentVersionId !== revisesVersionId)
      throw this.revisionAlreadyStarted();
  }
  private revisionAlreadyStarted() {
    return new ConflictException(
      'Já existe uma versão mais recente deste criativo. Envie essa versão para aprovação.',
    );
  }
  private isVersionNumberConflict(error: unknown) {
    const candidate = error as {
      code?: string;
      constraint?: string;
      driverError?: { code?: string; constraint?: string };
    } | null;
    const code = candidate?.code ?? candidate?.driverError?.code;
    const constraint =
      candidate?.constraint ?? candidate?.driverError?.constraint;
    return (
      code === '23505' &&
      constraint === 'UQ_social_creative_asset_versions_number'
    );
  }
  async list(
    scope: CreativeStudioScope,
    query: {
      assetType?: string;
      folderId?: string;
      status?: string;
      contentItemId?: string;
      search?: string;
      sourceType?: string;
      createdFrom?: string;
      createdTo?: string;
      trashed?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    const take = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), 100);
    const qb = this.assets
      .createQueryBuilder('asset')
      .leftJoinAndMapOne(
        'asset.currentVersion',
        CreativeAssetVersionEntity,
        'version',
        'version.id = asset.currentVersionId',
      )
      .leftJoinAndMapOne(
        'asset.currentMedia',
        MediaAssetEntity,
        'media',
        'media.id = version.mediaAssetId',
      )
      .where(
        'asset.tenantId = :tenantId AND asset.workspaceId = :workspaceId',
        scope,
      )
      .andWhere('asset.deletedAt IS NULL')
      .andWhere(
        scope.agencyClientId === null
          ? 'asset.agencyClientId IS NULL'
          : 'asset.agencyClientId = :agencyClientId',
        scope.agencyClientId === null
          ? {}
          : { agencyClientId: scope.agencyClientId },
      )
      .andWhere(
        scope.companyContextId === null
          ? 'asset.companyContextId IS NULL'
          : 'asset.companyContextId = :companyContextId',
        scope.companyContextId === null
          ? {}
          : { companyContextId: scope.companyContextId },
      );
    if (query.assetType)
      qb.andWhere('asset.assetType = :assetType', {
        assetType: query.assetType,
      });
    if (query.folderId)
      qb.andWhere('asset.folderId = :folderId', { folderId: query.folderId });
    // The Lixeira is its own view: its files are out of every status list.
    if (query.trashed === 'true') qb.andWhere('asset.trashedAt IS NOT NULL');
    else
      qb.andWhere('asset.trashedAt IS NULL').andWhere(
        'asset.status = :status',
        { status: query.status ?? 'ready' },
      );
    if (query.contentItemId)
      qb.andWhere('asset.contentItemId = :contentItemId', {
        contentItemId: query.contentItemId,
      });
    if (query.sourceType)
      qb.andWhere('asset.sourceType = :sourceType', {
        sourceType: query.sourceType,
      });
    if (query.createdFrom)
      qb.andWhere('asset.createdAt >= :createdFrom', {
        createdFrom: query.createdFrom,
      });
    if (query.createdTo)
      qb.andWhere('asset.createdAt <= :createdTo', {
        createdTo: query.createdTo,
      });
    if (query.search)
      qb.andWhere('asset.name ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    if (query.cursor)
      qb.andWhere('asset.createdAt < :cursor', {
        cursor: new Date(query.cursor),
      });
    const items = await qb
      .orderBy('asset.createdAt', 'DESC')
      .addOrderBy('asset.id', 'DESC')
      .take(take + 1)
      .getMany();
    const next =
      items.length > take
        ? (items.pop()?.createdAt.toISOString() ?? null)
        : null;
    return {
      items: items.map((asset) =>
        this.toView(
          asset,
          (
            asset as CreativeAssetEntity & {
              currentVersion?: CreativeAssetVersionEntity;
              currentMedia?: MediaAssetEntity;
            }
          ).currentVersion,
          (
            asset as CreativeAssetEntity & {
              currentMedia?: MediaAssetEntity;
            }
          ).currentMedia,
        ),
      ),
      nextCursor: next,
    };
  }
  async detail(scope: CreativeStudioScope, id: string) {
    const asset = await this.find(scope, id);
    const versions = await this.versions.find({
      where: { creativeAssetId: id },
      order: { versionNumber: 'DESC' },
    });
    const current = versions.find((v) => v.id === asset.currentVersionId);
    return {
      ...this.toView(asset, current),
      versions: versions.map((v) => this.versionView(v)),
      planner: await this.plannerLink(scope, asset.contentItemId),
    };
  }
  async update(
    scope: CreativeStudioScope,
    id: string,
    input: { name?: string; folderId?: string | null },
  ) {
    const asset = await this.findWritable(scope, id);
    if (input.folderId !== undefined && input.folderId !== null)
      await this.assertFolder(scope, input.folderId);
    if (input.name !== undefined) asset.name = input.name.trim();
    if (input.folderId !== undefined) asset.folderId = input.folderId;
    return this.assets.save(asset);
  }
  /**
   * CS5-B: an asset whose version is the explicit selection of a live content
   * item cannot be archived (`TR_social_creative_assets_selection_guard`, which
   * also closes the race with a concurrent selection). The operator changes or
   * clears the selection first; nothing cascades.
   */
  async archive(scope: CreativeStudioScope, id: string) {
    const asset = await this.findWritable(scope, id);
    asset.status = 'archived';
    asset.archivedAt = new Date();
    try {
      return await this.assets.save(asset);
    } catch (error) {
      if (
        databaseConstraint(error) ===
        'TR_social_creative_assets_selection_guard'
      )
        throw new ConflictException({
          code: 'creative_selected_for_content',
          message:
            'Este criativo é a versão selecionada de um conteúdo. Troque ou remova a seleção antes de arquivar.',
        });
      throw error;
    }
  }
  /**
   * Sends the asset to the Lixeira or, when `permanent`, deletes it now. Files
   * linked to the Planner stay recoverable through archive. The row survives
   * permanent deletion for Approvals and Production; the binary goes with
   * `CreativeTrashPurgeWorker` once no other owner holds it.
   */
  async remove(scope: CreativeStudioScope, id: string, permanent = false) {
    const asset = await this.find(scope, id);
    // A Planner upload is held by the purge until its post is out.
    if (
      asset.contentItemId &&
      asset.sourceType !== 'planner_upload' &&
      !asset.trashedAt
    )
      throw new ConflictException({
        code: 'creative_linked_to_content',
        message:
          'Este criativo está vinculado a um conteúdo do Planner. Arquive-o em vez de excluir.',
      });
    const now = new Date();
    if (!asset.trashedAt) asset.restoreFolderId = asset.folderId;
    asset.status = 'archived';
    asset.archivedAt = asset.archivedAt ?? now;
    asset.trashedAt = asset.trashedAt ?? now;
    asset.folderId = null;
    if (permanent) asset.deletedAt = now;
    await this.assets.save(asset);
  }
  /**
   * Back to its folder, or the root if that folder is gone. Trashing stamps
   * both dates together, so a difference means it was archived before.
   */
  async restore(scope: CreativeStudioScope, id: string) {
    const asset = await this.find(scope, id);
    if (!asset.trashedAt)
      throw new BadRequestException('Este arquivo não está na Lixeira.');
    const wasArchived =
      asset.archivedAt !== null &&
      asset.archivedAt.getTime() !== asset.trashedAt.getTime();
    const folderExists =
      asset.restoreFolderId !== null &&
      (await this.folders.exists({
        where: { ...this.scopeWhere(scope), id: asset.restoreFolderId },
      }));
    asset.folderId = folderExists ? asset.restoreFolderId : null;
    asset.status = wasArchived ? 'archived' : 'ready';
    asset.archivedAt = wasArchived ? asset.archivedAt : null;
    asset.trashedAt = null;
    asset.restoreFolderId = null;
    asset.purgeAfter = null;
    asset.restoredAt = new Date();
    return this.toView(await this.assets.save(asset));
  }
  async emptyTrash(scope: CreativeStudioScope) {
    const result = await this.assets.update(
      {
        ...this.scopeWhere(scope),
        trashedAt: Not(IsNull()),
        deletedAt: IsNull(),
      },
      { deletedAt: new Date() },
    );
    return { deleted: result.affected ?? 0 };
  }
  async copy(
    scope: CreativeStudioScope,
    actor: string | null,
    id: string,
    folderId?: string,
  ) {
    const source = await this.findWritable(scope, id);
    await this.assertFolder(scope, folderId);
    const sourceVersion = await this.versions.findOne({
      where: { id: source.currentVersionId ?? '', creativeAssetId: source.id },
    });
    if (!sourceVersion)
      throw new NotFoundException('Versão atual não encontrada.');
    const created = await this.dataSource.transaction((manager) =>
      copyCreativeAssetRecords(manager, source, sourceVersion, actor, {
        folderId: folderId ?? null,
        name: `${source.name} - cópia`.slice(0, 255),
      }),
    );
    return this.toView(created.asset, created.version);
  }
  /** The quota belongs to the client, across all of its companies. */
  async storage(scope: CreativeStudioScope) {
    const qb = this.mediaAssets
      .createQueryBuilder('media')
      .select('COALESCE(SUM(media.byteSize), 0)', 'usedBytes')
      .where(
        'media.tenantId = :tenantId AND media.workspaceId = :workspaceId',
        scope,
      )
      .andWhere(
        scope.agencyClientId === null
          ? 'media.agencyClientId IS NULL'
          : 'media.agencyClientId = :agencyClientId',
        scope.agencyClientId === null
          ? {}
          : { agencyClientId: scope.agencyClientId },
      )
      // Generation candidates expire on their own and never count.
      .andWhere("media.source NOT LIKE 'temporary:%'")
      // Freed the moment it is deleted, ahead of the sweep that removes the
      // binary. A copy still in use keeps the shared media counted.
      .andWhere(
        `(NOT EXISTS (${MEDIA_VERSION_REF} AND a.deleted_at IS NOT NULL)
          OR EXISTS (${MEDIA_VERSION_REF} AND a.deleted_at IS NULL))`,
      );
    const [result, trashCount] = await Promise.all([
      qb.getRawOne<{ usedBytes: string }>(),
      this.assets.count({
        where: {
          ...this.scopeWhere(scope),
          trashedAt: Not(IsNull()),
          deletedAt: IsNull(),
        },
      }),
    ]);
    return {
      usedBytes: Number(result?.usedBytes ?? 0),
      quotaBytes: CREATIVE_STORAGE_QUOTA_BYTES,
      trashCount,
    };
  }
  async content(
    scope: CreativeStudioScope,
    id: string,
    thumbnail = false,
    versionId?: string,
  ) {
    const asset = await this.find(scope, id);
    const version = versionId
      ? await this.versions.findOne({
          where: { id: versionId, creativeAssetId: asset.id },
        })
      : await this.versions.findOne({
          where: {
            id: asset.currentVersionId ?? '',
            creativeAssetId: asset.id,
          },
        });
    if (!version)
      throw new NotFoundException(
        versionId ? 'Versão não encontrada.' : 'Versão atual não encontrada.',
      );
    const mediaAssetId = thumbnail
      ? version.thumbnailMediaAssetId
      : version.mediaAssetId;
    if (!mediaAssetId)
      throw new NotFoundException(
        thumbnail
          ? 'Thumbnail não encontrada.'
          : 'Versão atual não encontrada.',
      );
    return this.mediaResolver.resolve({ ...scope, mediaAssetId });
  }
  async versionsFor(scope: CreativeStudioScope, id: string) {
    await this.find(scope, id);
    return (
      await this.versions.find({
        where: { creativeAssetId: id },
        order: { versionNumber: 'DESC' },
      })
    ).map((v) => this.versionView(v));
  }
  /** Files in the Lixeira can be viewed and deleted, never changed. */
  private async findWritable(scope: CreativeStudioScope, id: string) {
    const asset = await this.find(scope, id);
    if (asset.trashedAt)
      throw new NotFoundException('Criativo não encontrado.');
    return asset;
  }
  private async find(scope: CreativeStudioScope, id: string) {
    const asset = await this.assets.findOne({
      where: { ...this.scopeWhere(scope), id, deletedAt: IsNull() },
    });
    if (!asset) throw new NotFoundException('Criativo não encontrado.');
    return asset;
  }
  private versionView(version: CreativeAssetVersionEntity) {
    const versionQuery = `?versionId=${encodeURIComponent(version.id)}`;
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      source: version.source,
      createdAt: version.createdAt.toISOString(),
      contentPath: `/social/creative-studio/assets/${version.creativeAssetId}/content${versionQuery}`,
      thumbnailPath: version.thumbnailMediaAssetId
        ? `/social/creative-studio/assets/${version.creativeAssetId}/thumbnail${versionQuery}`
        : null,
    };
  }
  private toView(
    asset: CreativeAssetEntity,
    version?: CreativeAssetVersionEntity,
    media?: MediaAssetEntity,
  ) {
    return {
      id: asset.id,
      name: asset.name,
      assetType: asset.assetType,
      sourceType: asset.sourceType,
      status: asset.status,
      folderId: asset.folderId,
      contentItemId: asset.contentItemId,
      currentVersionId: asset.currentVersionId,
      version: version ? this.versionView(version) : null,
      byteSize: media ? Number(media.byteSize) : 0,
      // CA10 — the author, so the Client Area offers Operator edits only on own assets (§3.3).
      createdById: asset.createdById,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      archivedAt: asset.archivedAt?.toISOString() ?? null,
    };
  }
}
