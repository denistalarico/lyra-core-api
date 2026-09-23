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
  'views/social-ad-analytics-connection.view.ts',
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
  /**
   * Etapa 2B's measuring service, on the list for exactly the reason
   * `SocialAdSyncRunService` is: it holds `SocialAdCredentialResolver` and a
   * Graph reader, so injecting it would put a token-capable dependency behind a
   * dashboard load through the back door.
   *
   * The temptation is sharper here than anywhere else on this list, because that
   * class has a `resolve()` that measures a missing range — which is precisely
   * what somebody adding `periodReach` to a custom period would reach for. The
   * read path injects `SocialAdReachPeriodReadService` instead, which holds one
   * repository and no token, and reports `null` for a range nobody measured.
   */
  'SocialAdReachPeriodService',
  'MetaAdsReachReaderService',
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

  it('reads only the read-model tables', () => {
    const source = readSource('services/social-analytics-read.service.ts');

    // The entities named in the principle, and nothing else from the ORM.
    const repositories = source.match(/Repository<(\w+)>/g) ?? [];

    expect(new Set(repositories)).toEqual(
      new Set([
        'Repository<SocialAdAccountConnectionEntity>',
        'Repository<SocialAdMetricDailyEntity>',
        'Repository<SocialAdEntity>',
        'Repository<SocialAdSyncRunEntity>',
        /**
         * Owned by `social-campaigns`, read here to count boosts beside
         * campaigns and ads in the overview.
         *
         * Admitted deliberately rather than by loosening the assertion: the
         * principle this list enforces is that the read path touches no
         * provider and no credential, and a repository on a table this
         * platform writes itself does neither. What would violate it is
         * `SocialBoostService` — a write path holding a credential resolver —
         * which is why the entity is injected and the service is not.
         */
        'Repository<SocialBoostRequestEntity>',
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
   * Period reach is read, never derived.
   *
   * The failure this guards is the one §2.1 of the campaign plan exists to
   * prevent: somebody sees `periodReach` is null for a custom range, notices the
   * daily reach column right there in the aggregate, and fills the gap with a
   * sum. The number that produces is inflated by every person reached on more
   * than one day — up to double for a two-day period — and it is the figure a
   * client checks against Ads Manager first.
   *
   * So the aggregate may select reach (it does, for the single-day case
   * `readReach` answers) but nothing may compute a period figure from it. The
   * only source of `periodReach` is the measurement cache.
   */
  it('takes period reach from the measurement cache and never from a sum', () => {
    const source = readSource('services/social-analytics-read.service.ts');

    expect(source).toContain('SocialAdReachPeriodReadService');
    expect(source).toContain('periodReach');

    // The two expressions that would look obvious and be wrong.
    expect(source).not.toMatch(/SUM\(fact\.reach\)\s*[,)]?\s*'period/i);
    expect(source).not.toContain('MAX(fact.reach)');
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

  /**
   * The analytics connection picker must stay narrower than the settings list.
   *
   * It exists precisely so the settings screen's admin permission did not have
   * to be weakened to feed a dashboard. If credential fields drift back into it
   * over time, that trade quietly reverses: the weaker permission would then
   * reach the surface the stronger one was protecting.
   */
  it('keeps credential state out of the analytics connection view', () => {
    const source = readSource('views/social-ad-analytics-connection.view.ts');

    for (const field of [
      'accessToken',
      'refreshToken',
      'hasCredential',
      'tokenExpiresAt',
      'credentialVersion',
      'oauthStateHash',
      'scopes',
    ]) {
      expect(source).not.toContain(field);
    }

    // The raw `act_…` id is an addressable Graph resource, so it is masked by
    // the same helper the settings view uses rather than a second one that
    // could mask differently.
    expect(source).toContain('maskExternalAccountId');
    expect(source).not.toMatch(/externalAccountId:/);
  });
});
