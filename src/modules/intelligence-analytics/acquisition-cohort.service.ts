import { Injectable } from '@nestjs/common';
import {
  assertAggregable,
  type IntelligenceFactSet,
  type IntelligenceMetricDescriptor,
  type IntelligenceScope,
  type IntelligenceWindow,
} from '../../common/intelligence';
import { LeadFlowIntelligenceAdapter } from '../leadflow-analytics/intelligence/leadflow-intelligence.adapter';
import {
  divideScaled,
  formatDerived,
} from '../social-integrations/analytics/social-ad-kpi';
import { parseScaledAmount } from '../social-integrations/sync/metric-number';
import { SocialPaidMediaIntelligenceAdapter } from '../social-integrations/intelligence/social-paid-media-intelligence.adapter';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import {
  resolvePaidMediaChannel,
  type ChannelResolution,
} from './acquisition-channel';
import {
  COHORT_CORRELATION_LIMITATION,
  type AcquisitionCohortView,
  type CohortDerivedMetrics,
  type CohortLeadFlowFacts,
  type CohortSocialFacts,
} from './acquisition-cohort.contract';

/**
 * The first cross-domain read, and the first one that has to be honest about a
 * join it cannot make.
 *
 * It composes the two I2 fact sources — it does not query either domain. That
 * is the whole architectural claim of I2 being worth anything: a cross-domain
 * view is a *consumer* of the ports, so the four rules that make Social numbers
 * correct and the client predicate that makes LeadFlow numbers correct each
 * still have exactly one implementation, in the domain that owns them. A
 * projector that wrote its own SQL would be the sixth copy of a scope predicate
 * and the second copy of `entity_level = 'account'`.
 *
 * Nothing here is persisted. No fact table, no materialised view, no cache: the
 * result is derived per request from two reads that are themselves cheap, and
 * the measurements at the bottom of the postgres spec are what justify leaving
 * it that way rather than an assumption that it is fine.
 *
 * ## What it is not
 *
 * Not attribution. `kind` and `joinBasis` say so in the payload, the limitation
 * text says so in words, and `dataQuality.individualAttribution` says so as a
 * boolean a UI can branch on. The reason for saying it three times is that this
 * is the exact shape of output that gets screenshotted into a client deck with
 * the caveat cropped off.
 */
@Injectable()
export class AcquisitionCohortService {
  constructor(
    private readonly social: SocialPaidMediaIntelligenceAdapter,
    private readonly leadflow: LeadFlowIntelligenceAdapter,
    private readonly socialReads: SocialAnalyticsReadService,
  ) {}

  /**
   * One cohort row for the whole window.
   *
   * `period` grain on both sides, deliberately. The derived metrics are
   * quotients of two sums, and forming them from period totals is the only
   * definition that survives an arbitrary window — the same rule
   * `IntelligenceRatioDescriptor` states for paid media, applied across
   * domains. Day-grain cohort rows are a presentation concern that would want a
   * time series, and building one now would mean choosing a chart shape before
   * anyone has asked for a chart.
   */
  async cohort(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    connectionId: string,
  ): Promise<AcquisitionCohortView> {
    /**
     * The ad account's timezone decides the day boundary for *both* sides.
     *
     * Not a preference — a correctness requirement. Meta reports a day in the
     * account's zone, so 2026-07-14's spend covers 00:00–23:59 São Paulo time.
     * LeadFlow timestamps cast to `date` in the database's zone, which is UTC
     * here. Left alone, a conversation at 21:00 BRT counts against the next
     * day while the spend that preceded it counts against the current one, and
     * every evening conversation in the country lands in the wrong bucket.
     *
     * Read from the connection rather than assumed, and it is the reason this
     * method requires a `connectionId`: with two ad accounts in different
     * zones there is no single day boundary that is right for both, and
     * silently picking one would misstate the other.
     */
    const timezone = await this.resolveAccountTimezone(scope, connectionId);

    const [socialSet, leadflowSet] = await Promise.all([
      this.social.fetch({
        scope,
        window,
        grain: 'period',
        subjectId: connectionId,
      }),
      this.leadflow.fetch({
        scope,
        window,
        grain: 'period',
        // Undefined when the account has no zone: each domain then keeps its
        // own default, which is the pre-I3 behaviour rather than a guess.
        dayBucketTimezone: timezone ?? undefined,
      }),
    ]);

    const socialFacts = this.readSocialFacts(socialSet);
    const leadflowFacts = this.readLeadFlowFacts(leadflowSet);

    /**
     * Paid media cannot name its channel, so the cohort is the whole Meta
     * surface on both sides. See `resolvePaidMediaChannel` for the evidence.
     */
    const channel = resolvePaidMediaChannel();
    const channelResolution: ChannelResolution = 'provider_bucket';

    return {
      kind: 'cohort_correlation',
      joinBasis: 'date_channel_bucket',
      period: { since: window.since, until: window.until },
      channel,
      // The paid-media currency: it is the only side with a per-unit money
      // figure the derived costs are expressed in. LeadFlow's won value is
      // reported in its own currency and the two are *not* assumed equal —
      // `wonValueCurrencyMismatch` below is what says so when they differ.
      currency: socialSet.currency,
      businessMode: leadflowSet.businessMode,
      social: socialFacts,
      leadflow: leadflowFacts,
      derived: this.derive(socialFacts, leadflowFacts),
      provenance: {
        social: socialSet.provenance,
        leadflow: leadflowSet.provenance,
        projector: {
          kind: 'cohort_correlation',
          joinBasis: 'date_channel_bucket',
          dayBucketTimezone: timezone ?? 'UTC',
          dayBucketTimezoneSource: timezone ? 'ad_account' : 'utc_fallback',
        },
      },
      freshness: {
        social: socialSet.freshness,
        leadflow: leadflowSet.freshness,
        // A view is only as current as its least current half. Social D0 is
        // still landing for hours, and a reader told otherwise would compute a
        // cost per lead that moves under them tomorrow.
        overallPartial:
          socialSet.freshness.isPartial || leadflowSet.freshness.isPartial,
      },
      dataQuality: {
        cohortCorrelation: true,
        individualAttribution: false,
        channelResolution,
        partialData:
          socialSet.freshness.isPartial || leadflowSet.freshness.isPartial,
        limitations: this.limitations(
          socialSet,
          leadflowSet,
          channelResolution,
        ),
        missingFacts: this.missingFacts(leadflowSet.descriptors),
      },
    };
  }

  /**
   * The ad account's IANA zone, or null.
   *
   * Goes through the Social read service, which already scopes connection
   * lookups by tenant, workspace and client — so a caller cannot reach another
   * tenant's connection by guessing a UUID. A direct repository read here would
   * have been a second place that decides which connections a scope may see.
   */
  private async resolveAccountTimezone(
    scope: IntelligenceScope,
    connectionId: string,
  ): Promise<string | null> {
    const connections = await this.socialReads.listConnections(scope);
    const connection = connections.find((item) => item.id === connectionId);

    return connection?.timezone ?? null;
  }

  /**
   * Pulls the paid-media values out of the fact set by key.
   *
   * `assertAggregable` is called on every descriptor before its value is read,
   * even though a `period` fact set holds one row per metric. The check is
   * cheap and it is the guard that fails loudly if this method is ever pointed
   * at a `day` set — which is exactly the change someone will make to build a
   * time series, and exactly the change that would otherwise sum reach.
   */
  private readSocialFacts(set: IntelligenceFactSet): CohortSocialFacts {
    const read = (key: string) => this.readPeriodFact(set, key);

    return {
      spend: read('spend'),
      impressions: read('impressions'),
      clicks: read('clicks'),
      linkClicks: read('link_clicks'),
      providerLeads: read('leads'),
      conversions: read('conversions'),
      conversionValue: read('conversion_value'),
    };
  }

  private readLeadFlowFacts(set: IntelligenceFactSet): CohortLeadFlowFacts {
    const read = (key: string) => this.readPeriodFact(set, key);

    return {
      conversationsReceived: read('conversations_started'),
      inboundMessages: read('inbound_messages'),
      /**
       * Null, and named in `missingFacts` rather than reported as zero.
       *
       * `inbox_conversations.qualification_status` holds a current state with
       * no timestamp anywhere in the schema — verified against the live table,
       * not assumed. Counting it against a past window would report today's
       * state as last month's result, and the number would change every time
       * the report was run without anything having happened. A zero would be a
       * lie; a null with a stated reason is the honest answer.
       */
      qualifiedLeads: null,
      opportunitiesCreated: read('opportunities_created'),
      wonOpportunities: read('opportunities_won'),
      wonOpportunityValue: read('won_value'),
    };
  }

  /**
   * One metric's value from a `period` fact set, guarded by its descriptor.
   *
   * A metric the set does not declare returns null rather than throwing: the
   * two domains evolve independently, and a Social release that renamed a key
   * should degrade one field of this view, not take the endpoint down.
   */
  private readPeriodFact(set: IntelligenceFactSet, key: string): string | null {
    const descriptor = set.descriptors.find((item) => item.key === key);
    if (!descriptor) return null;

    const rows = set.facts.filter((fact) => fact.metricKey === key);
    if (rows.length === 0) return null;

    // Throws for a non-additive metric spread over several rows — the whole
    // point of the contract carrying additivity.
    assertAggregable(descriptor, rows.length);

    return rows[0].value;
  }

  /**
   * The eight cost and funnel metrics, in exact decimal.
   *
   * Every one is a quotient of two period totals, computed here and stored
   * nowhere. The arithmetic is `divideScaled` from the Social KPI module rather
   * than a second implementation: it works in `bigint` scaled to 1e6, matches
   * the `numeric(18,6)` columns the money comes from, rounds half-up the way
   * Postgres does, and returns null for a zero denominator. Re-deriving those
   * rules here would mean two rounding behaviours in one codebase.
   *
   * No `Number` appears in this path. A quarter of ad spend in binary floating
   * point drifts, and these are the numbers a client is invoiced against.
   */
  private derive(
    social: CohortSocialFacts,
    leadflow: CohortLeadFlowFacts,
  ): CohortDerivedMetrics {
    const spend = parseScaledAmount(social.spend);

    /** Money ÷ count, as a money value. Null when either side is unusable. */
    const costPer = (count: string | null): string | null => {
      const scaledCount = parseScaledAmount(count);
      if (spend === null || scaledCount === null) return null;
      return formatDerived(divideScaled(spend, scaledCount));
    };

    /** Count ÷ count, as a bare quotient. */
    const rate = (
      numerator: string | null,
      denominator: string | null,
    ): string | null => {
      const top = parseScaledAmount(numerator);
      const bottom = parseScaledAmount(denominator);
      if (top === null || bottom === null) return null;
      return formatDerived(divideScaled(top, bottom));
    };

    return {
      providerCpl: costPer(social.providerLeads),
      costPerConversation: costPer(leadflow.conversationsReceived),
      // Null for as long as qualified leads are not countable — the cost is
      // undefined, not zero, and it follows the metric rather than being
      // special-cased.
      costPerQualifiedLead: costPer(leadflow.qualifiedLeads),
      costPerOpportunity: costPer(leadflow.opportunitiesCreated),
      costPerWonOpportunity: costPer(leadflow.wonOpportunities),
      conversationToQualifiedRate: rate(
        leadflow.qualifiedLeads,
        leadflow.conversationsReceived,
      ),
      qualifiedToOpportunityRate: rate(
        leadflow.opportunitiesCreated,
        leadflow.qualifiedLeads,
      ),
      opportunityToWonRate: rate(
        leadflow.wonOpportunities,
        leadflow.opportunitiesCreated,
      ),
    };
  }

  /**
   * What the reader has to be told, in the order it matters.
   *
   * Assembled from what actually happened on this request rather than being a
   * fixed block, so a reader can tell a partial window from a complete one.
   */
  private limitations(
    social: IntelligenceFactSet,
    leadflow: IntelligenceFactSet,
    channelResolution: ChannelResolution,
  ): string[] {
    const limitations = [COHORT_CORRELATION_LIMITATION];

    if (channelResolution === 'provider_bucket') {
      limitations.push(
        'O destino da campanha (WhatsApp, Instagram Direct ou Messenger) não é ' +
          'informado pelo provedor no modelo de dados atual, portanto a ' +
          'comparação é feita entre toda a mídia paga Meta e todas as ' +
          'conversas recebidas nos canais Meta.',
      );
    }

    limitations.push(
      'Os leads informados pelo provedor e as conversas recebidas são ' +
        'contagens independentes e não devem ser subtraídas: diferenças de ' +
        'janela de atribuição, duplicidades e conversas iniciadas fora do ' +
        'período produzem divergência esperada.',
    );

    if (social.freshness.isPartial) {
      limitations.push(
        'Os dados de mídia do período incluem pelo menos um dia ainda em ' +
          'sincronização e podem mudar.',
      );
    }

    const { expectedDays, coveredDays } = social.freshness.coverage;
    if (coveredDays < expectedDays) {
      limitations.push(
        `A sincronização de mídia cobre ${coveredDays} de ${expectedDays} ` +
          'dias do período solicitado.',
      );
    }

    /**
     * Two currencies is a real risk here in a way it is not inside either
     * domain: costs are in the ad account's currency and won value is in the
     * CRM's, and a reader comparing them would be comparing unlike units
     * without this line.
     */
    if (
      social.currency &&
      leadflow.currency &&
      social.currency !== leadflow.currency
    ) {
      limitations.push(
        `O investimento está em ${social.currency} e o valor ganho em ` +
          `${leadflow.currency}; os dois não foram convertidos.`,
      );
    }

    return limitations;
  }

  /**
   * Metrics this view wanted and could not get, each with its reason.
   *
   * Derived from the descriptors the domain actually published, so the day
   * LeadFlow exposes `qualified_leads` this list shrinks on its own instead of
   * carrying a stale apology.
   */
  private missingFacts(
    descriptors: IntelligenceMetricDescriptor[],
  ): Array<{ metricKey: string; reason: string }> {
    const published = new Set(descriptors.map((item) => item.key));
    const missing: Array<{ metricKey: string; reason: string }> = [];

    if (!published.has('qualified_leads')) {
      missing.push({
        metricKey: 'qualified_leads',
        reason:
          'A qualificação da conversa é um estado atual sem data registrada, ' +
          'portanto não pode ser contada dentro de um período passado.',
      });
    }

    return missing;
  }
}
