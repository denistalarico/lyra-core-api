import { ForbiddenException } from '@nestjs/common';
import { ContractTargetType } from '../../contracts/enums';
import { PlatformRoleKey } from '../enums/permission.enums';
import { PermissionScopeEvaluatorService } from './permission-scope-evaluator.service';

function createRepositoryMock() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
  };
}

function createService() {
  const contactsRepository = createRepositoryMock();
  const agencyContactsRepository = createRepositoryMock();
  const inboxChannelsRepository = createRepositoryMock();
  const inboxConversationsRepository = createRepositoryMock();
  const inboxMediaAssetsRepository = createRepositoryMock();
  const webchatConversationsRepository = createRepositoryMock();
  const webchatWidgetsRepository = createRepositoryMock();
  const scheduledItemsRepository = createRepositoryMock();
  const clientsRepository = createRepositoryMock();
  const clientAccessRepository = createRepositoryMock();
  const teamMembersRepository = createRepositoryMock();
  const teamDepartmentsRepository = createRepositoryMock();
  const teamSkillsRepository = createRepositoryMock();
  const teamConfigOptionsRepository = createRepositoryMock();
  const teamPaymentsRepository = createRepositoryMock();
  const contractsRepository = createRepositoryMock();
  const contractPartiesRepository = createRepositoryMock();
  const contractTemplatesRepository = createRepositoryMock();
  const projectsRepository = createRepositoryMock();
  const tasksRepository = createRepositoryMock();
  const taskTimeEntriesRepository = createRepositoryMock();
  const calendarEventsRepository = createRepositoryMock();
  const calendarRoutineBlocksRepository = createRepositoryMock();
  const crmOpportunitiesRepository = createRepositoryMock();
  const crmPipelinesRepository = createRepositoryMock();
  const crmStagesRepository = createRepositoryMock();
  const crmTagsRepository = createRepositoryMock();
  const chatChannelsRepository = createRepositoryMock();
  const chatChannelMembersRepository = createRepositoryMock();
  const chatMessagesRepository = createRepositoryMock();
  const chatAttachmentsRepository = createRepositoryMock();
  const meetingRoomsRepository = createRepositoryMock();
  const meetingParticipantsRepository = createRepositoryMock();
  const salesItemsRepository = createRepositoryMock();
  const salesPipelinesRepository = createRepositoryMock();
  const salesStagesRepository = createRepositoryMock();
  const salesOpportunitiesRepository = createRepositoryMock();
  const salesActivitiesRepository = createRepositoryMock();
  const quotesRepository = createRepositoryMock();
  const knowledgeArticlesRepository = createRepositoryMock();
  const knowledgeCategoriesRepository = createRepositoryMock();
  const knowledgeCommentsRepository = createRepositoryMock();
  const knowledgeQuickNotesRepository = createRepositoryMock();
  const knowledgeVaultItemsRepository = createRepositoryMock();

  const service = new PermissionScopeEvaluatorService(
    contactsRepository as never,
    agencyContactsRepository as never,
    inboxChannelsRepository as never,
    inboxConversationsRepository as never,
    inboxMediaAssetsRepository as never,
    webchatConversationsRepository as never,
    webchatWidgetsRepository as never,
    scheduledItemsRepository as never,
    clientsRepository as never,
    clientAccessRepository as never,
    teamMembersRepository as never,
    teamDepartmentsRepository as never,
    teamSkillsRepository as never,
    teamConfigOptionsRepository as never,
    teamPaymentsRepository as never,
    contractsRepository as never,
    contractPartiesRepository as never,
    contractTemplatesRepository as never,
    projectsRepository as never,
    tasksRepository as never,
    taskTimeEntriesRepository as never,
    calendarEventsRepository as never,
    calendarRoutineBlocksRepository as never,
    crmOpportunitiesRepository as never,
    crmPipelinesRepository as never,
    crmStagesRepository as never,
    crmTagsRepository as never,
    chatChannelsRepository as never,
    chatChannelMembersRepository as never,
    chatMessagesRepository as never,
    chatAttachmentsRepository as never,
    meetingRoomsRepository as never,
    meetingParticipantsRepository as never,
    salesItemsRepository as never,
    salesPipelinesRepository as never,
    salesStagesRepository as never,
    salesOpportunitiesRepository as never,
    salesActivitiesRepository as never,
    quotesRepository as never,
    knowledgeArticlesRepository as never,
    knowledgeCategoriesRepository as never,
    knowledgeCommentsRepository as never,
    knowledgeQuickNotesRepository as never,
    knowledgeVaultItemsRepository as never,
  );

  return {
    service,
    contactsRepository,
    agencyContactsRepository,
    inboxChannelsRepository,
    inboxConversationsRepository,
    inboxMediaAssetsRepository,
    webchatConversationsRepository,
    webchatWidgetsRepository,
    scheduledItemsRepository,
    clientsRepository,
    clientAccessRepository,
    teamMembersRepository,
    contractsRepository,
    contractPartiesRepository,
    projectsRepository,
    tasksRepository,
    taskTimeEntriesRepository,
    calendarEventsRepository,
    crmOpportunitiesRepository,
    crmPipelinesRepository,
    crmStagesRepository,
    crmTagsRepository,
    chatChannelsRepository,
    chatChannelMembersRepository,
    chatMessagesRepository,
    meetingRoomsRepository,
    meetingParticipantsRepository,
    salesItemsRepository,
    salesPipelinesRepository,
    salesStagesRepository,
    salesOpportunitiesRepository,
    salesActivitiesRepository,
    quotesRepository,
    knowledgeArticlesRepository,
    knowledgeCategoriesRepository,
    knowledgeCommentsRepository,
    knowledgeQuickNotesRepository,
    knowledgeVaultItemsRepository,
  };
}

const baseContext = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: PlatformRoleKey.Manager,
};

describe('PermissionScopeEvaluatorService', () => {
  it('allows assigned contact access through owner or creator fields', async () => {
    const { service, contactsRepository } = createService();
    contactsRepository.findOne.mockResolvedValue({
      id: 'contact-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      createdByUserId: 'user-2',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'shared.contacts.view.assigned',
        {
          routePath: '/contacts/:contactId',
          params: { contactId: 'contact-1' },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('denies client-scoped contacts until client ownership metadata exists', async () => {
    const { service, contactsRepository } = createService();
    contactsRepository.findOne.mockResolvedValue({
      id: 'contact-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-2',
      createdByUserId: 'user-2',
    });

    await expect(
      service.assertScope(baseContext, 'shared.contacts.view.client', {
        routePath: '/contacts/:contactId',
        params: { contactId: 'contact-1' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows contact identification-type management without treating the config id as a contact', async () => {
    const { service, agencyContactsRepository } = createService();

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Manager },
        'shared.contacts.update.client',
        {
          routePath: '/agency/contacts/identification-types/:id',
          params: { id: 'identification-type-1' },
        },
      ),
    ).resolves.toBeUndefined();

    // The config id must NOT be looked up against the contacts table.
    expect(agencyContactsRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows deleting a contact source as the owner without an out-of-scope error', async () => {
    const { service, agencyContactsRepository } = createService();

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Owner },
        'shared.contacts.delete.owner_only',
        {
          routePath: '/agency/contacts/sources/:id',
          params: { id: 'source-1' },
        },
      ),
    ).resolves.toBeUndefined();

    expect(agencyContactsRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows assigned LeadFlow inbox conversation access', async () => {
    const { service, inboxConversationsRepository } = createService();
    inboxConversationsRepository.findOne.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assignedUserId: 'user-1',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'leadflow.inbox.conversation.view.assigned',
        {
          routePath: '/inbox/conversations/:id',
          params: { id: 'conversation-1' },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('denies unassigned LeadFlow inbox conversation access', async () => {
    const { service, inboxConversationsRepository } = createService();
    inboxConversationsRepository.findOne.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assignedUserId: 'user-2',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'leadflow.inbox.conversation.view.assigned',
        {
          routePath: '/inbox/conversations/:id',
          params: { id: 'conversation-1' },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resolves LeadFlow media access through its assigned conversation', async () => {
    const {
      service,
      inboxMediaAssetsRepository,
      inboxConversationsRepository,
    } = createService();
    inboxMediaAssetsRepository.findOne.mockResolvedValue({
      id: 'media-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      conversationId: 'conversation-1',
    });
    inboxConversationsRepository.findOne.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assignedUserId: 'user-1',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'leadflow.inbox.conversation.view.assigned',
        {
          routePath: '/inbox/media/:mediaId/content',
          params: { mediaId: 'media-1' },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('denies LeadFlow media access when its conversation is assigned elsewhere', async () => {
    const {
      service,
      inboxMediaAssetsRepository,
      inboxConversationsRepository,
    } = createService();
    inboxMediaAssetsRepository.findOne.mockResolvedValue({
      id: 'media-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      conversationId: 'conversation-1',
    });
    inboxConversationsRepository.findOne.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assignedUserId: 'user-2',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'leadflow.inbox.conversation.view.assigned',
        {
          routePath: '/inbox/media/:mediaId/content',
          params: { mediaId: 'media-1' },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows assigned LeadFlow appointment updates', async () => {
    const { service, scheduledItemsRepository } = createService();
    scheduledItemsRepository.findOne.mockResolvedValue({
      id: 'appointment-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assignedUserId: 'user-2',
      ownerUserId: 'user-1',
      createdByUserId: 'user-3',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'leadflow.appointments.item.update.assigned',
        {
          routePath: '/appointments/:id',
          params: { id: 'appointment-1' },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('allows assigned client access through the account owner relation', async () => {
    const { service, clientsRepository } = createService();
    clientsRepository.findOne.mockResolvedValue({
      id: 'client-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      accountOwnerId: 'user-1',
    });

    await expect(
      service.assertScope(
        baseContext,
        'agency.clients.profile.view.basic.assigned',
        {
          routePath: '/agency/clients/:clientId',
          params: { clientId: 'client-1' },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('denies scoped client collections for non-elevated roles', async () => {
    const { service } = createService();

    await expect(
      service.assertScope(
        baseContext,
        'agency.clients.profile.view.basic.assigned',
        {
          routePath: '/agency/clients',
          params: {},
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows team department access for members in the same department', async () => {
    const { service, teamMembersRepository } = createService();
    teamMembersRepository.findOne
      .mockResolvedValueOnce({
        id: 'member-2',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-2',
        departmentId: 'department-1',
      })
      .mockResolvedValueOnce({
        id: 'member-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        departmentId: 'department-1',
      });

    await expect(
      service.assertScope(baseContext, 'agency.team.member.view.department', {
        routePath: '/agency/team/members/:id',
        params: { id: 'member-2' },
      }),
    ).resolves.toBeUndefined();
  });

  it('denies team self access to another member', async () => {
    const { service, teamMembersRepository } = createService();
    teamMembersRepository.findOne.mockResolvedValue({
      id: 'member-2',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      userId: 'user-2',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'agency.team.member.view.self',
        {
          routePath: '/agency/team/members/:id',
          params: { id: 'member-2' },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows assigned contract access through a contract party relation', async () => {
    const { service, contractsRepository, contractPartiesRepository } =
      createService();
    contractsRepository.findOne.mockResolvedValue({
      id: 'contract-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      targetType: ContractTargetType.Internal,
      targetId: null,
      createdById: 'user-2',
    });
    contractPartiesRepository.findOne.mockResolvedValue({
      id: 'party-1',
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });

    await expect(
      service.assertScope(baseContext, 'agency.contracts.view.assigned', {
        routePath: '/agency/contracts/:id',
        params: { id: 'contract-1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('denies owner access when a resource id resolves outside the tenant/workspace', async () => {
    const { service, contractsRepository } = createService();
    contractsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Owner, userId: 'owner-1' },
        'agency.contracts.delete.owner_only',
        {
          routePath: '/agency/contracts/:id',
          params: { id: 'contract-404' },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows assigned task access for the assignee', async () => {
    const { service, tasksRepository } = createService();
    tasksRepository.findOne.mockResolvedValue({
      id: 'task-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assigneeId: 'user-1',
      createdById: 'user-2',
    });

    await expect(
      service.assertScope(baseContext, 'agency.tasks.task.update.assigned', {
        routePath: '/agency/projects/tasks/:id',
        params: { id: 'task-1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows project stage management without treating the stage id as a project', async () => {
    const { service, projectsRepository } = createService();

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Manager },
        'agency.projects.project.update.department',
        {
          routePath: '/agency/projects/project-stages/:id',
          params: { id: 'stage-1' },
        },
      ),
    ).resolves.toBeUndefined();

    // The stage id must NOT be looked up against the projects table.
    expect(projectsRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows task stage management without treating the stage id as a task', async () => {
    const { service, tasksRepository } = createService();

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Manager },
        'agency.tasks.task.manage.department',
        {
          routePath: '/agency/projects/task-stages/:id',
          params: { id: 'stage-1' },
        },
      ),
    ).resolves.toBeUndefined();

    expect(tasksRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows calendar self access for the event owner', async () => {
    const { service, calendarEventsRepository } = createService();
    calendarEventsRepository.findOne.mockResolvedValue({
      id: 'event-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      createdByUserId: 'user-2',
    });

    await expect(
      service.assertScope(baseContext, 'agency.calendar.events.manage.self', {
        routePath: '/calendar/events/:eventId',
        params: { eventId: 'event-1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows chat assigned access for channel participants', async () => {
    const { service, chatChannelsRepository, chatChannelMembersRepository } =
      createService();
    chatChannelsRepository.findOne.mockResolvedValue({
      id: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      createdById: 'user-2',
    });
    chatChannelMembersRepository.findOne.mockResolvedValue({
      id: 'member-1',
      channelId: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      leftAt: null,
    });

    await expect(
      service.assertScope(baseContext, 'agency.chat.channels.view.assigned', {
        routePath: '/agency/team-chat/channels/:channelId/messages',
        params: { channelId: 'channel-1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows assigned sales opportunity access for the owner', async () => {
    const { service, salesOpportunitiesRepository } = createService();
    salesOpportunitiesRepository.findOne.mockResolvedValue({
      id: 'opportunity-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
    });

    await expect(
      service.assertScope(baseContext, 'agency.sales.crm.view.assigned', {
        routePath: '/agency/sales/opportunities/:id',
        params: { id: 'opportunity-1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows assigned legacy CRM opportunity access for the assignee', async () => {
    const {
      service,
      salesOpportunitiesRepository,
      crmOpportunitiesRepository,
    } = createService();
    salesOpportunitiesRepository.findOne.mockResolvedValue(null);
    crmOpportunitiesRepository.findOne.mockResolvedValue({
      id: 'crm-opportunity-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assignedUserId: 'user-1',
    });

    await expect(
      service.assertScope(baseContext, 'agency.sales.crm.view.assigned', {
        routePath: '/crm/opportunities/:id',
        params: { id: 'crm-opportunity-1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows assigned quote access through the linked opportunity', async () => {
    const { service, quotesRepository, salesOpportunitiesRepository } =
      createService();
    quotesRepository.findOne.mockResolvedValue({
      id: 'quote-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      createdByUserId: 'user-2',
      opportunityId: 'opportunity-1',
    });
    salesOpportunitiesRepository.findOne.mockResolvedValue({
      id: 'opportunity-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
    });

    await expect(
      service.assertScope(baseContext, 'agency.sales.crm.view.assigned', {
        routePath: '/agency/sales/quotes/:id',
        params: { id: 'quote-1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows reading published knowledge articles', async () => {
    const { service, knowledgeArticlesRepository } = createService();
    knowledgeArticlesRepository.findOne.mockResolvedValue({
      id: 'article-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      status: 'published',
    });

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'agency.knowledge.articles.view.published',
        {
          routePath: '/agency/knowledge/articles/:id',
          params: { id: 'article-1' },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('allows dashboard self overview without a resource id', async () => {
    const { service } = createService();

    await expect(
      service.assertScope(
        { ...baseContext, role: PlatformRoleKey.Member },
        'agency.dashboards.view.self',
        {
          routePath: '/agency/dashboards/overview',
          params: {},
        },
      ),
    ).resolves.toBeUndefined();
  });
});
