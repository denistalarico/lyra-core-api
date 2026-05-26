import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { AgencyProject } from '../entities';
import { ProjectStatus } from '../enums';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
} from '../dto';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

@Injectable()
export class ProjectsCrudService {
  constructor(
    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepository: Repository<AgencyProject>,
  ) {}

  list(context: RequestContext, query: ListProjectsQueryDto) {
    const where: FindOptionsWhere<AgencyProject> = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      archivedAt: IsNull(),
    };

    if (query.clientId) where.clientId = query.clientId;
    if (query.stageId) where.stageId = query.stageId;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.search) where.name = ILike(`%${query.search}%`);

    return this.projectsRepository.find({
      where,
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  async findOne(context: RequestContext, id: string) {
    const project = await this.projectsRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!project || project.archivedAt) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  create(context: RequestContext, dto: CreateProjectDto) {
    const project = this.projectsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      clientId: dto.clientId ?? null,
      stageId: dto.stageId ?? null,
      ownerId: dto.ownerId ?? context.userId,
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status ?? ProjectStatus.Active,
      priority: dto.priority,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      progress: dto.progress ?? 0,
      archivedAt: null,
      completedAt: dto.status === ProjectStatus.Completed ? new Date() : null,
    });

    return this.projectsRepository.save(project);
  }

  async update(context: RequestContext, id: string, dto: UpdateProjectDto) {
    const project = await this.findOne(context, id);

    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.clientId !== undefined) project.clientId = dto.clientId;
    if (dto.stageId !== undefined) project.stageId = dto.stageId;
    if (dto.ownerId !== undefined) project.ownerId = dto.ownerId;
    if (dto.priority !== undefined) project.priority = dto.priority;
    if (dto.progress !== undefined) project.progress = dto.progress;
    if (dto.markerIds !== undefined) project.markerIds = dto.markerIds;
    if (dto.isPublicPageEnabled !== undefined) {
      project.isPublicPageEnabled = dto.isPublicPageEnabled;
    }
    if (dto.publicPagePassword !== undefined) {
      project.publicPagePassword = dto.publicPagePassword;
    }
    if (dto.startDate !== undefined) {
      project.startDate = dto.startDate ? new Date(dto.startDate) : null;
    }
    if (dto.dueDate !== undefined) {
      project.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    if (dto.status !== undefined) {
      project.status = dto.status;

      if (dto.status === ProjectStatus.Completed && !project.completedAt) {
        project.completedAt = new Date();
        project.progress = 100;
      }

      if (dto.status !== ProjectStatus.Completed) {
        project.completedAt = null;
      }
    }

    return this.projectsRepository.save(project);
  }

  async archive(context: RequestContext, id: string) {
    const project = await this.findOne(context, id);

    project.status = ProjectStatus.Archived;
    project.archivedAt = new Date();

    return this.projectsRepository.save(project);
  }
}
