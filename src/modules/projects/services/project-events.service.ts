import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyProjectEvent } from '../entities';
import { CreateProjectEventDto } from '../dto';
import { ProjectsCrudService } from './projects-crud.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

@Injectable()
export class ProjectEventsService {
  constructor(
    @InjectRepository(AgencyProjectEvent, 'agency')
    private readonly eventsRepository: Repository<AgencyProjectEvent>,

    private readonly projectsCrudService: ProjectsCrudService,
  ) {}

  async list(context: RequestContext, projectId: string) {
    await this.projectsCrudService.findOne(context, projectId);

    return this.eventsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async create(context: RequestContext, projectId: string, dto: CreateProjectEventDto) {
    await this.projectsCrudService.findOne(context, projectId);

    const body = dto.body.trim();

    if (!body) {
      throw new BadRequestException('Project event body is required');
    }

    const event = this.eventsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId,
      authorId: context.userId,
      kind: dto.kind,
      body,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
    });

    return this.eventsRepository.save(event);
  }

  async createSystemEvent(
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

  async clearAll(context: RequestContext, projectId: string) {
    await this.projectsCrudService.findOne(context, projectId);

    await this.eventsRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId,
    });

    return { cleared: true };
  }

  async delete(context: RequestContext, projectId: string, eventId: string) {
    await this.projectsCrudService.findOne(context, projectId);

    const event = await this.eventsRepository.findOne({
      where: {
        id: eventId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId,
      },
    });

    if (!event) {
      throw new NotFoundException('Project event not found');
    }

    await this.eventsRepository.delete(event.id);

    return { deleted: true };
  }
}
