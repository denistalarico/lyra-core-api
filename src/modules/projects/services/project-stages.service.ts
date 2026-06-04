import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectStage,
  AgencyTask,
  AgencyTaskStage,
} from '../entities';
import {
  CreatePersonalTaskStageDto,
  CreateProjectStageDto,
  CreateTaskStageDto,
  UpdatePersonalTaskStageDto,
  UpdateProjectStageDto,
  UpdateTaskStageDto,
} from '../dto';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

@Injectable()
export class ProjectStagesService {
  constructor(
    @InjectRepository(AgencyProjectStage, 'agency')
    private readonly projectStagesRepository: Repository<AgencyProjectStage>,

    @InjectRepository(AgencyTaskStage, 'agency')
    private readonly taskStagesRepository: Repository<AgencyTaskStage>,

    @InjectRepository(AgencyPersonalTaskStage, 'agency')
    private readonly personalTaskStagesRepository: Repository<AgencyPersonalTaskStage>,

    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepository: Repository<AgencyProject>,

    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepository: Repository<AgencyTask>,
  ) {}

  listProjectStages(context: RequestContext) {
    return this.projectStagesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        isArchived: false,
      },
      order: {
        position: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  createProjectStage(context: RequestContext, dto: CreateProjectStageDto) {
    const stage = this.projectStagesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      name: dto.name,
      color: dto.color ?? null,
      position: dto.position ?? 0,
      isDefault: dto.isDefault ?? false,
      isArchived: false,
    });

    return this.projectStagesRepository.save(stage);
  }

  async updateProjectStage(context: RequestContext, id: string, dto: UpdateProjectStageDto) {
    const stage = await this.projectStagesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!stage) {
      throw new NotFoundException('Project stage not found');
    }

    if (dto.name !== undefined) stage.name = dto.name;
    if (dto.color !== undefined) stage.color = dto.color;
    if (dto.position !== undefined) stage.position = dto.position;
    if (dto.isDefault !== undefined) stage.isDefault = dto.isDefault;
    if (dto.isArchived !== undefined) stage.isArchived = dto.isArchived;

    return this.projectStagesRepository.save(stage);
  }

  async archiveProjectStage(context: RequestContext, id: string) {
    const stage = await this.projectStagesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!stage) {
      throw new NotFoundException('Project stage not found');
    }

    await this.projectsRepository.update(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        stageId: stage.id,
      },
      { stageId: null },
    );
    await this.projectStagesRepository.delete(stage.id);

    return { deleted: true };
  }

  listTaskStages(context: RequestContext, projectId?: string | null) {
    return this.taskStagesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        isArchived: false,
        projectId: projectId !== undefined ? (projectId ?? IsNull()) : IsNull(),
      },
      order: {
        position: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  createTaskStage(context: RequestContext, dto: CreateTaskStageDto) {
    const stage = this.taskStagesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId: (dto as { projectId?: string | null }).projectId ?? null,
      name: dto.name,
      color: dto.color ?? null,
      position: dto.position ?? 0,
      isDefault: dto.isDefault ?? false,
      isArchived: false,
    });

    return this.taskStagesRepository.save(stage);
  }

  async updateTaskStage(context: RequestContext, id: string, dto: UpdateTaskStageDto) {
    const stage = await this.taskStagesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!stage) {
      throw new NotFoundException('Task stage not found');
    }

    if (dto.name !== undefined) stage.name = dto.name;
    if (dto.color !== undefined) stage.color = dto.color;
    if (dto.position !== undefined) stage.position = dto.position;
    if (dto.isDefault !== undefined) stage.isDefault = dto.isDefault;
    if (dto.isArchived !== undefined) stage.isArchived = dto.isArchived;

    return this.taskStagesRepository.save(stage);
  }

  async archiveTaskStage(context: RequestContext, id: string) {
    const stage = await this.taskStagesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!stage) {
      throw new NotFoundException('Task stage not found');
    }

    await this.tasksRepository.update(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        stageId: stage.id,
      },
      { stageId: null },
    );
    await this.taskStagesRepository.delete(stage.id);

    return { deleted: true };
  }

  listPersonalTaskStages(context: RequestContext) {
    return this.personalTaskStagesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
      order: {
        position: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  createPersonalTaskStage(context: RequestContext, dto: CreatePersonalTaskStageDto) {
    const stage = this.personalTaskStagesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      name: dto.name,
      color: dto.color ?? null,
      position: dto.position ?? 0,
      isDefault: dto.isDefault ?? false,
    });

    return this.personalTaskStagesRepository.save(stage);
  }

  async updatePersonalTaskStage(
    context: RequestContext,
    id: string,
    dto: UpdatePersonalTaskStageDto,
  ) {
    const stage = await this.personalTaskStagesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });

    if (!stage) {
      throw new NotFoundException('Personal task stage not found');
    }

    if (dto.name !== undefined) stage.name = dto.name;
    if (dto.color !== undefined) stage.color = dto.color;
    if (dto.position !== undefined) stage.position = dto.position;
    if (dto.isDefault !== undefined) stage.isDefault = dto.isDefault;

    return this.personalTaskStagesRepository.save(stage);
  }

  async deletePersonalTaskStage(context: RequestContext, id: string) {
    const stage = await this.personalTaskStagesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });

    if (!stage) {
      throw new NotFoundException('Personal task stage not found');
    }

    await this.personalTaskStagesRepository.delete(stage.id);

    return { deleted: true };
  }
}
