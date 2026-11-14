import type { SocialAdEntity } from '../../social-integrations/entities';
import { deriveMetaCampaignAttentionReasons } from './meta-campaign-attention';

const METRICS = {
  hasData: true,
  spend: '1',
  impressions: '1',
  clicks: '1',
  leads: '0',
  conversions: '0',
  hasPartialData: false,
};

function adSet(provider: string) {
  return {
    provider,
    entityLevel: 'adset',
    name: 'Grupo',
    effectiveStatus: 'ACTIVE',
    archivedAt: null,
    destinationType: null,
    budgetRemainingMinor: null,
    stopTime: null,
    lastSeenAt: new Date(),
  } as unknown as SocialAdEntity;
}

describe('campaign attention reasons by provider (G2)', () => {
  it('does not flag a Google ad group for a missing Meta destination', () => {
    expect(
      deriveMetaCampaignAttentionReasons({
        entity: adSet('google_ads'),
        metrics: METRICS,
        connectionLastSyncedAt: null,
      }),
    ).not.toContain('destination_unknown');
  });

  it('keeps flagging a Meta ad set without a destination', () => {
    expect(
      deriveMetaCampaignAttentionReasons({
        entity: adSet('meta_ads'),
        metrics: METRICS,
        connectionLastSyncedAt: null,
      }),
    ).toContain('destination_unknown');
  });
});
