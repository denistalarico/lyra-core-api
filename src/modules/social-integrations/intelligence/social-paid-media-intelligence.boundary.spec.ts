import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Extends the analytics provider boundary to the intelligence adapter.
 *
 * `social-analytics.boundary.spec` already guards the read path against
 * acquiring a Graph service or a credential resolver, and the reasoning there
 * applies verbatim here: the adapter is a second entry point into the same
 * numbers, and a new entry point is exactly where somebody adds the inline fetch
 * that the first one was built to avoid.
 *
 * Guarding the *reach* rather than the call, for the same reason: a stray
 * `await graph.get(...)` is easy to spot in review, an injected service used on
 * one branch is not.
 */
const ADAPTER_DIR = __dirname;

const ADAPTER_SOURCES = [
  'social-paid-media-intelligence.adapter.ts',
  'social-paid-media-metrics.ts',
];

/**
 * What the adapter may not name.
 *
 * Identical to the read path's list, with one addition: `Repository`. The read
 * service is allowed repositories — it is the thing that queries. The adapter is
 * not, because a repository is how the four critical filters would get
 * reimplemented here, which is the specific drift this file exists to prevent.
 */
const FORBIDDEN = [
  'MetaAdsGraphService',
  'MetaAdsInsightsReaderService',
  'MetaAdsEntityReaderService',
  'MetaAdsOAuthService',
  'MetaAdsSystemUserService',
  'SocialAdCredentialResolver',
  'SocialInternalAccessService',
  'SettingsCryptoService',
  'accessTokenEncrypted',
  'requireSystemUserToken',
  'InjectRepository',
  'Repository<',
  'createQueryBuilder',
  'dataSource',
];

/** Source with comments stripped — the prose explains the very rules checked. */
function readSource(file: string): string {
  return readFileSync(join(ADAPTER_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Social paid media adapter boundary', () => {
  it.each(ADAPTER_SOURCES)('%s reaches no provider or credential', (file) => {
    const source = readSource(file);

    for (const dependency of FORBIDDEN) {
      expect(source).not.toContain(dependency);
    }
  });

  /**
   * The point of the whole delegation: one implementation of
   * `entity_level = 'account'`, `source = 'paid'`,
   * `attribution_setting = 'account_default'` and the reach rule.
   */
  it('issues no SQL of its own', () => {
    const source = readSource('social-paid-media-intelligence.adapter.ts');

    expect(source).not.toMatch(/\bSELECT\b/i);
    expect(source).not.toMatch(/\bFROM\s+social_ad/i);
    expect(source).not.toContain('entity_level');
    expect(source).not.toContain('attribution_setting');
  });

  it('reads through the analytics read service and nothing else', () => {
    const source = readSource('social-paid-media-intelligence.adapter.ts');
    const injected = source.match(/private readonly \w+: (\w+)/g) ?? [];

    expect(injected).toEqual([
      'private readonly reads: SocialAnalyticsReadService',
    ]);
  });

  /**
   * Ratios are recipes. An adapter that computed one would have to pick an
   * aggregation level, which is the consumer's to pick.
   */
  it('does not compute a ratio', () => {
    const source = readSource('social-paid-media-intelligence.adapter.ts');

    expect(source).not.toContain('deriveSocialAdKpis');
    expect(source).not.toContain('divideScaled');
  });

  /** No arithmetic on money: values pass through as the strings they arrived as. */
  it('does no arithmetic on a value', () => {
    const source = readSource('social-paid-media-intelligence.adapter.ts');

    expect(source).not.toContain('parseFloat');
    expect(source).not.toContain('Number(');
    expect(source).not.toContain('BigInt(');
  });

  /**
   * Cross-domain is I3. This adapter must not know LeadFlow exists.
   */
  it('does not depend on LeadFlow', () => {
    const source = readSource('social-paid-media-intelligence.adapter.ts');

    expect(source).not.toContain('leadflow');
    expect(source).not.toContain('LeadFlow');
    expect(source).not.toContain('crm_');
    expect(source).not.toContain('inbox_');
  });

  /** I2 exposes facts. It does not join, publish or recommend. */
  it('computes no cross-domain metric and publishes nothing', () => {
    const source = readSource('social-paid-media-intelligence.adapter.ts');

    for (const forbidden of [
      'costPerQualifiedLead',
      'cac',
      'attribution_observations',
      'outbox',
      'emit(',
      'publish(',
      'recommendation',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
