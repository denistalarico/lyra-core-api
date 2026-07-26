import { Repository } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import { NotificationEventProcessorService } from '../../notifications/services';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectEvent,
  AgencyTask,
  AgencyTaskAttachment,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskStage,
  AgencyTaskTimeEntry,
} from '../entities';
import { TaskPriority, TaskStatus, TaskVisibility } from '../enums';
import { TaskNotificationPublisher } from './task-notification.publisher';
import { TasksCrudService } from './tasks-crud.service';

describe('TasksCrudService notification triggers', () => {
  it('scopes workspace task lists to assigned, created, or permitted project tasks for members', async () => {
    const { service, queryBuilder } = makeService();

    await service.listWorkspaceTasks({ ...makeContext(), role: 'member' }, {});

    expect(queryBuilder.scopeClauses.join('\n')).toContain(
      'task.assignee_id = :scopeUserId',
    );
    expect(queryBuilder.scopeClauses.join('\n')).toContain(
      'task.created_by_id = :scopeUserId',
    );
    expect(queryBuilder.scopeClauses.join('\n')).toContain(
      'agency_project_followers',
    );
  });

  it('publishes assigned once when creating with an assignee different from the actor', async () => {
    const { service, publisher } = makeService();

    await service.createWorkspaceTask(makeContext(), {
      title: 'Preparar proposta',
      priority: TaskPriority.Medium,
      assigneeId: 'user-assignee',
    });

    expect(publisher.publishAssigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-actor',
        task: expect.objectContaining({ assigneeId: 'user-assignee' }),
      }),
    );
  });

  it('places a newly assigned workspace task in the assignee default personal stage', async () => {
    const { service, tasksRepository, personalTaskStagesRepository } =
      makeService({
        assigneeUserId: 'user-assignee',
        personalStage: makePersonalStage({
          id: 'personal-stage-default',
          userId: 'user-assignee',
        }),
      });

    await service.createWorkspaceTask(makeContext(), {
      title: 'Preparar proposta',
      priority: TaskPriority.Medium,
      assigneeId: 'member-assignee',
    });

    expect(personalTaskStagesRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-assignee' }),
        order: {
          isDefault: 'DESC',
          position: 'ASC',
          createdAt: 'ASC',
        },
      }),
    );
    expect(tasksRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'member-assignee',
        personalStageId: 'personal-stage-default',
      }),
    );
  });

  it('does not publish assigned when creating without an assignee', async () => {
    const { service, publisher } = makeService();

    await service.createWorkspaceTask(makeContext(), {
      title: 'Preparar proposta',
      priority: TaskPriority.Medium,
    });

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
    expect(publisher.publishReassigned).not.toHaveBeenCalled();
  });

  it('preserves the cover image when creating a workspace task copy', async () => {
    const { service, tasksRepository } = makeService();

    const created = await service.createWorkspaceTask(makeContext(), {
      title: 'Cópia de Preparar proposta',
      priority: TaskPriority.Medium,
      coverImageUrl: '/uploads/tasks/source-cover.webp',
    });

    expect(tasksRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        coverImageUrl: '/uploads/tasks/source-cover.webp',
      }),
    );
    expect(created.coverImageUrl).toBe('/uploads/tasks/source-cover.webp');
  });

  it('preserves the cover image when creating a private task copy', async () => {
    const { service, tasksRepository } = makeService();

    const created = await service.createMyTask(makeContext(), {
      title: 'Cópia de Tarefa pessoal',
      priority: TaskPriority.Medium,
      coverImageUrl: '/uploads/tasks/private-cover.webp',
    });

    expect(tasksRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        coverImageUrl: '/uploads/tasks/private-cover.webp',
      }),
    );
    expect(created.coverImageUrl).toBe('/uploads/tasks/private-cover.webp');
  });

  it('uses the current user default stage when creating a private task without a stage', async () => {
    const { service, tasksRepository } = makeService({
      personalStage: makePersonalStage({
        id: 'personal-stage-default',
        userId: 'user-actor',
      }),
    });

    await service.createMyTask(makeContext(), {
      title: 'Tarefa pessoal',
      priority: TaskPriority.Medium,
    });

    expect(tasksRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'user-actor',
        personalStageId: 'personal-stage-default',
      }),
    );
  });

  it('publishes assigned when assignee changes from null to user', async () => {
    const task = makeTask({ assigneeId: null });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      assigneeId: 'user-assignee',
    });

    expect(publisher.publishAssigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ assigneeId: 'user-assignee' }),
      }),
    );
    expect(publisher.publishReassigned).not.toHaveBeenCalled();
  });

  it('publishes reassigned when assignee changes from one user to another', async () => {
    const task = makeTask({ assigneeId: 'user-old' });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      assigneeId: 'user-new',
    });

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
    expect(publisher.publishReassigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishReassigned).toHaveBeenCalledWith(
      expect.objectContaining({
        previousAssigneeId: 'user-old',
        task: expect.objectContaining({ assigneeId: 'user-new' }),
      }),
    );
  });

  it('moves a reassigned task to the new assignee default personal stage', async () => {
    const task = makeTask({
      assigneeId: 'member-old',
      personalStageId: 'personal-stage-old',
    });
    const { service } = makeService({
      task,
      assigneeUserId: 'user-new',
      personalStage: makePersonalStage({
        id: 'personal-stage-new',
        userId: 'user-new',
      }),
    });

    await service.update(makeContext(), task.id, {
      assigneeId: 'member-new',
    });

    expect(task.assigneeId).toBe('member-new');
    expect(task.personalStageId).toBe('personal-stage-new');
  });

  it('does not publish assignment notifications when assignee changes to null', async () => {
    const task = makeTask({
      assigneeId: 'user-old',
      personalStageId: 'personal-stage-old',
    });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      assigneeId: null,
    });

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
    expect(publisher.publishReassigned).not.toHaveBeenCalled();
    expect(task.personalStageId).toBeNull();
  });

  it('does not publish assignment notifications when assignee did not change', async () => {
    const task = makeTask({ assigneeId: 'user-assignee' });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      title: 'Preparar proposta revisada',
    });

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
    expect(publisher.publishReassigned).not.toHaveBeenCalled();
  });

  it('publishes completed when transitioning to done', async () => {
    const task = makeTask({ status: TaskStatus.InProgress });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      status: TaskStatus.Done,
    });

    expect(publisher.publishCompleted).toHaveBeenCalledTimes(1);
    expect(publisher.publishCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ status: TaskStatus.Done }),
      }),
    );
  });

  it('does not republish completed when an already done task is saved again', async () => {
    const task = makeTask({
      status: TaskStatus.Done,
      completedAt: new Date('2026-06-12T11:00:00.000Z'),
    });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      title: 'Preparar proposta final',
    });

    expect(publisher.publishCompleted).not.toHaveBeenCalled();
  });

  it('publishes reopened when transitioning from done to an open status', async () => {
    const task = makeTask({
      status: TaskStatus.Done,
      completedAt: new Date('2026-06-12T11:00:00.000Z'),
      assigneeId: 'user-assignee',
    });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      status: TaskStatus.InProgress,
    });

    expect(publisher.publishReopened).toHaveBeenCalledTimes(1);
    expect(publisher.publishReopened).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ status: TaskStatus.InProgress }),
      }),
    );
  });

  it('publishes blocked when moving from unblocked to blocked', async () => {
    const task = makeTask({ isBlocked: false });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      isBlocked: true,
    });

    expect(publisher.publishBlocked).toHaveBeenCalledTimes(1);
    expect(publisher.publishBlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        projectOwnerId: 'user-project-owner',
        task: expect.objectContaining({ isBlocked: true }),
      }),
    );
  });

  it('publishes unblocked when moving from blocked to unblocked', async () => {
    const task = makeTask({ isBlocked: true });
    const { service, publisher } = makeService({ task });

    await service.update(makeContext(), task.id, {
      isBlocked: false,
    });

    expect(publisher.publishUnblocked).toHaveBeenCalledTimes(1);
    expect(publisher.publishUnblocked).toHaveBeenCalledWith(
      expect.objectContaining({
        projectOwnerId: 'user-project-owner',
        task: expect.objectContaining({ isBlocked: false }),
      }),
    );
  });

  it('keeps the create operation successful when the real publisher catches processor failures', async () => {
    const processor = {
      process: jest.fn().mockRejectedValue(new Error('processor failed')),
    } as unknown as jest.Mocked<NotificationEventProcessorService>;
    const realPublisher = new TaskNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn((realPublisher as any).logger, 'error')
      .mockImplementation(() => undefined);
    const { service, tasksRepository } = makeService({
      publisher: realPublisher as jest.Mocked<TaskNotificationPublisher>,
    });

    const result = await service.createWorkspaceTask(makeContext(), {
      title: 'Preparar proposta',
      priority: TaskPriority.Medium,
      assigneeId: 'user-assignee',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'task-1' }));
    expect(tasksRepository.save).toHaveBeenCalledTimes(1);
    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });
});

function makeService(
  options: {
    task?: AgencyTask;
    publisher?: jest.Mocked<TaskNotificationPublisher>;
    assigneeUserId?: string | null;
    personalStage?: AgencyPersonalTaskStage | null;
  } = {},
) {
  const savedTask = options.task ?? makeTask();
  const queryBuilder = createQueryBuilderMock<AgencyTask>();
  const tasksRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    create: jest.fn((value: Partial<AgencyTask>) =>
      makeTask({
        ...value,
        assigneeId: value.assigneeId ?? null,
        projectId: value.projectId ?? null,
        status: value.status ?? TaskStatus.InProgress,
        isBlocked: value.isBlocked ?? false,
        updatedAt: new Date('2026-06-12T12:00:00.000Z'),
      }),
    ),
    findOne: jest.fn().mockResolvedValue(savedTask),
    save: jest.fn(async (item: AgencyTask) => item),
    manager: {
      query: jest
        .fn()
        .mockResolvedValue(
          Object.prototype.hasOwnProperty.call(options, 'assigneeUserId')
            ? [{ userId: options.assigneeUserId ?? null }]
            : [],
        ),
    },
  };
  const eventsRepository = {
    create: jest.fn((value: Partial<AgencyProjectEvent>) => value),
    save: jest.fn(async (item: AgencyProjectEvent) => item),
  };
  const projectsRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: 'project-1',
      ownerId: 'user-project-owner',
    }),
  };
  const taskStagesRepository = {
    findOne: jest.fn().mockResolvedValue(null),
  };
  const personalTaskStagesRepository = {
    findOne: jest.fn().mockResolvedValue(options.personalStage ?? null),
  };
  const publisher = options.publisher ?? makeTaskPublisher();
  const attachmentsRepository = { delete: jest.fn() };
  const checklistItemsRepository = { delete: jest.fn() };
  const commentsRepository = { delete: jest.fn() };
  const timeEntriesRepository = {
    delete: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (item: AgencyTaskTimeEntry) => item),
  };
  const service = new TasksCrudService(
    tasksRepository as unknown as Repository<AgencyTask>,
    eventsRepository as unknown as Repository<AgencyProjectEvent>,
    projectsRepository as unknown as Repository<AgencyProject>,
    taskStagesRepository as unknown as Repository<AgencyTaskStage>,
    personalTaskStagesRepository as unknown as Repository<AgencyPersonalTaskStage>,
    attachmentsRepository as unknown as Repository<AgencyTaskAttachment>,
    checklistItemsRepository as unknown as Repository<AgencyTaskChecklistItem>,
    commentsRepository as unknown as Repository<AgencyTaskComment>,
    timeEntriesRepository as unknown as Repository<AgencyTaskTimeEntry>,
    {} as FilesService,
    publisher,
  );

  return {
    service,
    tasksRepository,
    publisher,
    queryBuilder,
    personalTaskStagesRepository,
  };
}

function createQueryBuilderMock<T>() {
  const scopeClauses: string[] = [];
  const bracketQb = {
    where: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
    orWhere: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
  };
  const qb = {
    scopeClauses,
    where: jest.fn(() => qb),
    andWhere: jest.fn((condition: unknown) => {
      if (
        condition &&
        typeof condition === 'object' &&
        'whereFactory' in condition &&
        typeof (condition as { whereFactory?: unknown }).whereFactory ===
          'function'
      ) {
        (
          condition as { whereFactory: (qb: typeof bracketQb) => void }
        ).whereFactory(bracketQb);
      } else if (typeof condition === 'string') {
        scopeClauses.push(condition);
      }
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    getMany: jest.fn().mockResolvedValue([] as T[]),
  };

  return qb;
}

function makeTaskPublisher() {
  return {
    publishAssigned: jest.fn(),
    publishReassigned: jest.fn(),
    publishCompleted: jest.fn(),
    publishReopened: jest.fn(),
    publishBlocked: jest.fn(),
    publishUnblocked: jest.fn(),
  } as unknown as jest.Mocked<TaskNotificationPublisher>;
}

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeTask(overrides: Partial<AgencyTask> = {}): AgencyTask {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'task-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    clientId: null,
    stageId: null,
    projectStageId: null,
    personalStageId: null,
    assigneeId: null,
    createdById: 'user-owner',
    title: 'Preparar proposta',
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

function makePersonalStage(
  overrides: Partial<AgencyPersonalTaskStage> = {},
): AgencyPersonalTaskStage {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'personal-stage-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
    name: 'Hoje',
    color: '#2563EB',
    position: 1,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
