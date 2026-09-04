import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What the destination history read path may reach.
 *
 * Same rule the rest of the analytics read path holds, asserted for the same
 * reason: a read that could call the provider would make a report depend on a
 * live credential, so a disconnected account would stop being able to show its
 * own stored history — history that is still true and still the client's.
 */
const SOURCES = [
  join(__dirname, 'social-ad-destination-history.read.service.ts'),
  join(__dirname, '..', 'analytics', 'social-ad-destination-timeline.ts'),
  // I3.5's breakdown joins the same evidence to ad-set metrics, so it inherits
  // both rules: no provider access, and no vocabulary that claims a destination
  // was *in effect* rather than observed.
  join(__dirname, 'social-ad-destination-breakdown.read.service.ts'),
  join(__dirname, '..', 'analytics', 'social-ad-destination-breakdown.ts'),
];

function readCode(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('destination history boundary', () => {
  it.each(SOURCES)('%s reaches no provider or credential', (file) => {
    const source = readCode(file);

    for (const forbidden of [
      'MetaAdsGraph',
      'CredentialResolver',
      'accessToken',
      'access_token',
      'fetch(',
      'axios',
      'httpService',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * The vocabulary is the contract, and this is where it would most plausibly
   * be broken: an interval *looks* like a period during which something was
   * true, and naming it `effectiveFrom` would be the natural mistake.
   *
   * Meta does not report when a destination changed — `last_modified_time`,
   * `effective_time` and `destination_type_updated_time` are all dropped from
   * the ad set payload — so every name here says "observed".
   */
  it.each(SOURCES)('%s claims observation, never effect', (file) => {
    const source = readCode(file);

    for (const overclaim of [
      'effectiveAt',
      'effectiveFrom',
      'effectiveUntil',
      'effective_at',
      'changedAt',
      'changed_at',
      'validFrom',
    ]) {
      expect(source).not.toContain(overclaim);
    }
  });

  /**
   * Scope is bound, never optional.
   *
   * A destination history read that omitted the connection would return another
   * ad account's ad sets under this one's timezone.
   */
  it('binds tenant, workspace and connection on every read', () => {
    const service = readCode(SOURCES[0]);
    const timeline = readCode(SOURCES[1]);

    expect(timeline).toContain('observation.tenant_id = $1');
    expect(timeline).toContain('observation.workspace_id = $2');
    expect(timeline).toContain('observation.connection_id = $3');

    expect(service).toContain('observation.tenant_id = $1');
    expect(service).toContain('observation.connection_id = $3');
  });

  /**
   * Set-based resolution, not a correlated subquery per metric row.
   *
   * Measured: 1948ms correlated versus 666ms set-based on a 5k-ad-set,
   * 15k-observation, 450k-metric fixture over 90 days. The slow form would pass
   * every correctness test.
   */
  it('resolves intervals with a window function', () => {
    expect(readCode(SOURCES[1])).toContain('LEAD(');
  });

  /**
   * The current-state column is not a fallback for missing history.
   *
   * Substituting `social_ad_entities.destination_type` for a day before the
   * first observation would reintroduce exactly the current-state-as-history
   * error the observations table exists to remove.
   *
   * The rule is about that *column*, not the table. Through I3.4 the two were
   * the same test, because nothing on this path had a reason to read
   * `social_ad_entities` at all. I3.5's breakdown does: it joins the mirror to
   * turn a fact's `entity_external_id` into the ad set's internal id, which is
   * what the observations are keyed by — identity, never destination. So the
   * assertion now names the columns a current-state fallback would have to
   * touch, which is the thing that was actually meant.
   */
  it('never falls back to the current destination column', () => {
    for (const file of SOURCES) {
      const source = readCode(file);

      expect(source).not.toContain('entity.destination_type');
      expect(source).not.toContain('entity.destination_raw');
      expect(source).not.toContain('entity.destination_observed_at');
      expect(source).not.toContain('destinationType');
      expect(source).not.toContain('destinationObservedAt');
    }
  });

  /**
   * And where the mirror *is* joined, it is joined for identity alone.
   *
   * The breakdown's join exists to match a fact's external id to the ad set row
   * whose internal id the observations reference. Asserting the join predicate
   * pins that: a later edit that started selecting a destination from `entity`
   * would have to change this line as well as the query.
   */
  it('joins the entity mirror only to resolve an ad set identity', () => {
    const breakdown = readCode(SOURCES[2]);

    expect(breakdown).toContain('entity.external_id = fact.entity_external_id');
    expect(breakdown).toContain('observation.ad_entity_id = entity.id');
    // The destination always comes from the observations, never the mirror.
    expect(breakdown).toContain('SELECT observation.destination_type');
  });
});
