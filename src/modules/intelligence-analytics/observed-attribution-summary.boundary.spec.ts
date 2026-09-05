import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The rules I4.2 must not break, asserted against the source itself.
 *
 * An aggregate is more dangerous than the individual view it sums. A single
 * conversation's response shows its own evidence, so a reader can see what it
 * rests on; a campaign row showing "41 conversations, 12 won" shows none of
 * that, and every shortcut below would still produce a number that looks
 * exactly as authoritative as a correct one.
 */
const MODULE_DIR = __dirname;

const SOURCES = [
  'observed-attribution-summary.service.ts',
  'observed-attribution-summary.contract.ts',
  'observed-attribution-summary.controller.ts',
];

function readCode(file: string, dir: string = MODULE_DIR): string {
  return readFileSync(join(dir, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('observed attribution summary boundary', () => {
  /**
   * The cross-domain module composes ports and owns no data access — the rule
   * I3.5 and I4 both hold. A query here would carry a second copy of the client
   * predicate that decides whose conversations are counted.
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
      'social_ad_destination_observations',
    ]) {
      expect(source).not.toContain(table);
    }
  });

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
   * §21/§22: no spend, and no dependency on the metrics table.
   *
   * The most likely "improvement" to this endpoint is a cost column, and it is
   * forbidden for a semantic reason rather than a scheduling one: spend is a
   * period-grained media fact and this is an entry cohort followed past its
   * window, so dividing one by the other produces a CPA whose numerator and
   * denominator describe different sets of days.
   */
  it.each(SOURCES)('%s introduces no spend or cost metric', (file) => {
    /**
     * The limitation constants are excluded from this scan, and that exclusion
     * is the point rather than a loophole: `..._SPEND_LIMITATION` exists to
     * *tell the reader* that spend is absent, so a blanket ban on the word
     * would forbid the very sentence disclosing the boundary. What is banned is
     * the machinery a real cost read would need — a field, a metric key, a fact
     * source — none of which can hide inside a Portuguese sentence.
     */
    const source = readCode(file)
      .replace(/'[^']*'/g, "''")
      // The disclosure constant's own name is exempt, and only that name. It is
      // referenced exactly where the response is assembled, so the word can
      // still appear nowhere a cost could be computed.
      .replace(/OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION/g, 'DISCLOSURE')
      .toLowerCase();

    for (const forbidden of [
      'spend',
      'roas',
      'costper',
      'cost_per',
      'social_ad_metrics_daily',
      'socialanalyticsfact',
      'socialanalyticsreadservice.fetch',
      'intelligencefactset',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * §21: the exclusion of spend is disclosed, not merely observed.
   *
   * The scan above proves no cost is computed. This proves the response says
   * so — a reader comparing this view with I3.5's must be told why one carries
   * investment and the other does not.
   */
  it('discloses that spend is excluded', () => {
    const contract = readFileSync(
      join(MODULE_DIR, 'observed-attribution-summary.contract.ts'),
      'utf8',
    );

    expect(contract).toContain('OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION');
    expect(contract).toContain('ROAS');
  });

  /**
   * The summary never reads the cohort correlation.
   *
   * Both views answer "how is acquisition going" over a window, which makes
   * borrowing from one to fill the other feel natural. It would silently mix an
   * observed chain with a correlated one under a `kind` that claims only the
   * first.
   */
  it('never depends on the cohort correlation', () => {
    const service = readCode('observed-attribution-summary.service.ts');

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
   * §12: no fallback that would manufacture a link.
   *
   * `inbox_conversation_id` is the only accepted path from a conversation to an
   * opportunity, in aggregate exactly as individually.
   */
  it.each(SOURCES)('%s links opportunities only explicitly', (file) => {
    const source = readCode(file);

    for (const fallback of [
      'phone',
      'email',
      'contactId',
      'contact_id',
      'sameDay',
      'same_day',
    ]) {
      expect(source).not.toContain(fallback);
    }
  });

  /**
   * §20: no modelling vocabulary in a module that models nothing.
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
      'fractional',
    ]) {
      expect(source).not.toContain(causal);
    }
  });

  it.each(SOURCES)('%s never calls opportunity value revenue', (file) => {
    expect(readCode(file).toLowerCase()).not.toContain('revenue');
  });

  /**
   * §18/§19: conflicts and unresolved ads stay out of every group.
   *
   * The tempting failure is splitting a two-ad conversation between both, which
   * reads as fairness and is an invented fractional attribution. The filter is
   * `length === 1` and it runs before the hierarchy is even consulted.
   */
  it('excludes conflicting conversations from every group', () => {
    const service = readCode('observed-attribution-summary.service.ts');

    expect(service).toContain('distinctAdIds.length === 1');
    expect(service).toContain('conflictingConversations');
    expect(service).toContain('unresolvedConversations');
    // The exclusion happens before any ad is resolved, so a conflicting
    // conversation cannot reach a group by any later path.
    expect(service.indexOf('distinctAdIds.length === 1')).toBeLessThan(
      service.indexOf('this.hierarchy.lookupMany('),
    );
  });

  /**
   * §3: a conversation counts once, however many observations it carries.
   *
   * The guard is structural — the accumulation loop iterates conversations, so
   * `attributedConversations` cannot be incremented per observation without
   * changing the loop itself.
   */
  it('counts a conversation once and observations separately', () => {
    const service = readCode('observed-attribution-summary.service.ts');

    expect(service).toContain('accumulator.attributedConversations += 1');
    expect(service).toContain(
      'accumulator.observationsCount += conversation.observationsCount',
    );
    // Never derived from the other.
    expect(service).not.toContain(
      'attributedConversations += conversation.observationsCount',
    );
  });

  /**
   * §16: the denominator excludes channels that cannot carry a referral.
   *
   * `matched / all conversations` would fall as Instagram and Messenger grow,
   * describing channel mix rather than attribution.
   */
  it('computes coverage over eligible conversations only', () => {
    const service = readCode('observed-attribution-summary.service.ts');
    const contract = readCode('observed-attribution-summary.contract.ts');

    expect(service).toContain('eligibility.eligibleConversations');
    expect(contract).toContain('unsupportedConversations');
    // And never divides by a total that includes unsupported channels.
    expect(service).not.toContain('/ conversations.length');
  });

  /**
   * A ratio over an empty denominator is undefined, not zero.
   *
   * Rendering 0% would tell a client with no eligible conversations that
   * attribution is failing.
   */
  it('returns a null coverage rather than zero on an empty denominator', () => {
    const service = readCode('observed-attribution-summary.service.ts');

    expect(service).toContain('eligibility.eligibleConversations');
    expect(service).toContain(': null');
  });

  /**
   * §11: maturity is reported as recency, never as a benchmark.
   */
  it('reports cohort maturity as recency', () => {
    const contract = readCode('observed-attribution-summary.contract.ts');

    for (const field of [
      'dataAsOf',
      'latestAttributionAt',
      'cohortAgeHours',
      'immatureCohort',
    ]) {
      expect(contract).toContain(field);
    }

    // No benchmark, expectation or target is invented.
    for (const forbidden of ['benchmark', 'expected', 'target', 'baseline']) {
      expect(contract.toLowerCase()).not.toContain(forbidden);
    }
  });

  /**
   * §5: the cohort semantics are stated in the response.
   *
   * Entry-cohort and event-window produce different numbers from the same data,
   * and a reader cannot tell which they hold from the figures alone.
   */
  it('states its cohort semantics', () => {
    const contract = readCode('observed-attribution-summary.contract.ts');
    const service = readCode('observed-attribution-summary.service.ts');

    expect(contract).toContain("'entry_cohort'");
    expect(service).toContain("semantics: 'entry_cohort'");
  });

  /**
   * §14: unlike currencies are never added.
   */
  it('refuses to sum across currencies', () => {
    const service = readCode('observed-attribution-summary.service.ts');

    expect(service).toContain('multiCurrency');
    expect(service).toContain('currencies.size > 1');
    // No conversion of any kind.
    for (const forbidden of ['exchangeRate', 'fxRate', 'convertCurrency']) {
      expect(service).not.toContain(forbidden);
    }
  });

  /**
   * I4.3 §2: destination joins the existing axis rather than forking the API.
   *
   * The replacement for I4.2's "offers no destination grouping" guard. That test
   * did its job — it failed the moment the level was added, which is what forced
   * this deliberate change rather than a silent one. What it protected is still
   * protected, by the tests below: a conversation with no single destination
   * must still enter no group.
   */
  it('offers destination as an axis of the same endpoint', () => {
    const contract = readCode('observed-attribution-summary.contract.ts');
    const dto = readCode(
      'observed-attribution-summary.query.dto.ts',
      join(MODULE_DIR, 'dto'),
    );
    const controller = readCode('observed-attribution-summary.controller.ts');

    expect(contract).toContain("| 'ad'");
    expect(contract).toContain("| 'destination'");
    expect(dto).toContain("'destination'");

    // One route, not a parallel destination endpoint.
    expect(controller.match(/@Get\(/g) ?? []).toHaveLength(1);
  });

  /**
   * §5/§6: the temporal-variation refusal is structural, not a comment.
   *
   * The projector must place a conversation only when its destination state is
   * `resolved`. Selecting on anything weaker — "not unavailable", say — would
   * silently admit `temporal_variation` into a bucket, which is the one thing
   * this whole slice is built to refuse.
   */
  it('groups only conversations with a single resolved destination', () => {
    const service = readCode('observed-attribution-summary.service.ts');
    const builder = service.split('function buildDestinationGroups')[1];

    expect(builder).toBeDefined();
    expect(builder).toContain("state !== 'resolved'");

    // No "pick one" of any kind inside the destination builder.
    for (const forbidden of ['[0]', 'sort(', 'find(', 'Math.max']) {
      expect(
        builder.split('function summariseDestinationCoverage')[0],
      ).not.toContain(forbidden);
    }
  });

  /**
   * §10/§36: the destination is never inferred from where the conversation
   * arrived.
   *
   * The tempting bug is to see a `messaging_multi` ad set and a WhatsApp
   * conversation and conclude the destination was WhatsApp. That reads the
   * inbound channel as evidence about the ad set, which is backwards: it would
   * answer the very question the comparison exists to ask.
   */
  it('never derives a destination from the inbound channel', () => {
    const service = readCode('observed-attribution-summary.service.ts');
    const builder = service.split('function buildDestinationGroups')[1];

    // The builder reads the resolved destination and nothing about the channel.
    expect(builder).not.toContain('channelType');
    expect(builder).not.toContain('provider');

    // And messaging_multi is never rewritten to a single app anywhere.
    expect(service).not.toContain("=== 'messaging_multi' ? 'whatsapp'");
    expect(service).not.toContain("'messaging_multi' ?");
  });

  /**
   * §3: destination comes from the observation timeline, never from the
   * mirror's current column.
   *
   * `social_ad_entities.destination_type` is what the ad set points at *now*.
   * Reading it as history is the exact error the observations table was built
   * to remove, and it would look correct on any account that never changed an
   * ad set.
   */
  it('reads destination only from the observation timeline', () => {
    const service = readCode('observed-attribution-summary.service.ts');

    expect(service).toContain('destinationAtMany');
    expect(service).not.toContain('destination_type');
    expect(service).not.toContain('social_ad_entities');
  });

  /**
   * §19: destination provenance is its own layer.
   *
   * Folding it into `paidMedia` would tell a reader the destination was
   * resolved by the same mechanism that resolved the campaign — current
   * structure — when it was resolved from an append-only record of observations.
   */
  it('states destination provenance separately from the hierarchy', () => {
    const contract = readCode('observed-attribution-summary.contract.ts');
    const service = readCode('observed-attribution-summary.service.ts');

    expect(contract).toContain('destination: string');
    expect(service).toContain('destination: DESTINATION_AT_PROVENANCE');
  });

  /**
   * §25: the caller cannot name a client, and cannot name a tenant.
   */
  it('takes no client identity from the caller', () => {
    const controller = readCode('observed-attribution-summary.controller.ts');
    const dto = readCode(
      'observed-attribution-summary.query.dto.ts',
      join(MODULE_DIR, 'dto'),
    );

    expect(controller).toContain('ctx.managedContext');
    expect(controller).not.toContain('@Body');

    for (const forbidden of [
      'tenantId',
      'workspaceId',
      'agencyClientId',
      'clientId',
    ]) {
      expect(dto).not.toContain(forbidden);
    }
  });

  /**
   * §24: the commercial figures require a CRM permission of their own.
   *
   * A user granted media reporting must not obtain the sales pipeline by asking
   * a reporting endpoint for it.
   */
  it('requires both products and the commercial permission', () => {
    const controller = readCode('observed-attribution-summary.controller.ts');

    expect(controller).toContain("'social'");
    expect(controller).toContain("'leadflow'");
    expect(controller).toContain("'social.analytics.reports.view.operational'");
    expect(controller).toContain(
      "'leadflow.analytics.reports.view.operational'",
    );
    expect(controller).toContain("'leadflow.crm.records.view.client'");
  });

  /**
   * §7: the connection is required, so the window has one timezone and the
   * hierarchy lookup one Business.
   */
  it('requires a connection', () => {
    const dto = readCode(
      'observed-attribution-summary.query.dto.ts',
      join(MODULE_DIR, 'dto'),
    );

    expect(dto).toContain('connectionId');
    expect(dto).toContain('@IsUUID()');
  });

  /**
   * The cohort adapter reuses the canonical predicates rather than restating
   * them — the same assertion I4 makes about the individual adapter.
   */
  it('reuses the canonical client predicate and won semantics', () => {
    const adapter = readCode(
      'leadflow-attribution-cohort.adapter.ts',
      join(MODULE_DIR, '..', 'leadflow-analytics', 'intelligence'),
    );

    expect(adapter).toContain('LEADFLOW_SCOPE_SQL.CHANNEL');
    expect(adapter).toContain('LEADFLOW_SCOPE_SQL.OPPORTUNITY');
    expect(adapter).toContain('leadFlowScopeParameters');
    expect(adapter).toContain("row.status === 'won' && row.wonAt !== null");
    expect(adapter).not.toContain("metadata->>'clientId'");
  });

  /**
   * The cohort's entry instant is the first observation *carrying an ad id*.
   *
   * Selecting on any observation would place a conversation whose opening
   * message carried only a click id a week before the evidence that attributes
   * it — and the aggregate would be selected on a different rule from the one
   * the individual view reports.
   */
  it('enters the cohort on the first ad-carrying observation', () => {
    const adapter = readCode(
      'leadflow-attribution-cohort.adapter.ts',
      join(MODULE_DIR, '..', 'leadflow-analytics', 'intelligence'),
    );

    expect(adapter).toContain('observation.ad_id IS NOT NULL');
    expect(adapter).toContain('MIN(observation.observed_at)');
    // Grouped before the window is applied, so a conversation is placed by its
    // first ad ever rather than by whichever click falls inside the range.
    expect(
      adapter.indexOf('GROUP BY observation.conversation_id'),
    ).toBeLessThan(adapter.indexOf('entered.entered_at >= $5'));
  });

  /**
   * §9/§10: outcomes are followed past the window.
   *
   * The opportunity read carries no date predicate at all, which is what makes
   * the funnel a cohort funnel rather than a period report.
   */
  it('does not clip outcomes to the window', () => {
    const adapter = readCode(
      'leadflow-attribution-cohort.adapter.ts',
      join(MODULE_DIR, '..', 'leadflow-analytics', 'intelligence'),
    );

    // Sliced at the method rather than at its SQL comment, which `readCode`
    // strips — the same trap I4.1's day-truncation assertion hit.
    const [, opportunities] = adapter.split('async cohortOpportunities');

    expect(opportunities).toBeDefined();

    const query = opportunities.split('`')[1];

    // The window bounds never reach the opportunity query: that absence is what
    // makes this a cohort funnel rather than a period report.
    expect(query).toContain('inbox_conversation_id = ANY');
    expect(query).not.toContain('won_at >=');
    expect(query).not.toContain('created_at >=');
    expect(query).not.toContain('$6');
  });

  /**
   * The batch hierarchy lookup shares the single lookup's walk.
   *
   * Two hand-maintained copies of a four-level join is how one loses a
   * `connection_id` and starts climbing into another Business's campaign.
   */
  it('resolves the hierarchy with the same walk as the single lookup', () => {
    const lookup = readCode(
      'social-ad-hierarchy-lookup.read.service.ts',
      join(MODULE_DIR, '..', 'social-integrations', 'services'),
    );

    expect(lookup).toContain('HIERARCHY_WALK_SQL');
    // Both queries interpolate the shared walk rather than restating the joins.
    expect(lookup.match(/\$\{HIERARCHY_WALK_SQL\}/g)).toHaveLength(2);
    // And the batch is pinned to one connection, which is what removes
    // ambiguity rather than resolving it by guessing.
    expect(lookup).toContain('ad.connection_id = $7');
  });

  /**
   * I5 §12: Business Mode is carried, never consulted.
   *
   * The dimension is now in the response, which is the moment it becomes
   * tempting to use — filter a cohort to one mode, or default a threshold by
   * it. Either would make attribution mode-aware, and the resulting numbers
   * would silently depend on a *mutable current* setting that says nothing
   * about the period being attributed.
   *
   * The assertion is that the value flows one way. It is fetched once, placed
   * on the response and handed to the limitation builder, and it appears in no
   * predicate, comparison or branch that decides what is counted.
   */
  it('carries business mode without letting it affect attribution', () => {
    const service = readCode('observed-attribution-summary.service.ts');

    // Present: fetched once and surfaced.
    expect(service).toContain('businessModes.businessMode(scope)');

    /**
     * Absent: any comparison of the key against a literal.
     *
     * That is the shape every misuse takes — `=== 'real_estate'`,
     * `.key === mode`, an `includes` over a list of modes. Comparing the
     * *resolution* is legitimate and unaffected, which is why this looks for
     * `.key` specifically rather than banning the word.
     */
    expect(service).not.toMatch(/businessMode\.key\s*[=!]==/);
    expect(service).not.toMatch(/\.key\s*[=!]==\s*['"]/);

    // And nothing groups, filters or sorts by it.
    for (const forbidden of [
      "groupBy === 'businessMode'",
      "groupBy === 'business_mode'",
      'buildBusinessModeGroups',
      'filterByBusinessMode',
    ]) {
      expect(service).not.toContain(forbidden);
    }
  });

  /**
   * The mode sits at the response level, not inside each group (§12).
   *
   * A per-group copy would be the first step toward reading it as "this
   * campaign's mode", which nothing in the storage supports — there is one mode
   * per context and every group in the response shares it.
   */
  it('places business mode outside the group shape', () => {
    const contract = readCode('observed-attribution-summary.contract.ts');

    const [, group] = contract.split(
      'export type ObservedAttributionSummaryGroup = {',
    );

    expect(group).toBeDefined();
    expect(group.split('};')[0]).not.toContain('businessMode');
  });

  /**
   * The projector reads the dimension through the port and never the table.
   *
   * The generic `names no domain table` rule above already forbids arbitrary
   * table names, but it lists the tables that existed when it was written.
   * Naming this one explicitly means a regression reports *which* boundary
   * broke, and keeps the storage of Business Mode a LeadFlow detail even as the
   * value becomes visible in two Intelligence responses.
   */
  it.each(SOURCES)('%s names no business mode storage', (file) => {
    const source = readCode(file);

    for (const table of [
      'leadflow_client_settings',
      'leadflow_business_mode_templates',
      'business_mode_key',
    ]) {
      expect(source).not.toContain(table);
    }
  });
});
