import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { createHash } from 'crypto';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { ContactMethodEntity } from '../../contacts/entities/contact-method.entity';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../../crm/entities/crm-stage.entity';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxGovernedActionEntity } from '../entities/inbox-governed-action.entity';
import { InboxChannelContactIdentityEntity } from '../entities/inbox-channel-contact-identity.entity';
import { InboxAutonomyControlEntity } from '../entities/inbox-autonomy-control.entity';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';
import { WhatsAppOutboundService } from '../channels/whatsapp/services/whatsapp-outbound.service';
import { ConversationOwnershipService } from './conversation-ownership.service';

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
    private readonly ownership: ConversationOwnershipService,
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
        const sent = await this.outbound.sendAgentText({
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
        const contactId = await this.ensureContact(action, conversation);
        await this.finish(action, 'applied', null, { contactId });
      } else if (action.actionType === 'ensure_opportunity') {
        const opportunityId = await this.ensureOpportunity(
          action,
          conversation,
        );
        await this.finish(action, 'applied', null, { opportunityId });
      } else if (action.actionType === 'handoff') {
        const planned = this.plannedAction(decision, action.actionKey);
        await this.ownership.transition(
          {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
          },
          conversation.id,
          'request_handoff',
          typeof planned?.value === 'string'
            ? planned.value
            : 'governed_handoff',
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
              ELSE 2
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
  ): Promise<string> {
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
      if (conversation.contactId) return conversation.contactId;
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
        await manager.getRepository(InboxConversationEntity).save(conversation);
        return existing.contactId;
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
        await manager.getRepository(InboxConversationEntity).save(conversation);
        return contactMatches[0].id;
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
      await manager.getRepository(InboxConversationEntity).save(conversation);
      await this.auditCreatedEntity(manager, action, 'contact', contact.id);
      return contact.id;
    });
  }

  private async ensureOpportunity(
    action: InboxGovernedActionEntity,
    snapshot: InboxConversationEntity,
  ): Promise<string> {
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
      const existing = await manager
        .getRepository(CrmOpportunityEntity)
        .findOne({
          where: {
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
            inboxConversationId: conversation.id,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (existing) {
        if (conversation.opportunityId !== existing.id) {
          conversation.opportunityId = existing.id;
          await manager
            .getRepository(InboxConversationEntity)
            .save(conversation);
        }
        return existing.id;
      }
      if (!conversation.contactId) throw new Error('contact_missing');
      const pipelines = await manager.getRepository(CrmPipelineEntity).find({
        where: {
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          businessMode: conversation.businessMode,
          isDefault: true,
          status: 'active',
        },
      });
      if (pipelines.length !== 1)
        throw new Error('opportunity_defaults_ambiguous');
      const stage = await manager.getRepository(CrmStageEntity).findOne({
        where: {
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          pipelineId: pipelines[0].id,
          type: 'open',
        },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });
      if (!stage) throw new Error('initial_stage_missing');
      const opportunity = await manager
        .getRepository(CrmOpportunityEntity)
        .save({
          tenantId: action.tenantId,
          workspaceId: action.workspaceId,
          pipelineId: pipelines[0].id,
          stageId: stage.id,
          contactId: conversation.contactId,
          contactName: safeContactName(conversation.title),
          contactEmail: null,
          contactPhone: null,
          inboxConversationId: conversation.id,
          title: `LeadFlow — ${safeContactName(conversation.title)}`.slice(
            0,
            180,
          ),
          description: null,
          valueAmount: null,
          currency: 'BRL',
          status: 'open',
          priority: conversation.priority,
          source: 'leadflow',
          businessMode: conversation.businessMode,
          operationalStatus: null,
          businessContext: {
            origin: 'leadflow_inbox',
            channelId: conversation.channelId,
            governedActionId: action.id,
          },
          assignedUserId: null,
          expectedCloseDate: null,
          nextFollowUpAt: null,
          lastActivityAt: null,
          wonAt: null,
          lostAt: null,
          lostReason: null,
          cardColor: null,
          sortOrder: 0,
          visibility: 'workspace',
          followMode: 'manual',
          followMessage: null,
          followSendAutomatically: false,
          metadata: { createdBy: 'governed_autonomy' },
        });
      conversation.opportunityId = opportunity.id;
      await manager.getRepository(InboxConversationEntity).save(conversation);
      await this.auditCreatedEntity(
        manager,
        action,
        'opportunity',
        opportunity.id,
      );
      return opportunity.id;
    });
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
      const value = typeof planned.value === 'string' ? planned.value : null;
      if (action.actionType === 'set_summary' && value) {
        opportunity.businessContext = {
          ...opportunity.businessContext,
          agentSummary: value,
        };
      } else if (action.actionType === 'set_service' && value) {
        opportunity.businessContext = {
          ...opportunity.businessContext,
          service: value,
        };
      } else if (
        action.actionType === 'set_urgency' &&
        value &&
        ['low', 'normal', 'high', 'urgent'].includes(value)
      ) {
        opportunity.priority = value;
        opportunity.businessContext = {
          ...opportunity.businessContext,
          urgency: value,
        };
      } else if (action.actionType === 'add_tag' && value) {
        await this.assignExistingTag(
          manager,
          action,
          opportunity.id,
          slug(value),
        );
      } else {
        throw new Error('automatic_crm_action_not_supported');
      }
      await manager.getRepository(CrmOpportunityEntity).save(opportunity);
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
  const value = error instanceof Error ? error.message : 'effect_failed';
  return /^[a-z0-9_]{1,80}$/.test(value) ? value : 'effect_failed';
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
