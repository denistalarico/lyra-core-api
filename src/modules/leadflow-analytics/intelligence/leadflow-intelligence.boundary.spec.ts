import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The mirror of the Social adapter's boundary, guarding the other direction.
 *
 * The whole claim of I2 is that two domains can be read through one shape
 * *without* being coupled. That claim is only as good as the guarantee that
 * neither adapter reaches into the other — and the easiest way for it to fail is
 * convenience: a LeadFlow metric that "would be so much better with spend next
 * to it", one import, and the two products are joined by a class nobody
 * registered as an integration.
 *
 * Cross-domain reads are I3/I4, and they will be a deliberate composition over
 * these two ports rather than an import inside one of them.
 */
const ADAPTER_DIR = __dirname;

const ADAPTER_SOURCES = [
  'leadflow-intelligence.adapter.ts',
  'leadflow-metrics.ts',
];

function readSource(file: string): string {
  return readFileSync(join(ADAPTER_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('LeadFlow intelligence adapter boundary', () => {
  /**
   * Whole-word patterns rather than substrings.
   *
   * `meta` as a substring matches `metadata`, which every scope predicate here
   * legitimately reads, and `Social` matches nothing useful once the real
   * identifiers are listed. A boundary test that fails on an unrelated word
   * gets weakened by whoever hits it next, so the patterns name the actual
   * imports and tables instead.
   */
  const SOCIAL_PATTERNS = [
    /\bSocialAd\w*/,
    /\bSocialPaidMedia\w*/,
    /\bSocialAnalytics\w*/,
    /\bPAID_MEDIA\w*/,
    /\bsocial_ad_\w+/,
    /\bMetaAds\w*/,
    /from\s+'[^']*social-integrations/,
    /\bspend\b/,
    /\bimpressions\b/,
  ];

  it.each(ADAPTER_SOURCES)('%s does not depend on Social', (file) => {
    const source = readSource(file);

    for (const pattern of SOCIAL_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
  });

  /**
   * The adapter proves the abstraction; it does not replace the analytics layer.
   * Reaching into the existing services would make it a facade over them and
   * couple its lifetime to theirs — and both load tens of thousands of rows for
   * a screen, which is the wrong cost for five counts.
   */
  it('does not wrap the existing analytics services', () => {
    const source = readSource('leadflow-intelligence.adapter.ts');

    for (const service of [
      'LeadFlowAnalyticsService',
      'LeadFlowOperationalAnalyticsService',
      'LeadFlowOverviewService',
      'LeadFlowIntelligenceService',
      'projectCommercialJourney',
      'projectOperationalAnalytics',
    ]) {
      expect(source).not.toContain(service);
    }
  });

  /**
   * Scope comes resolved. An adapter that accepted a `RequestContext` could be
   * handed one whose managed context said something the caller never checked.
   */
  it('takes a resolved scope, never a request', () => {
    const source = readSource('leadflow-intelligence.adapter.ts');

    expect(source).not.toContain('RequestContext');
    expect(source).not.toContain('managedContext');
    expect(source).toContain('IntelligenceScope');
  });

  /**
   * Authorization happens before the port — see `IntelligenceFactSource`. A
   * guard here would be wrong for the callers that are not HTTP.
   */
  it('declares no permission guard', () => {
    const source = readSource('leadflow-intelligence.adapter.ts');

    for (const guard of [
      '@UseGuards',
      'PermissionsGuard',
      'RequirePermission',
      '@Controller',
    ]) {
      expect(source).not.toContain(guard);
    }
  });

  /**
   * Every query binds tenant and workspace as the first two parameters, and
   * reaches the shared client predicate. A query that forgot one would read
   * across a boundary, and the integration suite would only catch it if that
   * exact query happened to be covered.
   */
  it('binds tenant and workspace in every query', () => {
    // Read raw: `readSource` strips block comments, and the SQL tag that names
    // each query is one. The template literals are matched directly instead.
    const source = readFileSync(
      join(ADAPTER_DIR, 'leadflow-intelligence.adapter.ts'),
      'utf8',
    );
    const queries =
      source.match(/`\s*\n\s*\/\* leadflow-intelligence:[\s\S]*?`/g) ?? [];

    expect(queries.length).toBeGreaterThanOrEqual(4);

    for (const query of queries) {
      expect(query).toContain('tenant_id = $1');
      expect(query).toContain('workspace_id = $2');
      // The shared definition, never an inline copy — see LEADFLOW_SCOPE_SQL.
      expect(query).toContain('LEADFLOW_SCOPE_SQL.');
    }
  });

  /**
   * The predicate must never be re-inlined here.
   *
   * Re-inlining is how the drift this extraction removed would come back: a
   * local copy works on the day it is written and diverges the day the shared
   * one is corrected, with both screens still passing their own tests.
   */
  it('never spells the client predicate out itself', () => {
    const source = readSource('leadflow-intelligence.adapter.ts');

    expect(source).not.toContain("metadata->>'clientId'");
    expect(source).not.toContain("operatingMode' = 'agency'");
    expect(source).toContain('LEADFLOW_SCOPE_SQL');
  });

  /** I2 exposes facts. No events, no recommendations, no attribution. */
  it('publishes nothing and reads no attribution', () => {
    const source = readSource('leadflow-intelligence.adapter.ts');

    for (const forbidden of [
      'outbox',
      'emit(',
      'publish(',
      'recommendation',
      'inbox_attribution_observations',
      'ctwa',
      'referral',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
