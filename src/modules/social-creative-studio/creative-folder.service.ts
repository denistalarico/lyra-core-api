import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from './entities';
import { copyCreativeAssetRecords } from './creative-asset-copy';
import {
  contentFolderName,
  databaseConstraint,
} from './creative-asset.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';

@Injectable()
export class CreativeFolderService {
  constructor(
    @InjectRepository(CreativeFolderEntity, 'agency')
    private readonly folders: Repository<CreativeFolderEntity>,
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly assets: Repository<CreativeAssetEntity>,
  ) {}
  private where(scope: CreativeStudioScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    };
  }
  private values(scope: CreativeStudioScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
    };
  }
  async list(scope: CreativeStudioScope) {
    const [folders, assets] = await Promise.all([
      this.folders.find({ where: this.where(scope), order: { name: 'ASC' } }),
      this.assets.find({
        where: {
          ...this.where(scope),
          folderId: Not(IsNull()),
          deletedAt: IsNull(),
        },
        select: { folderId: true, status: true },
      }),
    ]);
    const count = (folderId: string, archived: boolean) =>
      assets.filter(
        (asset) =>
          asset.folderId === folderId &&
          (asset.status === 'archived') === archived,
      ).length;
    const names = await this.plannerNames(folders);
    return folders.map((folder) => ({
      ...folder,
      name: names.get(folder.id) ?? folder.name,
      assetCount: count(folder.id, false),
      archivedCount: count(folder.id, true),
    }));
  }
  async create(
    scope: CreativeStudioScope,
    actor: string | null,
    input: { name: string; parentId?: string },
  ) {
    if (input.parentId) await this.find(scope, input.parentId);
    return this.folders.save(
      this.folders.create({
        ...this.values(scope),
        name: input.name.trim(),
        parentId: input.parentId ?? null,
        createdById: actor,
      }),
    );
  }
  /** Read live, so renaming a plan or item needs no write here. */
  private async plannerNames(folders: CreativeFolderEntity[]) {
    const planIds = folders.flatMap((f) =>
      f.socialPlanId ? [f.socialPlanId] : [],
    );
    const itemIds = folders.flatMap((f) =>
      f.contentItemId ? [f.contentItemId] : [],
    );
    const names = new Map<string, string>();
    if (!planIds.length && !itemIds.length) return names;
    const manager = this.folders.manager;
    const [plans, items] = await Promise.all([
      planIds.length
        ? manager.find(SocialPlanEntity, {
            where: { id: In(planIds), deletedAt: IsNull() },
            select: { id: true, title: true },
          })
        : ([] as SocialPlanEntity[]),
      itemIds.length
        ? manager.find(SocialContentItemEntity, {
            where: { id: In(itemIds), deletedAt: IsNull() },
            select: { id: true, title: true, plannedDate: true },
          })
        : ([] as SocialContentItemEntity[]),
    ]);
    for (const folder of folders) {
      const plan = plans.find((row) => row.id === folder.socialPlanId);
      const item = items.find((row) => row.id === folder.contentItemId);
      if (plan) names.set(folder.id, plan.title.slice(0, 160));
      else if (item) names.set(folder.id, contentFolderName(item));
    }
    return names;
  }
  async update(scope: CreativeStudioScope, id: string, name: string) {
    const folder = await this.find(scope, id);
    if (folder.socialPlanId || folder.contentItemId)
      throw new ConflictException({
        code: 'creative_folder_follows_planner',
        message: 'O nome desta pasta acompanha o Planner.',
      });
    folder.name = name.trim();
    return this.folders.save(folder);
  }
  async remove(scope: CreativeStudioScope, id: string) {
    const folder = await this.find(scope, id);
    const [children, assets] = await Promise.all([
      this.folders.count({ where: { ...this.where(scope), parentId: id } }),
      this.assets.count({ where: { ...this.where(scope), folderId: id } }),
    ]);
    if (children || assets)
      throw new BadRequestException(
        'A pasta não pode ser removida enquanto contiver pastas ou criativos.',
      );
    await this.folders.remove(folder);
  }
  /** The folder followed by its descendants, parents always before children. */
  private async subtree(scope: CreativeStudioScope, id: string) {
    const root = await this.find(scope, id);
    const all = await this.folders.find({ where: this.where(scope) });
    const tree = [root];
    for (const folder of tree)
      tree.push(...all.filter((child) => child.parentId === folder.id));
    return tree;
  }
  private async assertDestination(
    scope: CreativeStudioScope,
    tree: CreativeFolderEntity[],
    parentId: string | null | undefined,
  ) {
    if (!parentId) return;
    await this.find(scope, parentId);
    if (tree.some((folder) => folder.id === parentId))
      throw new BadRequestException(
        'Escolha uma pasta fora da pasta selecionada.',
      );
  }
  async move(
    scope: CreativeStudioScope,
    id: string,
    parentId: string | null | undefined,
  ) {
    const tree = await this.subtree(scope, id);
    await this.assertDestination(scope, tree, parentId);
    tree[0].parentId = parentId ?? null;
    return this.folders.save(tree[0]);
  }
  /** Copies the active files of the tree; archived ones stay behind. */
  async copy(
    scope: CreativeStudioScope,
    actor: string | null,
    id: string,
    parentId: string | null | undefined,
  ) {
    const tree = await this.subtree(scope, id);
    await this.assertDestination(scope, tree, parentId);
    const sources = await this.assets.find({
      where: {
        ...this.where(scope),
        folderId: In(tree.map((folder) => folder.id)),
        status: 'ready',
        deletedAt: IsNull(),
      },
    });
    const versionIds = sources.flatMap((asset) =>
      asset.currentVersionId ? [asset.currentVersionId] : [],
    );
    return this.folders.manager.transaction(async (manager) => {
      const versions = versionIds.length
        ? await manager.find(CreativeAssetVersionEntity, {
            where: { id: In(versionIds) },
          })
        : [];
      const copies = new Map<string, CreativeFolderEntity>();
      for (const folder of tree) {
        const isRoot = folder.id === id;
        copies.set(
          folder.id,
          await manager.save(
            manager.create(CreativeFolderEntity, {
              ...this.values(scope),
              name: isRoot
                ? `${folder.name} - cópia`.slice(0, 160)
                : folder.name,
              parentId: isRoot
                ? (parentId ?? null)
                : copies.get(folder.parentId as string)!.id,
              createdById: actor,
            }),
          ),
        );
      }
      for (const source of sources) {
        const version = versions.find(
          (item) => item.id === source.currentVersionId,
        );
        if (!version) continue;
        await copyCreativeAssetRecords(manager, source, version, actor, {
          folderId: copies.get(source.folderId as string)!.id,
          name: source.name,
        });
      }
      return copies.get(id)!;
    });
  }
  /** Archives the active files of the tree; the folders themselves remain. */
  async archive(scope: CreativeStudioScope, id: string) {
    const tree = await this.subtree(scope, id);
    try {
      const result = await this.assets.update(
        {
          ...this.where(scope),
          folderId: In(tree.map((folder) => folder.id)),
          status: 'ready',
          deletedAt: IsNull(),
        },
        { status: 'archived', archivedAt: new Date() },
      );
      return { archived: result.affected ?? 0 };
    } catch (error) {
      if (
        databaseConstraint(error) ===
        'TR_social_creative_assets_selection_guard'
      )
        throw new ConflictException({
          code: 'creative_selected_for_content',
          message:
            'Um criativo desta pasta é a versão selecionada de um conteúdo. Troque ou remova a seleção antes de arquivar.',
        });
      throw error;
    }
  }
  /**
   * Removes the tree under the same rule as a single file: its files go to the
   * Lixeira, flat, or are deleted now when `permanent`.
   */
  async removeTree(scope: CreativeStudioScope, id: string, permanent = false) {
    const tree = await this.subtree(scope, id);
    const ids = tree.map((folder) => folder.id);
    const linked = await this.assets.count({
      where: {
        ...this.where(scope),
        folderId: In(ids),
        contentItemId: Not(IsNull()),
        deletedAt: IsNull(),
      },
    });
    if (linked)
      throw new ConflictException({
        code: 'creative_linked_to_content',
        message:
          'A pasta contém criativos vinculados ao Planner. Mova ou arquive esses arquivos antes de excluir.',
      });
    await this.folders.manager.transaction(async (manager) => {
      const now = new Date();
      await manager.update(
        CreativeAssetEntity,
        { ...this.where(scope), folderId: In(ids), deletedAt: IsNull() },
        {
          status: 'archived',
          archivedAt: now,
          trashedAt: now,
          folderId: null,
          ...(permanent ? { deletedAt: now } : {}),
        },
      );
      // Children first: the parent reference is restricted.
      for (const folder of [...tree].reverse()) await manager.remove(folder);
    });
  }
  async find(scope: CreativeStudioScope, id: string) {
    const folder = await this.folders.findOne({
      where: { ...this.where(scope), id },
    });
    if (!folder) throw new NotFoundException('Pasta não encontrada.');
    return folder;
  }
}
