import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards the rule that defines the analytics read path: **it never reaches a
 * provider.**
 *
 * Every number these four endpoints return comes from the local read model, and
 * that is not a performance decision — it is what makes a dashboard survive an
 * expired token, a rate limit, a Meta outage and a disconnected account. The
 * failure mode is not malice, it is convenience: somebody adding a field
 * notices the read model does not have it, sees `MetaAdsGraphService` in the
 * same folder, and fetches it inline. That works locally, ships, and turns
 * loading a page into a provider call that fails for reasons the page cannot
 * explain and costs quota the sync needs.
 *
 * The same applies to `SocialAdCredentialResolver`. It is the correct scope
 * boundary everywhere else in this module, but it refuses a connection whose
 * credential expired or was removed — which would blank out ninety days of
 * stored, still-true history exactly when somebody needs to read it.
 *
 * So the *reach* is guarded rather than the call. A stray `await graph.get(...)`
 * is easy to spot in review; an injected service that is only used on one branch
 * is not.
 */
const ANALYTICS_SOURCES = [
  'services/social-analytics-read.service.ts',
  'social-analytics.controller.ts',
  'analytics/social-ad-kpi.ts',
  'analytics/social-ad-analytics-period.ts',
  'views/social-ad-analytics-overview.view.ts',
  'views/social-ad-analytics-series.view.ts',
  'views/social-ad-analytics-campaigns.view.ts',
  'views/social-ad-analytics-freshness.view.ts',
];

/**
 * What the read path may not name.
 *
 * `SocialAdSyncRunService` is on the list for a subtler reason than the others:
 * it is a perfectly ordinary read service, but it holds
 * `SocialAdCredentialResolver`, so injecting it would put a token-capable
 * dependency on the read path through the back door. The chunk-outcome query it
 * owns is duplicated in the read service instead, and the gated spec asserts the
 * two agree.
 */
const FORBIDDEN_DEPENDENCIES = [
  'MetaAdsGraphService',
  'MetaAdsInsightsReaderService',
  'MetaAdsEntityReaderService',
  'MetaAdsOAuthService',
  'MetaAdsSystemUserService',
  'SocialAdCredentialResolver',
  'SocialInternalAccessService',
  'SettingsCryptoService',
  'SocialAdSyncRunService',
  'accessTokenEncrypted',
  'requireSystemUserToken',
];

const MODULE_ROOT = join(__dirname, '..');

/**
 * The file's code, with comments removed.
 *
 * Stripping them matters here: these files explain at length *why* they do not
 * use the credential resolver and *why* freshness does not call `planNext`, and
 * a naive substring search would fail on the explanation of the very rule it is
 * enforcing. Deleting the prose to satisfy the test would remove the reasoning
 * and leave the constraint looking arbitrary to the next reader.
 */
function readSource(relativePath: string): string {
  return readFileSync(join(MODULE_ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Social analytics provider boundary', () => {
  it.each(ANALYTICS_SOURCES)('%s reaches no provider or credential', (file) => {
    const source = readSource(file);

    for (const dependency of FORBIDDEN_DEPENDENCIES) {
      expect(source).not.toContain(dependency);
    }
  });

  it('reads only the four read-model tables', () => {
    const source = readSource('services/social-analytics-read.service.ts');

    // The four entities named in the principle, and nothing else from the ORM.
    const repositories = source.match(/Repository<(\w+)>/g) ?? [];

    expect(new Set(repositories)).toEqual(
      new Set([
        'Repository<SocialAdAccountConnectionEntity>',
        'Repository<SocialAdMetricDailyEntity>',
        'Repository<SocialAdEntity>',
        'Repository<SocialAdSyncRunEntity>',
      ]),
    );
  });

  /**
   * The planner enqueues; the read path must not.
   *
   * Freshness reports the backfill chain, and the shortest way to compute that
   * would have been to call `planNext` — which would make loading a dashboard
   * queue provider work. The pure helpers are imported instead.
   */
  it('borrows the planner pure helpers without calling the planner', () => {
    const source = readSource('services/social-analytics-read.service.ts');

    expect(source).toContain('resolveChunkState');
    expect(source).toContain('groupOutcomesByWindow');
    expect(source).toContain('planBackfillChunks');

    expect(source).not.toContain('planNext');
    expect(source).not.toContain('planForConnectedAccount');
    expect(source).not.toMatch(/\benqueue\b/);
  });

  /**
   * One implementation of every KPI formula.
   *
   * Overview, timeseries and campaigns all report a CTR, and three
   * implementations would eventually disagree — most likely on the zero
   * denominator, where the honest answer is null and the obvious one is zero.
   */
  it('derives every KPI through the one shared utility', () => {
    const source = readSource('services/social-analytics-read.service.ts');

    expect(source).toContain('deriveSocialAdKpis');

    // No arithmetic on money outside the utility: no division, no float
    // parsing, no `Number(`.
    expect(source).not.toContain('parseFloat');
    expect(source).not.toContain('Number(');
  });
});
