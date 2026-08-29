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
 * `destination_type` (and its `promoted_object`). Neither field is synced:
 * `social_ad_metrics_daily` has no destination column, and a check of every
 * `social_ad_entities.raw` payload in production found zero occurrences of
 * either key. The information is not in this database.
 *
 * What *is* available is `objective` (`OUTCOME_ENGAGEMENT`) and
 * `optimization_goal` (`CONVERSATIONS`). Those say a campaign optimised for
 * conversations. They do not say which inbox those conversations were sent to,
 * and an account running WhatsApp and Instagram Direct campaigns side by side —
 * the normal case — is indistinguishable under them.
 *
 * The remaining temptation is the campaign name. Reading "WPP" or "Direct" out
 * of a name a human typed would produce a number that is right for the accounts
 * whose naming convention happened to match and silently wrong for the rest,
 * with no way for the reader to tell which they are looking at. So it is not
 * done, and the cohort is declared at the level the data actually supports:
 * all Meta paid media against all Meta inbound.
 *
 * Closing this gap means syncing `destination_type` on the ad set — an S2
 * change, not a cohort-view change.
 */
export function resolvePaidMediaChannel(): CanonicalAcquisitionChannel {
  return 'unknown';
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
   * Paid media could not be resolved to a channel, so the cohort is the whole
   * Meta surface on both sides. The only value this release produces.
   */
  | 'provider_bucket';
