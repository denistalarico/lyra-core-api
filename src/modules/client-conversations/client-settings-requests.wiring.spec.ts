import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { ClientAreaSettingsRequestsRegistry } from '../client-area/client-area-settings-requests.registry';
import { ClientConversationsModule } from './client-conversations.module';
import { ClientConversationsService } from './services/client-conversations.service';
import { ClientConversationAttachmentsService } from './services/client-conversation-attachments.service';
import { ClientSettingsRequestPublisher } from './services/client-settings-request.publisher';

jest.mock('otplib', () => ({ verify: jest.fn() }));
describe('CA14 settings requests', () => {
  const context = {
    tenantId: 't',
    workspaceId: 'w',
    agencyClientId: 'client',
    companyContextId: 'company',
    userId: 'client-user',
    membershipId: 'membership',
  } as ClientAreaContext;
  it('the production onModuleInit registers the publisher through Nest', async () => {
    const publish = jest.fn().mockResolvedValue({
      requestId: 'message',
      conversationId: 'conversation',
    });
    const ref = await Test.createTestingModule({
      providers: [
        ClientConversationsModule,
        ClientAreaSettingsRequestsRegistry,
        { provide: ClientSettingsRequestPublisher, useValue: { publish } },
        {
          provide: ClientConversationsService,
          useValue: {
            registerAttachmentProjection: jest.fn(),
            registerAttachmentBinder: jest.fn(),
          },
        },
        {
          provide: ClientConversationAttachmentsService,
          useValue: { forMessages: jest.fn(), attachToMessage: jest.fn() },
        },
      ],
    }).compile();
    await ref.init();
    const input = {
      kind: 'deletion_request' as const,
      reason: 'Please remove my data.',
    };
    expect(
      await ref.get(ClientAreaSettingsRequestsRegistry).publish(context, input),
    ).toEqual({ requestId: 'message', conversationId: 'conversation' });
    expect(publish).toHaveBeenCalledWith(context, input);
    await ref.close();
  });
  it('uses the canonical system-card writer, broadcasts and excludes unassigned Agency admins', async () => {
    const conversations = {
      ensureDefaultConversation: jest
        .fn()
        .mockResolvedValue({ id: 'conversation' }),
      publishCard: jest.fn().mockResolvedValue({
        status: 'posted',
        conversationId: 'conversation',
        message: { id: 'message', createdAt: new Date() },
      }),
    };
    const access = {
      resolveScope: jest
        .fn()
        .mockImplementation((actor: { userId: string }) =>
          actor.userId === 'unassigned-admin'
            ? Promise.reject(new ForbiddenException())
            : Promise.resolve({}),
        ),
    };
    const agencyPermissions = { can: jest.fn().mockResolvedValue(true) };
    const notices = {
      publishMessageCreated: jest.fn().mockResolvedValue(undefined),
    };
    const agency = { broadcastMessageCreated: jest.fn() },
      client = { broadcastMessageCreated: jest.fn() };
    const users = {
      find: jest.fn().mockResolvedValue([
        { userId: 'agency-owner', role: 'owner' },
        { userId: 'unassigned-admin', role: 'admin' },
      ]),
    };
    const publisher = new ClientSettingsRequestPublisher(
      access as never,
      agencyPermissions as never,
      conversations as never,
      notices as never,
      agency as never,
      client as never,
      users as never,
    );
    const input = {
      kind: 'invitation_request' as const,
      displayName: 'Person',
      email: 'person@example.test',
      moduleLevels: { social_planner: 'viewer' as const },
    };
    expect(await publisher.publish(context, input)).toEqual({
      requestId: 'message',
      conversationId: 'conversation',
    });
    expect(conversations.publishCard).toHaveBeenCalledWith(
      {
        tenantId: 't',
        workspaceId: 'w',
        agencyClientId: 'client',
        companyContextId: 'company',
      },
      expect.objectContaining({
        kind: 'settings_request',
        requestedByUserId: 'client-user',
        request: input,
      }),
      expect.stringContaining('client_area_settings_request:'),
    );
    expect(notices.publishMessageCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message',
        authorUserId: 'client-user',
        agencyFallbackRecipientUserIds: ['agency-owner'],
      }),
    );
    expect(agency.broadcastMessageCreated).toHaveBeenCalled();
    expect(client.broadcastMessageCreated).toHaveBeenCalled();
    notices.publishMessageCreated.mockRejectedValueOnce(
      new Error('unavailable'),
    );
    await expect(publisher.publish(context, input)).resolves.toEqual({
      requestId: 'message',
      conversationId: 'conversation',
    });
  });
});
