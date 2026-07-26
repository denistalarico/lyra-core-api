import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { LeadFlowAgentChannelBindingEntity } from '../../leadflow-agents/entities/leadflow-agent-channel-binding.entity';
import { LeadFlowAgentStatus } from '../../leadflow-agents/enums/leadflow-agent-status.enum';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import {
  audienceServesRelationship,
  ContactRelationship,
} from '../../leadflow-agents/catalog/contact-relationship.catalog';
import { resolveServiceAudience } from '../../leadflow-agents/enums/leadflow-service-audience.enum';

export type ActivationReasonCode =
  | 'already_active'
  | 'manual_required'
  | 'eligible_channel'
  | 'keyword_match'
  | 'keyword_missing'
  | 'trusted_ad_referral'
  | 'ad_referral_missing_or_untrusted'
  | 'channel_unavailable'
  | 'channel_ai_disabled'
  | 'agent_unpublished'
  | 'binding_ineligible'
  | 'internal_contact'
  | 'duplicate_message'
  | 'conversation_human_or_closed'
  | 'disqualified_contact'
  | 'audience_mismatch';

@Injectable()
export class AgentActivationPolicyService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async evaluate(input: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
    messageText?: string;
    conversationState?: string;
    internalContact?: boolean;
    duplicate?: boolean;
    qualificationStatus?: string;
    referralTrusted?: boolean;
    referral?: Record<string, unknown>;
    contactRelationship?: ContactRelationship;
  }) {
    const exclusions: ActivationReasonCode[] = [];
    const channel = await this.dataSource
      .getRepository(InboxChannelEntity)
      .findOneBy({
        id: input.channelId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      });
    if (
      !channel ||
      channel.connectionStatus !== 'connected' ||
      channel.status !== 'active'
    )
      exclusions.push('channel_unavailable');
    if (!channel?.aiEnabled) exclusions.push('channel_ai_disabled');
    if (input.internalContact) exclusions.push('internal_contact');
    if (input.duplicate) exclusions.push('duplicate_message');
    if (
      ['human_active', 'paused', 'closed'].includes(
        input.conversationState ?? '',
      )
    )
      exclusions.push('conversation_human_or_closed');
    if (
      ['disqualified', 'non_lead', 'internal'].includes(
        input.qualificationStatus ?? '',
      )
    )
      exclusions.push('disqualified_contact');
    if (input.conversationState === 'ai_active' && exclusions.length === 0) {
      return this.result(
        true,
        'already_active',
        exclusions,
        channel,
        null,
        null,
        { trigger: 'continuity' },
      );
    }

    const agent = channel?.defaultAgentId
      ? await this.dataSource.getRepository(LeadFlowAgentEntity).findOneBy({
          id: channel.defaultAgentId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
        })
      : null;
    if (
      !agent ||
      agent.status !== LeadFlowAgentStatus.Active ||
      !agent.publishedVersionId
    )
      exclusions.push('agent_unpublished');
    const binding = agent
      ? await this.dataSource
          .getRepository(LeadFlowAgentChannelBindingEntity)
          .createQueryBuilder('binding')
          .where(
            'binding.tenant_id = :tenantId AND binding.workspace_id = :workspaceId AND binding.agent_id = :agentId',
            {
              tenantId: input.tenantId,
              workspaceId: input.workspaceId,
              agentId: agent.id,
            },
          )
          .andWhere("binding.status = 'active'")
          .andWhere(
            "(binding.external_ref = :channelId OR binding.config->>'channelId' = :channelId)",
            { channelId: input.channelId },
          )
          .getOne()
      : null;
    if (!binding) exclusions.push('binding_ineligible');

    // Audience filtering: an agent only serves the relationships its
    // `serviceAudience` covers. An internal user is never served; an unknown
    // relationship never blocks (only a definite opposite does), so this cannot
    // silence a legitimate lead just because classification was incomplete.
    if (
      agent &&
      input.contactRelationship &&
      !audienceServesRelationship(
        resolveServiceAudience(agent.behaviorConfig),
        input.contactRelationship,
      )
    ) {
      exclusions.push('audience_mismatch');
    }

    const rawPolicy = agent?.channelPolicy?.activationPolicy;
    const policy =
      rawPolicy && typeof rawPolicy === 'object' && !Array.isArray(rawPolicy)
        ? (rawPolicy as Record<string, unknown>)
        : { trigger: 'manual' };
    const trigger =
      typeof policy.trigger === 'string' ? policy.trigger : 'manual';
    let matched = false;
    let reason: ActivationReasonCode = 'manual_required';
    if (trigger === 'every_eligible') {
      matched = true;
      reason = 'eligible_channel';
    }
    if (trigger === 'keywords') {
      const text = normalize(input.messageText ?? '');
      const keywords = Array.isArray(policy.keywords)
        ? policy.keywords.filter(
            (item): item is string => typeof item === 'string',
          )
        : [];
      const mode =
        policy.keywordMode === 'phrase_contains' ? 'phrase_contains' : 'word';
      const words = text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
      matched = keywords.some((keyword) => {
        const target = normalize(keyword);
        return mode === 'phrase_contains'
          ? text.includes(target)
          : words.includes(target);
      });
      reason = matched ? 'keyword_match' : 'keyword_missing';
    }
    if (trigger === 'ad_referral') {
      matched = Boolean(
        input.referralTrusted &&
        this.matchesReferralFilters(policy, input.referral ?? {}),
      );
      reason = matched
        ? 'trusted_ad_referral'
        : 'ad_referral_missing_or_untrusted';
    }
    const wouldActivate = matched && exclusions.length === 0;
    return this.result(
      wouldActivate,
      reason,
      exclusions,
      channel,
      binding,
      agent,
      {
        trigger,
        normalizedMessage:
          trigger === 'keywords'
            ? normalize(input.messageText ?? '')
            : undefined,
      },
    );
  }

  private matchesReferralFilters(
    policy: Record<string, unknown>,
    referral: Record<string, unknown>,
  ) {
    const filters =
      policy.adFilters &&
      typeof policy.adFilters === 'object' &&
      !Array.isArray(policy.adFilters)
        ? (policy.adFilters as Record<string, unknown>)
        : {};
    return ['accountId', 'campaignId', 'adId'].every((key) => {
      const allowed = Array.isArray(filters[key])
        ? (filters[key] as unknown[]).filter(
            (item): item is string => typeof item === 'string',
          )
        : [];
      const referralValue = referral[key];
      return (
        allowed.length === 0 ||
        (typeof referralValue === 'string' && allowed.includes(referralValue))
      );
    });
  }

  private result(
    wouldActivate: boolean,
    reasonCode: ActivationReasonCode,
    exclusions: ActivationReasonCode[],
    channel: InboxChannelEntity | null,
    binding: LeadFlowAgentChannelBindingEntity | null,
    agent: LeadFlowAgentEntity | null,
    trigger: Record<string, unknown>,
  ) {
    return {
      wouldActivate,
      policyVersion: 1,
      trigger,
      reasonCode,
      exclusions: [...new Set(exclusions)],
      resolved: {
        channelId: channel?.id ?? null,
        bindingId: binding?.id ?? null,
        agentId: agent?.id ?? null,
        agentVersionId: agent?.publishedVersionId ?? null,
      },
      automaticEffects: { reply: false, crm: false, followUp: false },
    };
  }
}

export function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/\s+/g, ' ');
}
