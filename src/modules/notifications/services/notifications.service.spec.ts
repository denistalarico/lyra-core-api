import { NotificationRecipientEntity } from '../entities';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('marks unread notifications for one resource and one user as read', async () => {
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    const service = new NotificationsService(
      {} as never,
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as never,
    );

    await expect(
      service.markReadByResource(
        {
          tenantId: '11111111-1111-1111-1111-111111111111',
          workspaceId: '22222222-2222-2222-2222-222222222222',
          userId: '33333333-3333-3333-3333-333333333333',
        },
        {
          moduleKey: 'inbox',
          resourceType: 'inbox_conversation',
          resourceId: '44444444-4444-4444-4444-444444444444',
        },
      ),
    ).resolves.toEqual({ updated: 3 });

    expect(queryBuilder.update).toHaveBeenCalledWith(
      NotificationRecipientEntity,
    );
    expect(queryBuilder.where).toHaveBeenCalledWith('user_id = :userId', {
      userId: '33333333-3333-3333-3333-333333333333',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('AND resource_id = :resourceId'),
      expect.objectContaining({
        tenantId: '11111111-1111-1111-1111-111111111111',
        workspaceId: '22222222-2222-2222-2222-222222222222',
        resourceType: 'inbox_conversation',
        resourceId: '44444444-4444-4444-4444-444444444444',
        resourceModuleKey: 'inbox',
      }),
    );
  });
});
