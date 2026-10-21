/**
 * The channels a dashboard can be scoped to.
 *
 * A dashboard's channel decides two things: which cards it is allowed to hold
 * (via each metric's `channels` in the metric catalog) and which submenu entry
 * is highlighted. It deliberately does *not* decide which API is called — the
 * read endpoints are per-source (paid / organic), not per-channel, and a single
 * Meta Ads connection serves both Facebook and Instagram placements.
 *
 * Google Ads is listed with no integration behind it on purpose. The pipeline
 * does not exist (§2), and the honest thing for an operator who expects the
 * channel is a tab that says so, not a channel missing from the menu with no
 * explanation of where it went.
 */

export const ANALYTICS_CHANNEL_IDS = [
  /**
   * Not a network: the cross-channel block.
   *
   * A section carries a channel, and every rule in the product keys off it —
   * which cards the drawer offers, which the reset seeds, which a section may
   * hold. A summary block needs all of that machinery and differs only in
   * *what* it may hold, so it is a channel rather than an exception: the
   * alternative is a `null` channel threaded through the drawer, the seeder,
   * the report builder and the Orion prompt, each of which would then carry a
   * branch for "the section with no channel".
   *
   * Its metrics are the ones that sum across the real networks. It is listed
   * first because a summary read after the detail is a summary nobody reads.
   */
  "summary",
  "facebook",
  "instagram",
  "meta_ads",
  "google_ads",
] as const;

export type ChannelId = (typeof ANALYTICS_CHANNEL_IDS)[number];

export type AnalyticsChannel = {
  id: ChannelId;
  label: string;
  /** Path under `public/`, served as-is. */
  icon: string;
  /**
   * Whether anything at all can be read for this channel today.
   *
   * False renders the "em breve" state instead of an empty dashboard. An empty
   * dashboard reads as "no results in this period", which for a channel with no
   * integration at all is a different and wrong statement.
   */
  integrated: boolean;
};

export const ANALYTICS_CHANNELS: AnalyticsChannel[] = [
  {
    id: "summary",
    label: "Resumo",
    // No network owns it, so no network's mark belongs on it.
    icon: "",
    integrated: true,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: "/integrations/webp/facebook.webp",
    integrated: true,
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: "/integrations/webp/instagram.webp",
    integrated: true,
  },
  {
    id: "meta_ads",
    label: "Meta Ads",
    icon: "/integrations/webp/metaads.webp",
    integrated: true,
  },
  {
    id: "google_ads",
    label: "Google Ads",
    icon: "/integrations/webp/googleads.webp",
    integrated: false,
  },
];

export const DEFAULT_CHANNEL: ChannelId = "meta_ads";

export function isChannelId(
  value: string | null | undefined,
): value is ChannelId {
  return (
    !!value && (ANALYTICS_CHANNEL_IDS as readonly string[]).includes(value)
  );
}

/**
 * The channels whose sections a given dashboard may hold.
 *
 * `channelKey` is the dashboard's own network, set by the seeder and null
 * everywhere else — so it already distinguishes the three fixed channel screens
 * from Visão Geral and from anything an operator created. That distinction is
 * exactly the rule: a channel screen holds its own network and nothing else, so
 * that a Facebook tab cannot quietly grow an Instagram block; Visão Geral and a
 * custom dashboard may hold anything, including the cross-channel summary.
 *
 * `summary` is therefore offered only where `channelKey` is null. On a channel
 * screen it would be a block whose numbers span networks the tab does not
 * claim to show, which is the confusion the whole rule exists to prevent.
 */
export function channelsAllowedOn(
  channelKey: ChannelId | null,
): AnalyticsChannel[] {
  if (channelKey) {
    return ANALYTICS_CHANNELS.filter((channel) => channel.id === channelKey);
  }

  return ANALYTICS_CHANNELS;
}

export function findChannel(id: ChannelId): AnalyticsChannel {
  // Non-null by construction: every member of the union has an entry above, and
  // the list is the only way an id enters the app.
  return (
    ANALYTICS_CHANNELS.find((channel) => channel.id === id) ??
    ANALYTICS_CHANNELS[0]
  );
}
