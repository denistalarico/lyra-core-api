import { Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { AgencyActivity, AgencyActivityLink } from '../entities';
import {
  ActivityEntityType,
  ActivityPriority,
  ActivityRelationType,
  ActivityStatus,
  ActivityType,
  ActivityVisibility,
} from '../enums';
import { ActivityNotificationPublisher } from './activity-notification.publisher';

describe('ActivityNotificationPublisher', () => {
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

  it('publishes activity.assigned to the assignee with a client actionUrl', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({ assignedToId: 'user-assignee' });
    const links = [makeLink({ entityType: ActivityEntityType.Client, entityId: 'client-1' })];

    await publisher.publishAssigned({
      activity,
      links,
      actorUserId: 'user-actor',
    });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventType: 'activity.assigned',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'activities',
        actorType: NotificationActorType.USER,
        actorUserId: 'user-actor',
        resourceType: 'activity',
        resourceId: activity.id,
        recipients: [
          {
            userId: 'user-assignee',
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: '/clients/client-1',
          activityId: activity.id,
        }),
      }),
    );
  });

  it('falls back to a null actionUrl when no recognizable link exists', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({ assignedToId: 'user-assignee' });

    await publisher.publishAssigned({
      activity,
      links: [],
      actorUserId: 'user-actor',
    });

    expect(expectProcessedEvent(processor).payload).toEqual(
      expect.objectContaining({ actionUrl: null }),
    );
  });

  it('resolves project/task links to the project activities route', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({ assignedToId: 'user-assignee' });
    const links = [makeLink({ entityType: ActivityEntityType.Task, entityId: 'task-1' })];

    await publisher.publishAssigned({ activity, links, actorUserId: 'user-actor' });

    expect(expectProcessedEvent(processor).payload).toEqual(
      expect.objectContaining({ actionUrl: '/projects/activities' }),
    );
  });

  it('resolves sales-related links to the sales activities route', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({ assignedToId: 'user-assignee' });
    const links = [makeLink({ entityType: ActivityEntityType.SalesOpportunity, entityId: 'opp-1' })];

    await publisher.publishAssigned({ activity, links, actorUserId: 'user-actor' });

    expect(expectProcessedEvent(processor).payload).toEqual(
      expect.objectContaining({ actionUrl: '/sales/activities' }),
    );
  });

  it('publishes activity.reassigned and includes previousAssignedToId in the eventId', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({ assignedToId: 'user-new' });

    await publisher.publishReassigned({
      activity,
      links: [],
      actorUserId: 'user-actor',
      previousAssignedToId: 'user-old',
    });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('activity.reassigned');
    expect(event.eventId).toContain('user-old');
    expect(event.eventId).toContain('user-new');
    expect(event.recipients).toEqual([
      { userId: 'user-new', interestReason: NotificationInterestReason.ASSIGNED },
    ]);
  });

  it('publishes activity.completed to the creator', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({
      status: ActivityStatus.Done,
      createdById: 'user-creator',
      completedAt: new Date('2026-06-12T15:00:00.000Z'),
    });

    await publisher.publishCompleted({ activity, links: [], actorUserId: 'user-actor' });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('activity.completed');
    expect(event.recipients).toEqual([
      { userId: 'user-creator', interestReason: NotificationInterestReason.OWNER },
    ]);
  });

  it('publishes activity.canceled to both creator and assignee', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({
      status: ActivityStatus.Cancelled,
      createdById: 'user-creator',
      assignedToId: 'user-assignee',
      cancelledAt: new Date('2026-06-12T15:00:00.000Z'),
    });

    await publisher.publishCanceled({ activity, links: [], actorUserId: 'user-actor' });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('activity.canceled');
    expect(event.recipients).toEqual(
      expect.arrayContaining([
        { userId: 'user-creator', interestReason: NotificationInterestReason.OWNER },
        { userId: 'user-assignee', interestReason: NotificationInterestReason.ASSIGNED },
      ]),
    );
  });

  it('publishes activity.follow_up_created with parentActivityId in payload', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({ id: 'activity-2', assignedToId: 'user-assignee' });

    await publisher.publishFollowUpCreated({
      activity,
      links: [],
      actorUserId: 'user-actor',
      parentActivityId: 'activity-1',
    });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('activity.follow_up_created');
    expect(event.eventId).toContain('activity-1');
    expect(event.eventId).toContain('activity-2');
    expect(event.payload).toEqual(
      expect.objectContaining({ parentActivityId: 'activity-1' }),
    );
  });

  it('removes empty, duplicate, and actor recipients', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({
      status: ActivityStatus.Cancelled,
      createdById: 'user-actor',
      assignedToId: 'user-assignee',
    });

    await publisher.publishCanceled({
      activity,
      links: [],
      actorUserId: 'user-actor',
      recipients: [
        { userId: '', interestReason: NotificationInterestReason.OWNER },
        { userId: 'user-actor', interestReason: NotificationInterestReason.OWNER },
        { userId: 'user-assignee', interestReason: NotificationInterestReason.ASSIGNED },
        { userId: 'user-assignee', interestReason: NotificationInterestReason.OWNER },
      ],
    });

    expect(expectProcessedEvent(processor).recipients).toEqual([
      { userId: 'user-assignee', interestReason: NotificationInterestReason.ASSIGNED },
    ]);
  });

  it('does not call the processor when there are no valid recipients', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const activity = makeActivity({ assignedToId: null });

    await publisher.publishAssigned({ activity, links: [], actorUserId: 'user-actor' });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('captures processor errors without rethrowing', async () => {
    const publisher = new ActivityNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    processor.process.mockRejectedValueOnce(new Error('processor failed'));

    const activity = makeActivity({ assignedToId: 'user-assignee' });

    await expect(
      publisher.publishAssigned({ activity, links: [], actorUserId: 'user-actor' }),
    ).resolves.toBeUndefined();

    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });
});

function expectProcessedEvent(
  processor: jest.Mocked<NotificationEventProcessorService>,
) {
  expect(processor.process).toHaveBeenCalledTimes(1);
  return processor.process.mock.calls[0][0];
}

function makeActivity(overrides: Partial<AgencyActivity> = {}): AgencyActivity {
  const now = new Date('2026-06-12T12:00:00.000Z');

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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeLink(overrides: Partial<AgencyActivityLink> = {}): AgencyActivityLink {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'link-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    activityId: 'activity-1',
    entityType: ActivityEntityType.Client,
    entityId: 'entity-1',
    relationType: ActivityRelationType.RelatedTo,
    createdAt: now,
    ...overrides,
  };
}
