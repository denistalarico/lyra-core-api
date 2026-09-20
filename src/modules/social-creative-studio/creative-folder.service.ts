import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { MediaAssetScope } from '../../common/media-assets';
import { CreativeAssetEntity, CreativeFolderEntity } from './entities';

@Injectable()
export class CreativeFolderService {
  constructor(
    @InjectRepository(CreativeFolderEntity, 'agency') private readonly folders: Repository<CreativeFolderEntity>,
    @InjectRepository(CreativeAssetEntity, 'agency') private readonly assets: Repository<CreativeAssetEntity>,
  ) {}
  private where(scope: MediaAssetScope) { return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, agencyClientId: scope.agencyClientId === null ? IsNull() : scope.agencyClientId }; }
  private values(scope: MediaAssetScope) { return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, agencyClientId: scope.agencyClientId }; }
  async list(scope: MediaAssetScope) { return this.folders.find({ where: this.where(scope), order: { name: 'ASC' } }); }
  async create(scope: MediaAssetScope, actor: string | null, input: { name: string; parentId?: string }) {
    if (input.parentId) await this.find(scope, input.parentId);
    return this.folders.save(this.folders.create({ ...this.values(scope), name: input.name.trim(), parentId: input.parentId ?? null, createdById: actor }));
  }
  async update(scope: MediaAssetScope, id: string, name: string) { const folder = await this.find(scope, id); folder.name = name.trim(); return this.folders.save(folder); }
  async remove(scope: MediaAssetScope, id: string) {
    const folder = await this.find(scope, id);
    const [children, assets] = await Promise.all([
      this.folders.count({ where: { ...this.where(scope), parentId: id } }),
      this.assets.count({ where: { ...this.where(scope), folderId: id } }),
    ]);
    if (children || assets) throw new BadRequestException('A pasta não pode ser removida enquanto contiver pastas ou criativos.');
    await this.folders.remove(folder);
  }
  async find(scope: MediaAssetScope, id: string) { const folder = await this.folders.findOne({ where: { ...this.where(scope), id } }); if (!folder) throw new NotFoundException('Pasta não encontrada.'); return folder; }
}
