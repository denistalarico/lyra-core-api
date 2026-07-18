import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformModule } from '../platform';
import { ContextModule } from '../../common/context/context.module';
import { TenantProductEntitlementEntity } from '../platform';
import { AgencyClient } from '../clients/entities';
import {
  TeamConfigOption,
  TeamDepartment,
  TeamMember,
  TeamPayment,
  TeamSkill,
} from '../team/entities';
import {
  ContractParty,
  ContractRecord,
  ContractTemplate,
} from '../contracts/entities';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarRoutineBlock } from '../calendar/entities/calendar-routine-block.entity';
import { CrmOpportunityEntity } from '../crm/entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../crm/entities/crm-stage.entity';
import { CrmTagEntity } from '../crm/entities/crm-tag.entity';
import { InboxChannelEntity } from '../inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../inbox/entities/inbox-conversation.entity';
import { WebchatConversationEntity } from '../webchat/entities/webchat-conversation.entity';
import { WebchatWidgetEntity } from '../webchat/entities/webchat-widget.entity';
import { ScheduledItemEntity } from '../appointments/entities/scheduled-item.entity';
import {
  AgencyProject,
  AgencyTask,
  AgencyTaskTimeEntry,
} from '../projects/entities';
import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyMeetingParticipant,
  AgencyMeetingRoom,
} from '../team-chat/entities';
import {
  AgencySalesActivityEntity,
  AgencySalesItemEntity,
  AgencySalesOpportunityEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from '../agency/entities/agency-sales.entities';
import { QuoteEntity } from '../quotes/entities/quote.entities';
import { ContactEntity } from '../contacts/entities/contact.entity';
import {
  AgencyKnowledgeArticle,
  AgencyKnowledgeCategory,
  AgencyKnowledgeComment,
  AgencyKnowledgeQuickNote,
  AgencyKnowledgeVaultItem,
} from '../knowledge/entities';
import { PlatformPermissionsController } from './controllers/platform-permissions.controller';
import {
  AgencyClientAccessEntity,
  AgencyClientProductAccessEntity,
  PlatformPermissionAuditEventEntity,
  PlatformPermissionEntity,
  PlatformRoleEntity,
  PlatformRolePermissionEntity,
  PlatformUserPermissionEntity,
} from './entities';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionScopeEvaluatorService } from './services/permission-scope-evaluator.service';
import { PlatformPermissionService } from './services/platform-permission.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    PlatformModule,
    ContextModule,
    TypeOrmModule.forFeature([
      ContactEntity,
      WebchatConversationEntity,
      WebchatWidgetEntity,
      ScheduledItemEntity,
    ]),
    TypeOrmModule.forFeature(
      [
        ContactEntity,
        PlatformRoleEntity,
        PlatformPermissionEntity,
        PlatformRolePermissionEntity,
        PlatformUserPermissionEntity,
        AgencyClientAccessEntity,
        AgencyClientProductAccessEntity,
        PlatformPermissionAuditEventEntity,
        TenantProductEntitlementEntity,
        AgencyClient,
        InboxChannelEntity,
        InboxConversationEntity,
        TeamMember,
        TeamDepartment,
        TeamSkill,
        TeamConfigOption,
        TeamPayment,
        ContractRecord,
        ContractParty,
        ContractTemplate,
        AgencyProject,
        AgencyTask,
        AgencyTaskTimeEntry,
        CalendarEvent,
        CalendarRoutineBlock,
        CrmOpportunityEntity,
        CrmPipelineEntity,
        CrmStageEntity,
        CrmTagEntity,
        AgencyChatChannel,
        AgencyChatChannelMember,
        AgencyChatMessage,
        AgencyChatAttachment,
        AgencyMeetingRoom,
        AgencyMeetingParticipant,
        AgencySalesItemEntity,
        AgencySalesPipelineEntity,
        AgencySalesStageEntity,
        AgencySalesOpportunityEntity,
        AgencySalesActivityEntity,
        QuoteEntity,
        AgencyKnowledgeArticle,
        AgencyKnowledgeCategory,
        AgencyKnowledgeComment,
        AgencyKnowledgeQuickNote,
        AgencyKnowledgeVaultItem,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [PlatformPermissionsController],
  providers: [
    PlatformPermissionService,
    PermissionScopeEvaluatorService,
    PermissionsGuard,
  ],
  exports: [
    ContextModule,
    PlatformPermissionService,
    PermissionScopeEvaluatorService,
    PermissionsGuard,
  ],
})
export class PermissionsModule {}
