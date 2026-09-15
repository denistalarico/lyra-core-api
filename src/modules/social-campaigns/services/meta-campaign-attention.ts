import type { SocialAdEntity } from '../../social-integrations/entities';
import type {
  MetaCampaignAttentionReason,
  MetaCampaignNodeMetrics,
} from '../views/meta-campaign-hierarchy.view';

const DELIVERY_ISSUE_STATUSES = new Set([
  'ACCOUNT_DISABLED',
  'DISAPPROVED',
  'PENDING_BILLING_INFO',
  'WITH_ISSUES',
]);

export function deriveMetaCampaignAttentionReasons(input: {
  entity: SocialAdEntity;
  metrics: MetaCampaignNodeMetrics;
  connectionLastSyncedAt: Date | null;
  now?: Date;
}): MetaCampaignAttentionReason[] {
  const { entity, metrics, connectionLastSyncedAt } = input;
  const now = input.now ?? new Date();
  const reasons = new Set<MetaCampaignAttentionReason>();
  const effectiveStatus = entity.effectiveStatus?.toUpperCase() ?? null;

  if (entity.archivedAt || effectiveStatus === 'ARCHIVED') {
    reasons.add('archived');
  }
  if (!entity.name?.trim()) reasons.add('missing_name');
  if (entity.budgetRemainingMinor === '0') reasons.add('budget_exhausted');
  if (entity.stopTime && entity.stopTime.getTime() < now.getTime()) {
    reasons.add('ended');
  }
  if (effectiveStatus && DELIVERY_ISSUE_STATUSES.has(effectiveStatus)) {
    reasons.add('delivery_issue');
  }
  if (
    entity.entityLevel === 'adset' &&
    (!entity.destinationType || entity.destinationType === 'unknown')
  ) {
    reasons.add('destination_unknown');
  }
  if (metrics.hasPartialData) reasons.add('partial_data');

  if (
    connectionLastSyncedAt &&
    connectionLastSyncedAt.getTime() - entity.lastSeenAt.getTime() >
      36 * 60 * 60 * 1000
  ) {
    reasons.add('stale');
  }

  return [...reasons];
}
