import type { Repository } from 'typeorm';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { NotificationProductKey } from '../../notifications/enums';
import type { NotificationEventProcessorService } from '../../notifications/services';
import type { PlatformPermissionService } from '../../permissions';
import { SocialPublicationNotificationPublisher } from './social-publication-notification.publisher';

function publication() {
  return {
    id: 'publication-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    contentItemId: 'content-a',
    failureReason: 'payload_invalid' as const,
  };
}

describe('SocialPublicationNotificationPublisher', () => {
  it('notifies only active users who can view Social in the failed publication context', async () => {
    const workspaceUsers = {
      find: jest.fn().mockResolvedValue([
        { userId: 'user-allowed', role: 'manager' },
        { userId: 'user-blocked', role: 'member' },
        { userId: null, role: 'owner' },
      ]),
    };
    const permissions = {
      can: jest.fn(({ userId }) => Promise.resolve(userId === 'user-allowed')),
      canAccessClientProduct: jest.fn(({ userId }) => Promise.resolve(userId === 'user-allowed')),
      canAccessProduct: jest.fn(),
    };
    const notifications = { process: jest.fn().mockResolvedValue({ status: 'created' }) };
    const publisher = new SocialPublicationNotificationPublisher(
      workspaceUsers as unknown as Repository<AgencyWorkspaceUserEntity>,
      permissions as unknown as PlatformPermissionService,
      notifications as unknown as NotificationEventProcessorService,
    );

    await publisher.publishFailure(publication());

    expect(permissions.can).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', workspaceId: 'workspace-a' }),
      'social.publishing.publication.view.assigned',
    );
    expect(permissions.canAccessClientProduct).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-a', productKey: 'social' }),
    );
    expect(notifications.process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'social.publishing.publication_failed',
        productKey: NotificationProductKey.SOCIAL,
        recipients: [{ userId: 'user-allowed', interestReason: 'responsible_role' }],
        payload: expect.objectContaining({ actionUrl: '/social/planner/content/content-a' }),
      }),
    );
  });
});
