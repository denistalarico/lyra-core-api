import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  getPermissionDefinition,
  PermissionDefinition,
} from '../catalog/permission-keys.catalog';
import { PlatformRoleKey } from '../enums/permission.enums';
import {
  PermissionContext,
  PermissionScopeRequest,
} from '../types/permission-context.types';
import { AgencyClientAccessEntity } from '../entities/agency-client-access.entity';
import { AgencyClient } from '../../clients/entities';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import {
  TeamConfigOption,
  TeamDepartment,
  TeamMember,
  TeamPayment,
  TeamSkill,
} from '../../team/entities';
import {
  ContractParty,
  ContractRecord,
  ContractTemplate,
} from '../../contracts/entities';
import { ContractTargetType } from '../../contracts/enums';
import {
  AgencyProject,
  AgencyTask,
  AgencyTaskTimeEntry,
} from '../../projects/entities';
import { CalendarEvent } from '../../calendar/entities/calendar-event.entity';
import { CalendarRoutineBlock } from '../../calendar/entities/calendar-routine-block.entity';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../../crm/entities/crm-stage.entity';
import { CrmTagEntity } from '../../crm/entities/crm-tag.entity';
import { InboxChannelEntity } from '../../inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { WebchatConversationEntity } from '../../webchat/entities/webchat-conversation.entity';
import { WebchatWidgetEntity } from '../../webchat/entities/webchat-widget.entity';
import { ScheduledItemEntity } from '../../appointments/entities/scheduled-item.entity';
import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyMeetingParticipant,
  AgencyMeetingRoom,
} from '../../team-chat/entities';
import {
  AgencySalesActivityEntity,
  AgencySalesItemEntity,
  AgencySalesOpportunityEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from '../../agency/entities/agency-sales.entities';
import { QuoteEntity } from '../../quotes/entities/quote.entities';
import {
  AgencyKnowledgeArticle,
  AgencyKnowledgeCategory,
  AgencyKnowledgeComment,
  AgencyKnowledgeQuickNote,
  AgencyKnowledgeVaultItem,
} from '../../knowledge/entities';
import { AgencyKnowledgeArticleStatus } from '../../knowledge/enums';

const AGENCY_CONNECTION = 'agency';
const TARGET_MODULES = new Set([
  'clients',
  'team',
  'contracts',
  'projects',
  'tasks',
  'calendar',
  'chat',
  'sales',
  'knowledge',
  'dashboards',
  'contacts',
  'inbox',
  'channels',
  'crm',
  'appointments',
]);
const STANDARD_SCOPES = new Set([
  'self',
  'assigned',
  'created_by_me',
  'own',
  'department',
  'client',
  'workspace',
  'tenant',
  'all',
  'published',
  'agency',
  'executive',
  'admin',
  'manager_or_admin',
  'owner_only',
]);

type ResourceSummary = {
  exists: boolean;
  kind: string | null;
  id: string | null;
  record?: unknown;
  collectionSafe?: boolean;
  query?: Record<string, unknown>;
};

function normalizeRole(role: string): PlatformRoleKey {
  if (role === 'owner') return PlatformRoleKey.Owner;
  if (role === 'admin' || role === 'administrator')
    return PlatformRoleKey.Admin;
  if (role === 'manager') return PlatformRoleKey.Manager;
  return PlatformRoleKey.Member;
}

function isElevatedRole(role: string): boolean {
  return [PlatformRoleKey.Owner, PlatformRoleKey.Admin].includes(
    normalizeRole(role),
  );
}

function firstParam(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const [first] = value;
    return typeof first === 'string' ? first : undefined;
  }

  return undefined;
}

@Injectable()
export class PermissionScopeEvaluatorService {
  constructor(
    @InjectRepository(ContactEntity)
    private readonly contactsRepository: Repository<ContactEntity>,
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly agencyContactsRepository: Repository<ContactEntity>,
    @InjectRepository(InboxChannelEntity)
    private readonly inboxChannelsRepository: Repository<InboxChannelEntity>,
    @InjectRepository(InboxConversationEntity)
    private readonly inboxConversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(WebchatConversationEntity)
    private readonly webchatConversationsRepository: Repository<WebchatConversationEntity>,
    @InjectRepository(WebchatWidgetEntity)
    private readonly webchatWidgetsRepository: Repository<WebchatWidgetEntity>,
    @InjectRepository(ScheduledItemEntity)
    private readonly scheduledItemsRepository: Repository<ScheduledItemEntity>,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepository: Repository<AgencyClient>,
    @InjectRepository(AgencyClientAccessEntity, AGENCY_CONNECTION)
    private readonly clientAccessRepository: Repository<AgencyClientAccessEntity>,
    @InjectRepository(TeamMember, AGENCY_CONNECTION)
    private readonly teamMembersRepository: Repository<TeamMember>,
    @InjectRepository(TeamDepartment, AGENCY_CONNECTION)
    private readonly teamDepartmentsRepository: Repository<TeamDepartment>,
    @InjectRepository(TeamSkill, AGENCY_CONNECTION)
    private readonly teamSkillsRepository: Repository<TeamSkill>,
    @InjectRepository(TeamConfigOption, AGENCY_CONNECTION)
    private readonly teamConfigOptionsRepository: Repository<TeamConfigOption>,
    @InjectRepository(TeamPayment, AGENCY_CONNECTION)
    private readonly teamPaymentsRepository: Repository<TeamPayment>,
    @InjectRepository(ContractRecord, AGENCY_CONNECTION)
    private readonly contractsRepository: Repository<ContractRecord>,
    @InjectRepository(ContractParty, AGENCY_CONNECTION)
    private readonly contractPartiesRepository: Repository<ContractParty>,
    @InjectRepository(ContractTemplate, AGENCY_CONNECTION)
    private readonly contractTemplatesRepository: Repository<ContractTemplate>,
    @InjectRepository(AgencyProject, AGENCY_CONNECTION)
    private readonly projectsRepository: Repository<AgencyProject>,
    @InjectRepository(AgencyTask, AGENCY_CONNECTION)
    private readonly tasksRepository: Repository<AgencyTask>,
    @InjectRepository(AgencyTaskTimeEntry, AGENCY_CONNECTION)
    private readonly taskTimeEntriesRepository: Repository<AgencyTaskTimeEntry>,
    @InjectRepository(CalendarEvent, AGENCY_CONNECTION)
    private readonly calendarEventsRepository: Repository<CalendarEvent>,
    @InjectRepository(CalendarRoutineBlock, AGENCY_CONNECTION)
    private readonly calendarRoutineBlocksRepository: Repository<CalendarRoutineBlock>,
    @InjectRepository(CrmOpportunityEntity, AGENCY_CONNECTION)
    private readonly crmOpportunitiesRepository: Repository<CrmOpportunityEntity>,
    @InjectRepository(CrmPipelineEntity, AGENCY_CONNECTION)
    private readonly crmPipelinesRepository: Repository<CrmPipelineEntity>,
    @InjectRepository(CrmStageEntity, AGENCY_CONNECTION)
    private readonly crmStagesRepository: Repository<CrmStageEntity>,
    @InjectRepository(CrmTagEntity, AGENCY_CONNECTION)
    private readonly crmTagsRepository: Repository<CrmTagEntity>,
    @InjectRepository(AgencyChatChannel, AGENCY_CONNECTION)
    private readonly chatChannelsRepository: Repository<AgencyChatChannel>,
    @InjectRepository(AgencyChatChannelMember, AGENCY_CONNECTION)
    private readonly chatChannelMembersRepository: Repository<AgencyChatChannelMember>,
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly chatMessagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyChatAttachment, AGENCY_CONNECTION)
    private readonly chatAttachmentsRepository: Repository<AgencyChatAttachment>,
    @InjectRepository(AgencyMeetingRoom, AGENCY_CONNECTION)
    private readonly meetingRoomsRepository: Repository<AgencyMeetingRoom>,
    @InjectRepository(AgencyMeetingParticipant, AGENCY_CONNECTION)
    private readonly meetingParticipantsRepository: Repository<AgencyMeetingParticipant>,
    @InjectRepository(AgencySalesItemEntity, AGENCY_CONNECTION)
    private readonly salesItemsRepository: Repository<AgencySalesItemEntity>,
    @InjectRepository(AgencySalesPipelineEntity, AGENCY_CONNECTION)
    private readonly salesPipelinesRepository: Repository<AgencySalesPipelineEntity>,
    @InjectRepository(AgencySalesStageEntity, AGENCY_CONNECTION)
    private readonly salesStagesRepository: Repository<AgencySalesStageEntity>,
    @InjectRepository(AgencySalesOpportunityEntity, AGENCY_CONNECTION)
    private readonly salesOpportunitiesRepository: Repository<AgencySalesOpportunityEntity>,
    @InjectRepository(AgencySalesActivityEntity, AGENCY_CONNECTION)
    private readonly salesActivitiesRepository: Repository<AgencySalesActivityEntity>,
    @InjectRepository(QuoteEntity, AGENCY_CONNECTION)
    private readonly quotesRepository: Repository<QuoteEntity>,
    @InjectRepository(AgencyKnowledgeArticle, AGENCY_CONNECTION)
    private readonly knowledgeArticlesRepository: Repository<AgencyKnowledgeArticle>,
    @InjectRepository(AgencyKnowledgeCategory, AGENCY_CONNECTION)
    private readonly knowledgeCategoriesRepository: Repository<AgencyKnowledgeCategory>,
    @InjectRepository(AgencyKnowledgeComment, AGENCY_CONNECTION)
    private readonly knowledgeCommentsRepository: Repository<AgencyKnowledgeComment>,
    @InjectRepository(AgencyKnowledgeQuickNote, AGENCY_CONNECTION)
    private readonly knowledgeQuickNotesRepository: Repository<AgencyKnowledgeQuickNote>,
    @InjectRepository(AgencyKnowledgeVaultItem, AGENCY_CONNECTION)
    private readonly knowledgeVaultItemsRepository: Repository<AgencyKnowledgeVaultItem>,
  ) {}

  async assertScope(
    context: PermissionContext,
    permissionKey: string,
    request?: PermissionScopeRequest,
  ): Promise<void> {
    const definition = getPermissionDefinition(permissionKey);

    if (!definition || !TARGET_MODULES.has(definition.moduleKey)) {
      return;
    }

    const resource = await this.resolveResource(context, definition, request);

    if (resource.id && !resource.exists) {
      throw new ForbiddenException('Requested resource is outside your scope.');
    }

    const scopeKey = definition.scopeKey;

    if (!scopeKey || !STANDARD_SCOPES.has(scopeKey)) {
      return;
    }

    const allowed = await this.evaluateStandardScope(
      context,
      definition,
      scopeKey,
      resource,
    );

    if (!allowed) {
      throw new ForbiddenException('Requested resource is outside your scope.');
    }
  }

  private async evaluateStandardScope(
    context: PermissionContext,
    definition: PermissionDefinition,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (scopeKey === 'all') {
      return true;
    }

    if (
      scopeKey === 'admin' ||
      scopeKey === 'manager_or_admin' ||
      scopeKey === 'owner_only' ||
      scopeKey === 'agency' ||
      scopeKey === 'executive'
    ) {
      return resource.id ? resource.exists : true;
    }

    if (scopeKey === 'tenant') {
      return Boolean(context.tenantId);
    }

    if (scopeKey === 'workspace') {
      return Boolean(context.tenantId && context.workspaceId);
    }

    if (isElevatedRole(context.role)) {
      return resource.id ? resource.exists : true;
    }

    if (definition.moduleKey === 'clients') {
      return this.evaluateClientScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'team') {
      return this.evaluateTeamScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'contracts') {
      return this.evaluateContractScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'projects') {
      return this.evaluateProjectScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'tasks') {
      return this.evaluateTaskScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'calendar') {
      return this.evaluateCalendarScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'chat') {
      return this.evaluateChatScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'inbox') {
      return this.evaluateLeadFlowInboxScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'channels') {
      return this.evaluateLeadFlowChannelScope(scopeKey, resource);
    }

    if (definition.moduleKey === 'crm') {
      return this.evaluateSalesScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'appointments') {
      return this.evaluateLeadFlowAppointmentScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'sales') {
      return this.evaluateSalesScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'knowledge') {
      return this.evaluateKnowledgeScope(context, scopeKey, resource);
    }

    if (definition.moduleKey === 'dashboards') {
      return this.evaluateDashboardScope(scopeKey);
    }

    if (definition.moduleKey === 'contacts') {
      return this.evaluateContactScope(context, scopeKey, resource);
    }

    return Boolean(resource.collectionSafe);
  }

  private async evaluateContactScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (scopeKey === 'assigned') {
      const contact = resource.record as ContactEntity | undefined;

      if (!contact) {
        return false;
      }

      return (
        contact.ownerUserId === context.userId ||
        contact.createdByUserId === context.userId
      );
    }

    if (scopeKey === 'client' || scopeKey === 'department') {
      // TODO(permissions-sprint-8): replace this deny-by-default fallback
      // once contacts carry explicit client/department assignment metadata.
      return false;
    }

    return false;
  }

  private async evaluateClientScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    const client = resource.record as AgencyClient | undefined;

    if (!client) {
      return false;
    }

    if (scopeKey === 'client') {
      return true;
    }

    if (scopeKey === 'assigned') {
      return this.canAccessAssignedClient(context, client);
    }

    if (scopeKey === 'created_by_me' || scopeKey === 'own') {
      return false;
    }

    return false;
  }

  private async evaluateTeamScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (scopeKey === 'self' || scopeKey === 'own') {
      const member = resource.record as TeamMember | undefined;
      return member?.userId === context.userId;
    }

    if (scopeKey === 'created_by_me') {
      const record = resource.record as
        | { createdById?: string | null }
        | undefined;
      return record?.createdById === context.userId;
    }

    if (scopeKey === 'department') {
      const targetMember = await this.resolveTeamMemberForResource(resource);
      return this.canAccessTeamMemberDepartment(context, targetMember);
    }

    return false;
  }

  private async evaluateContractScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    const contract = resource.record as ContractRecord | undefined;

    if (!contract) {
      return false;
    }

    if (scopeKey === 'created_by_me' || scopeKey === 'own') {
      return contract.createdById === context.userId;
    }

    if (scopeKey === 'self') {
      return this.isOwnTeamMemberContract(context, contract);
    }

    if (scopeKey === 'client') {
      return this.isClientContractInScope(context, contract);
    }

    if (scopeKey === 'assigned' || scopeKey === 'department') {
      return this.canAccessAssignedContract(context, contract);
    }

    return false;
  }

  private async evaluateProjectScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (resource.kind === 'project_preferences') {
      return scopeKey === 'assigned';
    }

    const project = resource.record as AgencyProject | undefined;

    if (!project) {
      return false;
    }

    if (scopeKey === 'own' || scopeKey === 'assigned') {
      if (project.ownerId === context.userId) {
        return true;
      }

      if (project.clientId && context.workspaceId) {
        const client = await this.clientsRepository.findOne({
          where: {
            id: project.clientId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        });
        return client ? this.canAccessAssignedClient(context, client) : false;
      }
    }

    if (scopeKey === 'department') {
      return project.ownerId
        ? this.canAccessUserDepartment(context, project.ownerId)
        : false;
    }

    if (scopeKey === 'client') {
      return Boolean(project.clientId);
    }

    return false;
  }

  private async evaluateTaskScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (resource.kind === 'task_collection') {
      return scopeKey === 'self' || scopeKey === 'assigned';
    }

    if (resource.kind === 'task_create') {
      const body = resource.record as
        | Record<string, unknown>
        | null
        | undefined;
      const assigneeId =
        typeof body?.assigneeId === 'string' ? body.assigneeId : null;

      if (scopeKey === 'assigned') {
        return !assigneeId || assigneeId === context.userId;
      }

      if (scopeKey === 'department') {
        return assigneeId
          ? this.canAccessUserDepartment(context, assigneeId)
          : true;
      }
    }

    if (resource.kind === 'task_time_entry') {
      const entry = resource.record as AgencyTaskTimeEntry | undefined;
      return scopeKey === 'self' && entry?.userId === context.userId;
    }

    const task = resource.record as AgencyTask | undefined;

    if (!task) {
      return false;
    }

    if (
      scopeKey === 'self' ||
      scopeKey === 'assigned' ||
      scopeKey === 'created_by_me' ||
      scopeKey === 'own'
    ) {
      return (
        task.assigneeId === context.userId ||
        task.createdById === context.userId
      );
    }

    if (scopeKey === 'department') {
      if (
        task.assigneeId &&
        (await this.canAccessUserDepartment(context, task.assigneeId))
      ) {
        return true;
      }

      return task.createdById
        ? this.canAccessUserDepartment(context, task.createdById)
        : false;
    }

    if (scopeKey === 'client') {
      return Boolean(task.clientId);
    }

    return false;
  }

  private async evaluateCalendarScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (scopeKey === 'all') {
      return true;
    }

    if (resource.kind === 'calendar_event_create') {
      const body = resource.record as
        | Record<string, unknown>
        | null
        | undefined;
      const ownerUserId =
        typeof body?.ownerUserId === 'string' ? body.ownerUserId : null;

      if (scopeKey === 'self') {
        return !ownerUserId || ownerUserId === context.userId;
      }

      if (scopeKey === 'department') {
        return ownerUserId
          ? this.canAccessUserDepartment(context, ownerUserId)
          : true;
      }
    }

    if (resource.kind === 'calendar_event') {
      const event = resource.record as CalendarEvent | undefined;
      if (!event) return false;

      if (scopeKey === 'self') {
        return (
          event.ownerUserId === context.userId ||
          event.createdByUserId === context.userId
        );
      }

      if (scopeKey === 'department') {
        return event.ownerUserId
          ? this.canAccessUserDepartment(context, event.ownerUserId)
          : false;
      }
    }

    if (
      resource.kind === 'calendar_routine_block' ||
      resource.kind === 'calendar_routine_block_collection'
    ) {
      const block = resource.record as CalendarRoutineBlock | undefined;

      if (scopeKey === 'self') {
        return !block || block.userId === context.userId;
      }

      if (scopeKey === 'department') {
        return block?.userId
          ? this.canAccessUserDepartment(context, block.userId)
          : true;
      }
    }

    return false;
  }

  private async evaluateChatScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (scopeKey === 'all') {
      return true;
    }

    if (resource.kind === 'chat_settings') {
      return scopeKey === 'assigned';
    }

    if (resource.kind === 'chat_direct') {
      const body = resource.record as
        | Record<string, unknown>
        | null
        | undefined;
      const targetUserId =
        typeof body?.targetUserId === 'string' ? body.targetUserId : null;

      return scopeKey === 'assigned' && Boolean(targetUserId);
    }

    if (
      resource.kind === 'chat_channel_create' ||
      resource.kind === 'chat_meeting_create'
    ) {
      if (scopeKey !== 'department') {
        return false;
      }

      return this.canAccessRelatedWorkItem(context, resource.record);
    }

    if (resource.kind === 'chat_attachment_create') {
      if (scopeKey !== 'assigned') {
        return false;
      }

      const body = resource.record as
        | Record<string, unknown>
        | null
        | undefined;
      const messageId =
        typeof body?.messageId === 'string' ? body.messageId : null;
      const meetingRoomId =
        typeof body?.meetingRoomId === 'string' ? body.meetingRoomId : null;

      if (messageId) {
        const message = await this.chatMessagesRepository.findOne({
          where: {
            id: messageId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        });
        return message?.channelId
          ? this.isChatChannelParticipant(context, message.channelId)
          : false;
      }

      if (meetingRoomId) {
        return this.isMeetingParticipant(context, meetingRoomId);
      }

      return false;
    }

    if (resource.kind === 'chat_channel') {
      const channel = resource.record as AgencyChatChannel | undefined;
      if (!channel) return false;

      if (scopeKey === 'assigned') {
        return this.isChatChannelParticipant(context, channel.id);
      }

      if (scopeKey === 'department') {
        return channel.createdById
          ? this.canAccessUserDepartment(context, channel.createdById)
          : false;
      }
    }

    if (resource.kind === 'chat_message') {
      const message = resource.record as AgencyChatMessage | undefined;
      if (!message) return false;

      if (scopeKey === 'assigned') {
        return message.channelId
          ? this.isChatChannelParticipant(context, message.channelId)
          : false;
      }

      if (scopeKey === 'self' || scopeKey === 'own') {
        return message.senderUserId === context.userId;
      }
    }

    if (resource.kind === 'chat_attachment') {
      const attachment = resource.record as AgencyChatAttachment | undefined;
      if (!attachment) return false;

      if (scopeKey === 'assigned') {
        if (attachment.messageId) {
          const message = await this.chatMessagesRepository.findOne({
            where: {
              id: attachment.messageId,
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
            },
          });
          return message?.channelId
            ? this.isChatChannelParticipant(context, message.channelId)
            : false;
        }

        if (attachment.meetingRoomId) {
          return this.isMeetingParticipant(context, attachment.meetingRoomId);
        }
      }

      if (scopeKey === 'self' || scopeKey === 'own') {
        return attachment.uploadedById === context.userId;
      }
    }

    if (resource.kind === 'chat_meeting') {
      const meeting = resource.record as AgencyMeetingRoom | undefined;
      if (!meeting) return false;

      if (scopeKey === 'assigned') {
        if (meeting.hostUserId === context.userId) {
          return true;
        }

        if (
          meeting.channelId &&
          (await this.isChatChannelParticipant(context, meeting.channelId))
        ) {
          return true;
        }

        return this.isMeetingParticipant(context, meeting.id);
      }

      if (scopeKey === 'department') {
        return meeting.hostUserId
          ? this.canAccessUserDepartment(context, meeting.hostUserId)
          : false;
      }
    }

    return false;
  }

  private async evaluateLeadFlowInboxScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (
      resource.kind === 'leadflow_conversation_collection' ||
      resource.kind === 'leadflow_conversation_create'
    ) {
      if (scopeKey === 'client') {
        return true;
      }

      if (scopeKey === 'assigned') {
        return firstParam(resource.query?.assignedUserId) === context.userId;
      }
    }

    if (resource.kind === 'leadflow_conversation') {
      const conversation = resource.record as
        | InboxConversationEntity
        | WebchatConversationEntity
        | undefined;

      if (!conversation) {
        return false;
      }

      if (scopeKey === 'client') {
        return true;
      }

      if (scopeKey === 'assigned') {
        return conversation.assignedUserId === context.userId;
      }
    }

    return false;
  }

  private evaluateLeadFlowChannelScope(
    scopeKey: string,
    resource: ResourceSummary,
  ): boolean {
    if (
      resource.kind === 'leadflow_channel_collection' ||
      resource.kind === 'leadflow_widget_collection' ||
      resource.kind === 'leadflow_channel_create'
    ) {
      return scopeKey === 'client';
    }

    if (
      resource.kind === 'leadflow_channel' ||
      resource.kind === 'leadflow_widget'
    ) {
      return scopeKey === 'client' && Boolean(resource.record);
    }

    return false;
  }

  private async evaluateLeadFlowAppointmentScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (
      resource.kind === 'leadflow_appointment_collection' ||
      resource.kind === 'leadflow_appointment_create'
    ) {
      if (scopeKey === 'client') {
        return true;
      }

      if (scopeKey === 'assigned') {
        return firstParam(resource.query?.assignedUserId) === context.userId;
      }
    }

    if (resource.kind === 'leadflow_appointment') {
      const appointment = resource.record as ScheduledItemEntity | undefined;

      if (!appointment) {
        return false;
      }

      if (scopeKey === 'client') {
        return true;
      }

      if (scopeKey === 'assigned') {
        return (
          appointment.assignedUserId === context.userId ||
          appointment.ownerUserId === context.userId ||
          appointment.createdByUserId === context.userId
        );
      }
    }

    return false;
  }

  private async evaluateSalesScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (resource.kind === 'sales_collection') {
      return scopeKey === 'department' || scopeKey === 'client';
    }

    if (resource.kind === 'sales_opportunity_create') {
      const body = resource.record as
        | Record<string, unknown>
        | null
        | undefined;
      const ownerUserId =
        typeof body?.ownerUserId === 'string' ? body.ownerUserId : null;
      const assignedUserId =
        typeof body?.assignedUserId === 'string'
          ? body.assignedUserId
          : ownerUserId;

      if (scopeKey === 'assigned') {
        return !assignedUserId || assignedUserId === context.userId;
      }

      if (scopeKey === 'client') {
        return true;
      }

      if (scopeKey === 'department') {
        return assignedUserId
          ? this.canAccessUserDepartment(context, assignedUserId)
          : true;
      }
    }

    if (resource.kind === 'sales_activity') {
      const activity = resource.record as AgencySalesActivityEntity | undefined;
      if (!activity) return false;

      if (scopeKey === 'assigned') {
        return activity.assignedUserId === context.userId;
      }

      if (scopeKey === 'department') {
        return activity.assignedUserId
          ? this.canAccessUserDepartment(context, activity.assignedUserId)
          : this.evaluateSalesOpportunityIdScope(
              context,
              scopeKey,
              activity.opportunityId,
            );
      }
    }

    if (resource.kind === 'sales_quote') {
      const quote = resource.record as QuoteEntity | undefined;
      if (!quote) return false;

      if (scopeKey === 'assigned') {
        if (quote.createdByUserId === context.userId) {
          return true;
        }

        return quote.opportunityId
          ? this.evaluateSalesOpportunityIdScope(
              context,
              scopeKey,
              quote.opportunityId,
            )
          : false;
      }

      if (scopeKey === 'department') {
        if (
          quote.createdByUserId &&
          (await this.canAccessUserDepartment(context, quote.createdByUserId))
        ) {
          return true;
        }

        return quote.opportunityId
          ? this.evaluateSalesOpportunityIdScope(
              context,
              scopeKey,
              quote.opportunityId,
            )
          : false;
      }
    }

    if (resource.kind === 'crm_opportunity') {
      const opportunity = resource.record as CrmOpportunityEntity | undefined;
      if (!opportunity) return false;

      if (scopeKey === 'assigned') {
        return opportunity.assignedUserId === context.userId;
      }

      if (scopeKey === 'client') {
        return true;
      }

      if (scopeKey === 'department') {
        return opportunity.assignedUserId
          ? this.canAccessUserDepartment(context, opportunity.assignedUserId)
          : true;
      }
    }

    if (
      resource.kind === 'crm_pipeline' ||
      resource.kind === 'crm_stage' ||
      resource.kind === 'crm_tag'
    ) {
      return scopeKey === 'department' || scopeKey === 'client';
    }

    const opportunity = resource.record as
      | AgencySalesOpportunityEntity
      | undefined;

    if (!opportunity) {
      return false;
    }

    if (scopeKey === 'assigned') {
      return opportunity.ownerUserId === context.userId;
    }

    if (scopeKey === 'department') {
      return opportunity.ownerUserId
        ? this.canAccessUserDepartment(context, opportunity.ownerUserId)
        : false;
    }

    return false;
  }

  private async evaluateKnowledgeScope(
    context: PermissionContext,
    scopeKey: string,
    resource: ResourceSummary,
  ): Promise<boolean> {
    if (scopeKey === 'published') {
      if (resource.kind === 'knowledge_article_collection') {
        const status = firstParam(resource.query?.status);
        return status === AgencyKnowledgeArticleStatus.PUBLISHED;
      }

      if (resource.kind === 'knowledge_article') {
        const article = resource.record as AgencyKnowledgeArticle | undefined;
        return article?.status === AgencyKnowledgeArticleStatus.PUBLISHED;
      }

      if (resource.kind === 'knowledge_comment') {
        const comment = resource.record as AgencyKnowledgeComment | undefined;
        return comment
          ? this.isPublishedKnowledgeArticle(context, comment.articleId)
          : false;
      }

      if (resource.kind === 'knowledge_note_collection') {
        return true;
      }

      if (resource.kind === 'knowledge_category_collection') {
        return true;
      }
    }

    if (scopeKey === 'department') {
      if (
        resource.kind === 'knowledge_article_collection' ||
        resource.kind === 'knowledge_article_create'
      ) {
        return true;
      }

      if (resource.kind === 'knowledge_article') {
        const article = resource.record as AgencyKnowledgeArticle | undefined;
        if (!article) return false;
        return (
          article.authorId === context.userId ||
          Boolean(
            article.ownerId &&
            (await this.canAccessUserDepartment(context, article.ownerId)),
          )
        );
      }
    }

    if (resource.kind === 'knowledge_comment') {
      const comment = resource.record as AgencyKnowledgeComment | undefined;
      return comment?.authorId === context.userId;
    }

    if (resource.kind === 'knowledge_quick_note') {
      const note = resource.record as AgencyKnowledgeQuickNote | undefined;
      return note?.authorId === context.userId;
    }

    if (resource.kind === 'knowledge_note_collection') {
      return true;
    }

    return false;
  }

  private evaluateDashboardScope(scopeKey: string): boolean {
    return (
      scopeKey === 'self' ||
      scopeKey === 'department' ||
      scopeKey === 'agency' ||
      scopeKey === 'executive'
    );
  }

  private async resolveResource(
    context: PermissionContext,
    definition: PermissionDefinition,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};

    if (definition.moduleKey === 'clients') {
      return this.resolveClientResource(
        context,
        firstParam(params.clientId) ?? firstParam(params.id),
      );
    }

    if (definition.moduleKey === 'team') {
      return this.resolveTeamResource(context, request);
    }

    if (definition.moduleKey === 'contracts') {
      return this.resolveContractResource(context, request);
    }

    if (definition.moduleKey === 'projects') {
      return this.resolveProjectResource(context, request);
    }

    if (definition.moduleKey === 'tasks') {
      return this.resolveTaskResource(context, request);
    }

    if (definition.moduleKey === 'calendar') {
      return this.resolveCalendarResource(context, request);
    }

    if (definition.moduleKey === 'chat') {
      return this.resolveChatResource(context, request);
    }

    if (definition.moduleKey === 'inbox') {
      return this.resolveLeadFlowInboxResource(context, request);
    }

    if (definition.moduleKey === 'channels') {
      return this.resolveLeadFlowChannelResource(context, request);
    }

    if (definition.moduleKey === 'crm') {
      return this.resolveSalesResource(context, request);
    }

    if (definition.moduleKey === 'appointments') {
      return this.resolveLeadFlowAppointmentResource(context, request);
    }

    if (definition.moduleKey === 'sales') {
      return this.resolveSalesResource(context, request);
    }

    if (definition.moduleKey === 'knowledge') {
      return this.resolveKnowledgeResource(context, request);
    }

    if (definition.moduleKey === 'dashboards') {
      return {
        exists: false,
        kind: 'dashboard',
        id: null,
        collectionSafe: true,
      };
    }

    if (definition.moduleKey === 'contacts') {
      return this.resolveContactResource(context, request);
    }

    return { exists: false, kind: null, id: null };
  }

  private async resolveContactResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const query = request?.query ?? {};
    const path = request?.routePath ?? '';
    const contactId =
      firstParam(params.contactId) ??
      firstParam(params.id) ??
      (typeof query.contactId === 'string' ? query.contactId : undefined);

    if (!contactId) {
      return { exists: false, kind: 'contact', id: null };
    }

    if (!context.workspaceId) {
      return { exists: false, kind: 'contact', id: contactId };
    }

    const repository = path.includes('agency/contacts')
      ? this.agencyContactsRepository
      : this.contactsRepository;
    const contact = await repository.findOne({
      where: {
        id: contactId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return {
      exists: Boolean(contact),
      kind: 'contact',
      id: contactId,
      record: contact ?? null,
    };
  }

  private async resolveClientResource(
    context: PermissionContext,
    clientId?: string,
  ): Promise<ResourceSummary> {
    if (!clientId) {
      return { exists: false, kind: 'client', id: null };
    }

    if (!context.workspaceId) {
      return { exists: false, kind: 'client', id: clientId };
    }

    const client = await this.clientsRepository.findOne({
      where: {
        id: clientId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return {
      exists: Boolean(client),
      kind: 'client',
      id: clientId,
      record: client ?? null,
    };
  }

  private async resolveTeamResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const path = request?.routePath ?? '';
    const id = firstParam(params.id);

    if (path.includes('members/:id') && id) {
      return this.resolveTeamMemberResource(context, id);
    }

    if (path.includes('departments/:id') && id) {
      if (!context.workspaceId) {
        return { exists: false, kind: 'team_department', id };
      }

      const department = await this.teamDepartmentsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(department),
        kind: 'team_department',
        id,
        record: department ?? null,
      };
    }

    if (path.includes('skills/:id') && id) {
      if (!context.workspaceId) {
        return { exists: false, kind: 'team_skill', id };
      }

      const skill = await this.teamSkillsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(skill),
        kind: 'team_skill',
        id,
        record: skill ?? null,
      };
    }

    if (path.includes('config-options/:id') && id) {
      if (!context.workspaceId) {
        return { exists: false, kind: 'team_config_option', id };
      }

      const option = await this.teamConfigOptionsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(option),
        kind: 'team_config_option',
        id,
        record: option ?? null,
      };
    }

    if (id) {
      if (!context.workspaceId) {
        return { exists: false, kind: 'team_payment', id };
      }

      const payment = await this.teamPaymentsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(payment),
        kind: 'team_payment',
        id,
        record: payment ?? null,
      };
    }

    return { exists: false, kind: 'team', id: null };
  }

  private async resolveTeamMemberResource(
    context: PermissionContext,
    memberId: string,
  ): Promise<ResourceSummary> {
    if (!context.workspaceId) {
      return { exists: false, kind: 'team_member', id: memberId };
    }

    const member = await this.teamMembersRepository.findOne({
      where: {
        id: memberId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return {
      exists: Boolean(member),
      kind: 'team_member',
      id: memberId,
      record: member ?? null,
    };
  }

  private async resolveContractResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const path = request?.routePath ?? '';
    const id = firstParam(params.id);

    if (!id) {
      return { exists: false, kind: 'contract', id: null };
    }

    if (!context.workspaceId) {
      return { exists: false, kind: 'contract', id };
    }

    if (path.includes('templates/:id')) {
      const template = await this.contractTemplatesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(template),
        kind: 'contract_template',
        id,
        record: template ?? null,
      };
    }

    const contract = await this.contractsRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return {
      exists: Boolean(contract),
      kind: 'contract',
      id,
      record: contract ?? null,
    };
  }

  private async resolveProjectResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const path = request?.routePath ?? '';
    const projectId = firstParam(params.projectId) ?? firstParam(params.id);

    if (path.includes('/preferences')) {
      return {
        exists: false,
        kind: 'project_preferences',
        id: null,
        collectionSafe: true,
      };
    }

    if (!projectId) {
      return { exists: false, kind: 'project', id: null };
    }

    if (!context.workspaceId) {
      return { exists: false, kind: 'project', id: projectId };
    }

    const project = await this.projectsRepository.findOne({
      where: {
        id: projectId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return {
      exists: Boolean(project),
      kind: 'project',
      id: projectId,
      record: project ?? null,
    };
  }

  private async resolveTaskResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const path = request?.routePath ?? '';
    const entryId = firstParam(params.entryId);
    const taskId = firstParam(params.taskId) ?? firstParam(params.id);

    if (
      path.includes('tasks/my') ||
      path.includes('my-task-stages') ||
      path.includes('time-entries/stop-active')
    ) {
      return {
        exists: false,
        kind: 'task_collection',
        id: null,
        collectionSafe: true,
      };
    }

    if (request?.method === 'POST' && path.endsWith('/tasks')) {
      return {
        exists: false,
        kind: 'task_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if (entryId) {
      if (!context.workspaceId) {
        return { exists: false, kind: 'task_time_entry', id: entryId };
      }

      const entry = await this.taskTimeEntriesRepository.findOne({
        where: {
          id: entryId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(entry),
        kind: 'task_time_entry',
        id: entryId,
        record: entry ?? null,
      };
    }

    if (!taskId) {
      return { exists: false, kind: 'task', id: null };
    }

    if (!context.workspaceId) {
      return { exists: false, kind: 'task', id: taskId };
    }

    const task = await this.tasksRepository.findOne({
      where: {
        id: taskId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return {
      exists: Boolean(task),
      kind: 'task',
      id: taskId,
      record: task ?? null,
    };
  }

  private async resolveCalendarResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const path = request?.routePath ?? '';
    const eventId = firstParam(params.eventId);
    const blockId = firstParam(params.blockId);

    if (eventId) {
      const event = await this.calendarEventsRepository.findOne({
        where: {
          id: eventId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId ?? IsNull(),
        },
      });

      return {
        exists: Boolean(event),
        kind: 'calendar_event',
        id: eventId,
        record: event ?? null,
      };
    }

    if (blockId) {
      const block = await this.calendarRoutineBlocksRepository.findOne({
        where: {
          id: blockId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId ?? IsNull(),
        },
      });

      return {
        exists: Boolean(block),
        kind: 'calendar_routine_block',
        id: blockId,
        record: block ?? null,
      };
    }

    if (path.includes('routine-blocks')) {
      return {
        exists: false,
        kind: 'calendar_routine_block_collection',
        id: null,
        collectionSafe: true,
        record: request?.body ?? null,
      };
    }

    if (request?.method === 'POST' && path.includes('events')) {
      return {
        exists: false,
        kind: 'calendar_event_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    return { exists: false, kind: 'calendar_event', id: null };
  }

  private async resolveChatResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const channelId = firstParam(params.channelId);
    const messageId = firstParam(params.messageId);
    const attachmentId = firstParam(params.attachmentId);
    const meetingId = firstParam(params.meetingId);

    if (!context.workspaceId) {
      return {
        exists: false,
        kind: 'chat',
        id: channelId ?? messageId ?? attachmentId ?? meetingId ?? null,
      };
    }

    if (
      request?.method === 'POST' &&
      (request.routePath ?? '').endsWith('/channels/direct')
    ) {
      return {
        exists: false,
        kind: 'chat_direct',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if (
      request?.method === 'POST' &&
      (request.routePath ?? '').endsWith('/channels')
    ) {
      return {
        exists: false,
        kind: 'chat_channel_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if (
      request?.method === 'POST' &&
      (request.routePath ?? '').endsWith('/meetings')
    ) {
      return {
        exists: false,
        kind: 'chat_meeting_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if ((request?.routePath ?? '').includes('/settings')) {
      return {
        exists: false,
        kind: 'chat_settings',
        id: null,
        collectionSafe: true,
      };
    }

    if (
      request?.method === 'POST' &&
      (request.routePath ?? '').endsWith('/attachments')
    ) {
      return {
        exists: false,
        kind: 'chat_attachment_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if (attachmentId) {
      const attachment = await this.chatAttachmentsRepository.findOne({
        where: {
          id: attachmentId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(attachment),
        kind: 'chat_attachment',
        id: attachmentId,
        record: attachment ?? null,
      };
    }

    if (messageId) {
      const message = await this.chatMessagesRepository.findOne({
        where: {
          id: messageId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(message),
        kind: 'chat_message',
        id: messageId,
        record: message ?? null,
      };
    }

    if (meetingId) {
      const meeting = await this.meetingRoomsRepository.findOne({
        where: {
          id: meetingId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(meeting),
        kind: 'chat_meeting',
        id: meetingId,
        record: meeting ?? null,
      };
    }

    if (channelId) {
      const channel = await this.chatChannelsRepository.findOne({
        where: {
          id: channelId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(channel),
        kind: 'chat_channel',
        id: channelId,
        record: channel ?? null,
      };
    }

    return { exists: false, kind: 'chat', id: null };
  }

  private async resolveLeadFlowInboxResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const body = (request?.body ?? {}) as Record<string, unknown>;
    const query = request?.query ?? {};
    const path = request?.routePath ?? '';
    const conversationId =
      firstParam(params.conversationId) ??
      firstParam(params.id) ??
      (typeof body.conversationId === 'string'
        ? body.conversationId
        : undefined);

    if (
      request?.method === 'POST' &&
      path.endsWith('/conversations') &&
      !conversationId
    ) {
      return {
        exists: false,
        kind: 'leadflow_conversation_create',
        id: null,
        collectionSafe: true,
        query,
        record: request.body ?? null,
      };
    }

    if (!conversationId) {
      return {
        exists: false,
        kind: 'leadflow_conversation_collection',
        id: null,
        collectionSafe: true,
        query,
      };
    }

    if (!context.workspaceId) {
      return {
        exists: false,
        kind: 'leadflow_conversation',
        id: conversationId,
      };
    }

    const inboxConversation = await this.inboxConversationsRepository.findOne({
      where: {
        id: conversationId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (inboxConversation) {
      return {
        exists: true,
        kind: 'leadflow_conversation',
        id: conversationId,
        record: inboxConversation,
      };
    }

    const webchatConversation =
      await this.webchatConversationsRepository.findOne({
        where: {
          id: conversationId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

    return {
      exists: Boolean(webchatConversation),
      kind: 'leadflow_conversation',
      id: conversationId,
      record: webchatConversation ?? null,
    };
  }

  private async resolveLeadFlowChannelResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const body = (request?.body ?? {}) as Record<string, unknown>;
    const path = request?.routePath ?? '';
    const widgetId = firstParam(params.widgetId);
    const channelId =
      firstParam(params.channelId) ??
      firstParam(params.id) ??
      (typeof body.channelId === 'string' ? body.channelId : undefined);

    if (request?.method === 'POST' && !channelId && !widgetId) {
      return {
        exists: false,
        kind: 'leadflow_channel_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if (!context.workspaceId) {
      return {
        exists: false,
        kind: widgetId ? 'leadflow_widget' : 'leadflow_channel',
        id: widgetId ?? channelId ?? null,
      };
    }

    if (widgetId) {
      const widget = await this.webchatWidgetsRepository.findOne({
        where: {
          id: widgetId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(widget),
        kind: 'leadflow_widget',
        id: widgetId,
        record: widget ?? null,
      };
    }

    if (channelId) {
      const channel = await this.inboxChannelsRepository.findOne({
        where: {
          id: channelId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(channel),
        kind: 'leadflow_channel',
        id: channelId,
        record: channel ?? null,
      };
    }

    return {
      exists: false,
      kind: path.includes('widgets')
        ? 'leadflow_widget_collection'
        : 'leadflow_channel_collection',
      id: null,
      collectionSafe: true,
    };
  }

  private async resolveLeadFlowAppointmentResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const query = request?.query ?? {};
    const id = firstParam(params.id);

    if (request?.method === 'POST' && !id) {
      return {
        exists: false,
        kind: 'leadflow_appointment_create',
        id: null,
        collectionSafe: true,
        query,
        record: request.body ?? null,
      };
    }

    if (!id) {
      return {
        exists: false,
        kind: 'leadflow_appointment_collection',
        id: null,
        collectionSafe: true,
        query,
      };
    }

    if (!context.workspaceId) {
      return { exists: false, kind: 'leadflow_appointment', id };
    }

    const appointment = await this.scheduledItemsRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return {
      exists: Boolean(appointment),
      kind: 'leadflow_appointment',
      id,
      record: appointment ?? null,
    };
  }

  private async resolveSalesResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const path = request?.routePath ?? '';
    const id = firstParam(params.id);
    const activityId = firstParam(params.activityId);

    if (
      request?.method === 'POST' &&
      (path.endsWith('/opportunities') || path.endsWith('/opportunities/quick'))
    ) {
      return {
        exists: false,
        kind: 'sales_opportunity_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if (!context.workspaceId) {
      return { exists: false, kind: 'sales', id: activityId ?? id ?? null };
    }

    if (activityId) {
      const activity = await this.salesActivitiesRepository.findOne({
        where: {
          id: activityId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(activity),
        kind: 'sales_activity',
        id: activityId,
        record: activity ?? null,
      };
    }

    if (path.includes('crm/opportunities') && id) {
      const opportunity = await this.crmOpportunitiesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(opportunity),
        kind: 'crm_opportunity',
        id,
        record: opportunity ?? null,
      };
    }

    if (path.includes('crm/pipelines') && id) {
      const pipeline = await this.crmPipelinesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(pipeline),
        kind: 'crm_pipeline',
        id,
        record: pipeline ?? null,
      };
    }

    if (path.includes('crm/stages') && id) {
      const stage = await this.crmStagesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(stage),
        kind: 'crm_stage',
        id,
        record: stage ?? null,
      };
    }

    if (path.includes('crm/tags') && id) {
      const tag = await this.crmTagsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(tag),
        kind: 'crm_tag',
        id,
        record: tag ?? null,
      };
    }

    if (path.includes('quotes') && id) {
      const quote = await this.quotesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(quote),
        kind: 'sales_quote',
        id,
        record: quote ?? null,
      };
    }

    if (path.includes('opportunities') && id) {
      const opportunity = await this.salesOpportunitiesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      if (!opportunity) {
        const crmOpportunity = await this.crmOpportunitiesRepository.findOne({
          where: {
            id,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        });

        return {
          exists: Boolean(crmOpportunity),
          kind: 'crm_opportunity',
          id,
          record: crmOpportunity ?? null,
        };
      }

      return {
        exists: Boolean(opportunity),
        kind: 'sales_opportunity',
        id,
        record: opportunity ?? null,
      };
    }

    if (path.includes('pipelines') && id) {
      const pipeline = await this.salesPipelinesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      if (!pipeline) {
        const crmPipeline = await this.crmPipelinesRepository.findOne({
          where: {
            id,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        });

        return {
          exists: Boolean(crmPipeline),
          kind: 'crm_pipeline',
          id,
          record: crmPipeline ?? null,
        };
      }

      return {
        exists: Boolean(pipeline),
        kind: 'sales_pipeline',
        id,
        record: pipeline ?? null,
      };
    }

    if (path.includes('stages') && id) {
      const stage = await this.salesStagesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      if (!stage) {
        const crmStage = await this.crmStagesRepository.findOne({
          where: {
            id,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        });

        return {
          exists: Boolean(crmStage),
          kind: 'crm_stage',
          id,
          record: crmStage ?? null,
        };
      }

      return {
        exists: Boolean(stage),
        kind: 'sales_stage',
        id,
        record: stage ?? null,
      };
    }

    if (path.includes('tags') && id) {
      const tag = await this.crmTagsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(tag),
        kind: 'crm_tag',
        id,
        record: tag ?? null,
      };
    }

    if (path.includes('items') && id) {
      const item = await this.salesItemsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(item),
        kind: 'sales_item',
        id,
        record: item ?? null,
      };
    }

    if (
      path.includes('opportunities') ||
      path.includes('pipelines') ||
      path.includes('stages') ||
      path.includes('tags')
    ) {
      return { exists: false, kind: 'sales_collection', id: null };
    }

    return { exists: false, kind: 'sales', id: null, collectionSafe: true };
  }

  private async resolveKnowledgeResource(
    context: PermissionContext,
    request?: PermissionScopeRequest,
  ): Promise<ResourceSummary> {
    const params = request?.params ?? {};
    const path = request?.routePath ?? '';
    const id = firstParam(params.id);
    const articleId = firstParam(params.articleId);
    const commentId = firstParam(params.commentId);

    if (request?.method === 'POST' && path.endsWith('/articles')) {
      return {
        exists: false,
        kind: 'knowledge_article_create',
        id: null,
        collectionSafe: true,
        record: request.body ?? null,
      };
    }

    if (!context.workspaceId) {
      return {
        exists: false,
        kind: 'knowledge',
        id: commentId ?? articleId ?? id ?? null,
      };
    }

    if (commentId) {
      const comment = await this.knowledgeCommentsRepository.findOne({
        where: {
          id: commentId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(comment),
        kind: 'knowledge_comment',
        id: commentId,
        record: comment ?? null,
      };
    }

    if (articleId ?? (path.includes('articles') ? id : null)) {
      const resolvedArticleId = articleId ?? id;
      const article = await this.knowledgeArticlesRepository.findOne({
        where: {
          id: resolvedArticleId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(article),
        kind: 'knowledge_article',
        id: resolvedArticleId ?? null,
        record: article ?? null,
      };
    }

    if (path.includes('categories') && id) {
      const category = await this.knowledgeCategoriesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(category),
        kind: 'knowledge_category',
        id,
        record: category ?? null,
      };
    }

    if (path.includes('categories')) {
      return {
        exists: false,
        kind: 'knowledge_category_collection',
        id: null,
        collectionSafe: true,
      };
    }

    if (path.includes('notes') && id) {
      const note = await this.knowledgeQuickNotesRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(note),
        kind: 'knowledge_quick_note',
        id,
        record: note ?? null,
      };
    }

    if (path.includes('vault') && id) {
      const item = await this.knowledgeVaultItemsRepository.findOne({
        where: {
          id,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return {
        exists: Boolean(item),
        kind: 'knowledge_vault_item',
        id,
        record: item ?? null,
      };
    }

    if (path.includes('notes')) {
      return {
        exists: false,
        kind: 'knowledge_note_collection',
        id: null,
        collectionSafe: true,
      };
    }

    if (path.includes('articles')) {
      return {
        exists: false,
        kind: 'knowledge_article_collection',
        id: null,
        query: request?.query,
      };
    }

    return { exists: false, kind: 'knowledge', id: null, collectionSafe: true };
  }

  private async canAccessAssignedClient(
    context: PermissionContext,
    client: AgencyClient,
  ): Promise<boolean> {
    if (client.accountOwnerId === context.userId) {
      return true;
    }

    if (!context.workspaceId) {
      return false;
    }

    const access = await this.clientAccessRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        clientId: client.id,
        userId: context.userId,
      },
    });

    return Boolean(access);
  }

  private async resolveCurrentTeamMember(
    context: PermissionContext,
  ): Promise<TeamMember | null> {
    if (!context.workspaceId) {
      return null;
    }

    return this.teamMembersRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });
  }

  private async resolveTeamMemberForResource(
    resource: ResourceSummary,
  ): Promise<TeamMember | null> {
    if (resource.kind === 'team_member') {
      return (resource.record as TeamMember | null | undefined) ?? null;
    }

    if (resource.kind === 'team_payment') {
      const payment = resource.record as TeamPayment | null | undefined;
      if (!payment) return null;

      return this.teamMembersRepository.findOne({
        where: {
          id: payment.memberId,
          tenantId: payment.tenantId,
          workspaceId: payment.workspaceId,
        },
      });
    }

    return null;
  }

  private async canAccessTeamMemberDepartment(
    context: PermissionContext,
    targetMember: TeamMember | null,
  ): Promise<boolean> {
    if (!targetMember) {
      return false;
    }

    const actorMember = await this.resolveCurrentTeamMember(context);

    if (!actorMember) {
      return false;
    }

    if (targetMember.id === actorMember.id) {
      return true;
    }

    if (targetMember.managerMemberId === actorMember.id) {
      return true;
    }

    return Boolean(
      actorMember.departmentId &&
      targetMember.departmentId &&
      actorMember.departmentId === targetMember.departmentId,
    );
  }

  private async canAccessUserDepartment(
    context: PermissionContext,
    targetUserId: string,
  ): Promise<boolean> {
    if (targetUserId === context.userId) {
      return true;
    }

    if (!context.workspaceId) {
      return false;
    }

    const targetMember = await this.teamMembersRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: targetUserId,
      },
    });

    return this.canAccessTeamMemberDepartment(context, targetMember);
  }

  private async evaluateSalesOpportunityIdScope(
    context: PermissionContext,
    scopeKey: string,
    opportunityId: string,
  ): Promise<boolean> {
    if (!context.workspaceId) {
      return false;
    }

    const opportunity = await this.salesOpportunitiesRepository.findOne({
      where: {
        id: opportunityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return opportunity
      ? this.evaluateSalesScope(context, scopeKey, {
          exists: true,
          kind: 'sales_opportunity',
          id: opportunityId,
          record: opportunity,
        })
      : false;
  }

  private async isPublishedKnowledgeArticle(
    context: PermissionContext,
    articleId: string,
  ): Promise<boolean> {
    if (!context.workspaceId) {
      return false;
    }

    const article = await this.knowledgeArticlesRepository.findOne({
      where: {
        id: articleId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return article?.status === AgencyKnowledgeArticleStatus.PUBLISHED;
  }

  private async isChatChannelParticipant(
    context: PermissionContext,
    channelId: string,
  ): Promise<boolean> {
    if (!context.workspaceId) {
      return false;
    }

    const membership = await this.chatChannelMembersRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
        userId: context.userId,
      },
    });

    return Boolean(membership && !membership.leftAt);
  }

  private async isMeetingParticipant(
    context: PermissionContext,
    meetingId: string,
  ): Promise<boolean> {
    if (!context.workspaceId) {
      return false;
    }

    const participant = await this.meetingParticipantsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        meetingRoomId: meetingId,
        userId: context.userId,
      },
    });

    return Boolean(participant);
  }

  private async canAccessRelatedWorkItem(
    context: PermissionContext,
    record: unknown,
  ): Promise<boolean> {
    if (!context.workspaceId) {
      return false;
    }

    const body = record as Record<string, unknown> | null | undefined;
    const relatedClientId =
      typeof body?.relatedClientId === 'string' ? body.relatedClientId : null;
    const relatedProjectId =
      typeof body?.relatedProjectId === 'string' ? body.relatedProjectId : null;
    const relatedTaskId =
      typeof body?.relatedTaskId === 'string' ? body.relatedTaskId : null;

    if (relatedClientId) {
      const client = await this.clientsRepository.findOne({
        where: {
          id: relatedClientId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return client ? this.canAccessAssignedClient(context, client) : false;
    }

    if (relatedProjectId) {
      const project = await this.projectsRepository.findOne({
        where: {
          id: relatedProjectId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return project
        ? this.evaluateProjectScope(context, 'department', {
            exists: true,
            kind: 'project',
            id: relatedProjectId,
            record: project,
          })
        : false;
    }

    if (relatedTaskId) {
      const task = await this.tasksRepository.findOne({
        where: {
          id: relatedTaskId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return task
        ? this.evaluateTaskScope(context, 'department', {
            exists: true,
            kind: 'task',
            id: relatedTaskId,
            record: task,
          })
        : false;
    }

    return true;
  }

  private async isOwnTeamMemberContract(
    context: PermissionContext,
    contract: ContractRecord,
  ): Promise<boolean> {
    if (
      contract.targetType !== ContractTargetType.TeamMember ||
      !contract.targetId
    ) {
      return false;
    }

    if (!context.workspaceId) {
      return false;
    }

    const member = await this.teamMembersRepository.findOne({
      where: {
        id: contract.targetId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    return member?.userId === context.userId;
  }

  private async isClientContractInScope(
    context: PermissionContext,
    contract: ContractRecord,
  ): Promise<boolean> {
    if (
      contract.targetType !== ContractTargetType.Client ||
      !contract.targetId
    ) {
      return false;
    }

    if (!context.workspaceId) {
      return false;
    }

    const client = await this.clientsRepository.findOne({
      where: {
        id: contract.targetId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!client) {
      return false;
    }

    return this.canAccessAssignedClient(context, client);
  }

  private async canAccessAssignedContract(
    context: PermissionContext,
    contract: ContractRecord,
  ): Promise<boolean> {
    if (contract.createdById === context.userId) {
      return true;
    }

    const party = await this.contractPartiesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contractId: contract.id,
        userId: context.userId,
      },
    });

    if (party) {
      return true;
    }

    if (await this.isClientContractInScope(context, contract)) {
      return true;
    }

    if (await this.isOwnTeamMemberContract(context, contract)) {
      return true;
    }

    if (
      contract.targetType === ContractTargetType.TeamMember &&
      contract.targetId
    ) {
      if (!context.workspaceId) {
        return false;
      }

      const targetMember = await this.teamMembersRepository.findOne({
        where: {
          id: contract.targetId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      return this.canAccessTeamMemberDepartment(context, targetMember);
    }

    return false;
  }
}
