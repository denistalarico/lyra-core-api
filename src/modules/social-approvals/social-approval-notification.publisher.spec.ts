import { NotificationInterestReason } from '../notifications/enums';
import { SocialApprovalNotificationPublisher } from './social-approval-notification.publisher';

describe('SocialApprovalNotificationPublisher AP2', () => {
  const approval = {
    id: 'approval-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', companyContextId: 'company-a',
    requestedByUserId: 'agency-requester', subjectType: 'planner_content_revision', title: 'Post', subjectVersionLabel: 'r2',
    sentToClientAt: new Date('2026-09-23T10:00:00.000Z'), approvedAt: new Date('2026-09-23T11:00:00.000Z'),
    supersededAt: new Date('2026-09-23T12:00:00.000Z'), updatedAt: new Date('2026-09-23T09:00:00.000Z'), status: 'awaiting_client',
  };

  it.each(['awaiting_client', 'changes_requested', 'approved', 'superseded'] as const)(
    'publishes the cataloged %s event with the stable source-event identity and only the known Agency requester',
    async (type) => {
      const seen = new Set<string>();
      const processor = {
        process: jest.fn(async (event: { eventId: string }) =>
          seen.has(event.eventId) ? { status: 'duplicate' } : (seen.add(event.eventId), { status: 'created' }),
        ),
      };
      const publisher = new SocialApprovalNotificationPublisher(processor as never);

      await publisher.publish(type, approval as never, 'actor-a');
      await publisher.publish(type, approval as never, 'actor-a');

      const [first, second] = processor.process.mock.calls.map(
        ([event]) => event as Record<string, unknown>,
      );
      expect(first.eventId).toBe(second.eventId);
      expect(first.eventType).toBe(`social.approval.${type}`);
      expect(first.recipients).toEqual([{ userId: 'agency-requester', interestReason: NotificationInterestReason.REQUESTER }]);
      expect(first.recipients).not.toContainEqual(expect.objectContaining({ userId: 'company-a' }));
      expect([...seen]).toHaveLength(1);
    },
  );
});
