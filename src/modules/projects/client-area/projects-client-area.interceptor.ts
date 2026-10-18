import { getAuthorizedContext } from '../../../common/context/authorized-context.decorator';
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { mergeMap } from 'rxjs';
import { ClientAreaBridgeRegistry } from '../../../common/client-area-bridge/client-area-bridge.registry';
import type { ClientAreaRequest } from '../../client-area/client-area.types';
import {
  PROJECT_CLIENT_ROUTES,
  projectClientRoutePath,
  type ProjectClientKind,
} from './projects-client-area-scope.service';

const fields: Record<ProjectClientKind, readonly string[]> = {
  project: [
    'id',
    'name',
    'description',
    'stageId',
    'ownerId',
    'status',
    'priority',
    'startDate',
    'dueDate',
    'completedAt',
    'progress',
    'markerIds',
    'color',
    'archivedAt',
    'createdAt',
    'updatedAt',
    'taskCount',
  ],
  task: [
    'id',
    'projectId',
    'projectName',
    'isSubtask',
    'parentTaskId',
    'parentTaskTitle',
    'stageId',
    'projectStageId',
    'personalStageId',
    'assigneeId',
    'createdById',
    'title',
    'description',
    'status',
    'priority',
    'taskTypeId',
    'visibility',
    'startDate',
    'dueDate',
    'completedAt',
    'isBlocked',
    'color',
    'markerIds',
    'coverImageUrl',
    'archivedAt',
    'createdAt',
    'updatedAt',
    'checklistTotal',
    'checklistDone',
    'progress',
  ],
  checklist: [
    'id',
    'taskId',
    'title',
    'description',
    'isDone',
    'status',
    'position',
    'taskTypeId',
    'assigneeId',
    'personalStageId',
    'dueDate',
    'createdAt',
    'updatedAt',
  ],
  comment: ['id', 'taskId', 'authorId', 'body', 'createdAt', 'updatedAt'],
  event: [
    'id',
    'projectId',
    'authorId',
    'kind',
    'body',
    'dueAt',
    'createdAt',
    'updatedAt',
  ],
  attachment: [
    'id',
    'taskId',
    'projectId',
    'fileName',
    'fileSize',
    'mimeType',
    'assetUrl',
    'uploadedById',
    'createdAt',
  ],
  follower: ['id', 'userId', 'userName', 'createdAt'],
  'project-board': [],
  'task-board': [],
};
const pick = (row: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in row).map((key) => [key, row[key]]),
  );
export function projectClientResponse(
  value: unknown,
  kind: ProjectClientKind,
): unknown {
  if (Array.isArray(value))
    return value
      .filter(
        (row) =>
          kind !== 'event' || (row as { kind?: string }).kind === 'activity',
      )
      .map((row) => projectClientResponse(row, kind));
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if ('deleted' in row) return { deleted: row.deleted === true };
  if (kind === 'project-board' || kind === 'task-board') {
    const cardKind = kind === 'project-board' ? 'project' : 'task';
    const column = (entry: Record<string, unknown>) => ({
      ...pick(entry, ['id', 'name', 'color', 'position']),
      cards: projectClientResponse(entry.cards, cardKind),
    });
    return {
      columns: Array.isArray(row.columns) ? row.columns.map(column) : [],
      unassigned: row.unassigned
        ? column(row.unassigned as Record<string, unknown>)
        : null,
    };
  }
  return pick(row, fields[kind]);
}
@Injectable()
export class ProjectsClientAreaInterceptor implements NestInterceptor {
  constructor(private readonly registry: ClientAreaBridgeRegistry) {}
  intercept(execution: ExecutionContext, next: CallHandler) {
    const request = execution.switchToHttp().getRequest<ClientAreaRequest>();
    const route = request.route as { path: string };
    const kind = PROJECT_CLIENT_ROUTES[projectClientRoutePath(route.path)];
    if (!request.clientAreaContext && kind !== 'comment' && kind !== 'event')
      return next.handle();
    const tenantId =
      request.clientAreaContext?.tenantId ??
      getAuthorizedContext(request).tenantId;
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        const projected = request.clientAreaContext
          ? projectClientResponse(value, kind)
          : value;
        if (kind !== 'comment' && kind !== 'event') return projected;
        const rows = (
          Array.isArray(projected) ? projected : [projected]
        ) as Record<string, unknown>[];
        const names = await this.registry.resolveActorNames(
          tenantId,
          rows.flatMap((row) =>
            typeof row?.authorId === 'string' ? [row.authorId] : [],
          ),
        );
        const named = rows.map((row) => ({
          ...row,
          authorName: names[String(row.authorId)] ?? 'Usuário',
        }));
        return Array.isArray(projected) ? named : named[0];
      }),
    );
  }
}
