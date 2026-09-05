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

  /**
   * Qualification is read from history, never from the current column.
   *
   * The regression this guards is subtle and would look like a fix: a later
   * author, seeing `qualified_leads` return 0 for an old window, reaches for
   * `inbox_conversations.qualification_status` because it "has the answer". It
   * does — today's answer, reported as last month's.
   */
  it('never reads current qualification state as history', () => {
    const service = readCode('acquisition-cohort.service.ts');

    for (const currentState of [
      'qualification_status',
      'qualificationStatus',
      'updated_at',
      'lead_score',
      'hot_band',
    ]) {
      expect(service).not.toContain(currentState);
    }
  });

  /**
   * The destination vocabulary, enforced in the consumer as well as the
   * producer.
   *
   * I3.2a's own boundary spec already forbids `effective_at`/`changed_at` in
   * the write path. The same claim must not reappear on the read side, where
   * an interval is most tempting to describe as the period a destination was
   * "in effect" — which is exactly what Meta does not tell us.
   */
  it('claims observation, never effect, about destinations', () => {
    const sources = [
      readCode('acquisition-cohort.service.ts'),
      readCode('acquisition-cohort.contract.ts'),
      readCode('acquisition-channel.ts'),
    ].join('\n');

    expect(sources).toContain('observed_destination');

    for (const overclaim of [
      'effectiveAt',
      'effectiveFrom',
      'effective_at',
      'changedAt',
      'changed_at',
      'destinationChangedAt',
    ]) {
      expect(sources).not.toContain(overclaim);
    }
  });

  /**
   * No individual attribution, stated as an import rule rather than a promise.
   *
   * `inbox_attribution_observations` is I1.1's per-conversation evidence and is
   * what I4 will use. Reaching it from here would turn a cohort correlation
   * into per-lead attribution while every label in the payload still said
   * otherwise.
   */
  it('never imports the individual attribution evidence', () => {
    for (const file of SOURCES) {
      const source = readCode(file);

      expect(source).not.toContain('inbox_attribution_observations');
      expect(source).not.toContain('InboxAttributionObservation');
    }
  });

  /**
   * A ratio whose two sides come from different cohorts is not computed.
   *
   * Asserted on the source because the failure is silent: the numbers exist,
   * the quotient is well-formed, and only the semantics are wrong. A later
   * author restoring one of these would produce a plausible number with no
   * test failing — unless this one does.
   */
  it('leaves the stage-to-stage rates unset', () => {
    const service = readCode('acquisition-cohort.service.ts');

    expect(service).toContain('conversationToQualifiedRate: null');
    expect(service).toContain('qualifiedToOpportunityRate: null');
    expect(service).toContain('opportunityToWonRate: null');
  });

  /**
   * The destination breakdown must not become an apportionment.
   *
   * The specific regression: an author wanting a fuller-looking breakdown takes
   * a campaign's or the account's spend and divides it across destinations by
   * ad set count, impressions or conversations. Every one of those produces a
   * number that looks measured, and every one is wrong for exactly the account
   * this feature exists to serve — one testing two destinations inside one
   * campaign.
   *
   * Asserted on the source rather than the output because the failure has no
   * failing shape: the buckets would still be well-formed, still sum to the
   * total, and be silently fictional.
   */
  it('apportions nothing across destinations', () => {
    const service = readCode('acquisition-cohort.service.ts');

    for (const forbidden of [
      'allocate',
      'apportion',
      'prorate',
      'proRata',
      'weight',
      'share *',
      'distribute',
    ]) {
      expect(service).not.toContain(forbidden);
    }
  });

  /**
   * A destination without an inbox counterpart gets null, never a sum.
   *
   * `messaging_multi` is the one that invites the mistake: the ad set offered
   * WhatsApp *and* Instagram *and* Messenger, so adding those three channels'
   * conversations produces a number that lines up beside the spend and asserts
   * routing nobody observed. The contract makes the refusal a type — `support`
   * is not `mapped` — and this asserts the type is actually consulted.
   */
  it('never sums channels to manufacture a multi-destination funnel', () => {
    const service = readCode('acquisition-cohort.service.ts');

    expect(service).toContain('multi_destination');
    expect(service).toContain('no_inbox_equivalent');
    // The support value decides the funnel side; a bucket is never given counts
    // by falling through to a default channel.
    expect(service).toContain("support === 'mapped'");
  });

  /**
   * Totals are not rebuilt from buckets.
   *
   * The `social` block must keep coming from the account-level fact set. Summing
   * the destination buckets into it would change every number this endpoint has
   * ever returned — the account row includes delivery belonging to no mirrored
   * ad set, and days the ad-set backfill has not reached would silently vanish
   * from the total.
   */
  it('derives the period totals from the fact sets, not the breakdown', () => {
    const service = readCode('acquisition-cohort.service.ts');

    expect(service).toContain('this.readSocialFacts(socialSet)');
    expect(service).toContain('this.derive(socialFacts, leadflowFacts)');
  });

  /**
   * The CRM is not broken down by destination, and the refusal is permanent.
   *
   * Unlike the ad-set gap this one does not close by waiting: no opportunity
   * carries the ad set that produced it. The bucket type has no
   * `opportunitiesCreated` field at all — absent rather than present-and-null —
   * so a future author has to change the contract to make the mistake.
   */
  it('offers no per-destination CRM outcome', () => {
    const contract = readCode('acquisition-cohort.contract.ts');
    const bucketBlock = contract.slice(
      contract.indexOf('CohortDestinationLeadFlowFacts = {'),
      contract.indexOf('CohortDestinationDerived'),
    );

    expect(bucketBlock).not.toContain('opportunities');
    expect(bucketBlock).not.toContain('wonOpportunity');
  });

  /**
   * I5: the Business Mode value is read through the port, never from storage.
   *
   * The generic query rules above already forbid this module a repository, so
   * the only way to reach `leadflow_client_settings` from here is by inventing
   * one. Naming the two tables explicitly makes a regression say which boundary
   * broke, and states in the test file that Business Mode's storage is a
   * LeadFlow detail even though its *value* now appears in this response.
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

  /**
   * The mode is read from the dimension, and from nowhere else (§11).
   *
   * Before I5 this module took `businessMode` from `leadflowSet.businessMode` —
   * a field the fact source hardcodes to null. Leaving that read in place beside
   * the new one would give the response two sources for one value, free to
   * disagree the day the fact source starts populating it. The old read is gone
   * and this asserts it stays gone.
   */
  it('resolves business mode only through the dimension', () => {
    const service = readCode('acquisition-cohort.service.ts');

    expect(service).toContain('this.businessMode.businessMode(scope)');
    expect(service).not.toContain('leadflowSet.businessMode');
    expect(service).not.toContain('socialSet.businessMode');
  });

  /**
   * The dimension does not become a filter or an axis (§12's I3 analogue).
   *
   * I3 correlates by period and channel. Adding a mode predicate would make the
   * correlation depend on a mutable current setting, and — because that setting
   * has no history — would silently change which rows a past period contains
   * whenever somebody edits their settings screen.
   */
  it('never filters or groups by business mode', () => {
    const service = readCode('acquisition-cohort.service.ts');

    expect(service).not.toMatch(/businessMode\.key\s*[=!]==/);
    expect(service).not.toMatch(/\.key\s*[=!]==\s*['"]/);
  });
});
