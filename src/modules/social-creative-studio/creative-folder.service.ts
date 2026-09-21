import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreativeAssetEntity, CreativeFolderEntity } from './entities';
import type { CreativeStudioScope } from './creative-studio.scope';

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
    return this.folders.find({
      where: this.where(scope),
      order: { name: 'ASC' },
    });
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
  async update(scope: CreativeStudioScope, id: string, name: string) {
    const folder = await this.find(scope, id);
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
  async find(scope: CreativeStudioScope, id: string) {
    const folder = await this.folders.findOne({
      where: { ...this.where(scope), id },
    });
    if (!folder) throw new NotFoundException('Pasta não encontrada.');
    return folder;
  }
}
