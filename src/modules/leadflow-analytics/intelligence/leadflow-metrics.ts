import type { IntelligenceMetricDescriptor } from '../../../common/intelligence';

/**
 * The LeadFlow metrics exposed through the shared port.
 *
 * Five, not the twenty the operational and commercial projectors compute. The
 * selection rule was: a metric appears here only if its source is a column this
 * platform writes transactionally and its definition needs no qualifier a
 * consumer could get wrong. `qualified_leads` and `hot_leads` were both
 * candidates and both were cut — see the note at the bottom of this file, which
 * is part of the deliverable rather than an aside.
 *
 * Everything is `sum` and `count`. That is not a coincidence: these are
 * cohort-counted events, and a metric that could not be counted honestly is a
 * metric that is not here.
 */
export const LEADFLOW_CONVERSATION_METRICS: readonly IntelligenceMetricDescriptor[] =
  [
    {
      key: 'conversations_started',
      unit: 'count',
      additivity: 'sum',
      derived: false,
      source: 'inbox_conversations.created_at',
      formula:
        'COUNT(DISTINCT conversation.id) where created_at falls in the window, ' +
        'scoped by the channel’s client binding.',
      limitation:
        'Cohorted on when the conversation was opened, not when it was last ' +
        'active — a conversation started before the window and still running is ' +
        'not counted.',
    },
    {
      key: 'inbound_messages',
      unit: 'count',
      additivity: 'sum',
      derived: false,
      source: "inbox_messages.direction = 'inbound'",
      formula: 'COUNT(*) of inbound messages with occurred_at in the window.',
    },
  ];

export const LEADFLOW_COMMERCIAL_METRICS: readonly IntelligenceMetricDescriptor[] =
  [
    {
      key: 'opportunities_created',
      unit: 'count',
      additivity: 'sum',
      derived: false,
      source: 'crm_opportunities.created_at',
      formula:
        'COUNT(*) of opportunities created in the window, scoped by ' +
        "metadata->>'clientId'.",
    },
    {
      key: 'opportunities_won',
      unit: 'count',
      additivity: 'sum',
      derived: false,
      source: 'crm_opportunities.won_at',
      formula: "COUNT(*) where status = 'won' and won_at falls in the window.",
      limitation:
        'Cohorted on when the deal closed, not when it was created — so this ' +
        'is not the win rate of `opportunities_created` over the same window, ' +
        'and dividing one by the other would compare two different cohorts.',
    },
    {
      key: 'won_value',
      unit: 'currency',
      additivity: 'sum',
      derived: false,
      source: 'crm_opportunities.value_amount',
      formula:
        'SUM(value_amount) over the same won cohort as opportunities_won.',
      limitation:
        'Summed only within a single currency; the fact set declares which. ' +
        'A scope holding deals in several currencies reports no total rather ' +
        'than adding unlike units.',
    },
  ];

/**
 * Metrics deliberately **not** exposed, and why.
 *
 * Recorded here rather than omitted silently, because the next person to look
 * will assume they were forgotten.
 *
 * - **`qualified_leads`** — `inbox_conversations.qualification_status` exists and
 *   holds `pending | …`, but nothing records *when* a conversation became
 *   qualified. Counting current status against a past window would report
 *   today's state as last month's result, and the number would change every time
 *   it was asked without any new event having occurred. It becomes exposable the
 *   day qualification is timestamped or emits an event; not before.
 *
 * - **`hot_leads`** — `crm_lead_score_snapshots` is append-only and does carry
 *   `calculated_at`, so a cohort is expressible. It is still cut, because the
 *   honest count needs a decision this task is not the place to make: a lead
 *   scored hot on Monday and cold on Friday is one hot lead or none, depending
 *   on whether the question is "reached hot" or "is hot", and the two differ by
 *   more than rounding. The operational analytics answers it one way
 *   (`hotTransitions`: entered the band) for a screen whose reader can see the
 *   label. A fact under a bare key `hot_leads` carries no such label.
 *
 * - **`first_response_time`** — computed by the operational projector, and the
 *   only strong candidate with `average` additivity. Cut because the weight —
 *   the number of response pairs — is not part of a `{ metricKey, value }` fact,
 *   so a consumer combining two windows would take the mean of two means. That
 *   is precisely the error `IntelligenceAdditivity` exists to prevent, and
 *   shipping the first metric that walks into it would be a poor start.
 */
export const LEADFLOW_METRICS_DEFERRED = [
  'qualified_leads',
  'hot_leads',
  'first_response_time',
] as const;
