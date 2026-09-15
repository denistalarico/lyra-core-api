import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Social Campaign Monitor boundary', () => {
  const service = readFileSync(
    join(__dirname, 'social-campaign-monitor.service.ts'),
    'utf8',
  );
  const scheduler = readFileSync(
    join(__dirname, 'social-campaign-monitor.scheduler.ts'),
    'utf8',
  );

  it('reads the local paid account grain and never imports a provider client', () => {
    expect(service).toContain("metric.entity_level = :level");
    expect(service).toContain("level: 'account'");
    expect(service).toContain("source: 'paid'");
    expect(service).not.toMatch(/GraphApi|CredentialResolver|facebook\.com/);
    expect(service).not.toMatch(/\.update\([^)]*SocialAdEntity/);
  });

  it('has a dedicated scheduler kill switch', () => {
    expect(scheduler).toContain('SOCIAL_CAMPAIGN_MONITOR_ENABLED');
    expect(scheduler).toContain("@Cron('*/15 * * * *')");
  });

  it('does not accept HTTP scope fields in the monitor DTO', () => {
    const dto = readFileSync(
      join(__dirname, '../dto/social-campaign-monitor.dto.ts'),
      'utf8',
    );
    expect(dto).not.toMatch(/tenantId|workspaceId|agencyClientId/);
  });
});
