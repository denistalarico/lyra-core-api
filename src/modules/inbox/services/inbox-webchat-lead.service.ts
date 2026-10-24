import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, IsNull } from 'typeorm';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { ContactMethodEntity } from '../../contacts/entities/contact-method.entity';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { InboxChannelContactIdentityEntity } from '../entities/inbox-channel-contact-identity.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { inboxScopeRequestContext } from '../inbox-company-scope';
import { resolveRoutedCrmTarget } from '../runtime/inbox-crm-target-resolver';
import { ensureLeadFlowContactMembership } from './inbox-leadflow-contact-membership';
import { normalizeIdentity } from './inbox-governed-action.worker';

export type WebchatLeadInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type WebchatLeadOutcome =
  | { status: 'captured'; contactId: string; opportunityId: string | null }
  | { status: 'skipped'; reason: string };

/**
 * Turns a Webchat lead form (name + phone) into a LeadFlow contact and a CRM
 * opportunity, in the Agency database.
 *
 * A visitor who leaves name and phone has shown real interest, so this does
 * not wait for the AI attendant to qualify the conversation (the governed
 * `ensure_opportunity` path) and does not require the channel to have AI on.
 * Both paths converge: the contact is found by the same phone identity, and an
 * opportunity already linked to the conversation is reused, never duplicated.
 *
 * Idempotent: every call re-checks the conversation's contact and opportunity,
 * so the widget may send the lead again on each message.
 */
@Injectable()
export class InboxWebchatLeadService {
  private readonly logger = new Logger(InboxWebchatLeadService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @Optional()
    private readonly opportunityCommands?: CrmOpportunityCommandService,
  ) {}

  async captureLead(
    scope: { tenantId: string; workspaceId: string },
    webchatConversationId: string,
    lead: WebchatLeadInput,
  ): Promise<WebchatLeadOutcome> {
    const name = lead.name?.trim() || null;
    const phone = lead.phone?.trim() || null;
    if (!name || !phone) return { status: 'skipped', reason: 'lead_incomplete' };

    let identity: string;
    try {
      identity = normalizeIdentity(phone);
    } catch {
      return { status: 'skipped', reason: 'phone_invalid' };
    }

    const linked = await this.ensureContact(scope, webchatConversationId, {
      name,
      identity,
      email: lead.email?.trim().toLowerCase() || null,
    });
    if (linked.status === 'skipped') return linked;

    const opportunityId = await this.ensureOpportunity(linked.conversation);
    return {
      status: 'captured',
      contactId: linked.conversation.contactId!,
      opportunityId,
    };
  }

  private async ensureContact(
    scope: { tenantId: string; workspaceId: string },
    webchatConversationId: string,
    lead: { name: string; identity: string; email: string | null },
  ): Promise<
    | { status: 'linked'; conversation: InboxConversationEntity }
    | { status: 'skipped'; reason: string }
  > {
    return this.dataSource.transaction(async (manager) => {
      const conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            source: 'webchat',
            externalThreadId: webchatConversationId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!conversation?.channelId) {
        return { status: 'skipped', reason: 'conversation_not_synced' };
      }
      if (conversation.contactId) return { status: 'linked', conversation };

      const externalIdentityHash = createHash('sha256')
        .update(lead.identity)
        .digest('hex');
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          `${scope.tenantId}:${scope.workspaceId}:${conversation.channelId}:${externalIdentityHash}`,
        ],
      );
      const identities = manager.getRepository(
        InboxChannelContactIdentityEntity,
      );
      const known = await identities.findOneBy({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        channelId: conversation.channelId,
        externalIdentityHash,
      });

      let contactId = known?.contactId ?? null;
      if (!contactId) {
        const matches = await manager.query<
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
          [scope.tenantId, scope.workspaceId, lead.identity.slice(1)],
        );
        if (matches.length > 1) {
          return { status: 'skipped', reason: 'contact_ambiguous' };
        }
        if (matches[0]?.status === 'archived') {
          return { status: 'skipped', reason: 'contact_archived' };
        }
        contactId =
          matches[0]?.id ??
          (await this.createContact(manager, scope, lead)).id;
        await identities.save({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          channelId: conversation.channelId,
          contactId,
          externalIdentityHash,
          identityType: 'phone',
          provenance: {
            source: matches[0]
              ? 'existing_contact_method'
              : 'webchat_lead_form',
            webchatConversationId,
          },
        });
      }

      conversation.contactId = contactId;
      await manager.getRepository(InboxConversationEntity).save(conversation);
      await ensureLeadFlowContactMembership(
        manager,
        scope,
        conversation.channelId,
        contactId,
      );
      return { status: 'linked', conversation };
    });
  }

  private async createContact(
    manager: import('typeorm').EntityManager,
    scope: { tenantId: string; workspaceId: string },
    lead: { name: string; identity: string; email: string | null },
  ): Promise<ContactEntity> {
    const contact = await manager.getRepository(ContactEntity).save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      type: 'person',
      displayName: lead.name.slice(0, 180),
      firstName: null,
      lastName: null,
      legalName: null,
      documentType: null,
      documentNumber: null,
      jobTitle: null,
      companyContactId: null,
      source: 'leadflow_webchat',
      businessMode: 'general',
      lifecycleStage: 'lead',
      lifecycleStages: ['lead'],
      status: 'active',
      ownerUserId: null,
      createdByUserId: null,
      notes: null,
    });
    const methods = manager.getRepository(ContactMethodEntity);
    await methods.save({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      contactId: contact.id,
      type: 'phone',
      value: lead.identity,
      label: 'LeadFlow Webchat',
      isPrimary: true,
      verifiedAt: null,
    });
    if (lead.email) {
      await methods.save({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        contactId: contact.id,
        type: 'email',
        value: lead.email,
        label: 'LeadFlow Webchat',
        isPrimary: false,
        verifiedAt: null,
      });
    }
    return contact;
  }

  /**
   * Opens the opportunity in the channel's pipeline. Reuses one already linked
   * to the conversation; a conversation whose last cycle ended is left for the
   * explicit reconversion (agent or operator), as the CRM requires.
   */
  private async ensureOpportunity(
    conversation: InboxConversationEntity,
  ): Promise<string | null> {
    if (!this.opportunityCommands) return null;
    const existing = await this.dataSource
      .getRepository(CrmOpportunityEntity)
      .findOne({
        where: {
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          inboxConversationId: conversation.id,
          deletedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
    if (existing) return existing.status === 'open' ? existing.id : null;

    const target = await resolveRoutedCrmTarget(
      this.dataSource.manager,
      {
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        channelId: conversation.channelId,
        businessMode: conversation.businessMode,
      },
      { requireAiEnabled: false },
    );
    if (!target.ok) {
      this.logger.warn({
        event: 'webchat_lead_opportunity_skipped',
        reason: target.errorCode,
      });
      return null;
    }
    const contact = await this.dataSource
      .getRepository(ContactEntity)
      .findOneBy({
        id: conversation.contactId!,
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
      });
    const phone = await this.dataSource
      .getRepository(ContactMethodEntity)
      .findOne({
        where: {
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          contactId: conversation.contactId!,
          isPrimary: true,
        },
      });
    const clientId =
      typeof target.channel.metadata?.clientId === 'string'
        ? target.channel.metadata.clientId
        : null;
    const displayName = contact?.displayName ?? 'Lead Webchat';
    const candidate = this.dataSource
      .getRepository(CrmOpportunityEntity)
      .create({
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        agencyClientId: conversation.agencyClientId,
        companyContextId: conversation.companyContextId,
        scopeKind: conversation.scopeKind,
        pipelineId: target.pipeline.id,
        stageId: target.initialStage.id,
        contactId: conversation.contactId,
        contactName: displayName,
        contactEmail: null,
        contactPhone:
          phone?.type === 'phone' || phone?.type === 'whatsapp'
            ? phone.value
            : null,
        inboxConversationId: conversation.id,
        title: `LeadFlow — ${displayName}`.slice(0, 180),
        status: 'open',
        priority: conversation.priority,
        source: 'webchat',
        businessMode: conversation.businessMode,
        operationalStatus: conversation.ownershipState,
        businessContext: {
          origin: 'leadflow_webchat_form',
          acquisitionChannel: 'webchat',
          channelId: conversation.channelId,
        },
        assignedUserId: null,
        currency: 'BRL',
        visibility: 'workspace',
        metadata: {
          createdBy: 'webchat_lead_capture',
          sourceProvenance: 'webchat_lead_form',
          operatingMode: clientId ? 'client' : 'agency',
          clientId,
        },
      });
    const saved = await this.opportunityCommands.createOpportunity(
      inboxScopeRequestContext(conversation),
      candidate,
      {
        actor: { type: 'automation' },
        idempotencyKey: `webchat-lead:${conversation.id}:opportunity`,
        reason: 'webchat_lead_capture',
      },
    );
    return saved.id;
  }
}
