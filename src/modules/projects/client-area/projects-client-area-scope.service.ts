import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClientAreaBridgeRegistry } from '../../../common/client-area-bridge/client-area-bridge.registry';
import { isUuid } from '../../client-area/client-area.types';
import type { ClientAreaContext } from '../../client-area/client-area.types';
import type { PermissionScopeRequest } from '../../permissions/types/permission-context.types';

export type ProjectClientKind =
  | 'project'
  | 'project-board'
  | 'task'
  | 'task-board'
  | 'checklist'
  | 'comment'
  | 'event'
  | 'attachment'
  | 'follower';
const base = '/agency/projects';
export const projectClientRoutePath = (path: string) =>
  path.startsWith('/api/') ? path.slice(4) : path;
/** Exact route templates: unknown resources and configuration never resolve. */
export const PROJECT_CLIENT_ROUTES: Record<string, ProjectClientKind> = {
  [base]: 'project',
  [`${base}/:id`]: 'project',
  [`${base}/board`]: 'project-board',
  [`${base}/tasks`]: 'task',
  [`${base}/tasks/my`]: 'task',
  [`${base}/tasks/my-assigned-subtasks`]: 'task',
  [`${base}/tasks/:id`]: 'task',
  [`${base}/tasks/:id/permanent`]: 'task',
  [`${base}/tasks/:id/cover`]: 'task',
  [`${base}/tasks/board`]: 'task-board',
  [`${base}/tasks/my/board`]: 'task-board',
  [`${base}/:projectId/tasks/board`]: 'task-board',
  [`${base}/tasks/:taskId/checklist`]: 'checklist',
  [`${base}/tasks/:taskId/checklist/:itemId`]: 'checklist',
  [`${base}/tasks/:taskId/comments`]: 'comment',
  [`${base}/:projectId/events`]: 'event',
  [`${base}/tasks/:id/attachments`]: 'attachment',
  [`${base}/:projectId/attachments`]: 'attachment',
  [`${base}/:projectId/followers`]: 'follower',
};
const allowedFields: Record<ProjectClientKind, readonly string[]> = {
  project: [
    'name',
    'description',
    'clientId',
    'stageId',
    'ownerId',
    'status',
    'priority',
    'startDate',
    'dueDate',
    'progress',
    'markerIds',
    'color',
  ],
  task: [
    'title',
    'description',
    'projectId',
    'clientId',
    'stageId',
    'projectStageId',
    'personalStageId',
    'assigneeId',
    'status',
    'priority',
    'taskTypeId',
    'visibility',
    'startDate',
    'dueDate',
    'isBlocked',
    'color',
    'markerIds',
  ],
  checklist: [
    'title',
    'description',
    'isDone',
    'status',
    'position',
    'taskTypeId',
    'assigneeId',
    'personalStageId',
    'dueDate',
  ],
  comment: ['body'],
  event: ['kind', 'body', 'dueAt'],
  attachment: [],
  follower: [],
  'project-board': [],
  'task-board': [],
};
type Row = { id: string; createdById?: string; projectId?: string | null };

@Injectable()
export class ProjectsClientAreaScopeService implements OnModuleInit {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly registry: ClientAreaBridgeRegistry,
  ) {}
  onModuleInit() {
    this.registry.registerScopeResolver(
      'agency_projects',
      (context, key, request) => this.resolve(context, key, request),
    );
  }

  async resolve(
    context: ClientAreaContext,
    _key: string,
    request: PermissionScopeRequest,
  ) {
    const path = projectClientRoutePath(request.routePath ?? ''),
      kind = PROJECT_CLIENT_ROUTES[path];
    if (!kind) return null;
    if (
      request.body &&
      (typeof request.body !== 'object' || Array.isArray(request.body))
    )
      return null;
    const params = request.params ?? {},
      body = request.body ?? {},
      query = request.query ?? {};
    for (const data of [params, body, query]) {
      for (const key of [
        'id',
        'taskId',
        'projectId',
        'itemId',
        'stageId',
        'projectStageId',
        'personalStageId',
        'assigneeId',
        'ownerId',
      ])
        if (data[key] !== undefined && data[key] !== null && !isUuid(data[key]))
          return null;
    }
    const creating =
      request.method === 'POST' &&
      [base, `${base}/tasks`, `${base}/tasks/my`].includes(path);
    if (
      !['GET', 'HEAD', 'DELETE'].includes(request.method ?? '') &&
      !['attachment', 'follower'].includes(kind) &&
      !path.endsWith('/cover') &&
      (!request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body))
    )
      return null;
    if (creating) body.clientId = context.agencyClientId;
    if (
      !['GET', 'HEAD', 'DELETE'].includes(request.method ?? '') &&
      Object.keys(body).some((key) => !allowedFields[kind].includes(key))
    )
      return null;
    if (kind === 'event' && body.kind !== undefined && body.kind !== 'activity')
      return null;
    const scope = [
      context.tenantId,
      context.workspaceId,
      context.agencyClientId,
    ];
    const project = async (id: unknown) =>
      typeof id === 'string' &&
      (
        await this.db.query<Row[]>(
          `SELECT id, owner_id AS "createdById" FROM agency_projects WHERE tenant_id=$1 AND workspace_id=$2 AND client_id=$3 AND id=$4`,
          [...scope, id],
        )
      )[0];
    const task = async (id: unknown) =>
      typeof id === 'string' &&
      (
        await this.db.query<Row[]>(
          `SELECT id, created_by_id AS "createdById", project_id AS "projectId" FROM agency_tasks WHERE tenant_id=$1 AND workspace_id=$2 AND client_id=$3 AND id=$4 AND (visibility='workspace' OR created_by_id=$5)`,
          [...scope, id, context.userId],
        )
      )[0];
    let creator = context.userId,
      projectId: unknown =
        params.projectId ?? body.projectId ?? query.projectId;
    const taskId =
      params.taskId ?? (path.includes('/tasks/:id') ? params.id : null);
    if (taskId) {
      const row = await task(taskId);
      if (!row) return null;
      creator = row.createdById!;
      projectId ??= row.projectId;
      if (
        context.memberAccess?.agency_projects.level === 'operator' &&
        body.status === 'archived' &&
        creator !== context.userId
      )
        return null;
    }
    if (kind === 'project' && params.id) projectId = params.id;
    if (projectId && !(await project(projectId))) return null;
    if (kind === 'project' && params.id)
      creator = ((await project(params.id)) as Row).createdById!;
    for (const data of [body, query]) {
      if (data.projectId && !(await project(data.projectId))) return null;
      if (data.parentTaskId && !(await task(data.parentTaskId))) return null;
    }
    if (params.itemId) {
      const rows = await this.db.query<Row[]>(
        `SELECT id FROM agency_task_checklist_items WHERE tenant_id=$1 AND workspace_id=$2 AND task_id=$3 AND id=$4`,
        [context.tenantId, context.workspaceId, taskId, params.itemId],
      );
      if (!rows.length) return null;
    }
    for (const field of [
      'stageId',
      'projectStageId',
      'personalStageId',
    ] as const) {
      if (!body[field]) continue;
      const isProject = kind === 'project',
        personal = field === 'personalStageId';
      const table = personal
        ? 'agency_personal_task_stages'
        : isProject
          ? 'agency_project_stages'
          : 'agency_task_stages';
      const rows = await this.db.query<Row[]>(
        `SELECT id FROM ${table} WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3${personal ? ' AND user_id=$4' : isProject ? '' : ' AND (project_id IS NULL OR project_id=$4)'}`,
        [
          context.tenantId,
          context.workspaceId,
          body[field],
          ...(!isProject
            ? [personal ? context.userId : (projectId ?? null)]
            : []),
        ],
      );
      if (!rows.length) return null;
    }
    for (const field of ['assigneeId', 'ownerId']) {
      if (!body[field] || body[field] === context.userId) continue;
      const rows = await this.db.query<Row[]>(
        `SELECT id FROM team_members WHERE tenant_id=$1 AND workspace_id=$2 AND (id=$3 OR user_id=$3)`,
        [context.tenantId, context.workspaceId, body[field]],
      );
      if (!rows.length) return null;
    }
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      agencyClientId: context.agencyClientId,
      companyContextId: context.companyContextId,
      createdById: creator,
    };
  }
}
