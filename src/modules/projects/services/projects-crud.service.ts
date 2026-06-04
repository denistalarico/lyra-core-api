import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { AgencyProject, AgencyProjectEvent } from '../entities';
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

    @InjectRepository(AgencyProjectEvent, 'agency')
    private readonly eventsRepository: Repository<AgencyProjectEvent>,
  ) {}

  private recordEvent(
    context: RequestContext,
    projectId: string,
    body: string,
    meta?: Record<string, unknown>,
  ) {
    const event = this.eventsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId,
      authorId: context.userId,
      kind: 'system',
      body,
      dueAt: null,
      meta: meta ?? null,
    });
    return this.eventsRepository.save(event);
  }

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
      markerIds: dto.markerIds ?? [],
      archivedAt: null,
      completedAt: dto.status === ProjectStatus.Completed ? new Date() : null,
    });

    return this.projectsRepository.save(project);
  }

  async update(context: RequestContext, id: string, dto: UpdateProjectDto) {
    const project = await this.findOne(context, id);

    // Capture previous values BEFORE any mutation so event diffs are correct
    const prev = {
      name: project.name,
      clientId: project.clientId,
      ownerId: project.ownerId,
      priority: project.priority,
      status: project.status,
      dueDate: project.dueDate ? project.dueDate.toISOString().slice(0, 10) : null,
    };

    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.clientId !== undefined) project.clientId = dto.clientId;
    if (dto.stageId !== undefined) project.stageId = dto.stageId;
    if (dto.ownerId !== undefined) project.ownerId = dto.ownerId;
    if (dto.priority !== undefined) project.priority = dto.priority;
    if (dto.progress !== undefined) project.progress = dto.progress;
    if (dto.markerIds !== undefined) project.markerIds = dto.markerIds;
    if (dto.color !== undefined) project.color = dto.color;
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

    const saved = await this.projectsRepository.save(project);

    // Record events using captured prev values
    if (dto.status !== undefined && dto.status !== prev.status) {
      void this.recordEvent(
        context, id,
        `Status: ${prev.status} → ${dto.status}`,
        { field: 'status', from: prev.status, to: dto.status },
      );
    }
    if (dto.priority !== undefined && dto.priority !== prev.priority) {
      void this.recordEvent(
        context, id,
        `Prioridade: ${prev.priority ?? '–'} → ${dto.priority}`,
        { field: 'priority', from: prev.priority, to: dto.priority },
      );
    }
    if (dto.ownerId !== undefined && dto.ownerId !== prev.ownerId) {
      void this.recordEvent(
        context, id,
        `Responsável atualizado`,
        { field: 'ownerId', from: prev.ownerId ?? null, to: dto.ownerId ?? null },
      );
    }
    if (dto.dueDate !== undefined) {
      const newDate = dto.dueDate ? new Date(dto.dueDate).toISOString().slice(0, 10) : null;
      if (prev.dueDate !== newDate) {
        void this.recordEvent(
          context, id,
          `Data limite: ${prev.dueDate ?? 'sem data'} → ${newDate ?? 'sem data'}`,
          { field: 'dueDate', from: prev.dueDate, to: newDate },
        );
      }
    }
    if (dto.clientId !== undefined && dto.clientId !== prev.clientId) {
      void this.recordEvent(
        context, id,
        `Cliente atualizado`,
        { field: 'clientId', from: prev.clientId ?? null, to: dto.clientId ?? null },
      );
    }
    if (dto.name !== undefined && dto.name !== prev.name) {
      void this.recordEvent(
        context, id,
        `Nome: "${prev.name}" → "${dto.name}"`,
        { field: 'name', from: prev.name, to: dto.name },
      );
    }

    return saved;
  }

  async archive(context: RequestContext, id: string) {
    const project = await this.findOne(context, id);

    project.status = ProjectStatus.Archived;
    project.archivedAt = new Date();

    const saved = await this.projectsRepository.save(project);
    void this.recordEvent(context, id, 'Projeto arquivado');

    return saved;
  }
}
