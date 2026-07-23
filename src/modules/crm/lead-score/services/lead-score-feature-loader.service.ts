import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { InboxMessageEntity } from '../../../inbox/entities/inbox-message.entity';
import type { CrmOpportunityEntity } from '../../entities/crm-opportunity.entity';
import { CrmStageEntity } from '../../entities/crm-stage.entity';
import { CrmOpportunityFieldCatalogService } from '../../services/crm-opportunity-field-catalog.service';
import {
  LeadScoreFeatureKey,
  type LeadScoreFeature,
  type LeadScoreFeatureSet,
  type LeadScorePolicy,
} from '../lead-score.types';

export interface LeadScoreFeatureLoadResult {
  features: LeadScoreFeatureSet;
  queryCount: number;
  durationMs: number;
}

/**
 * Loads exactly the features the active rules consult, and nothing else.
 *
 * Demand-driven on purpose: a policy where half the rules are `planned` must
 * not pay for reads that feed them. Each source is consulted at most once per
 * calculation, and a source that cannot answer produces an explicit gap rather
 * than a zero — because a rule scoring zero and a rule that could not be
 * evaluated must never look the same in the breakdown.
 */
@Injectable()
export class LeadScoreFeatureLoaderService {
  constructor(
    private readonly fieldCatalog: CrmOpportunityFieldCatalogService,
  ) {}

  async load(
    manager: EntityManager,
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
    policy: LeadScorePolicy,
  ): Promise<LeadScoreFeatureLoadResult> {
    const startedAt = Date.now();
    const wanted = new Set(
      policy.rules
        .filter((rule) => rule.availability === 'active')
        .flatMap((rule) => rule.features),
    );

    const features: LeadScoreFeatureSet = {};
    const observedAt = new Date().toISOString();
    let queryCount = 0;

    const set = (key: LeadScoreFeatureKey, feature: LeadScoreFeature): void => {
      features[key] = feature;
    };

    // --- read off the opportunity itself: no query -------------------------
    const conversationId = opportunity.inboxConversationId ?? null;

    if (wanted.has(LeadScoreFeatureKey.ConversationLinked)) {
      set(LeadScoreFeatureKey.ConversationLinked, {
        available: true,
        value: conversationId !== null,
        observedAt,
      });
    }

    if (wanted.has(LeadScoreFeatureKey.OriginatedFromChannel)) {
      // An opportunity linked to a conversation demonstrably arrived through a
      // channel; one created by hand has no conversation to link to.
      set(LeadScoreFeatureKey.OriginatedFromChannel, {
        available: true,
        value: conversationId !== null,
        observedAt,
      });
    }

    if (wanted.has(LeadScoreFeatureKey.LifecycleStatus)) {
      set(LeadScoreFeatureKey.LifecycleStatus, {
        available: true,
        value: opportunity.status,
        observedAt,
      });
    }

    // --- one read per remaining source -------------------------------------
    if (wanted.has(LeadScoreFeatureKey.InboundMessageCount)) {
      if (!conversationId) {
        set(LeadScoreFeatureKey.InboundMessageCount, {
          available: false,
          reason: 'no_canonical_link',
        });
      } else {
        queryCount += 1;
        const count = await manager.getRepository(InboxMessageEntity).count({
          where: {
            tenantId: opportunity.tenantId,
            workspaceId: opportunity.workspaceId,
            conversationId,
            direction: 'inbound',
          },
        });
        set(LeadScoreFeatureKey.InboundMessageCount, {
          available: true,
          value: count,
          observedAt,
        });
      }
    }

    if (wanted.has(LeadScoreFeatureKey.StageIsLost)) {
      queryCount += 1;
      const stage = await manager.getRepository(CrmStageEntity).findOne({
        where: {
          id: opportunity.stageId,
          tenantId: opportunity.tenantId,
          workspaceId: opportunity.workspaceId,
        },
        select: { id: true, isLostStage: true },
      });
      set(
        LeadScoreFeatureKey.StageIsLost,
        stage
          ? { available: true, value: stage.isLostStage, observedAt }
          : { available: false, reason: 'no_canonical_link' },
      );
    }

    if (
      wanted.has(LeadScoreFeatureKey.EssentialFieldsTotal) ||
      wanted.has(LeadScoreFeatureKey.EssentialFieldsPresent)
    ) {
      queryCount += 1;
      const essential = await this.fieldCatalog.essentialFields(
        ctx,
        opportunity.businessMode ?? null,
      );

      if (!essential.resolved) {
        // An unresolved Business Mode means the qualification requirements are
        // unknown. Reporting zero required fields would make every lead look
        // fully qualified.
        set(LeadScoreFeatureKey.EssentialFieldsTotal, {
          available: false,
          reason: 'business_mode_unresolved',
        });
        set(LeadScoreFeatureKey.EssentialFieldsPresent, {
          available: false,
          reason: 'business_mode_unresolved',
        });
      } else {
        const present = essential.fields.filter((spec) =>
          isPresent(readField(opportunity, spec.key)),
        ).length;
        set(LeadScoreFeatureKey.EssentialFieldsTotal, {
          available: true,
          value: essential.fields.length,
          observedAt,
        });
        set(LeadScoreFeatureKey.EssentialFieldsPresent, {
          available: true,
          value: present,
          observedAt,
        });
      }
    }

    return { features, queryCount, durationMs: Date.now() - startedAt };
  }
}

/** Mirrors how transition policies address opportunity fields. */
function readField(opportunity: CrmOpportunityEntity, field: string): unknown {
  if (field.startsWith('businessContext.')) {
    return opportunity.businessContext?.[
      field.slice('businessContext.'.length)
    ];
  }
  return (opportunity as unknown as Record<string, unknown>)[field];
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
