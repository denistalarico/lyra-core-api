import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { AgencyProject } from '../projects/entities/agency-project.entity';
import { AgencyTaskChecklistItem } from '../projects/entities/agency-task-checklist-item.entity';
import { AgencyTask } from '../projects/entities/agency-task.entity';
import { TaskStatus } from '../projects/enums/task-status.enum';
import { TaskVisibility } from '../projects/enums/task-visibility.enum';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
} from '../social-creative-studio/entities';
import { approvalScopeWhere } from './approval-scope';

const OPTION_LIMIT = 200;

export type ApprovalWorkSelection = {
  workProjectId?: string;
  workTaskId?: string;
  workSubtaskId?: string;
};

export type ApprovalWorkLink = {
  projectId: string | null;
  taskId: string | null;
  subtaskId: string | null;
};

/**
 * What a new standalone piece may point at: the work of the scope's client and
 * the creatives of its library. One predicate per list on purpose, so the
 * picker can never offer what the send then refuses.
 */
@Injectable()
export class SocialApprovalPieceSourcesService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /** `NULL` client means the agency's own projects. */
  private projectsInScope(scope: CompanyAwareScope) {
    const qb = this.dataSource
      .getRepository(AgencyProject)
      .createQueryBuilder('project')
      .where(
        'project.tenantId = :tenantId AND project.workspaceId = :workspaceId',
        { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      )
      .andWhere('project.archivedAt IS NULL');
    return scope.agencyClientId === null
      ? qb.andWhere('project.clientId IS NULL')
      : qb.andWhere('project.clientId = :clientId', {
          clientId: scope.agencyClientId,
        });
  }

  private tasksInScope(scope: CompanyAwareScope, actorUserId: string) {
    const qb = this.dataSource
      .getRepository(AgencyTask)
      .createQueryBuilder('task')
      .leftJoin(
        AgencyProject,
        'project',
        'project.id = task.projectId AND project.tenantId = task.tenantId AND project.workspaceId = task.workspaceId',
      )
      .where('task.tenantId = :tenantId AND task.workspaceId = :workspaceId', {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      })
      .andWhere('task.archivedAt IS NULL')
      .andWhere('task.status <> :archivedStatus', {
        archivedStatus: TaskStatus.Archived,
      })
      .andWhere(
        '(task.visibility <> :private OR task.createdById = :actorId)',
        { private: TaskVisibility.Private, actorId: actorUserId },
      );
    return scope.agencyClientId === null
      ? qb.andWhere('COALESCE(task.clientId, project.clientId) IS NULL')
      : qb.andWhere('COALESCE(task.clientId, project.clientId) = :clientId', {
          clientId: scope.agencyClientId,
        });
  }

  async projects(scope: CompanyAwareScope) {
    const rows = await this.projectsInScope(scope)
      .orderBy('project.name', 'ASC')
      .take(OPTION_LIMIT)
      .getMany();
    return { items: rows.map(({ id, name }) => ({ id, name })) };
  }

  async tasks(
    scope: CompanyAwareScope,
    actorUserId: string,
    projectId?: string,
  ) {
    const qb = this.tasksInScope(scope, actorUserId);
    if (projectId) qb.andWhere('task.projectId = :projectId', { projectId });
    const rows = await qb
      .orderBy('task.updatedAt', 'DESC')
      .addOrderBy('task.id', 'DESC')
      .limit(OPTION_LIMIT)
      .getMany();
    return {
      items: rows.map(({ id, title, projectId: project }) => ({
        id,
        title,
        projectId: project,
      })),
    };
  }

  private async taskInScope(
    scope: CompanyAwareScope,
    actorUserId: string,
    taskId: string,
  ) {
    const task = await this.tasksInScope(scope, actorUserId)
      .andWhere('task.id = :taskId', { taskId })
      .getOne();
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    return task;
  }

  async subtasks(
    scope: CompanyAwareScope,
    actorUserId: string,
    taskId: string,
  ) {
    const task = await this.taskInScope(scope, actorUserId, taskId);
    const rows = await this.dataSource
      .getRepository(AgencyTaskChecklistItem)
      .find({
        where: {
          taskId: task.id,
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
        },
        order: { position: 'ASC' },
        take: OPTION_LIMIT,
      });
    return { items: rows.map(({ id, title }) => ({ id, title })) };
  }

  /** Anything outside the scope answers as if it did not exist. */
  async resolveWork(
    scope: CompanyAwareScope,
    actorUserId: string,
    selection: ApprovalWorkSelection,
  ): Promise<ApprovalWorkLink | null> {
    const { workProjectId, workTaskId, workSubtaskId } = selection;
    if (!workProjectId && !workTaskId && !workSubtaskId) return null;
    if (workSubtaskId && !workTaskId)
      throw new BadRequestException('Informe a tarefa da subtarefa.');
    if (workProjectId) {
      const project = await this.projectsInScope(scope)
        .andWhere('project.id = :projectId', { projectId: workProjectId })
        .getOne();
      if (!project) throw new NotFoundException('Projeto não encontrado.');
    }
    if (!workTaskId)
      return {
        projectId: workProjectId ?? null,
        taskId: null,
        subtaskId: null,
      };
    const task = await this.taskInScope(scope, actorUserId, workTaskId);
    if (workProjectId && task.projectId !== workProjectId)
      throw new NotFoundException('Tarefa não encontrada.');
    if (workSubtaskId) {
      const subtask = await this.dataSource
        .getRepository(AgencyTaskChecklistItem)
        .findOne({
          where: {
            id: workSubtaskId,
            taskId: task.id,
            tenantId: task.tenantId,
            workspaceId: task.workspaceId,
          },
        });
      if (!subtask) throw new NotFoundException('Subtarefa não encontrada.');
    }
    return {
      projectId: task.projectId ?? null,
      taskId: task.id,
      subtaskId: workSubtaskId ?? null,
    };
  }

  /** The current version of each creative, in the order they were chosen. */
  async creativeMediaIds(
    scope: CompanyAwareScope,
    assetIds: readonly string[],
  ): Promise<string[]> {
    const ids = [...new Set(assetIds)];
    const assets = await this.dataSource
      .getRepository(CreativeAssetEntity)
      .find({
        where: {
          ...approvalScopeWhere(scope),
          id: In(ids),
          status: 'ready',
          trashedAt: IsNull(),
        },
      });
    const versionIds = assets
      .map((asset) => asset.currentVersionId)
      .filter((id): id is string => Boolean(id));
    const versions = versionIds.length
      ? await this.dataSource
          .getRepository(CreativeAssetVersionEntity)
          .find({ where: { id: In(versionIds) } })
      : [];
    const mediaByVersion = new Map(
      versions.map((version) => [version.id, version.mediaAssetId]),
    );
    const versionByAsset = new Map(
      assets.map((asset) => [asset.id, asset.currentVersionId]),
    );
    return ids.map((id) => {
      const media = mediaByVersion.get(versionByAsset.get(id) ?? '');
      if (!media)
        throw new NotFoundException(
          'Criativo não encontrado no contexto atual.',
        );
      return media;
    });
  }
}
