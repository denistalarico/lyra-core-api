import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('social campaign monitor migration', () => {
  const source = readFileSync(
    join(__dirname, '1793300000000-create-social-campaign-monitor.ts'),
    'utf8',
  );

  it('persists scoped policies and deduplicated alerts', () => {
    expect(source).toContain('social_campaign_monitor_policies');
    expect(source).toContain('social_campaign_alerts');
    expect(source).toContain('UQ_social_campaign_monitor_policies_connection');
    expect(source).toContain('UQ_social_campaign_alerts_deduplication');
    expect(source).toContain('cooldown_minutes');
    expect(source).toContain('agency_client_id');
  });
});
