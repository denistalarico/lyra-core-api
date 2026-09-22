import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Campaign recommendations boundary', () => {
  const service = readFileSync(
    join(__dirname, 'social-campaign-recommendation.service.ts'),
    'utf8',
  );
  const provider = readFileSync(
    join(__dirname, 'social-campaign-recommendation.provider.ts'),
    'utf8',
  );
  const controller = readFileSync(
    join(__dirname, '..', 'social-campaigns.controller.ts'),
    'utf8',
  );

  it('uses the local read model and has no dependency capable of Meta writes', () => {
    expect(service).toContain('SocialAnalyticsReadService');
    expect(service).toContain('evidenceSnapshot');
    expect(service).not.toMatch(
      /graph\.facebook|credential|accessToken|MetaAdsClient/,
    );
    expect(provider).not.toMatch(
      /graph\.facebook|credential|accessToken|MetaAdsClient/,
    );
  });

  it('exposes generation and history without an accept/apply/reject lifecycle', () => {
    expect(controller).toContain("@Post('meta/recommendations/generate')");
    expect(controller).toContain("@Get('meta/recommendations')");
    expect(controller).not.toMatch(
      /recommendations\/(?:accept|apply|reject|execute|pause|budget)/,
    );
  });

  it('reserves scoped daily budget behind an advisory lock and request identity', () => {
    expect(service).toContain('pg_advisory_xact_lock');
    expect(service).toContain('dailyBudgetCents');
    expect(service).toContain('reserveCents');
    expect(service).toContain('requestId: dto.requestId');
  });
});
