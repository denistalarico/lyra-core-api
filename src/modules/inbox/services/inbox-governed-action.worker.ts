import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { createHash } from 'crypto';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { ContactMethodEntity } from '../../contacts/entities/contact-method.entity';
import { ContactListEntity } from '../../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../../contacts/entities/contact-list-member.entity';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxGovernedActionEntity } from '../entities/inbox-governed-action.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { InboxChannelContactIdentityEntity } from '../entities/inbox-channel-contact-identity.entity';
import { InboxAutonomyControlEntity } from '../entities/inbox-autonomy-control.entity';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';
import { resolveRoutedCrmTarget } from '../runtime/inbox-crm-target-resolver';
import { WhatsAppOutboundService } from '../channels/whatsapp/services/whatsapp-outbound.service';
import { InstagramOutboundService } from '../channels/instagram/services/instagram-outbound.service';
import { FacebookMessengerOutboundService } from '../channels/facebook-messenger/services/facebook-messenger-outbound.service';
import { ConversationOwnershipService } from './conversation-ownership.service';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { CrmStageTransitionPolicyEntity } from '../../crm/entities/crm-stage-transition-policy.entity';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { LeadFlowAgentStatus } from '../../leadflow-agents/enums/leadflow-agent-status.enum';

@Injectable()
export class InboxGovernedActionWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InboxGovernedActionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: InboxRuntimeConfigService,
    private readonly outbound: WhatsAppOutboundService,
    private readonly instagramOutbound: InstagramOutboundService,
    private readonly facebookMessengerOutbound: FacebookMessengerOutboundService,
    private readonly ownership: ConversationOwnershipService,
    @Optional()
    private readonly opportunityCommands?: CrmOpportunityCommandService,
  ) {}

  onModuleInit(): void {
    if (!this.effectsEnabled()) return;
    this.timer = setInterval(() => void this.tick(), 750);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processOnce(workerId = `governed:${process.pid}`) {
    const actionId = await this.claim(workerId);
    if (!actionId) return null;
    try {
      const action = await this.dataSource
        .getRepository(InboxGovernedActionEntity)
        .findOneBy({ id: actionId });
      if (!action) return null;
      if (!(await this.effectEnabled(action))) {
        await this.finish(action, 'blocked', 'effect_kill_switch', {});
        return action;
      }
      const decision = await this.dataSource
        .getRepository(InboxAgentDecisionEntity)
        .findOneBy({
          id: action.decisionId,
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          conversationId: action.conversationId,
        });
      const conversation = await this.dataSource
        .getRepository(InboxConversationEntity)
        .findOneBy({
          id: action.conversationId,
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
        });
      if (
        !decision ||
        !conversation ||
        action.policyOutcome !== 'allowed' ||
        conversation.ownershipState !== 'ai_active' ||
        !conversation.aiEnabled ||
        conversation.ownershipVersion !== action.ownershipVersion
      ) {
        await this.finish(action, 'stale', 'ownership_or_decision_stale', {});
        return action;
      }
      if (action.actionType === 'reply') {
        const reply = decision.proposal.reply;
        if (
          typeof reply !== 'string' ||
          !reply.trim() ||
          !conversation.channelId ||
          !conversation.externalThreadId ||
          !decision.agentId
        ) {
          await this.finish(action, 'invalid', 'reply_payload_invalid', {});
          return action;
        }
        const channel = await this.dataSource
          .getRepository(InboxChannelEntity)
          .findOneBy({
            id: conversation.channelId,
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          });
        // Explicit per-channel dispatch: an unknown channel type must fail the
        // action instead of silently sending through WhatsApp.
        const outbound = this.outboundForChannelType(channel?.type);
        if (!outbound) {
          await this.finish(action, 'invalid', 'channel_type_unsupported', {});
          return action;
        }
        const sent = await outbound.sendAgentText({
          ctx: {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          channelId: conversation.channelId,
          conversationId: conversation.id,
          to: conversation.externalThreadId,
          text: reply,
          agentId: decision.agentId,
          ownershipVersion: action.ownershipVersion,
          decisionId: decision.id,
          policyVersion: action.policyVersion,
          idempotencyKey: action.idempotencyKey,
        });
        await this.finish(action, 'applied', null, {
          messageId: sent.message.id,
        });
      } else if (action.actionType === 'ensure_contact') {
        const result = await this.ensureContact(action, conversation);
        await this.finish(action, 'applied', null, result);
      } else if (action.actionType === 'ensure_opportunity') {
        const result = await this.ensureOpportunity(action, conversation);
        await this.finish(action, 'applied', null, result);
      } else if (action.actionType === 'handoff') {
        const planned = this.plannedAction(decision, action.actionKey);
        const transfer = await this.resolveHandoffTransfer(action, decision);
        await this.ownership.requestHandoff(
          {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          conversation.id,
          typeof planned?.value === 'string'
            ? planned.value
            : 'governed_handoff',
          transfer,
        );
        await this.finish(action, 'applied', null, {
          conversationId: conversation.id,
        });
      } else {
        const result = await this.applyCrm(action, decision, conversation);
        await this.finish(action, 'applied', null, result);
      }
      return action;
    } catch (error) {
      await this.dataSource
        .getRepository(InboxGovernedActionEntity)
        .update(actionId, {
          status: 'failed',
          failedAt: new Date(),
          errorCode: safeErrorCode(error),
        });
      return null;
    }
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processOnce();
    } catch (error) {
      this.logger.warn(
        `Governed action worker failed: ${safeErrorCode(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async resolveHandoffTransfer(
    action: InboxGovernedActionEntity,
    decision: InboxAgentDecisionEntity,
  ) {
    if (!decision.agentId) return undefined;
    const agent = await this.dataSource
      .getRepository(LeadFlowAgentEntity)
      .findOneBy({
        id: decision.agentId,
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        status: LeadFlowAgentStatus.Active,
      });
    if (
      !agent?.publishedVersionId ||
      agent.handoffPolicy?.transferOpportunityOnHandoff !== true
    ) {
      return undefined;
    }
    return {
      pipelineId:
        typeof agent.handoffPolicy.targetPipelineId === 'string'
          ? agent.handoffPolicy.targetPipelineId
          : null,
      stageId:
        typeof agent.handoffPolicy.targetStageId === 'string'
          ? agent.handoffPolicy.targetStageId
          : null,
      idempotencyKey: `handoff:${action.id}:pipeline-transfer`,
      agentId: agent.id,
    };
  }

  private async claim(workerId: string): Promise<string | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM inbox_governed_actions
          WHERE policy_outcome = 'allowed' AND (
            status = 'planned'
            OR (status = 'claimed' AND claimed_at < now() - interval '2 minutes')
          )
          ORDER BY
            CASE action_type
              WHEN 'ensure_contact' THEN 0
              WHEN 'ensure_opportunity' THEN 1
              WHEN 'reply' THEN 2
              WHEN 'set_stage' THEN 3
              WHEN 'handoff' THEN 5
              ELSE 4
            END,
            created_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!rows[0]) return null;
      await manager
        .getRepository(InboxGovernedActionEntity)
        .update(rows[0].id, {
          status: 'claimed',
          claimedAt: new Date(),
          claimedBy: workerId,
          attempts: () => 'attempts + 1',
        });
      return rows[0].id;
    });
  }

  private async ensureContact(
    action: InboxGovernedActionEntity,
    snapshot: InboxConversationEntity,
  ): Promise<{ contactId: string; contactOutcome: 'created' | 'reused' }> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertWorkspaceControl(manager, action, 'crm_enabled');
      const conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            id: snapshot.id,
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!conversation?.channelId || !conversation.externalThreadId)
        throw new Error('canonical_identity_missing');
      if (conversation.contactId) {
        linkPlaybookProgress(conversation, {
          contactId: conversation.contactId,
        });
        await manager.getRepository(InboxConversationEntity).save(conversation);
        await this.ensureLeadFlowMembership(
          manager,
          action,
          conversation.channelId,
          conversation.contactId,
        );
        return { contactId: conversation.contactId, contactOutcome: 'reused' };
      }
      const identity = normalizeIdentity(conversation.externalThreadId);
      const externalIdentityHash = createHash('sha256')
        .update(identity)
        .digest('hex');
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          `${action.tenantId}:${action.workspaceId}:${conversation.channelId}:${externalIdentityHash}`,
        ],
      );
      const existing = await manager
        .getRepository(InboxChannelContactIdentityEntity)
        .findOneBy({
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          channelId: conversation.channelId,
          externalIdentityHash,
        });
      if (existing) {
        conversation.contactId = existing.contactId;
        linkPlaybookProgress(conversation, { contactId: existing.contactId });
        await manager.getRepository(InboxConversationEntity).save(conversation);
        await this.ensureLeadFlowMembership(
          manager,
          action,
          conversation.channelId,
          existing.contactId,
        );
        return { contactId: existing.contactId, contactOutcome: 'reused' };
      }
      const contactMatches = await manager.query<
        Array<{ id: string; status: string }>
      >(
        `SELECT DISTINCT contact.id, contact.status
           FROM contacts contact
           JOIN contact_methods method
             ON method.contact_id = contact.id
            AND method.tenant_id = contact.tenant_id
            AND method.workspace_id = contact.workspace_id
          WHERE contact.tenant_id = $1 AND contact.workspace_id = $2
            AND method.type IN ('phone', 'whatsapp')
            AND regexp_replace(method.value, '\\D', '', 'g') = $3`,
        [action.tenantId, action.workspaceId, identity.slice(1)],
      );
      if (contactMatches.length > 1)
        throw new Error('canonical_identity_ambiguous');
      if (contactMatches[0]?.status === 'archived')
        throw new Error('canonical_contact_archived');
      if (contactMatches[0]) {
        await manager.getRepository(InboxChannelContactIdentityEntity).save({
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          channelId: conversation.channelId,
          contactId: contactMatches[0].id,
          externalIdentityHash,
          identityType: 'whatsapp',
          provenance: {
            source: 'existing_contact_method',
            governedActionId: action.id,
          },
        });
        conversation.contactId = contactMatches[0].id;
        linkPlaybookProgress(conversation, { contactId: contactMatches[0].id });
        await manager.getRepository(InboxConversationEntity).save(conversation);
        await this.ensureLeadFlowMembership(
          manager,
          action,
          conversation.channelId,
          contactMatches[0].id,
        );
        return {
          contactId: contactMatches[0].id,
          contactOutcome: 'reused',
        };
      }
      const contact = await manager.getRepository(ContactEntity).save({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        type: 'person',
        displayName: safeContactName(conversation.title),
        firstName: null,
        lastName: null,
        legalName: null,
        documentType: null,
        documentNumber: null,
        jobTitle: null,
        companyContactId: null,
        source: 'leadflow_whatsapp',
        businessMode: contactBusinessMode(conversation.businessMode),
        lifecycleStage: 'lead',
        lifecycleStages: ['lead'],
        status: 'active',
        ownerUserId: null,
        createdByUserId: null,
        notes: null,
      });
      await manager.getRepository(ContactMethodEntity).save({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        contactId: contact.id,
        type: 'whatsapp',
        value: identity,
        label: 'LeadFlow WhatsApp',
        isPrimary: true,
        verifiedAt: null,
      });
      await manager.getRepository(InboxChannelContactIdentityEntity).save({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        channelId: conversation.channelId,
        contactId: contact.id,
        externalIdentityHash,
        identityType: 'whatsapp',
        provenance: {
          source: 'canonical_inbound_identity',
          governedActionId: action.id,
        },
      });
      conversation.contactId = contact.id;
      linkPlaybookProgress(conversation, { contactId: contact.id });
      await manager.getRepository(InboxConversationEntity).save(conversation);
      await this.ensureLeadFlowMembership(
        manager,
        action,
        conversation.channelId,
        contact.id,
      );
      await this.auditCreatedEntity(manager, action, 'contact', contact.id);
      return { contactId: contact.id, contactOutcome: 'created' };
    });
  }

  private async ensureLeadFlowMembership(
    manager: EntityManager,
    action: InboxGovernedActionEntity,
    channelId: string,
    contactId: string,
  ) {
    const channel = await manager.getRepository(InboxChannelEntity).findOneBy({
      id: channelId,
      tenantId: action.tenantId,
      workspaceId: action.workspaceId,
    });
    const lists = manager.getRepository(ContactListEntity);
    await manager.query(
      `INSERT INTO contact_lists
        (tenant_id,workspace_id,name,description,color,parent_list_id,visibility,
         created_by_user_id,is_system,is_protected,source_product,source_context)
       VALUES ($1,$2,'LeadFlow','Contatos canônicos do LeadFlow.','#2563EB',NULL,
         'workspace',NULL,true,true,'leadflow','shared_contacts')
       ON CONFLICT (workspace_id,name) DO UPDATE SET
         is_system=true,is_protected=true,source_product='leadflow'`,
      [action.tenantId, action.workspaceId],
    );
    const parent = await lists.findOneBy({
      tenantId: action.tenantId,
      workspaceId: action.workspaceId,
      name: 'LeadFlow',
    });
    if (!parent) throw new Error('leadflow_contact_list_missing');
    const listIds = [parent.id];
    const clientId =
      typeof channel?.metadata?.clientId === 'string'
        ? channel.metadata.clientId
        : null;
    if (clientId) {
      const clientName =
        typeof channel?.metadata?.clientName === 'string' &&
        channel.metadata.clientName.trim()
          ? channel.metadata.clientName.trim().slice(0, 120)
          : `Cliente ${clientId.slice(0, 8)}`;
      await manager.query(
        `INSERT INTO contact_lists
          (tenant_id,workspace_id,name,description,color,parent_list_id,visibility,
           created_by_user_id,is_system,is_protected,source_product,source_context)
         VALUES ($1,$2,$3,'Contatos do LeadFlow deste cliente.','#2563EB',$4,
           'workspace',NULL,true,true,'leadflow',$5)
         ON CONFLICT (workspace_id,name) DO UPDATE SET
           is_system=true,is_protected=true,source_product='leadflow',
           source_context=EXCLUDED.source_context,parent_list_id=EXCLUDED.parent_list_id`,
        [
          action.tenantId,
          action.workspaceId,
          clientName,
          parent.id,
          `client:${clientId}`,
        ],
      );
      const child = await lists.findOneBy({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        parentListId: parent.id,
        sourceContext: `client:${clientId}`,
      });
      if (child) listIds.push(child.id);
    }
    for (const listId of listIds) {
      await manager
        .getRepository(ContactListMemberEntity)
        .createQueryBuilder()
        .insert()
        .values({
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          listId,
          contactId,
          addedByUserId: null,
        })
        .orIgnore()
        .execute();
    }
  }

  private async ensureOpportunity(
    action: InboxGovernedActionEntity,
    snapshot: InboxConversationEntity,
  ): Promise<{
    opportunityId: string;
    opportunityOutcome: 'created' | 'reused' | 'reconverted';
  }> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertWorkspaceControl(manager, action, 'crm_enabled');
      const conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            id: snapshot.id,
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!conversation || conversation.qualificationStatus !== 'qualified')
        throw new Error('lead_not_eligible');
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          `${action.tenantId}:${action.workspaceId}:${conversation.id}:opportunity`,
        ],
      );
      const active = await manager
        .getRepository(CrmOpportunityEntity)
        .createQueryBuilder('opportunity')
        .setLock('pessimistic_write')
        .where('opportunity.tenant_id = :tenantId', action)
        .andWhere('opportunity.workspace_id = :workspaceId', action)
        .andWhere('opportunity.inbox_conversation_id = :conversationId', {
          conversationId: conversation.id,
        })
        .andWhere("opportunity.status = 'open'")
        .andWhere('opportunity.deleted_at IS NULL')
        .orderBy('opportunity.created_at', 'DESC')
        .take(2)
        .getMany();
      if (active.length > 1) throw new Error('multiple_active_opportunities');
      const existing = active[0];
      if (existing && existing.businessMode !== conversation.businessMode)
        throw new Error('active_opportunity_incompatible');
      const contactOutcome = await this.contactOutcomeForDecision(
        manager,
        action,
      );
      if (existing) {
        existing.operationalStatus = conversation.ownershipState;
        if (
          conversation.ownershipState === 'human_active' &&
          conversation.assignedUserId
        ) {
          existing.assignedUserId = conversation.assignedUserId;
        }
        existing.businessContext = {
          ...existing.businessContext,
          contactResolution: {
            status: 'linked',
            outcome: contactOutcome,
            contactId: conversation.contactId,
          },
          opportunityResolution: {
            outcome: 'reused',
            governedActionId: action.id,
          },
        };
        if (this.opportunityCommands) {
          await this.opportunityCommands.updateWithinTransaction(
            manager,
            {
              tenantId: action.tenantId,
              workspaceId: action.workspaceId,
            },
            existing,
            {
              actor: { type: 'automation' },
              idempotencyKey: `governed:${action.id}:opportunity-reused`,
              correlationId: action.id,
              causationId: action.decisionId,
              policyVersion: action.policyVersion,
              reason: 'governed_autonomy',
            },
          );
        } else {
          await manager.getRepository(CrmOpportunityEntity).save(existing);
        }
        conversation.opportunityId = existing.id;
        linkPlaybookProgress(conversation, { opportunityId: existing.id });
        await manager.getRepository(InboxConversationEntity).save(conversation);
        return { opportunityId: existing.id, opportunityOutcome: 'reused' };
      }
      const terminalSource = await manager
        .getRepository(CrmOpportunityEntity)
        .createQueryBuilder('opportunity')
        .setLock('pessimistic_write')
        .where('opportunity.tenant_id = :tenantId', action)
        .andWhere('opportunity.workspace_id = :workspaceId', action)
        .andWhere('opportunity.inbox_conversation_id = :conversationId', {
          conversationId: conversation.id,
        })
        .andWhere("opportunity.status <> 'open'")
        .andWhere('opportunity.deleted_at IS NULL')
        .orderBy(
          'CASE WHEN opportunity.id = :primaryOpportunityId THEN 0 ELSE 1 END',
          'ASC',
        )
        .addOrderBy('opportunity.created_at', 'DESC')
        .setParameter(
          'primaryOpportunityId',
          conversation.opportunityId ?? '00000000-0000-0000-0000-000000000000',
        )
        .getOne();
      if (!conversation.contactId) throw new Error('contact_missing');
      const routedCrmTarget = await resolveRoutedCrmTarget(manager, {
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        channelId: conversation.channelId,
        businessMode: conversation.businessMode,
      });
      if (!routedCrmTarget.ok) throw new Error(routedCrmTarget.errorCode);
      const { pipeline, initialStage: stage, channel } = routedCrmTarget;
      const contact = await manager.getRepository(ContactEntity).findOneBy({
        id: conversation.contactId,
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
      });
      const primaryMethod = await manager
        .getRepository(ContactMethodEntity)
        .findOne({
          where: {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
            contactId: conversation.contactId,
            isPrimary: true,
          },
          order: { createdAt: 'ASC' },
        });
      const source =
        channel?.type === 'whatsapp' ? 'whatsapp' : conversation.source;
      const routedClientId =
        typeof channel.metadata?.clientId === 'string'
          ? channel.metadata.clientId
          : null;
      const opportunityCandidate = manager
        .getRepository(CrmOpportunityEntity)
        .create({
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          contactId: conversation.contactId,
          contactName:
            contact?.displayName ?? safeContactName(conversation.title),
          contactEmail: null,
          contactPhone:
            primaryMethod?.type === 'phone' ||
            primaryMethod?.type === 'whatsapp'
              ? primaryMethod.value
              : null,
          inboxConversationId: conversation.id,
          sourceOpportunityId: terminalSource?.id ?? null,
          title: `LeadFlow — ${safeContactName(conversation.title)}`.slice(
            0,
            180,
          ),
          description: null,
          valueAmount: null,
          currency: 'BRL',
          status: 'open',
          priority: conversation.priority,
          source,
          businessMode: conversation.businessMode,
          operationalStatus: conversation.ownershipState,
          businessContext: {
            origin: 'leadflow_inbox',
            acquisitionChannel: source,
            channelId: conversation.channelId,
            governedActionId: action.id,
            contactResolution: {
              status: 'linked',
              outcome: contactOutcome,
              contactId: conversation.contactId,
            },
            opportunityResolution: {
              outcome: terminalSource ? 'reconverted' : 'created',
              governedActionId: action.id,
              ...(terminalSource
                ? { sourceOpportunityId: terminalSource.id }
                : {}),
            },
          },
          assignedUserId:
            conversation.ownershipState === 'human_active'
              ? conversation.assignedUserId
              : null,
          expectedCloseDate: null,
          nextFollowUpAt: null,
          lastActivityAt: null,
          wonAt: null,
          lostAt: null,
          lostReason: null,
          cardColor: null,
          sortOrder: 0,
          visibility: 'workspace',
          // The agent qualified this conversation and wrote the follow-up
          // drafts along with its reply, so the card starts automatic: the
          // cadence has both a reason to run and something to say.
          followMode: 'automatic',
          followMessage: null,
          followSendAutomatically: false,
          rowVersion: 1,
          metadata: {
            createdBy: 'governed_autonomy',
            conversionKey: readConversionKey(conversation.metadata),
            sourceProvenance: 'canonical_inbound_channel',
            operatingMode: routedClientId ? 'client' : 'agency',
            clientId: routedClientId,
          },
        });
      let opportunity: CrmOpportunityEntity;
      if (terminalSource) {
        if (!this.opportunityCommands)
          throw new Error('crm_command_unavailable');
        opportunity =
          await this.opportunityCommands.reconvertOpportunityWithinTransaction(
            manager,
            {
              tenantId: action.tenantId,
              workspaceId: action.workspaceId,
            },
            terminalSource.id,
            opportunityCandidate,
            {
              actor: { type: 'automation' },
              idempotencyKey: `governed:${action.id}:opportunity-reconverted`,
              correlationId: action.id,
              causationId: action.decisionId,
              policyVersion: action.policyVersion,
              reason: 'new_conversion',
              metadata: { governedActionId: action.id },
            },
          );
      } else {
        opportunity = await manager
          .getRepository(CrmOpportunityEntity)
          .save(opportunityCandidate);
      }
      if (this.opportunityCommands && !terminalSource) {
        await this.opportunityCommands.appendHistory(
          manager,
          {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          {
            opportunity,
            actor: { type: 'automation' },
            eventType: 'opportunity_created',
            title: 'Oportunidade criada por automação governada',
            afterData: {
              opportunityId: opportunity.id,
              pipelineId: opportunity.pipelineId,
              stageId: opportunity.stageId,
              status: opportunity.status,
              rowVersion: opportunity.rowVersion,
            },
            idempotencyKey: `governed:${action.id}:opportunity-created`,
            correlationId: action.id,
            causationId: action.decisionId,
            policyVersion: action.policyVersion,
            reason: 'governed_autonomy',
          },
        );
      }
      conversation.opportunityId = opportunity.id;
      linkPlaybookProgress(conversation, { opportunityId: opportunity.id });
      await manager.getRepository(InboxConversationEntity).save(conversation);
      await this.auditCreatedEntity(
        manager,
        action,
        'opportunity',
        opportunity.id,
      );
      return {
        opportunityId: opportunity.id,
        opportunityOutcome: terminalSource ? 'reconverted' : 'created',
      };
    });
  }

  private async contactOutcomeForDecision(
    manager: EntityManager,
    action: InboxGovernedActionEntity,
  ): Promise<'created' | 'reused'> {
    const contactAction = await manager
      .getRepository(InboxGovernedActionEntity)
      .findOneBy({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        decisionId: action.decisionId,
        actionType: 'ensure_contact',
      });
    return contactAction?.applicationResult?.contactOutcome === 'created'
      ? 'created'
      : 'reused';
  }

  private async auditCreatedEntity(
    manager: EntityManager,
    action: InboxGovernedActionEntity,
    entityType: 'contact' | 'opportunity',
    entityId: string,
  ) {
    await manager.getRepository(InboxConversationEventEntity).save({
      tenantId: action.tenantId,
      workspaceId: action.workspaceId,
      conversationId: action.conversationId,
      eventType: `governed_${entityType}_linked`,
      actorType: 'system',
      actorUserId: null,
      payload: {
        actionId: action.id,
        policyVersion: action.policyVersion,
        entityId,
      },
    });
    await manager.getRepository(InboxDomainOutboxEntity).save({
      tenantId: action.tenantId,
      workspaceId: action.workspaceId,
      aggregateType: `inbox_${entityType}`,
      aggregateId: entityId,
      eventName: `leadflow.inbox.${entityType}.linked`,
      eventVersion: 1,
      idempotencyKey: `governed-action:${action.id}:${entityType}`,
      payload: {
        conversationId: action.conversationId,
        actionId: action.id,
        entityId,
      },
      publishedAt: null,
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      deadLetteredAt: null,
      updatedAt: new Date(),
    });
  }

  private async applyCrm(
    action: InboxGovernedActionEntity,
    decision: InboxAgentDecisionEntity,
    conversation: InboxConversationEntity,
  ): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertWorkspaceControl(manager, action, 'crm_enabled');
      const lockedConversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            id: conversation.id,
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (
        !lockedConversation ||
        lockedConversation.ownershipVersion !== action.ownershipVersion ||
        lockedConversation.ownershipState !== 'ai_active'
      )
        throw new Error('ownership_changed');
      const latestInbound = await manager
        .getRepository(InboxMessageEntity)
        .findOne({
          where: {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
            conversationId: action.conversationId,
            direction: 'inbound',
          },
          order: { occurredAt: 'DESC', createdAt: 'DESC' },
        });
      const expectedInboundId =
        typeof decision.contextSnapshot?.latestInboundId === 'string'
          ? decision.contextSnapshot.latestInboundId
          : null;
      if (expectedInboundId && expectedInboundId !== latestInbound?.id)
        throw new Error('decision_context_stale');
      const opportunity = await manager
        .getRepository(CrmOpportunityEntity)
        .findOne({
          where: lockedConversation.opportunityId
            ? {
                id: lockedConversation.opportunityId,
                tenantId: action.tenantId,
                workspaceId: action.workspaceId,
              }
            : {
                inboxConversationId: lockedConversation.id,
                tenantId: action.tenantId,
                workspaceId: action.workspaceId,
              },
          lock: { mode: 'pessimistic_write' },
        });
      const planned = this.plannedAction(decision, action.actionKey);
      if (!opportunity || !planned || planned.allowed !== true)
        throw new Error('canonical_target_unresolved');
      if (opportunity.inboxConversationId !== lockedConversation.id)
        throw new Error('opportunity_conversation_link_invalid');
      const value = typeof planned.value === 'string' ? planned.value : null;
      let stageMoved = false;
      if (
        lockedConversation.source === 'whatsapp' &&
        opportunity.metadata?.createdBy === 'governed_autonomy' &&
        opportunity.metadata?.sourceProvenance !== 'human'
      ) {
        opportunity.source = 'whatsapp';
        opportunity.businessContext = {
          ...opportunity.businessContext,
          acquisitionChannel: 'whatsapp',
        };
      }
      if (action.actionType === 'set_stage') {
        if (!this.opportunityCommands)
          throw new Error('crm_command_authority_unavailable');
        const opportunityId = safeRecordString(planned.opportunityId);
        const fromStageId = safeRecordString(planned.fromStageId);
        const toStageId = safeRecordString(planned.stageId);
        const policyId = safeRecordString(planned.transitionPolicyId);
        const reasonCode = safeRecordString(planned.reasonCode);
        const policyVersion = Number(planned.transitionPolicyVersion);
        const expectedVersion = Number(planned.opportunityRowVersion);
        const evidenceRefs = Array.isArray(planned.evidenceRefs)
          ? planned.evidenceRefs.filter(
              (ref): ref is string => typeof ref === 'string',
            )
          : [];
        const allowedEvidenceRefs = Array.isArray(
          decision.contextSnapshot?.allowedEvidenceRefs,
        )
          ? decision.contextSnapshot.allowedEvidenceRefs.filter(
              (ref): ref is string => typeof ref === 'string',
            )
          : [];
        if (
          !opportunityId ||
          opportunityId !== opportunity.id ||
          !fromStageId ||
          fromStageId !== opportunity.stageId ||
          !toStageId ||
          !policyId ||
          !reasonCode ||
          !Number.isInteger(policyVersion) ||
          !Number.isInteger(expectedVersion)
        ) {
          throw new Error('stage_transition_proposal_stale');
        }
        if (
          evidenceRefs.length === 0 ||
          evidenceRefs.some((ref) => !allowedEvidenceRefs.includes(ref))
        ) {
          throw new Error('decision_evidence_invalid');
        }
        const publishedPolicy = await manager
          .getRepository(CrmStageTransitionPolicyEntity)
          .findOne({
            where: {
              id: policyId,
              tenantId: action.tenantId,
              workspaceId: action.workspaceId,
              pipelineId: opportunity.pipelineId,
              fromStageId,
              toStageId,
              status: 'published',
              version: policyVersion,
              deletedAt: IsNull(),
            },
            lock: { mode: 'pessimistic_read' },
          });
        if (!publishedPolicy) throw new Error('transition_policy_stale');
        if (!publishedPolicy.allowedActors.includes('ai'))
          throw new Error('transition_actor_not_allowed');
        const moved = await this.opportunityCommands.moveStageWithinTransaction(
          manager,
          {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          opportunity.id,
          toStageId,
          {
            actor: { type: 'ai', agentId: decision.agentId },
            expectedVersion,
            expectedTransitionPolicyId: policyId,
            expectedTransitionPolicyVersion: policyVersion,
            idempotencyKey: `governed:${action.id}:stage`,
            correlationId: action.id,
            causationId: action.decisionId,
            reason: reasonCode,
            metadata: {
              governedActionId: action.id,
              evidenceRefs,
              proposalConfidence: planned.confidence,
            },
          },
        );
        Object.assign(opportunity, moved.opportunity);
        stageMoved = true;
      } else if (action.actionType === 'set_summary' && value) {
        setGovernedBusinessContextField(
          opportunity,
          'agentSummary',
          value,
          decision.id,
          action,
        );
      } else if (action.actionType === 'set_service' && value) {
        setGovernedBusinessContextField(
          opportunity,
          'service',
          value,
          decision.id,
          action,
        );
      } else if (
        action.actionType === 'set_urgency' &&
        value &&
        ['low', 'normal', 'high', 'urgent'].includes(value)
      ) {
        setGovernedBusinessContextField(
          opportunity,
          'urgency',
          value,
          decision.id,
          action,
        );
        opportunity.priority = value;
      } else if (action.actionType === 'add_tag' && value) {
        await this.assignExistingTag(
          manager,
          action,
          opportunity.id,
          slug(value),
        );
      } else if (action.actionType === 'set_fact' && value) {
        const target =
          typeof planned.crmTarget === 'string' ? planned.crmTarget : '';
        if (!/^business_context\.[a-zA-Z0-9_.-]{1,100}$/.test(target))
          throw new Error('fact_target_not_allowed');
        const field = target.slice('business_context.'.length);
        const typedValue = canonicalFactValue(value, planned.valueType);
        if (typedValue === null) throw new Error('fact_value_invalid');
        setGovernedBusinessContextField(
          opportunity,
          field,
          typedValue,
          decision.id,
          action,
        );
      } else {
        throw new Error('automatic_crm_action_not_supported');
      }
      if (this.opportunityCommands && !stageMoved) {
        await this.opportunityCommands.updateWithinTransaction(
          manager,
          {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          opportunity,
          {
            actor: { type: 'automation' },
            idempotencyKey: `governed:${action.id}:crm`,
            correlationId: action.id,
            causationId: action.decisionId,
            policyVersion: action.policyVersion,
            reason: 'governed_autonomy',
          },
        );
      } else if (!stageMoved) {
        await manager.getRepository(CrmOpportunityEntity).save(opportunity);
      }
      await manager.getRepository(InboxConversationEventEntity).save({
        id: action.auditRef,
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        conversationId: action.conversationId,
        eventType: 'governed_action_applied',
        actorType: 'system',
        actorUserId: null,
        payload: {
          actionId: action.id,
          actionType: action.actionType,
          policyVersion: action.policyVersion,
          opportunityId: opportunity.id,
        },
      });
      await manager.getRepository(InboxDomainOutboxEntity).save({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        aggregateType: 'inbox_governed_action',
        aggregateId: action.id,
        eventName: 'leadflow.inbox.governed_action.applied',
        eventVersion: 1,
        idempotencyKey: `governed-action:${action.id}:applied`,
        payload: {
          conversationId: action.conversationId,
          actionId: action.id,
          actionType: action.actionType,
          opportunityId: opportunity.id,
        },
        publishedAt: null,
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        deadLetteredAt: null,
        updatedAt: new Date(),
      });
      return { opportunityId: opportunity.id };
    });
  }

  private async assignExistingTag(
    manager: EntityManager,
    action: InboxGovernedActionEntity,
    opportunityId: string,
    tagSlug: string,
  ) {
    await manager.query(
      `INSERT INTO crm_opportunity_tags
        (tenant_id, workspace_id, opportunity_id, tag_id, assigned_by_type, assigned_by_user_id, metadata)
       SELECT $1, $2, $3, tag.id, 'system', NULL, jsonb_build_object('governedActionId', $4)
       FROM crm_tags tag
       WHERE tag.tenant_id = $1 AND tag.workspace_id = $2
         AND tag.slug = $5 AND tag.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM crm_opportunity_tags link
           WHERE link.tenant_id = $1 AND link.workspace_id = $2
             AND link.opportunity_id = $3 AND link.tag_id = tag.id
         )`,
      [action.tenantId, action.workspaceId, opportunityId, action.id, tagSlug],
    );
  }

  private async assertWorkspaceControl(
    manager: EntityManager,
    action: InboxGovernedActionEntity,
    column: 'crm_enabled' | 'handoff_enabled',
  ) {
    const rows = await manager.query<Array<{ enabled: boolean }>>(
      `SELECT ${column} enabled FROM inbox_autonomy_controls
        WHERE tenant_id=$1 AND workspace_id=$2 FOR SHARE`,
      [action.tenantId, action.workspaceId],
    );
    if (rows[0] && !rows[0].enabled) throw new Error('effect_kill_switch');
  }

  private plannedAction(
    decision: InboxAgentDecisionEntity,
    actionKey: string,
  ): Record<string, unknown> | null {
    return (
      (Array.isArray(decision.actionPlan)
        ? decision.actionPlan.find((item) => item.key === actionKey)
        : null) ?? null
    );
  }

  /**
   * Governed replies are routed by the channel's own type. Every supported
   * provider is named here, so adding a channel without an outbound service is
   * a rejected action rather than a message delivered through the wrong API.
   */
  private outboundForChannelType(channelType: string | undefined) {
    if (channelType === 'whatsapp') return this.outbound;
    if (channelType === 'instagram') return this.instagramOutbound;
    if (channelType === 'facebook_messenger') {
      return this.facebookMessengerOutbound;
    }
    return null;
  }

  private async finish(
    action: InboxGovernedActionEntity,
    status: InboxGovernedActionEntity['status'],
    errorCode: string | null,
    applicationResult: Record<string, unknown>,
  ) {
    action.status = status;
    action.errorCode = errorCode;
    action.applicationResult = applicationResult;
    action.appliedAt = status === 'applied' ? new Date() : null;
    action.failedAt = status === 'failed' ? new Date() : null;
    await this.dataSource.getRepository(InboxGovernedActionEntity).save(action);
    await this.settleDecision(action);
  }

  private async settleDecision(action: InboxGovernedActionEntity) {
    const rows = await this.dataSource.query<
      Array<{ open_count: number; exception_count: number }>
    >(
      `SELECT
         count(*) FILTER (WHERE status IN ('planned','claimed'))::int open_count,
         count(*) FILTER (WHERE status IN
           ('blocked','requires_human','stale','invalid','failed','unknown_outcome'))::int exception_count
       FROM inbox_governed_actions
       WHERE tenant_id=$1 AND workspace_id=$2 AND decision_id=$3`,
      [action.tenantId, action.workspaceId, action.decisionId],
    );
    if (
      Number(rows[0]?.open_count ?? 0) !== 0 ||
      Number(rows[0]?.exception_count ?? 0) !== 0
    )
      return;
    await this.dataSource.getRepository(InboxAgentDecisionEntity).update(
      {
        id: action.decisionId,
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        status: 'proposed',
      },
      {
        status: 'approved',
        reviewOutcome: 'actions_applied',
        appliedAt: new Date(),
        reviewedAt: new Date(),
      },
    );
  }

  private effectsEnabled(): boolean {
    return (
      this.config.autoReplyEnabled ||
      this.config.autoCrmEnabled ||
      this.config.autoHandoffEnabled
    );
  }

  private async effectEnabled(action: InboxGovernedActionEntity) {
    const control = await this.dataSource
      .getRepository(InboxAutonomyControlEntity)
      .findOneBy({
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
      });
    if (action.actionType === 'reply')
      return this.config.autoReplyEnabled && (control?.replyEnabled ?? true);
    if (action.actionType === 'handoff')
      return (
        this.config.autoHandoffEnabled && (control?.handoffEnabled ?? true)
      );
    return this.config.autoCrmEnabled && (control?.crmEnabled ?? true);
  }
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function safeErrorCode(error: unknown): string {
  const response =
    error && typeof error === 'object'
      ? (error as { response?: unknown }).response
      : null;
  const responseReason =
    response && typeof response === 'object'
      ? (response as Record<string, unknown>).reasonCode
      : null;
  const value =
    typeof responseReason === 'string'
      ? responseReason
      : error instanceof Error
        ? error.message
        : 'effect_failed';
  return /^[a-z0-9_]{1,80}$/.test(value) ? value : 'effect_failed';
}

function safeRecordString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeIdentity(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15)
    throw new Error('canonical_identity_invalid');
  return `+${digits}`;
}

function safeContactName(value: string | null): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized || /^\+?\d[\d\s()-]+$/.test(normalized))
    return 'Contato do WhatsApp';
  return normalized.slice(0, 160);
}

function contactBusinessMode(value: string) {
  const mapped: Record<string, string> = {
    agency_services: 'agency_service',
    local_services: 'service_quote',
    clinics_esthetics: 'clinic_booking',
    restaurants_food: 'restaurant_order',
    ecommerce_light: 'ecommerce',
    education_courses: 'education',
    real_estate: 'real_estate',
  };
  return (mapped[value] ?? 'general') as ContactEntity['businessMode'];
}

function readConversionKey(metadata: Record<string, unknown>): string | null {
  const progress = metadata.leadflowPlaybookProgress;
  if (!progress || typeof progress !== 'object' || Array.isArray(progress))
    return null;
  const value = (progress as Record<string, unknown>).conversionKey;
  return typeof value === 'string' ? value.slice(0, 220) : null;
}

function linkPlaybookProgress(
  conversation: InboxConversationEntity,
  refs: { contactId?: string; opportunityId?: string },
) {
  const value = conversation.metadata.leadflowPlaybookProgress;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  conversation.metadata = {
    ...conversation.metadata,
    leadflowPlaybookProgress: {
      ...(value as Record<string, unknown>),
      ...(refs.contactId ? { contactId: refs.contactId } : {}),
      ...(refs.opportunityId ? { opportunityId: refs.opportunityId } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
}

function canonicalFactValue(value: string, valueType: unknown) {
  if (valueType === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
  }
  if (valueType === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const normalized = value.trim().slice(0, 500);
  return normalized || null;
}

function setGovernedBusinessContextField(
  opportunity: CrmOpportunityEntity,
  field: string,
  value: string | number | boolean,
  decisionId: string,
  action: InboxGovernedActionEntity,
) {
  const provenance =
    opportunity.businessContext.fieldProvenance &&
    typeof opportunity.businessContext.fieldProvenance === 'object' &&
    !Array.isArray(opportunity.businessContext.fieldProvenance)
      ? (opportunity.businessContext.fieldProvenance as Record<string, unknown>)
      : {};
  if (
    !governedBusinessContextWriteAllowed(
      opportunity.businessContext,
      field,
      value,
    )
  ) {
    throw new Error('human_verified_value_preserved');
  }
  opportunity.businessContext = {
    ...opportunity.businessContext,
    [field]: value,
    fieldProvenance: {
      ...provenance,
      [field]: {
        source: 'governed_agent',
        decisionId,
        actionId: action.id,
        evidenceRefs: action.canonicalRefs.filter((ref) =>
          /^(message|transcription|image):/.test(ref),
        ),
      },
    },
  };
}

export function governedBusinessContextWriteAllowed(
  context: Record<string, unknown>,
  field: string,
  value: string | number | boolean,
) {
  const current = context[field];
  if (current === undefined || current === null) {
    return true;
  }
  if (
    (typeof current === 'string' ||
      typeof current === 'number' ||
      typeof current === 'boolean') &&
    (!String(current).trim() || String(current) === String(value))
  )
    return true;
  const provenance =
    context.fieldProvenance &&
    typeof context.fieldProvenance === 'object' &&
    !Array.isArray(context.fieldProvenance)
      ? (context.fieldProvenance as Record<string, unknown>)
      : {};
  const fieldProvenance = provenance[field];
  return Boolean(
    fieldProvenance &&
    typeof fieldProvenance === 'object' &&
    !Array.isArray(fieldProvenance) &&
    (fieldProvenance as Record<string, unknown>).source === 'governed_agent',
  );
}
