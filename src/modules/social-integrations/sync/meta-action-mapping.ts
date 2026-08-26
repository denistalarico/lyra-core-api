import {
  formatScaledAmount,
  parseCountText,
  parseScaledAmount,
} from './metric-number';

/**
 * How Meta's `actions` array becomes the handful of columns the product names.
 *
 * This file exists because of one measurement taken against the real internal
 * ad account (`act_415877197389621`, 90 days). On the three days it recorded
 * leads, Meta reported **seven** action types carrying the identical value:
 *
 * ```
 *   lead                                          4
 *   onsite_conversion.lead                        4
 *   onsite_web_lead                               4
 *   onsite_conversion.lead_grouped                4
 *   offsite_complete_registration_add_meta_leads  4
 *   offsite_search_add_meta_leads                 4
 *   offsite_content_view_add_meta_leads           4
 * ```
 *
 * Four leads happened. Summing the array gives twenty-eight. That is not an
 * edge case to guard against later — it is the default behaviour of the most
 * obvious implementation, on the first account this pipeline ever reads.
 *
 * So actions are not summed. They are grouped into **families**, each family is
 * an ordered list of the type names Meta uses for the same underlying event,
 * and a family contributes **the first type present** and nothing else. A type
 * belongs to exactly one family, which is what makes double counting
 * structurally impossible rather than merely avoided.
 *
 * Everything Meta sent is still persisted in the `actions` column, whether or
 * not a family claims it. If this mapping turns out to be wrong — and on an
 * account with a different objective it may well be incomplete — `leads`,
 * `conversions` and `conversion_value` can be re-derived from stored rows
 * without asking Meta for the window again.
 */

/**
 * Which revision of the rules below produced a stored row's promoted columns.
 *
 * Written into every fact's `actions` payload, and the reason is the sentence
 * above: re-derivation only works if you know what the current numbers *mean*.
 * A row whose `leads` came from version 1 and a row whose `leads` came from a
 * future version that counts messaging conversations are not comparable, and
 * without a stamp there is no way to tell them apart after the fact — the two
 * look identical, and summing them would mix two definitions into one total.
 *
 * Bump it whenever a change would make `leads`, `conversions`,
 * `conversion_value` or `video_views` come out differently for the same input:
 * a family gaining or losing a type, an ordering change, a family becoming
 * counted. Do not bump it for a comment, a rename, or a new family that no
 * account has ever reported — those produce identical numbers.
 */
export const META_ACTION_MAPPING_VERSION = 1;

/** The families this version recognizes. */
export type MetaActionFamilyKey = 'lead' | 'purchase' | 'complete_registration';

export type MetaActionFamily = {
  key: MetaActionFamilyKey;
  /**
   * Type names for the same event, most canonical first.
   *
   * Order is the whole mechanism: the first name present supplies the value and
   * the rest are ignored. Meta's aggregate names (`lead`, `purchase`) come
   * first because they are what Ads Manager's own column shows; the
   * placement-specific and CRM-echo names follow, so an account that reports
   * only those is still counted once.
   */
  types: readonly string[];
  /** Whether the family adds to the `conversions` column. */
  countsAsConversion: boolean;
};

/**
 * **`leads` is a subset of `conversions`, never a sibling of it.**
 *
 * The lead family is one of the families `conversions` sums, so a row with four
 * leads and no purchases has `conversions = 4` — the same four events, counted
 * once under each name. `leads + conversions` is therefore double counting with
 * extra steps, and it is an inviting mistake precisely because the two columns
 * sit next to each other and look like categories.
 *
 * The columns answer different questions. `leads` is "how many people asked to
 * be contacted", which a lead-generation client reads directly. `conversions`
 * is "how many outcome events of any counted family happened", which is what a
 * cost-per-result needs when an account runs lead ads and a shop at once. A
 * report showing both must label them as overlapping or show only one.
 *
 * What `conversions` counts in version 1, and nothing else:
 * `lead`, `purchase`, `complete_registration`.
 */

/**
 * `video_view` in the `actions` array is Meta's 3-second video play.
 *
 * Read from `actions` rather than from `video_play_actions` or
 * `video_thruplay_watched_actions`. All three were confirmed available on the
 * account and they answer different questions — over the same 90 days the same
 * campaign reported 4 877 plays, 872 three-second views and 190 ThruPlays. A
 * column called `video_views` that silently held plays would overstate video
 * performance by five times, and picking the field costs nothing extra here
 * because `actions` is already being requested.
 *
 * **So `video_views` means this one action type, not "video views" in general.**
 * Meta has no single such number: a play, a three-second view, a ThruPlay, a
 * 25% and a 100% completion are five different measurements of the same
 * impression, and Ads Manager shows whichever the campaign's objective makes
 * relevant. Anything reading this column must say which one it is showing, and
 * a future slice that wants completions or ThruPlays needs new columns and a
 * mapping version — not a redefinition of this one, which would change the
 * meaning of every row already stored.
 */
export const VIDEO_VIEW_ACTION_TYPE = 'video_view';

/**
 * The families, and the reasoning behind each membership list.
 *
 * Deliberately three. A larger table would be guesses about objectives no
 * client of this platform runs yet, and every guess is a chance to put two
 * names for one event into two different families — which is the one mistake
 * this structure cannot catch on its own.
 */
export const META_ACTION_FAMILIES: readonly MetaActionFamily[] = [
  {
    key: 'lead',
    /**
     * All seven names observed on the real account, plus Meta's grouped
     * aggregate. The `*_add_meta_leads` trio are the Meta Leads CRM's echo of
     * the same submission — they are members here, and not a registration or a
     * search event, precisely so they can never form a family of their own and
     * be added a second time.
     */
    types: [
      'lead',
      'onsite_conversion.lead_grouped',
      'onsite_conversion.lead',
      'onsite_web_lead',
      'offsite_complete_registration_add_meta_leads',
      'offsite_content_view_add_meta_leads',
      'offsite_search_add_meta_leads',
    ],
    countsAsConversion: true,
  },
  {
    key: 'purchase',
    /** Not observed on this account; the names are Meta's documented trio. */
    types: [
      'purchase',
      'omni_purchase',
      'offsite_conversion.fb_pixel_purchase',
    ],
    countsAsConversion: true,
  },
  {
    key: 'complete_registration',
    /**
     * The `add_meta_leads` variant of this event is deliberately absent — it
     * lives in the lead family above, where the data showed it belongs.
     */
    types: [
      'complete_registration',
      'omni_complete_registration',
      'offsite_conversion.fb_pixel_complete_registration',
    ],
    countsAsConversion: true,
  },
];

/**
 * Messaging action types, recorded and deliberately **not** counted.
 *
 * On the measured account these overlap the lead family without matching it:
 * five conversations started against four leads, three of the five on days that
 * also recorded a lead. For a WhatsApp campaign a conversation and a lead are
 * two views of one funnel, so adding both would count most people twice — and
 * asserting they are entirely distinct would be a claim the data does not
 * support either.
 *
 * The honest v1 is to leave them out of the counted columns and keep every one
 * of them in `actions`, where a later slice that knows the campaign objective
 * can decide. Listed here so the omission is visible and testable rather than
 * an oversight.
 */
export const UNCOUNTED_MESSAGING_ACTION_TYPES: readonly string[] = [
  'onsite_conversion.total_messaging_connection',
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_first_reply',
  'onsite_conversion.messaging_user_depth_2_message_send',
  'onsite_conversion.messaging_user_depth_3_message_send',
];

/** Action counts and values as stored, keyed by Meta's own type name. */
export type MetaActionBreakdown = {
  counts: Record<string, string>;
  values: Record<string, string>;
};

/** The columns derived from the breakdown above. */
export type MetaActionFacts = {
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;
};

/**
 * Reads Meta's `actions` / `action_values` arrays into a stored map.
 *
 * Unknown type names are kept, not dropped: the point of the column is that a
 * mapping change tomorrow does not require re-reading the window from Meta, and
 * that only holds if everything the provider said is still there. Entries whose
 * value cannot be parsed are dropped, because storing an unreadable number
 * would defeat the same purpose.
 */
export function readActionMap(value: unknown): Record<string, string> {
  const map: Record<string, string> = {};

  if (!Array.isArray(value)) return map;

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;

    const record = entry as Record<string, unknown>;
    const type = record.action_type;

    if (typeof type !== 'string' || !type.length) continue;

    const scaled = parseScaledAmount(record.value);

    if (scaled === null) continue;

    map[type] = formatScaledAmount(scaled);
  }

  return map;
}

/**
 * Derives the promoted columns from one row's action breakdown.
 *
 * Reading this is the fastest way to see the rule: every number below comes
 * from at most one type per family, so no arrangement of Meta's aliases can
 * inflate a total.
 */
export function deriveActionFacts(
  breakdown: MetaActionBreakdown,
): MetaActionFacts {
  let conversions = 0n;
  let conversionValue = 0n;
  let leads = 0n;

  for (const family of META_ACTION_FAMILIES) {
    const count = firstPresent(breakdown.counts, family.types);

    if (family.key === 'lead' && count !== null) {
      leads = count;
    }

    if (!family.countsAsConversion) continue;

    if (count !== null) conversions += count;

    /**
     * The value is looked up in the same ordered list, independently of which
     * name supplied the count. Meta attaches monetary value to whichever alias
     * its optimization used, and that is not always the alias that reported the
     * count — insisting on the same name would silently zero the revenue of a
     * value-optimized campaign.
     */
    const amount = firstPresent(breakdown.values, family.types);

    if (amount !== null) conversionValue += amount;
  }

  return {
    // `bigint` column: leads are whole submissions, so the fractional part of
    // an attribution-split value is dropped rather than being rounded up into
    // a lead that did not happen.
    leads: formatScaledAmount(leads).split('.')[0],
    conversions: formatScaledAmount(conversions),
    conversionValue: formatScaledAmount(conversionValue),
    videoViews:
      parseCountText(breakdown.counts[VIDEO_VIEW_ACTION_TYPE]?.split('.')[0]) ??
      '0',
  };
}

/** The first of `types` present in the map, as a scaled amount. */
function firstPresent(
  map: Record<string, string>,
  types: readonly string[],
): bigint | null {
  for (const type of types) {
    const stored = map[type];

    if (stored === undefined) continue;

    const scaled = parseScaledAmount(stored);

    if (scaled !== null) return scaled;
  }

  return null;
}
