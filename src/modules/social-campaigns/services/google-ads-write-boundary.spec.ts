import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SocialAdActionsConfigService } from './social-ad-actions-config.service';

/**
 * GA-WRITE (D-G5) turned the G2 guard around on purpose: Google Ads may now be
 * written, but only through the governed `google/actions/*` routes, only with
 * its own brake, and only through one adapter. Boost stays Meta-only, and
 * TikTok and LinkedIn stay read-only.
 */
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
const controller = readFileSync(
  join(__dirname, '../social-campaigns.controller.ts'),
  'utf8',
);
const mutatingRoutes = (prefix: string) =>
  [
    ...controller.matchAll(
      new RegExp(
        `@(?:Post|Patch|Put|Delete)\\(\\s*['"](${prefix}[^'"]*)['"]`,
        'g',
      ),
    ),
  ].map((match) => match[1]);

describe('Google Ads write boundary (GA-WRITE)', () => {
  it('mutates Google only through google/actions/*', () => {
    const routes = mutatingRoutes('google');
    expect(routes.length).toBeGreaterThan(0);
    expect(
      routes.filter((route) => !route.startsWith('google/actions/')),
    ).toEqual([]);
  });

  it('offers no schedule or delete on Google', () => {
    expect(
      mutatingRoutes('google/actions/').filter((route) =>
        /\/(schedule|delete)\//.test(route),
      ),
    ).toEqual([]);
  });

  it('keeps every Google write route out of the Client Area', () => {
    expect(controller).not.toMatch(
      /@ClientAreaExposed\([^)]*\)\s*@(Get|Post|Patch|Put|Delete)\(\s*['"]google\/actions/,
    );
  });

  it('opens Google writes only with SOCIAL_CAMPAIGN_GOOGLE_WRITES_ENABLED', () => {
    const previous = {
      meta: process.env.SOCIAL_CAMPAIGN_META_WRITES_ENABLED,
      google: process.env.SOCIAL_CAMPAIGN_GOOGLE_WRITES_ENABLED,
    };
    try {
      process.env.SOCIAL_CAMPAIGN_META_WRITES_ENABLED = 'true';
      delete process.env.SOCIAL_CAMPAIGN_GOOGLE_WRITES_ENABLED;
      const metaOnly = new SocialAdActionsConfigService();
      expect(metaOnly.writesEnabledFor('google_ads')).toBe(false);
      expect(metaOnly.writesEnabledFor('meta_ads')).toBe(true);

      process.env.SOCIAL_CAMPAIGN_META_WRITES_ENABLED = 'false';
      process.env.SOCIAL_CAMPAIGN_GOOGLE_WRITES_ENABLED = 'true';
      const googleOnly = new SocialAdActionsConfigService();
      expect(googleOnly.writesEnabledFor('google_ads')).toBe(true);
      expect(googleOnly.writesEnabledFor('meta_ads')).toBe(false);
    } finally {
      for (const [key, value] of [
        ['SOCIAL_CAMPAIGN_META_WRITES_ENABLED', previous.meta],
        ['SOCIAL_CAMPAIGN_GOOGLE_WRITES_ENABLED', previous.google],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('checks the brake of the route provider in preflight and confirm', () => {
    const service = read('social-ad-manual-action.service.ts');
    expect(service).not.toContain("const PROVIDER = 'meta_ads';");
    expect(
      service.match(/this\.assertGlobalEnabled\(provider\)/g),
    ).toHaveLength(2);
    expect(service).toContain('this.config.writesEnabledFor(provider)');
  });

  it('reaches the Google mutation client only from the Google adapter', () => {
    const users = readdirSync(__dirname)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) => read(file).includes('GoogleAdsMutationClient'));
    expect(users).toEqual(['google-ads-manual-action.adapter.ts']);
  });

  it('binds boost creation to the Meta provider', () => {
    expect(read('social-boost-request.service.ts')).toContain(
      "provider: 'meta_ads',",
    );
  });

  it('exposes no TikTok route that mutates (TT-ADS-BE)', () => {
    expect(controller).not.toMatch(/@(Post|Patch|Put|Delete)\(\s*['"]tiktok/);
  });

  it('exposes no LinkedIn route that mutates (LI-ADS-BE)', () => {
    expect(controller).not.toMatch(/@(Post|Patch|Put|Delete)\(\s*['"]linkedin/);
  });
});
