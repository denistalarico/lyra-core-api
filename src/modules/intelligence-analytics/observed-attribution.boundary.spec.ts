import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The rules I4 must not break, asserted against the source itself.
 *
 * Attribution is the feature most likely to be "improved" into something it is
 * not. Every shortcut this file forbids is one that would still produce a
 * plausible-looking response — a matched conversation where none was observed,
 * a single ad chosen from two real clicks, an opportunity linked by phone
 * number — and would keep the `observed_attribution` label while doing it.
 */
const MODULE_DIR = __dirname;

const SOURCES = [
  'observed-attribution.service.ts',
  'observed-attribution.contract.ts',
  'observed-attribution.controller.ts',
];

function readCode(file: string, dir: string = MODULE_DIR): string {
  return readFileSync(join(dir, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('observed attribution boundary', () => {
  /**
   * The cross-domain module composes ports and owns no data access — the same
   * rule the cohort view holds, for the same reason: a query here would carry a
   * second copy of the client predicate that decides whose conversation this is.
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

  it.each(SOURCES)('%s names no domain table', (file) => {
    const source = readCode(file);

    for (const table of [
      'inbox_attribution_observations',
      'inbox_conversations',
      'inbox_messages',
      'inbox_conversation_events',
      'crm_opportunities',
      'social_ad_entities',
      'social_ad_metrics_daily',
      'social_ad_account_connections',
    ]) {
      expect(source).not.toContain(table);
    }
  });

  /**
   * No provider access, anywhere on the read path.
   *
   * An `ad_not_found` must stay a local answer. Resolving it by asking Meta
   * would make a report depend on a live credential, so a disconnected account
   * would stop being able to explain conversations it already observed — and
   * would put a Graph call on a per-conversation endpoint.
   */
  it.each(SOURCES)('%s reaches no provider or credential', (file) => {
    const source = readCode(file);

    for (const forbidden of [
      'MetaAdsGraph',
      'CredentialResolver',
      'accessToken',
      'access_token',
      'graph.facebook.com',
      'fetch(',
      'axios',
      'httpService',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * The bridge never reads the cohort.
   *
   * This is the specific inversion I4 exists to avoid: attributing a
   * conversation because spend existed on the same day and channel is exactly
   * the correlation I3 refuses to call attribution. Importing it here would
   * launder that correlation into a response labelled `observed`.
   */
  it('never depends on the cohort correlation', () => {
    const service = readCode('observed-attribution.service.ts');

    for (const forbidden of [
      'AcquisitionCohortService',
      'acquisition-cohort',
      'cohort_correlation',
      'joinBasis',
      'date_channel_bucket',
    ]) {
      expect(service).not.toContain(forbidden);
    }
  });

  /**
   * No fallback that would manufacture a link.
   *
   * `inbox_conversation_id` is the only accepted path from a conversation to an
   * opportunity. Every identifier below names a different person-level
   * coincidence that would look like evidence and is not.
   */
  it('links opportunities only by explicit conversation id', () => {
    for (const file of SOURCES) {
      const source = readCode(file);

      for (const fallback of [
        'phone',
        'email',
        'contactId',
        'contact_id',
        'sameDay',
        'same_day',
        'campaignName =',
        'campaign_name =',
      ]) {
        expect(source).not.toContain(fallback);
      }
    }
  });

  /**
   * No modelling vocabulary, in a module whose whole claim is that it does none.
   *
   * A field named `attributedRevenue` or a status called `inferred` would be
   * read as the claim itself by code written years from now, whatever the
   * comments here say.
   */
  it.each(SOURCES)('%s makes no modelled or causal claim', (file) => {
    const source = readCode(file);

    for (const causal of [
      'attributedRevenue',
      'attributedTo',
      'convertedFrom',
      'causedBy',
      'influencedBy',
      'creditedTo',
      'firstTouch',
      'lastTouch',
      'multiTouch',
      'probabilistic',
      'inferredAttribution',
      'modeledAttribution',
    ]) {
      expect(source).not.toContain(causal);
    }
  });

  /**
   * `revenue` is never the name of a seller-entered number.
   *
   * `value_amount` is a figure a salesperson typed into a CRM field. Nothing
   * has been invoiced or reconciled with Finance, and naming it revenue is how
   * a forecast becomes a financial statement two dashboards later.
   */
  it.each(SOURCES)('%s never calls opportunity value revenue', (file) => {
    expect(readCode(file).toLowerCase()).not.toContain('revenue');
  });

  /**
   * A conflict is a terminal state, not an input to a tiebreak.
   *
   * The failure this guards is subtle and tempting: sorting the observations
   * and taking `[0]` looks like "use the first touch" and would silently turn
   * two real clicks into one attributed ad.
   */
  it('resolves conflicts to a status rather than to an ad', () => {
    const service = readCode('observed-attribution.service.ts');

    expect(service).toContain("'conflicting_observations'");
    expect(service).toContain("attribution.consistency === 'conflicting'");
    // The conflict branch returns before any lookup happens.
    expect(
      service.indexOf("return miss('conflicting_observations')"),
    ).toBeLessThan(service.indexOf('this.hierarchy.lookup('));
  });

  /**
   * Ambiguity fails closed.
   *
   * Two connections answering for one ad id is undecidable from the evidence.
   * A `[0]`, a `find`, or an ordering by recency would all produce a confident
   * answer with nothing behind it.
   */
  it('never picks a connection when several match', () => {
    const lookup = readCode(
      'social-ad-hierarchy-lookup.read.service.ts',
      join(MODULE_DIR, '..', 'social-integrations', 'services'),
    );

    expect(lookup).toContain('ambiguous_connection');
    expect(lookup).toContain('connectionIds.length > 1');
  });

  /**
   * The click id is evidence, never an identifier this layer hands out or
   * resolves.
   */
  it('exposes only that a click id was observed', () => {
    const contract = readCode('observed-attribution.contract.ts');
    const service = readCode('observed-attribution.service.ts');

    expect(contract).toContain('clickIdPresent: boolean');
    // The value itself never reaches the response shape.
    expect(contract).not.toContain('clickId: string');
    expect(service).toContain('clickIdPresent: observation.clickId !== null');
  });

  /**
   * Attribution does not depend on spend having been ingested.
   *
   * On this deployment ad-set metrics do not exist at all, and a conversation
   * carrying a valid ad id is still attributable. A read of the metrics table
   * here would make that conversation unattributable for a reason that has
   * nothing to do with its evidence.
   */
  it('requires no social metrics', () => {
    const service = readCode('observed-attribution.service.ts');
    const lookup = readCode(
      'social-ad-hierarchy-lookup.read.service.ts',
      join(MODULE_DIR, '..', 'social-integrations', 'services'),
    );

    for (const source of [service, lookup]) {
      expect(source).not.toContain('social_ad_metrics_daily');
      expect(source).not.toContain('spend');
      expect(source).not.toContain('SocialAnalyticsReadService');
      expect(source).not.toContain('backfill');
    }
  });

  /**
   * `individualAttribution` is set from the match and from nothing else.
   *
   * It is the strongest flag in the response, and the only honest source for it
   * is "an observed id resolved to exactly one ad".
   */
  it('sets individualAttribution only from a match', () => {
    const service = readCode('observed-attribution.service.ts');

    expect(service).toContain('individualAttribution: matched');
    expect(service).toContain("const matched = matchStatus === 'matched'");
  });

  /**
   * I4.1 §3: the current destination column is never a fallback for history.
   *
   * This is the single most tempting shortcut in the whole enrichment. When a
   * conversation predates the observation history, `social_ad_entities`
   * *always* has a destination sitting right there on the ad set row the
   * hierarchy walk already joined — and using it would fill in every blank
   * while silently asserting that today's configuration was true months ago.
   * The observations table exists precisely to remove that error.
   */
  it('never falls back to the current destination column', () => {
    const files: Array<[string, string]> = [
      ['observed-attribution.service.ts', MODULE_DIR],
      [
        'social-ad-destination-at.ts',
        join(MODULE_DIR, '..', 'social-integrations', 'analytics'),
      ],
      [
        'social-ad-destination-history.read.service.ts',
        join(MODULE_DIR, '..', 'social-integrations', 'services'),
      ],
      [
        'social-ad-hierarchy-lookup.read.service.ts',
        join(MODULE_DIR, '..', 'social-integrations', 'services'),
      ],
    ];

    for (const [file, dir] of files) {
      const source = readCode(file, dir);

      // The columns a current-state fallback would have to touch — the same
      // rule I3.5 settled on, for the same reason: the table is legitimately
      // joined for identity, so banning its name would ban the correct code.
      expect(source).not.toContain('entity.destination_type');
      expect(source).not.toContain('entity.destination_raw');
      expect(source).not.toContain('entity.destination_observed_at');
      expect(source).not.toContain('adset.destination_type');
      expect(source).not.toContain('destinationType');
    }
  });

  /**
   * The temporal resolution reads the evidence table and orders by the
   * observation instant.
   */
  it('resolves the destination from observations, at or before the instant', () => {
    const service = readCode(
      'social-ad-destination-history.read.service.ts',
      join(MODULE_DIR, '..', 'social-integrations', 'services'),
    );

    expect(service).toContain('FROM social_ad_destination_observations');
    // Inclusive boundary: an observation made at the very instant the message
    // arrived describes that message's ad set.
    expect(service).toContain('observation.observed_at <= asked.instant');
    expect(service).toContain('ORDER BY observation.observed_at DESC');
  });

  /**
   * I4.1 §14: absolute instants, never truncated to a day.
   *
   * This is individual attribution — a message at 09:00 and an ad set observed
   * at 21:00 are the same calendar day and the wrong answer. The day-cut
   * timeline that I3.2a uses for period reporting must not leak in here.
   */
  it('never truncates the attribution instant to a day', () => {
    const service = readCode(
      'social-ad-destination-history.read.service.ts',
      join(MODULE_DIR, '..', 'social-integrations', 'services'),
    );

    // Sliced at the point-in-time query's own landmark rather than at its SQL
    // comment, which `readCode` strips. The day-cut interval query above it is
    // I3.2a's and legitimately casts to date.
    const [, atInstantQuery] = service.split('DESTINATION_AT_SQL = `');

    expect(atInstantQuery).toBeDefined();
    expect(atInstantQuery).not.toContain('::date');
    expect(atInstantQuery).not.toContain('date_trunc');
    expect(atInstantQuery).not.toContain('AT TIME ZONE');
    expect(atInstantQuery).toContain('timestamptz');
  });

  /**
   * §5: destination consistency is its own vocabulary.
   *
   * Two observations of the same ad are not an attribution conflict, but the
   * destination may still have varied between them. One shared word would make
   * that state unsayable.
   */
  it('keeps destination consistency separate from attribution consistency', () => {
    const contract = readCode('observed-attribution.contract.ts');
    const service = readCode('observed-attribution.service.ts');

    expect(contract).toContain('ObservedAttributionDestinationConsistency');
    expect(contract).toContain("'temporal_variation'");
    // And a varying destination never collapses to one value.
    expect(service).toContain("resolution: 'temporal_variation'");
  });

  /**
   * §12: the enrichment adds no dependency on metrics.
   *
   * Already true of the bridge; asserted again over the destination path so
   * I4.1 cannot be the edit that introduces one.
   */
  it('resolves a destination without reading metrics', () => {
    const service = readCode(
      'social-ad-destination-history.read.service.ts',
      join(MODULE_DIR, '..', 'social-integrations', 'services'),
    );

    expect(service).not.toContain('social_ad_metrics_daily');
    expect(service).not.toContain('spend');
  });

  /**
   * The caller cannot name a client.
   *
   * Scope comes from the request context. A client id accepted from the query
   * or the body would let any authenticated user read another client's
   * conversation by asking for it.
   */
  it('takes no client identity from the caller', () => {
    const controller = readCode('observed-attribution.controller.ts');

    expect(controller).not.toContain('@Query');
    expect(controller).not.toContain('@Body');
    expect(controller).toContain('ctx.managedContext');
    // The only caller-supplied input, and it is validated as a uuid.
    expect(controller).toContain(
      "@Param('conversationId', new ParseUUIDPipe())",
    );
  });

  /**
   * Out-of-scope is a 404, never a distinguishable refusal.
   *
   * Confirming that an id names a real conversation in another tenant is the
   * one bit enumeration needs.
   */
  it('does not distinguish "not yours" from "not found"', () => {
    const controller = readCode('observed-attribution.controller.ts');

    expect(controller).toContain('NotFoundException');
    expect(controller).toContain('if (!view)');
  });

  /**
   * Both entitlements and both permissions, as I3 established.
   */
  it('requires both products and both permissions', () => {
    const controller = readCode('observed-attribution.controller.ts');

    expect(controller).toContain("'social'");
    expect(controller).toContain("'leadflow'");
    expect(controller).toContain("'social.analytics.reports.view.operational'");
    expect(controller).toContain(
      "'leadflow.analytics.reports.view.operational'",
    );
  });

  /**
   * The qualification event literal is the one I3.1 writes.
   *
   * Spelled in the attribution adapter rather than imported from the write
   * path, so this asserts the two agree — a rename on either side must fail a
   * test instead of silently returning null for every conversation.
   */
  it('reads the same qualification event the recorder writes', () => {
    const attribution = readCode(
      'leadflow-attribution.adapter.ts',
      join(MODULE_DIR, '..', 'leadflow-analytics', 'intelligence'),
    );
    const facts = readCode(
      'leadflow-intelligence.adapter.ts',
      join(MODULE_DIR, '..', 'leadflow-analytics', 'intelligence'),
    );

    expect(attribution).toContain("'qualification_status_changed'");
    expect(facts).toContain("'qualification_status_changed'");
  });

  /**
   * The LeadFlow port reuses the shared scope predicate rather than restating
   * it. Two definitions of "this client's conversations" is how one screen
   * attributes a conversation the next one denies.
   */
  it('reuses the canonical client predicate', () => {
    const attribution = readCode(
      'leadflow-attribution.adapter.ts',
      join(MODULE_DIR, '..', 'leadflow-analytics', 'intelligence'),
    );

    expect(attribution).toContain('LEADFLOW_SCOPE_SQL.CHANNEL');
    expect(attribution).toContain('LEADFLOW_SCOPE_SQL.OPPORTUNITY');
    expect(attribution).toContain('leadFlowScopeParameters');
    // And does not hand-roll the JSONB conditions it would replace.
    expect(attribution).not.toContain("metadata->>'clientId'");
  });

  /**
   * Won is the CRM's definition, reused verbatim.
   *
   * `status = 'won'` *and* `won_at` present — the same pair
   * `sumOpportunitiesWon` requires. A parallel definition here would make the
   * per-conversation card disagree with the period report.
   */
  it('reuses the canonical won semantics', () => {
    const attribution = readCode(
      'leadflow-attribution.adapter.ts',
      join(MODULE_DIR, '..', 'leadflow-analytics', 'intelligence'),
    );

    expect(attribution).toContain("row.status === 'won' && row.wonAt !== null");
  });
});
