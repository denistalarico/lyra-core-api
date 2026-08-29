/**
 * The one place a channel name is decided.
 *
 * Social and LeadFlow each name channels in their own vocabulary, and the cohort
 * view has to put them side by side. The mapping is small and explicit rather
 * than a set of `includes('whats')` tests scattered through the projector,
 * because string heuristics spread: the second place that guesses disagrees with
 * the first on some value neither author thought about, and the two screens then
 * report different numbers for the same client.
 *
 * ## Why `meta_paid` is not a channel
 *
 * The honest answer for paid media, today, is that it has no channel — and this
 * file is where that is enforced rather than papered over. See
 * `resolvePaidMediaChannel` below.
 */

/**
 * The channels the cohort view can speak about.
 *
 * `unknown` is a first-class member, not an error case. It is what paid media
 * resolves to, and a bucket the reader can see is far better than a guess that
 * looks authoritative.
 */
export type CanonicalAcquisitionChannel =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'webchat'
  | 'unknown';

/**
 * LeadFlow's own channel vocabulary, from `inbox_channels.type`.
 *
 * The live values, verified against the column rather than assumed:
 * `whatsapp`, `instagram`, `facebook_messenger`, `webchat`, `manual`.
 * `facebook_messenger` is the one that does not map to itself, which is
 * precisely the kind of detail a heuristic gets wrong.
 */
const INBOX_CHANNEL_TYPES: Record<string, CanonicalAcquisitionChannel> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  facebook_messenger: 'messenger',
  messenger: 'messenger',
  webchat: 'webchat',
};

/**
 * Maps an Inbox channel type onto the canonical set.
 *
 * Anything unrecognised — `manual`, a channel type added after this was
 * written — becomes `unknown` rather than throwing. A new channel type must not
 * be able to break an analytics read; it should show up in a bucket that
 * visibly says "we do not know", which is a signal to come back here.
 */
export function resolveInboxChannel(
  channelType: string | null | undefined,
): CanonicalAcquisitionChannel {
  if (!channelType) return 'unknown';
  return INBOX_CHANNEL_TYPES[channelType.toLowerCase().trim()] ?? 'unknown';
}

/**
 * The channel paid media delivered into — which this system cannot observe.
 *
 * **Always `unknown`, and that is a finding rather than a stub.** It is a
 * function, and not a constant, so the reasoning has somewhere to live and so
 * the day the data arrives there is one call site to change.
 *
 * A Meta click-to-message campaign lands the person in WhatsApp, Instagram
 * Direct or Messenger, and which one is decided by the ad set's
 * `destination_type`.
 *
 * **The reason has changed since this was first written, and the conclusion has
 * not.** I3.2 syncs `destination_type` onto the ad set and I3.2a records its
 * history, so the destination *is* now in this database. What is still missing
 * is a metric to attach to it: insights are ingested at account and campaign
 * level only — `SocialAdInsightsLevel` excludes ad set at the type level and
 * `INGEST_LEVELS` is `['account', 'campaign']` — so there is no per-ad-set
 * spend, and a campaign may hold ad sets pointing at different destinations.
 *
 * Splitting a campaign's spend across the destinations of its ad sets would
 * require a weighting nobody measured. Proportional allocation by ad set count,
 * by impressions, by anything else, produces a number that looks per-destination
 * and is a guess; it would be wrong in exactly the case the feature exists for,
 * an account testing WhatsApp against Instagram Direct within one campaign.
 *
 * The remaining temptation is the campaign name. Reading "WPP" or "Direct" out
 * of a name a human typed would produce a number that is right for the accounts
 * whose naming convention happened to match and silently wrong for the rest,
 * with no way for the reader to tell which they are looking at. So it is not
 * done, and the cohort is declared at the level the data actually supports:
 * all Meta paid media against all Meta inbound.
 *
 * Closing this gap means ingesting ad-set-level insights — an S2 change, not a
 * cohort-view change. The temporal destination resolution this release *does*
 * ship (`social-ad-destination-timeline`) is the half that was missing on the
 * other side, and it is reported as coverage so the gap is visible.
 */
export function resolvePaidMediaChannel(): CanonicalAcquisitionChannel {
  return 'unknown';
}

/**
 * Which LeadFlow channel a paid-media destination corresponds to.
 *
 * Explicit, and small enough to read at a glance — the point of writing it out
 * is that the correspondence is *not* obvious in either direction:
 * `instagram_direct` on the paid side is `instagram` on the LeadFlow side, and
 * `messenger` on the paid side is `facebook_messenger` in
 * `inbox_channels.type`. A heuristic would get both wrong.
 *
 * `null` means "this destination does not identify a single LeadFlow channel",
 * and it is a real answer rather than a gap. Three kinds of destination map to
 * it:
 *
 * - **`messaging_multi`** — the advertiser offered several inboxes and Meta
 *   reports the *offer*, not which one each person chose. Splitting its spend
 *   across WhatsApp, Instagram and Messenger in proportion to conversations
 *   would invent per-person routing that nobody measured. Resolving individual
 *   conversations is what I4 is for; until then this bucket has a paid side and
 *   no funnel side.
 * - **`website`, `lead_form`, `app`, `phone`, `profile`, `on_post`** — real
 *   destinations that simply do not land in an Inbox at all. A conversation
 *   count of zero would be the wrong shape: there is no LeadFlow population to
 *   count, rather than an empty one.
 * - **`unknown`** — no evidence.
 */
const DESTINATION_TO_INBOX_CHANNEL: Record<
  string,
  CanonicalAcquisitionChannel | null
> = {
  whatsapp: 'whatsapp',
  instagram_direct: 'instagram',
  messenger: 'messenger',
  messaging_multi: null,
  website: null,
  lead_form: null,
  app: null,
  phone: null,
  profile: null,
  on_post: null,
  unknown: null,
};

/**
 * The LeadFlow channel a paid destination corresponds to, or null.
 *
 * Null is never a licence to fall back to a default bucket — a caller that
 * receives it must report the paid side alone and say why, which is what the
 * `messaging_multi` limitation does.
 */
export function inboxChannelForDestination(
  destination: string | null | undefined,
): CanonicalAcquisitionChannel | null {
  if (!destination) return null;
  return DESTINATION_TO_INBOX_CHANNEL[destination] ?? null;
}

/**
 * How a cohort's channel bucket was arrived at, travelling with the result.
 *
 * A reader looking at a row that says `unknown` deserves to know whether that
 * means "mixed" or "we cannot see it", and those are different enough that a
 * bare channel string would be misread.
 */
export type ChannelResolution =
  /** Both sides named the same channel. Not reachable until destination syncs. */
  | 'exact'
  /**
   * The bucket came from destination evidence observed at the ad set.
   *
   * Distinct from `exact`: it says the *paid* side was resolved from what was
   * observed, which is a claim about Lyra's evidence rather than about the
   * advertiser's configuration at that moment. Not produced while ad-set-level
   * metrics are unavailable — see `resolvePaidMediaChannel`.
   */
  | 'observed_destination'
  /**
   * Paid media could not be resolved to a channel, so the cohort is the whole
   * Meta surface on both sides. The only value this release produces.
   */
  | 'provider_bucket';
