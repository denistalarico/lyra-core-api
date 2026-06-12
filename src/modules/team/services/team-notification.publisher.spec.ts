import { Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { TeamMember } from '../entities';
import { TeamMemberStatus, TeamWorkerType, TeamWorkMode } from '../enums';
import { TeamNotificationPublisher } from './team-notification.publisher';

describe('TeamNotificationPublisher', () => {
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

  it('publishes team.member_invited to the member userId with a real route', async () => {
    const publisher = new TeamNotificationPublisher(processor);
    const member = makeMember({ userId: 'user-member' });

    await publisher.publishMemberInvited({ member, actorUserId: 'user-actor' });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventType: 'team.member_invited',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'team',
        actorType: NotificationActorType.USER,
        actorUserId: 'user-actor',
        resourceType: 'team_member',
        resourceId: member.id,
        recipients: [
          { userId: 'user-member', interestReason: NotificationInterestReason.PARTICIPANT },
        ],
        payload: expect.objectContaining({
          actionUrl: `/team/members/${member.id}`,
          memberId: member.id,
        }),
      }),
    );
  });

  it('publishes team.department_changed with previous and current departmentId in payload', async () => {
    const publisher = new TeamNotificationPublisher(processor);
    const member = makeMember({ userId: 'user-member', departmentId: 'dept-new' });

    await publisher.publishDepartmentChanged({
      member,
      actorUserId: 'user-actor',
      previousDepartmentId: 'dept-old',
    });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('team.department_changed');
    expect(event.payload).toEqual(
      expect.objectContaining({ previousDepartmentId: 'dept-old', departmentId: 'dept-new' }),
    );
  });

  it('publishes team.role_changed with previous and current roleName in payload', async () => {
    const publisher = new TeamNotificationPublisher(processor);
    const member = makeMember({ userId: 'user-member', roleName: 'Designer' });

    await publisher.publishRoleChanged({
      member,
      actorUserId: 'user-actor',
      previousRoleName: 'Estagiário',
    });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('team.role_changed');
    expect(event.payload).toEqual(
      expect.objectContaining({ previousRoleName: 'Estagiário', roleName: 'Designer' }),
    );
  });

  it('publishes team.skill_assigned with skillId in payload', async () => {
    const publisher = new TeamNotificationPublisher(processor);
    const member = makeMember({ userId: 'user-member' });

    await publisher.publishSkillAssigned({
      member,
      actorUserId: 'user-actor',
      skillId: 'skill-1',
      recipients: [
        { userId: member.userId, interestReason: NotificationInterestReason.ASSIGNED },
      ],
    });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('team.skill_assigned');
    expect(event.recipients).toEqual([
      { userId: 'user-member', interestReason: NotificationInterestReason.ASSIGNED },
    ]);
    expect(event.payload).toEqual(expect.objectContaining({ skillId: 'skill-1' }));
  });

  it('does not notify the member when they are the actor', async () => {
    const publisher = new TeamNotificationPublisher(processor);
    const member = makeMember({ userId: 'user-actor' });

    await publisher.publishMemberActivated({ member, actorUserId: 'user-actor' });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('does not call the processor when the member has no userId', async () => {
    const publisher = new TeamNotificationPublisher(processor);
    const member = makeMember({ userId: null });

    await publisher.publishMemberInvited({ member, actorUserId: 'user-actor' });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('captures processor errors without rethrowing', async () => {
    const publisher = new TeamNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    processor.process.mockRejectedValueOnce(new Error('processor failed'));

    const member = makeMember({ userId: 'user-member' });

    await expect(
      publisher.publishMemberInvited({ member, actorUserId: 'user-actor' }),
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

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'member-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: null,
    contactId: null,
    contractId: null,
    departmentId: null,
    managerMemberId: null,
    displayName: 'Maria Silva',
    legalName: null,
    email: null,
    phone: null,
    avatarUrl: null,
    jobTitle: null,
    roleName: null,
    seniority: null,
    workerType: TeamWorkerType.Contractor,
    workMode: TeamWorkMode.Flexible,
    status: TeamMemberStatus.Active,
    workLocation: null,
    country: null,
    timezone: null,
    startDate: null,
    endDate: null,
    pinCodeHash: null,
    barcodeValue: null,
    attendanceEnabled: false,
    overtimeApprovalRequired: true,
    hourlyCost: null,
    monthlyCost: null,
    currency: 'USD',
    resumeFileKey: null,
    notes: null,
    createdById: null,
    updatedById: null,
    archivedAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
