import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateKnowledgeCategoryDto, UpdateKnowledgeCategoryDto } from '../dto';
import { AgencyKnowledgeCategory } from '../entities';
import { KnowledgeContext } from './knowledge-context';

@Injectable()
export class KnowledgeCategoriesService {
  constructor(
    @InjectRepository(AgencyKnowledgeCategory, 'agency')
    private readonly categoriesRepository: Repository<AgencyKnowledgeCategory>,
  ) {}

  list(context: KnowledgeContext) {
    return this.categoriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      order: {
        sortOrder: 'ASC',
        name: 'ASC',
      },
    });
  }

  create(context: KnowledgeContext, dto: CreateKnowledgeCategoryDto) {
    const category = this.categoriesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      parentId: dto.parentId ?? null,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      color: dto.color ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    return this.categoriesRepository.save(category);
  }

  async update(
    context: KnowledgeContext,
    id: string,
    dto: UpdateKnowledgeCategoryDto,
  ) {
    const category = await this.categoriesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!category) {
      throw new NotFoundException('Knowledge category not found');
    }

    Object.assign(category, {
      parentId: dto.parentId ?? category.parentId,
      name: dto.name ?? category.name,
      slug: dto.slug ?? category.slug,
      description:
        dto.description === undefined ? category.description : dto.description,
      icon: dto.icon === undefined ? category.icon : dto.icon,
      color: dto.color === undefined ? category.color : dto.color,
      sortOrder: dto.sortOrder ?? category.sortOrder,
      isActive: dto.isActive ?? category.isActive,
    });

    return this.categoriesRepository.save(category);
  }

  async delete(context: KnowledgeContext, id: string) {
    const category = await this.categoriesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!category) {
      throw new NotFoundException('Knowledge category not found');
    }

    const childCount = await this.categoriesRepository.count({
      where: {
        parentId: id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete a category that has subcategories. Delete or reassign them first.',
      );
    }

    await this.categoriesRepository.remove(category);

    return { deleted: true, id };
  }
}
