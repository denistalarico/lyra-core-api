import { Logger } from '@nestjs/common';
import {
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { AgencyTask } from '../entities';
import { TaskPriority, TaskStatus, TaskVisibility } from '../enums';
import { TaskNotificationPublisher } from './task-notification.publisher';

describe('TaskNotificationPublisher', () => {
  const processor = {
    process: jest.fn(),
  } as unknown as jest.Mocked<NotificationEventProcessorService>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor.process.mockResolvedValue({
      status: 'created',
      notificationId: 'notification-1',
      recipientCount: 1,
    });
  });

  it('publishes task.assigned to another user with deterministic metadata', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ assigneeId: 'user-assignee' });

    await publisher.publishAssigned({
      task,
      actorUserId: 'user-actor',
    });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventId: expect.stringContaining('task.assigned'),
        eventType: 'task.assigned',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'tasks',
        actorUserId: 'user-actor',
        resourceId: task.id,
        recipients: [
          {
            userId: 'user-assignee',
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: `/projects/${task.projectId}/tasks/${task.id}`,
        }),
      }),
    );
    expect(event.eventId).toContain(task.id);
    expect(event.eventId).toContain(task.updatedAt.toISOString());
  });

  it('filters self-assignment before processing', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ assigneeId: 'user-actor' });

    await publisher.publishAssigned({
      task,
      actorUserId: 'user-actor',
    });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('publishes task.reassigned only to the new assignee', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ assigneeId: 'user-new' });

    await publisher.publishReassigned({
      task,
      actorUserId: 'user-actor',
      previousAssigneeId: 'user-old',
    });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventId: expect.stringContaining('task.reassigned'),
        eventType: 'task.reassigned',
        recipients: [
          {
            userId: 'user-new',
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      }),
    );
    expect(event.eventId).toContain('user-old');
    expect(event.eventId).toContain('user-new');
  });

  it('publishes task.completed to the creator', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({
      status: TaskStatus.Done,
      completedAt: new Date('2026-06-12T13:00:00.000Z'),
    });

    await publisher.publishCompleted({
      task,
      actorUserId: 'user-actor',
    });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventId: expect.stringContaining('task.completed'),
        eventType: 'task.completed',
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      }),
    );
    expect(event.eventId).toContain(task.completedAt?.toISOString());
  });

  it('publishes task.reopened to the assignee', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ assigneeId: 'user-assignee' });

    await publisher.publishReopened({
      task,
      actorUserId: 'user-actor',
    });

    expect(expectProcessedEvent(processor)).toEqual(
      expect.objectContaining({
        eventType: 'task.reopened',
        recipients: [
          {
            userId: 'user-assignee',
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      }),
    );
  });

  it('deduplicates creator and project owner for task.blocked', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ createdById: 'user-owner' });

    await publisher.publishBlocked({
      task,
      actorUserId: 'user-actor',
      projectOwnerId: 'user-owner',
    });

    expect(expectProcessedEvent(processor)).toEqual(
      expect.objectContaining({
        eventType: 'task.blocked',
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      }),
    );
  });

  it('deduplicates recipients for task.unblocked', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ createdById: 'user-owner' });

    await publisher.publishUnblocked({
      task,
      actorUserId: 'user-actor',
      projectOwnerId: 'user-owner',
    });

    expect(expectProcessedEvent(processor)).toEqual(
      expect.objectContaining({
        eventType: 'task.unblocked',
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      }),
    );
  });

  it('uses the project task route when projectId is present', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ projectId: 'project-1', assigneeId: 'user-a' });

    await publisher.publishAssigned({ task, actorUserId: 'user-actor' });

    expect(expectProcessedEvent(processor).payload).toEqual(
      expect.objectContaining({
        actionUrl: '/projects/project-1/tasks/task-1',
      }),
    );
  });

  it('uses the task route when projectId is absent', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ projectId: null, assigneeId: 'user-a' });

    await publisher.publishAssigned({ task, actorUserId: 'user-actor' });

    expect(expectProcessedEvent(processor).payload).toEqual(
      expect.objectContaining({
        actionUrl: '/projects/tasks/task-1',
      }),
    );
  });

  it('captures processor errors without rethrowing', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    processor.process.mockRejectedValueOnce(new Error('processor failed'));

    await expect(
      publisher.publishAssigned({
        task: makeTask({ assigneeId: 'user-assignee' }),
        actorUserId: 'user-actor',
      }),
    ).resolves.toBeUndefined();

    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });

  it('uses different deterministic ids for different task actions', async () => {
    const publisher = new TaskNotificationPublisher(processor);
    const task = makeTask({ assigneeId: 'user-assignee' });
    const randomSpy = jest.spyOn(Math, 'random');

    await publisher.publishAssigned({ task, actorUserId: 'user-actor' });
    await publisher.publishReopened({ task, actorUserId: 'user-actor' });

    const [assigned, reopened] = processor.process.mock.calls.map(
      ([event]) => event.eventId,
    );

    expect(assigned).not.toEqual(reopened);
    expect(assigned).toContain(task.id);
    expect(reopened).toContain(task.id);
    expect(assigned).toContain(task.updatedAt.toISOString());
    expect(reopened).toContain(task.updatedAt.toISOString());
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});

function expectProcessedEvent(processor: jest.Mocked<NotificationEventProcessorService>) {
  expect(processor.process).toHaveBeenCalledTimes(1);
  return processor.process.mock.calls[0][0];
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
