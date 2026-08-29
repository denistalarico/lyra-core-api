/**
 * Where a paid-media click or conversation actually lands.
 *
 * This is deliberately *not* a Meta type. Google Ads and TikTok both express
 * the same idea — a click ends on a website, in a lead form, or in a messaging
 * thread — under their own vocabularies, and each will bring its own mapping
 * function to this same canonical set. Naming the concept after Meta (a
 * `MetaWhatsAppDestination`) would mean the second provider either widens a
 * type that claims to be Meta's or lands next to it with a parallel vocabulary
 * that no shared query can group by.
 *
 * `unknown` is a real member of the set, not a gap in it. A destination that
 * the provider did not state is a fact about the ad set, and the read model
 * must be able to say it plainly rather than guess.
 */
export type CanonicalPaidMediaDestination =
  | 'whatsapp'
  | 'instagram_direct'
  | 'messenger'
  | 'messaging_multi'
  | 'website'
  | 'lead_form'
  | 'app'
  | 'phone'
  | 'profile'
  | 'on_post'
  | 'unknown';

/**
 * How firmly the destination above is known.
 *
 * Two values, no probability. The provider either stated a destination for this
 * ad set or it did not; a number in between would be a claim this pipeline has
 * no evidence for, and it would immediately be read as one — a "0.7 WhatsApp"
 * in a report is indistinguishable from a measurement.
 */
export type PaidMediaDestinationResolution = 'observed' | 'unavailable';

export type ResolvedPaidMediaDestination = {
  canonical: CanonicalPaidMediaDestination;
  /**
   * The provider's own string, preserved verbatim.
   *
   * Kept alongside the canonical value rather than replaced by it, because the
   * mapping below is the part most likely to be wrong or incomplete: Meta ships
   * new `destination_type` values without notice, and a destructive transform
   * would leave a row saying `unknown` with no way to find out what Meta had
   * actually said. With the raw value stored, a corrected mapping can be
   * re-derived from data already on disk instead of by re-syncing the account.
   */
  providerValue: string | null;
  resolution: PaidMediaDestinationResolution;
};

/**
 * Meta `destination_type` → canonical destination.
 *
 * Every key here was observed in a real account, not read off a documentation
 * page. Meta's own enum is longer than this, and it grows; the map is
 * deliberately not exhaustive, because an entry invented for a value nobody has
 * seen is an untested guess about what that value means.
 *
 * The messaging entries are the reason this whole slice exists. Meta expresses
 * "a conversation" as five distinct destinations, and only these strings
 * separate them — `optimization_goal` is `CONVERSATIONS` for all of them.
 */
const META_DESTINATION_MAP: Readonly<
  Record<string, CanonicalPaidMediaDestination>
> = {
  WHATSAPP: 'whatsapp',
  INSTAGRAM_DIRECT: 'instagram_direct',
  MESSENGER: 'messenger',
  /**
   * Meta's multi-app messaging destinations, where the advertiser offered the
   * person a choice of app and Meta routes to whichever they pick.
   *
   * Mapped to their own canonical value rather than to one of the three
   * single-app ones. Collapsing `..._DIRECT_MESSENGER_WHATSAPP` into `whatsapp`
   * would state that these conversations arrived on WhatsApp, which is exactly
   * the question the comparison is supposed to answer and precisely what this
   * ad set does not determine. The honest answer at ad-set level is "messaging,
   * app decided per person" — resolving it further needs the conversation, not
   * the ad set.
   */
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER: 'messaging_multi',
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP: 'messaging_multi',
  MESSAGING_INSTAGRAM_DIRECT_WHATSAPP: 'messaging_multi',
  MESSAGING_MESSENGER_WHATSAPP: 'messaging_multi',
  WEBSITE: 'website',
  LEAD_FORM: 'lead_form',
  ON_AD: 'lead_form',
  APP: 'app',
  PHONE_CALL: 'phone',
  INSTAGRAM_PROFILE: 'profile',
  INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE: 'profile',
  FACEBOOK_PAGE: 'profile',
  ON_PAGE: 'profile',
  ON_POST: 'on_post',
  ON_VIDEO: 'on_post',
  ON_EVENT: 'on_post',
};

/**
 * Meta's explicit "no destination configured" value.
 *
 * `UNDEFINED` arrives on 11 of 126 ad sets in the account this was built
 * against, on goals like `VISIT_INSTAGRAM_PROFILE` and `LINK_CLICKS`. It is a
 * value Meta chose to send, but it carries no destination, so it resolves the
 * same way an absent field does: `unknown` / `unavailable`. What separates the
 * two cases is `providerValue`, which keeps the string — that is how a reader
 * can still tell "Meta said UNDEFINED" from "Meta said nothing at all".
 */
const META_UNDEFINED_DESTINATION = 'UNDEFINED';

/** Column width for the stored provider value. */
const MAX_PROVIDER_VALUE = 60;

/**
 * Resolves an ad set's destination from the provider fields, and nothing else.
 *
 * Pure, and narrow on purpose. The signals it is *not* allowed to look at are
 * the point of the function:
 *
 * - `objective` is the campaign's outcome (`OUTCOME_ENGAGEMENT`), not a place.
 * - `optimization_goal` is what the delivery system bids toward. In the account
 *   this was written against, `CONVERSATIONS` resolves to WHATSAPP 35 times,
 *   to a multi-app messaging destination 6 times, to MESSENGER once and to
 *   INSTAGRAM_DIRECT once. Reading it as "WhatsApp" would be right most of the
 *   time in this account and wrong in a way nobody could see.
 * - the ad set or campaign *name* is advertiser prose. "Campanha WhatsApp Ago"
 *   is a label a human typed, and it stays true in the report long after the
 *   ad set was pointed somewhere else.
 *
 * So the only input that decides anything is `destination_type`. If Meta did
 * not state it, the answer is `unknown` — which is a usable answer, unlike a
 * confident wrong one.
 */
export function resolvePaidMediaDestination(
  providerFields: Record<string, unknown>,
): ResolvedPaidMediaDestination {
  const raw = providerFields.destination_type;

  if (typeof raw !== 'string' || !raw.trim()) {
    return {
      canonical: 'unknown',
      providerValue: null,
      resolution: 'unavailable',
    };
  }

  const providerValue = raw.trim().slice(0, MAX_PROVIDER_VALUE);
  const normalized = providerValue.toUpperCase();

  if (normalized === META_UNDEFINED_DESTINATION) {
    // Preserved, not discarded: "Meta explicitly said UNDEFINED" and "Meta sent
    // no field" are different provider behaviours and stay distinguishable.
    return { canonical: 'unknown', providerValue, resolution: 'unavailable' };
  }

  const canonical = META_DESTINATION_MAP[normalized];

  if (!canonical) {
    /**
     * A value Meta added after this map was written.
     *
     * Resolved to `unknown` rather than thrown. A sync that failed on an
     * unrecognised enum would mean Meta could stop the mirror of an entire
     * account by shipping a new destination — and the row is still perfectly
     * usable for spend, reach and every other column. The raw string is kept,
     * so the new value is visible in the data the moment it appears and the
     * mapping can be extended from evidence.
     */
    return { canonical: 'unknown', providerValue, resolution: 'unavailable' };
  }

  return { canonical, providerValue, resolution: 'observed' };
}
