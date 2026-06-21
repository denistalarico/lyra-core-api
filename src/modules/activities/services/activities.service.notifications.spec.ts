import { Repository } from 'typeorm';
import { AgencyActivity, AgencyActivityLink } from '../entities';
import {
  ActivityPriority,
  ActivityStatus,
  ActivityType,
  ActivityVisibility,
} from '../enums';
import { ActivityNotificationPublisher } from './activity-notification.publisher';
import { ActivitiesService } from './activities.service';

const NOW = new Date('2026-06-12T12:00:00.000Z');

describe('ActivitiesService notification triggers', () => {
  it('publishes activity.assigned on create when assignedToId is set', async () => {
    const { service, publisher } = makeService();

    await service.create(
      makeContext(),
      makeCreateDto({ assignedToId: 'user-assignee' }),
    );

    expect(publisher.publishAssigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({ assignedToId: 'user-assignee' }),
      }),
    );
  });

  it('does not publish activity.assigned on create without an assignee', async () => {
    const { service, publisher } = makeService();

    await service.create(
      makeContext(),
      makeCreateDto({ assignedToId: undefined }),
    );

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
  });

  it('skips activity.assigned on create when skipAssignedNotification is set', async () => {
    const { service, publisher } = makeService();

    await service.create(
      makeContext(),
      makeCreateDto({ assignedToId: 'user-assignee' }),
      { skipAssignedNotification: true },
    );

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
  });

  it('publishes activity.assigned on update when an unassigned activity gets an assignee', async () => {
    const activity = makeActivity({ assignedToId: null });
    const { service, publisher } = makeService({ activity });

    await service.update(makeContext(), activity.id, {
      assignedToId: 'user-assignee',
    });

    expect(publisher.publishAssigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishReassigned).not.toHaveBeenCalled();
  });

  it('publishes activity.reassigned on update when the assignee changes', async () => {
    const activity = makeActivity({ assignedToId: 'user-old' });
    const { service, publisher } = makeService({ activity });

    await service.update(makeContext(), activity.id, {
      assignedToId: 'user-new',
    });

    expect(publisher.publishReassigned).toHaveBeenCalledWith(
      expect.objectContaining({ previousAssignedToId: 'user-old' }),
    );
    expect(publisher.publishAssigned).not.toHaveBeenCalled();
  });

  it('publishes activity.completed on update when status transitions to done', async () => {
    const activity = makeActivity({
      status: ActivityStatus.Todo,
      createdById: 'user-creator',
    });
    const { service, publisher } = makeService({ activity });

    await service.update(makeContext(), activity.id, {
      status: ActivityStatus.Done,
    });

    expect(publisher.publishCompleted).toHaveBeenCalledTimes(1);
  });

  it('publishes activity.canceled on update when status transitions to cancelled', async () => {
    const activity = makeActivity({
      status: ActivityStatus.Todo,
      createdById: 'user-creator',
      assignedToId: 'user-assignee',
    });
    const { service, publisher } = makeService({ activity });

    await service.update(makeContext(), activity.id, {
      status: ActivityStatus.Cancelled,
    });

    expect(publisher.publishCanceled).toHaveBeenCalledTimes(1);
  });

  it('does not publish completed/canceled again when status is unchanged', async () => {
    const activity = makeActivity({
      status: ActivityStatus.Done,
      createdById: 'user-creator',
      completedAt: NOW,
    });
    const { service, publisher } = makeService({ activity });

    await service.update(makeContext(), activity.id, {
      priority: ActivityPriority.High,
    });

    expect(publisher.publishCompleted).not.toHaveBeenCalled();
    expect(publisher.publishCanceled).not.toHaveBeenCalled();
  });

  it('publishes activity.completed via complete()', async () => {
    const activity = makeActivity({
      status: ActivityStatus.Todo,
      createdById: 'user-creator',
    });
    const { service, publisher } = makeService({ activity });

    await service.complete(makeContext(), activity.id, {});

    expect(publisher.publishCompleted).toHaveBeenCalledTimes(1);
  });

  it('publishes activity.canceled via cancel()', async () => {
    const activity = makeActivity({
      status: ActivityStatus.Todo,
      createdById: 'user-creator',
      assignedToId: 'user-assignee',
    });
    const { service, publisher } = makeService({ activity });

    await service.cancel(makeContext(), activity.id, {});

    expect(publisher.publishCanceled).toHaveBeenCalledTimes(1);
  });

  it('completeAndScheduleNext fires completed for the old activity and follow_up_created for the new one, but not assigned for the new one', async () => {
    const activity = makeActivity({
      id: 'activity-1',
      status: ActivityStatus.Todo,
      createdById: 'user-creator',
    });
    const { service, publisher } = makeService({ activity });

    await service.completeAndScheduleNext(makeContext(), activity.id, {
      completion: {},
      nextActivity: makeCreateDto({ assignedToId: 'user-assignee' }),
    });

    expect(publisher.publishCompleted).toHaveBeenCalledTimes(1);
    expect(publisher.publishAssigned).not.toHaveBeenCalled();
    expect(publisher.publishFollowUpCreated).toHaveBeenCalledTimes(1);
    expect(publisher.publishFollowUpCreated).toHaveBeenCalledWith(
      expect.objectContaining({ parentActivityId: 'activity-1' }),
    );
  });

  it('completeAndScheduleNext does not fire follow_up_created when the next activity has no assignee', async () => {
    const activity = makeActivity({
      id: 'activity-1',
      status: ActivityStatus.Todo,
      createdById: 'user-creator',
    });
    const { service, publisher } = makeService({ activity });

    await service.completeAndScheduleNext(makeContext(), activity.id, {
      completion: {},
      nextActivity: makeCreateDto({ assignedToId: undefined }),
    });

    expect(publisher.publishFollowUpCreated).not.toHaveBeenCalled();
  });
});

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeService(options: { activity?: AgencyActivity } = {}) {
  let savedActivity: AgencyActivity | undefined = options.activity;

  const activitiesRepository = {
    create: jest.fn((value: Partial<AgencyActivity>) => ({
      ...value,
    })) as unknown as Repository<AgencyActivity>['create'],
    save: jest.fn(async (value: AgencyActivity) => {
      savedActivity = {
        ...value,
        id: value.id ?? 'activity-new',
        createdAt: value.createdAt ?? NOW,
        updatedAt: NOW,
      } as AgencyActivity;
      return savedActivity;
    }),
    findOne: jest.fn(() => Promise.resolve(savedActivity)),
    remove: jest.fn(),
  };

  const linksRepository = {
    find: jest.fn().mockResolvedValue([] as AgencyActivityLink[]),
    create: jest.fn(
      (value: Partial<AgencyActivityLink>) => value as AgencyActivityLink,
    ),
    save: jest.fn(async (value: Partial<AgencyActivityLink>) => ({
      id: 'link-new',
      createdAt: NOW,
      ...value,
    })),
  };

  const publisher = {
    publishAssigned: jest.fn(),
    publishReassigned: jest.fn(),
    publishCompleted: jest.fn(),
    publishCanceled: jest.fn(),
    publishFollowUpCreated: jest.fn(),
    publishReminder: jest.fn(),
  } as unknown as jest.Mocked<ActivityNotificationPublisher>;
  const emailService = {
    sendCalendarReminderEmail: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ActivitiesService(
    activitiesRepository as unknown as Repository<AgencyActivity>,
    linksRepository as unknown as Repository<AgencyActivityLink>,
    publisher,
    emailService as any,
  );

  return { service, publisher, activitiesRepository, linksRepository };
}

function makeActivity(overrides: Partial<AgencyActivity> = {}): AgencyActivity {
  return {
    id: 'activity-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    type: ActivityType.Task,
    subtype: null,
    status: ActivityStatus.Todo,
    priority: ActivityPriority.Medium,
    summary: 'Ligar para o cliente',
    note: null,
    completionFeedback: null,
    dueAt: null,
    startAt: null,
    endAt: null,
    completedAt: null,
    cancelledAt: null,
    archivedAt: null,
    assignedToId: null,
    createdById: 'user-creator',
    completedById: null,
    cancelledById: null,
    sourceModule: null,
    visibility: ActivityVisibility.Workspace,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    type: ActivityType.Task,
    summary: 'Nova atividade',
    priority: ActivityPriority.Medium,
    ...overrides,
  } as any;
}
