import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgencyPersonalTaskStage,
  AgencyProjectStage,
  AgencyTaskStage,
} from '../entities';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

@Injectable()
export class ProjectSeedsService {
  constructor(
    @InjectRepository(AgencyProjectStage, 'agency')
    private readonly projectStagesRepository: Repository<AgencyProjectStage>,

    @InjectRepository(AgencyTaskStage, 'agency')
    private readonly taskStagesRepository: Repository<AgencyTaskStage>,

    @InjectRepository(AgencyPersonalTaskStage, 'agency')
    private readonly personalTaskStagesRepository: Repository<AgencyPersonalTaskStage>,
  ) {}

  async seedDefaults(context: RequestContext) {
    const projectStages = await this.ensureProjectStages(context);
    const taskStages = await this.ensureTaskStages(context);
    const personalTaskStages = await this.ensurePersonalTaskStages(context);

    return {
      seeded: true,
      projectStages,
      taskStages,
      personalTaskStages,
    };
  }

  private async ensureProjectStages(context: RequestContext) {
    const defaults = [
      { name: 'Novo', color: '#2563EB', position: 1, isDefault: true },
      { name: 'Em desenvolvimento', color: '#0EA5E9', position: 2, isDefault: false },
      { name: 'Para aprovação', color: '#F59E0B', position: 3, isDefault: false },
      { name: 'Concluído', color: '#16A34A', position: 4, isDefault: false },
    ];

    const created: AgencyProjectStage[] = [];

    for (const item of defaults) {
      const existing = await this.projectStagesRepository.findOne({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          name: item.name,
        },
      });

      if (existing) {
        created.push(existing);
        continue;
      }

      const stage = this.projectStagesRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name: item.name,
        color: item.color,
        position: item.position,
        isDefault: item.isDefault,
        isArchived: false,
      });

      created.push(await this.projectStagesRepository.save(stage));
    }

    return created;
  }

  private async ensureTaskStages(context: RequestContext) {
    const defaults = [
      { name: 'A fazer', color: '#64748B', position: 1, isDefault: true },
      { name: 'Em andamento', color: '#2563EB', position: 2, isDefault: false },
      { name: 'Aguardando', color: '#F59E0B', position: 3, isDefault: false },
      { name: 'Revisar', color: '#7C3AED', position: 4, isDefault: false },
      { name: 'Concluído', color: '#16A34A', position: 5, isDefault: false },
    ];

    const created: AgencyTaskStage[] = [];

    for (const item of defaults) {
      const existing = await this.taskStagesRepository.findOne({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          name: item.name,
        },
      });

      if (existing) {
        created.push(existing);
        continue;
      }

      const stage = this.taskStagesRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name: item.name,
        color: item.color,
        position: item.position,
        isDefault: item.isDefault,
        isArchived: false,
      });

      created.push(await this.taskStagesRepository.save(stage));
    }

    return created;
  }

  private async ensurePersonalTaskStages(context: RequestContext) {
    const defaults = [
      { name: 'Hoje', color: '#2563EB', position: 1, isDefault: true },
      { name: 'Esta semana', color: '#0EA5E9', position: 2, isDefault: false },
      { name: 'Aguardando', color: '#F59E0B', position: 3, isDefault: false },
      { name: 'Concluído', color: '#16A34A', position: 4, isDefault: false },
    ];

    const created: AgencyPersonalTaskStage[] = [];

    for (const item of defaults) {
      const existing = await this.personalTaskStagesRepository.findOne({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          name: item.name,
        },
      });

      if (existing) {
        created.push(existing);
        continue;
      }

      const stage = this.personalTaskStagesRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        name: item.name,
        color: item.color,
        position: item.position,
        isDefault: item.isDefault,
      });

      created.push(await this.personalTaskStagesRepository.save(stage));
    }

    return created;
  }
}
