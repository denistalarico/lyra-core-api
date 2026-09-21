import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  detectMediaAssetMimeType,
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

const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = 300 * 1024 * 1024;
const PAGE_SIZE = 50;
type UploadFile = {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
};

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
  ) {}
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
    if (!contentItemId) return;
    const item = await this.contentItems.findOne({
      where: {
        id: contentItemId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      },
      select: { id: true, planId: true },
    });
    if (!item) throw new BadRequestException('Conteúdo não encontrado.');
    const planExists = await this.plans.exists({
      where: {
        id: item.planId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        companyContextId:
          scope.companyContextId === null ? IsNull() : scope.companyContextId,
      },
    });
    if (!planExists) throw new BadRequestException('Conteúdo não encontrado.');
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
    if (bytes > (type === 'image' ? IMAGE_MAX : VIDEO_MAX))
      throw new BadRequestException(
        type === 'image'
          ? 'A imagem excede o limite de 20 MB.'
          : 'O vídeo excede o limite de 300 MB.',
      );
  }
  async upload(
    scope: CreativeStudioScope,
    actor: string | null,
    input: {
      file: UploadFile;
      name?: string;
      folderId?: string;
      contentItemId?: string;
    },
  ) {
    const assetType = this.kind(input.file);
    this.assertDomainLimit(input.file, assetType);
    await this.assertFolder(scope, input.folderId);
    await this.assertContentItem(scope, input.contentItemId);
    const original = await this.mediaUpload.upload(scope, actor, {
      file: input.file,
      source: 'creative_studio',
    });
    let thumbnailId: string | null = null;
    try {
      if (assetType === 'image')
        thumbnailId = (await this.thumbnails.create(scope, actor, input.file))
          .id;
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
            sourceType: 'upload',
            status: 'ready',
            folderId: input.folderId ?? null,
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
        return assets.save(asset);
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
  async createVersion(
    scope: CreativeStudioScope,
    actor: string | null,
    assetId: string,
    file: UploadFile,
  ) {
    const asset = await this.find(scope, assetId);
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
      if (assetType === 'image')
        thumbnailId = (await this.thumbnails.create(scope, actor, file)).id;
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
        await assets.update({ id: asset.id }, { currentVersionId: version.id });
        return version;
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
      .where(
        'asset.tenantId = :tenantId AND asset.workspaceId = :workspaceId',
        scope,
      )
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
    qb.andWhere('asset.status = :status', {
      status: query.status ?? 'ready',
    });
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
            }
          ).currentVersion,
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
    return {
      ...this.toView(
        asset,
        versions.find((v) => v.id === asset.currentVersionId),
      ),
      versions: versions.map((v) => this.versionView(v)),
    };
  }
  async update(
    scope: CreativeStudioScope,
    id: string,
    input: { name?: string; folderId?: string | null },
  ) {
    const asset = await this.find(scope, id);
    if (input.folderId !== undefined && input.folderId !== null)
      await this.assertFolder(scope, input.folderId);
    if (input.name !== undefined) asset.name = input.name.trim();
    if (input.folderId !== undefined) asset.folderId = input.folderId;
    return this.assets.save(asset);
  }
  async archive(scope: CreativeStudioScope, id: string) {
    const asset = await this.find(scope, id);
    asset.status = 'archived';
    asset.archivedAt = new Date();
    return this.assets.save(asset);
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
  private async find(scope: CreativeStudioScope, id: string) {
    const asset = await this.assets.findOne({
      where: { ...this.scopeWhere(scope), id },
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
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      archivedAt: asset.archivedAt?.toISOString() ?? null,
    };
  }
}
