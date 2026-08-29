import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What the cross-domain layer is allowed to reach.
 *
 * This projector is the first place in the codebase that legitimately depends
 * on two products at once, which makes it the first place that could quietly
 * undo the separation I2 established. The specific failure it guards against is
 * concrete: needing one more number, reaching past the port into
 * `social_ad_metrics_daily` or `crm_opportunities` directly, and thereby making
 * a second copy of the four filters — or the client predicate — that decide
 * whether the numbers are right at all.
 *
 * The rule is that this module composes ports and owns no data access.
 */
const MODULE_DIR = __dirname;

const SOURCES = [
  'acquisition-cohort.service.ts',
  'acquisition-cohort.contract.ts',
  'acquisition-channel.ts',
  'acquisition-cohort.controller.ts',
];

function readCode(file: string): string {
  return readFileSync(join(MODULE_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('acquisition cohort boundary', () => {
  /**
   * No SQL, no repository, no data source — in any file of this module.
   *
   * Every number arrives through an adapter. A query here would bypass the
   * scope predicate and the account-level filter simultaneously, and would do
   * it while looking entirely reasonable in review.
   */
  it.each(SOURCES)('%s issues no queries of its own', (file) => {
    const source = readCode(file);

    for (const forbidden of [
      'createQueryBuilder',
      'InjectRepository',
      'Repository<',
      'InjectDataSource',
      'DataSource',
      'SELECT ',
      'FROM ',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * It must not name the tables either.
   *
   * A module that mentions `social_ad_metrics_daily` is one edit away from
   * querying it, and the mention itself would mean the knowledge of how paid
   * media is stored had leaked out of the domain that owns it.
   */
  it.each(SOURCES)('%s names no domain table', (file) => {
    const source = readCode(file);

    for (const table of [
      'social_ad_metrics_daily',
      'social_ad_entities',
      'social_ad_account_connections',
      'inbox_conversations',
      'inbox_messages',
      'crm_opportunities',
      'inbox_attribution_observations',
    ]) {
      expect(source).not.toContain(table);
    }
  });

  /**
   * No provider access. The projector reads what was already synced; it never
   * reaches Meta, and it never touches a credential.
   */
  it.each(SOURCES)('%s never reaches a provider', (file) => {
    const source = readCode(file);

    for (const forbidden of [
      'graph.facebook.com',
      'GraphApi',
      'MetaAdsClient',
      'SocialAdCredentialResolver',
      'accessToken',
      'access_token',
      'SettingsCryptoService',
      'decrypt',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * The attribution table is deployed and populated by ingestion, and it is
   * exactly the shortcut this step must not take: joining it would turn a
   * cohort correlation into a partial individual attribution, silently, while
   * the payload still said `cohort_correlation`. That work is I4.
   */
  it.each(SOURCES)('%s reads no attribution observation', (file) => {
    const source = readCode(file);

    for (const forbidden of [
      'AttributionObservation',
      'ctwa',
      'clickId',
      'adId',
      'ad_id',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * Nothing is written, published or persisted. A cross-domain read that
   * emitted an event would make two products' data flow into a third place, and
   * a materialised total would need a reconciler the moment a day was restated.
   */
  it.each(SOURCES)('%s persists nothing', (file) => {
    const source = readCode(file);

    for (const forbidden of [
      'outbox',
      '.save(',
      '.insert(',
      '.update(',
      'emit(',
      'publish(',
      'MigrationInterface',
      'materialized',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * Money arithmetic goes through the exact-decimal helpers, never through JS
   * numbers. `parseFloat` on ad spend is the specific bug this forbids: it
   * survives every test with round fixture values and drifts in the cents on
   * real data.
   */
  it('the service does no floating-point arithmetic', () => {
    const source = readCode('acquisition-cohort.service.ts');

    for (const forbidden of [
      'parseFloat',
      'parseInt',
      'Number(',
      'toFixed',
      'Math.round',
    ]) {
      expect(source).not.toContain(forbidden);
    }

    // And it uses the shared ones instead.
    expect(source).toContain('divideScaled');
    expect(source).toContain('parseScaledAmount');
  });

  /**
   * The claim the payload makes is fixed at the type level. If someone ever
   * needs this view to mean something else, they have to change the contract —
   * which is a visible act — rather than change what the same response implies.
   */
  it('declares itself a cohort correlation, not attribution', () => {
    const contract = readCode('acquisition-cohort.contract.ts');

    expect(contract).toContain("'cohort_correlation'");
    expect(contract).toContain("'date_channel_bucket'");
    expect(contract).toContain('individualAttribution: false');

    // No causal vocabulary anywhere in the shape a consumer reads.
    for (const causal of [
      'attributedRevenue',
      'attributedTo',
      'causedBy',
      'generatedBy',
      'influencedBy',
    ]) {
      expect(contract).not.toContain(causal);
    }
  });

  /**
   * Channel decisions live in one file. The moment a second place guesses, the
   * two disagree on some value and two screens report different numbers.
   */
  it('resolves channels in exactly one place', () => {
    const service = readCode('acquisition-cohort.service.ts');

    expect(service).toContain('resolvePaidMediaChannel');
    // No inline guessing.
    for (const heuristic of [
      "includes('whats",
      'toLowerCase().includes',
      "startsWith('wa",
      'WHATSAPP_PATTERN',
    ]) {
      expect(service).not.toContain(heuristic);
    }
  });
});
