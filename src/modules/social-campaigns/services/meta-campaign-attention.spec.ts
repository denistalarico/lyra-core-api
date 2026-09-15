import type { SocialAdEntity } from '../../social-integrations/entities';
import { deriveMetaCampaignAttentionReasons } from './meta-campaign-attention';

const metrics = {
  hasData: true,
  spend: '0',
  impressions: '0',
  clicks: '0',
  leads: '0',
  conversions: '0',
  hasPartialData: false,
};

function entity(overrides: Partial<SocialAdEntity> = {}) {
  return {
    entityLevel: 'campaign',
    name: 'Campaign',
    effectiveStatus: 'ACTIVE',
    archivedAt: null,
    budgetRemainingMinor: '1000',
    stopTime: null,
    destinationType: null,
    lastSeenAt: new Date('2026-09-15T10:00:00Z'),
    ...overrides,
  } as SocialAdEntity;
}

describe('deriveMetaCampaignAttentionReasons', () => {
  it('reports deterministic operational evidence without provider calls', () => {
    const result = deriveMetaCampaignAttentionReasons({
      entity: entity({
        effectiveStatus: 'WITH_ISSUES',
        budgetRemainingMinor: '0',
      }),
      metrics: { ...metrics, hasPartialData: true },
      connectionLastSyncedAt: new Date('2026-09-15T11:00:00Z'),
      now: new Date('2026-09-15T12:00:00Z'),
    });

    expect(result).toEqual([
      'budget_exhausted',
      'delivery_issue',
      'partial_data',
    ]);
  });

  it('marks an ad set whose current destination is not known', () => {
    const result = deriveMetaCampaignAttentionReasons({
      entity: entity({ entityLevel: 'adset', destinationType: 'unknown' }),
      metrics,
      connectionLastSyncedAt: null,
    });

    expect(result).toEqual(['destination_unknown']);
  });

  it('uses the connection sync as the staleness reference', () => {
    const result = deriveMetaCampaignAttentionReasons({
      entity: entity({ lastSeenAt: new Date('2026-09-13T00:00:00Z') }),
      metrics,
      connectionLastSyncedAt: new Date('2026-09-15T00:00:00Z'),
    });

    expect(result).toContain('stale');
  });
});
