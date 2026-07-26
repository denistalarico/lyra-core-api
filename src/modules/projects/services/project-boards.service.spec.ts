import { AgencyPersonalTaskStage, AgencyTask } from '../entities';
import { TaskPriority, TaskStatus, TaskVisibility } from '../enums';
import { ProjectBoardsService } from './project-boards.service';

describe('ProjectBoardsService personal tasks board', () => {
  const buildPersonalTasksBoard = (
    stages: AgencyPersonalTaskStage[],
    tasks: AgencyTask[],
  ) => {
    const service = new ProjectBoardsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return (
      service as unknown as {
        buildPersonalTasksBoard: (
          stageRows: AgencyPersonalTaskStage[],
          taskRows: AgencyTask[],
        ) => {
          columns: Array<{ id: string; cards: AgencyTask[] }>;
          unassigned: { cards: AgencyTask[] };
        };
      }
    ).buildPersonalTasksBoard(stages, tasks);
  };

  it('places tasks without a personal stage in the default column', () => {
    const stages = [
      makePersonalStage({
        id: 'stage-later',
        position: 1,
        isDefault: false,
      }),
      makePersonalStage({
        id: 'stage-default',
        position: 2,
        isDefault: true,
      }),
    ];
    const task = makeTask({ personalStageId: null });

    const board = buildPersonalTasksBoard(stages, [task]);

    expect(
      board.columns.find((column) => column.id === 'stage-default')?.cards,
    ).toEqual([task]);
    expect(board.unassigned.cards).toEqual([]);
  });

  it('places tasks with a stale personal stage in the first column when there is no default', () => {
    const stages = [
      makePersonalStage({
        id: 'stage-first',
        position: 1,
        isDefault: false,
      }),
      makePersonalStage({
        id: 'stage-second',
        position: 2,
        isDefault: false,
      }),
    ];
    const task = makeTask({ personalStageId: 'stage-from-previous-assignee' });

    const board = buildPersonalTasksBoard(stages, [task]);

    expect(board.columns[0].cards).toEqual([task]);
    expect(board.unassigned.cards).toEqual([]);
  });

  it('keeps tasks unassigned only when the user has no configured stages', () => {
    const task = makeTask({ personalStageId: null });

    const board = buildPersonalTasksBoard([], [task]);

    expect(board.columns).toEqual([]);
    expect(board.unassigned.cards).toEqual([task]);
  });
});

function makePersonalStage(
  overrides: Partial<AgencyPersonalTaskStage> = {},
): AgencyPersonalTaskStage {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'stage-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    name: 'Hoje',
    color: '#2563EB',
    position: 1,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgencyTask> = {}): AgencyTask {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'task-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    projectId: null,
    clientId: null,
    stageId: null,
    projectStageId: null,
    personalStageId: null,
    assigneeId: 'member-1',
    createdById: 'user-1',
    title: 'Tarefa',
    description: null,
    status: TaskStatus.InProgress,
    priority: TaskPriority.Medium,
    taskTypeId: null,
    visibility: TaskVisibility.Workspace,
    startDate: null,
    dueDate: null,
    completedAt: null,
    estimatedMinutes: null,
    trackedMinutes: 0,
    isBlocked: false,
    blockedReason: null,
    color: null,
    coverImageUrl: null,
    coverImageAssetKey: null,
    markerIds: [],
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
