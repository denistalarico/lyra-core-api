/** Explicit public read-model fields. Recursion preserves canonical values verbatim;
 * new provider/domain fields fail closed until reviewed for the client surface.
 * Worker state, raw destinations, sync errors, credentials and config are excluded. */
const PUBLIC_SOCIAL_FIELDS = new Set(
  `
mode data sources organicByChannel paidSeries organicSeries organicSeriesByChannel facebook instagram summary absolute accountName
accountsEngaged actionTypes adSetExternalId ads adSets anchor archived asOf assetId
assetTimezone assetType avatarUrl average avgWatchTimeMs bestWeekday billingEvent
blueReelsPlays boosts buckets campaignExternalId campaigns caption change clicks comments
comparisonPeriod connectionId connectionStatus conversionValue conversions costPer
costPerConversation count counts cpa cpc cpl cpm cpp creativeId ctr currency current date
daysCovered description destinationType direction displayName effectiveStatus expectedDays
externalId externalPublicationId feedInteractions followersCount followersGained
followersLost follows frequency group hasData hasPartialData hour hours id impressions
isPartial items key kind label lastFactDate lastSyncedAt leads lengthSeconds likes
linkClicks mediaProductType mediaType mediaUrl messagingConversations metrics name navBack
navExit navForward navNextStory newConversations newFollowers objective observedAt
observedDays optimizationGoal organic pageComments pageDailyFollows pageDailyUnfollows
pageFollows pagePostCount pageReactions pageReelComments pageReelCount pageReelPlays
pageReelReactions pageReelShares pageReelViewers pageReelWatchTimeSeconds pageShares
pageViews paid percent period periodFeedReach periodFeedViews periodMeasuredSince
periodMeasuredUntil periodReach periodReachIncludesAds periodReachMeasuredAt
periodReachOrganic periodReachPaid periodReelComments periodReelCount
periodReelInteractions periodReelLikes periodReelReach periodReelSaves periodReelShares
periodReelViews periodStoryCount periodStoryInteractions periodStoryReach
periodStoryShares periodStoryViews periodTruncated periodViews periodViewsOrganic
periodViewsPaid permalink plays points previous previousCounts previousTotals profileViews
profileVisits promoted provider publicationId publications publishedAt reach
reachGranularity reactionsAnger reactionsHaha reactionsLike reactionsLove reactionsSorry
reactionsTotal reactionsWow reelInteractions reelsAvgWatchTimeMs reelsSkipRateBp
reelsTotalWatchTimeMs replays replies reposts retentionGraph roas sampleDays saves
seriesMode shares since sort sourceTimezone spend status thruplays thumbnailUrl timezone
total totalInteractions totalWatchTimeMs totals type uniqueViewers until username value
verified videoAvgWatchSeconds videoViews views viewsOrganic viewsPaid weekday weekdays
windowSince windowUntil budget dailyMinor lifetimeMinor remainingMinor schedule startsAt
stopsAt freshness lastSeenAt providerUpdatedAt attentionReasons hierarchyLastSeenAt
unassignedAds pagination page limit totalPages filters search feed reel story stories post
posts selectedAt selectionBasis createdAt campaign
`
    .trim()
    .split(/\s+/),
);
export function projectSocialAnalyticsData(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return value;
  if (Array.isArray(value)) return value.map(projectSocialAnalyticsData);
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => PUBLIC_SOCIAL_FIELDS.has(key))
      .map(([key, item]) => [
        key,
        key === 'retentionGraph' &&
        item &&
        typeof item === 'object' &&
        !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item as Record<string, unknown>).filter(
                ([second, amount]) =>
                  /^\d+(?:\.\d+)?$/.test(second) &&
                  typeof amount === 'number' &&
                  Number.isFinite(amount),
              ),
            )
          : projectSocialAnalyticsData(item),
      ]),
  );
}
