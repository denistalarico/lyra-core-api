import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import {
  SocialOrganicFacebookReelWriterService,
  type OrganicFacebookReelObservation,
} from '../social-organic-facebook-reel-writer.service';
import { SocialOrganicSyncError } from '../social-organic-sync.error';
import {
  FACEBOOK_REACTION_TYPES,
  FACEBOOK_REEL_UNIQUE_VIEWERS_METRIC,
  type FacebookReactionType,
} from './meta-organic-insights.types';

/**
 * How many reels one pass lists.
 *
 * Each listed reel costs one further insights call, so this is the real budget
 * of the pass rather than a paging preference. 50 is more reels than a Page
 * publishes in a month; the production account's whole history is 58.
 */
const MAX_LISTED_REELS = 50;

export type SocialOrganicFacebookReelsSyncSummary = {
  reelsSeen: number;
  rowsWritten: number;
  apiCalls: number;
};

/**
 * Collects a Facebook Page's reels.
 *
 * ## Why this is not part of the post collector
 *
 * A Page reel is invisible to everything the post collector uses. It is not on
 * `/{page}/posts`, and `/{reel}/insights` answers nothing — every metric name
 * tried there was refused. Verified against production on 2026-09-24: the Page
 * listing returned only photo posts while `/{page}/video_reels` returned 58
 * reels, and their numbers came back only from `/{reel}/video_insights`.
 *
 * The metric vocabulary is disjoint too. A reel reports plays, replays and
 * unique viewers; a post reports views and reactions. Nothing here could be
 * folded into the post read even if the edge allowed it.
 *
 * ## The window is applied here, not by Meta
 *
 * `/{page}/video_reels` ignores `since`/`until` — unlike `/posts` and
 * `/media`, which honour them server-side. So the pass lists the most recent
 * reels and filters locally on `created_time`. The consequence is real and
 * worth stating: a Page that published more than `MAX_LISTED_REELS` reels
 * since the window opened would have its oldest ones missed. That is a Page
 * posting fifty reels in one window, and the honest fix then is a narrower
 * window, not a longer loop against a shared quota.
 *
 * ## Refusals cost a column, not the row
 *
 * The insights call is wrapped: a reel whose metrics are refused is still
 * written with its identity, its length and the `views` the listing already
 * carried. Those cost nothing extra — Meta puts them in the listing response —
 * and a row with a play count and no retention curve is worth more than no row.
 */
@Injectable()
export class MetaOrganicFacebookReelsService {
  private readonly logger = new Logger(MetaOrganicFacebookReelsService.name);

  constructor(
    private readonly graph: MetaOrganicGraphService,
    private readonly writer: SocialOrganicFacebookReelWriterService,
  ) {}

  async sync(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    /** Calendar days in the asset's own timezone, inclusive. */
    fromDate: string;
    toDate: string;
    syncRunId: string | null;
    syncedAt?: Date;
  }): Promise<SocialOrganicFacebookReelsSyncSummary> {
    const { credential } = input.resolved;
    const observedAt = input.syncedAt ?? new Date();
    const empty: SocialOrganicFacebookReelsSyncSummary = {
      reelsSeen: 0,
      rowsWritten: 0,
      apiCalls: 0,
    };

    if (credential.provider !== 'meta') {
      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    // Facebook only. An Instagram reel is on `/media` and is already collected
    // by the post pass, with entirely different metrics.
    if (credential.assetType !== 'facebook_page') return empty;

    const listing = await this.graph.listPageReels({
      objectId: credential.externalAssetId,
      accessToken: credential.accessToken,
      limit: MAX_LISTED_REELS,
    });
    let apiCalls = listing.apiCalls;

    // Inclusive of both ends, in UTC. The reel's `created_time` is an instant
    // and the window is a pair of calendar days; comparing the instant's date
    // against them is the same approximation the rest of this module makes,
    // and a reel published within hours of midnight is the only case where the
    // asset's own timezone would place it on the other day.
    const reels = listing.data
      .flatMap((entry) => {
        const parsed = parseReel(entry);
        return parsed ? [parsed] : [];
      })
      .filter((reel) =>
        inWindow(reel.publishedAt, input.fromDate, input.toDate),
      );

    if (reels.length === 0) return { ...empty, apiCalls };

    const observations: OrganicFacebookReelObservation[] = [];

    for (const reel of reels) {
      const insights = await this.readInsights(
        credential.accessToken,
        reel.externalPublicationId,
      );
      apiCalls += insights.apiCalls;

      observations.push({
        tenantId: credential.tenantId,
        workspaceId: credential.workspaceId,
        agencyClientId: credential.agencyClientId,
        assetId: credential.assetId,
        provider: credential.provider,
        externalPublicationId: reel.externalPublicationId,
        publishedAt: reel.publishedAt,
        description: reel.description,
        permalink: reel.permalink,
        thumbnailUrl: reel.thumbnailUrl,
        lengthSeconds: reel.lengthSeconds,
        // The listing's `views` is the fallback when insights were refused:
        // a number already in hand beats a null.
        plays: insights.values.plays ?? reel.views,
        blueReelsPlays: insights.values.blueReelsPlays,
        replays: insights.values.replays,
        uniqueViewers: insights.values.uniqueViewers,
        totalWatchTimeMs: insights.values.totalWatchTimeMs,
        avgWatchTimeMs: insights.values.avgWatchTimeMs,
        reactionsTotal: insights.values.reactionsTotal ?? reel.likes,
        reactionsLike: insights.values.reactions?.like ?? null,
        reactionsLove: insights.values.reactions?.love ?? null,
        reactionsWow: insights.values.reactions?.wow ?? null,
        reactionsHaha: insights.values.reactions?.haha ?? null,
        reactionsSorry: insights.values.reactions?.sorry ?? null,
        reactionsAnger: insights.values.reactions?.anger ?? null,
        // `post_video_social_actions` carries comments and shares as a map;
        // the listing's own comment summary is the fallback.
        comments: insights.values.comments ?? reel.comments,
        shares: insights.values.shares,
        newFollowers: insights.values.newFollowers,
        retentionGraph: insights.values.retentionGraph,
        observedAt,
        syncRunId: input.syncRunId,
      });
    }

    const rowsWritten = await this.writer.upsert(observations);

    return { reelsSeen: reels.length, rowsWritten, apiCalls };
  }

  /**
   * One reel's metrics, or nulls if Meta refuses the whole list.
   *
   * Swallowed rather than thrown for the reason the class docblock gives: the
   * identity and the listing's own counters are still worth a row, and a reel
   * is permanent, so the next pass gets another chance at the numbers.
   */
  private async readInsights(
    accessToken: string,
    reelId: string,
  ): Promise<{ values: ReelInsightValues; apiCalls: number }> {
    try {
      // Deliberately no `metrics`: naming them costs the unique-viewer figure,
      // which this edge returns only in an unnamed request and refuses when
      // asked for by name. See `FACEBOOK_REEL_UNIQUE_VIEWERS_METRIC`. The
      // reader below still takes only the names it knows.
      const insights = await this.graph.getVideoInsights({
        objectId: reelId,
        accessToken,
      });

      return {
        values: readReelInsights(insights.data),
        apiCalls: insights.apiCalls,
      };
    } catch (error) {
      this.logger.warn(
        `Reel ${reelId} insights unavailable; storing the listing figures only: ${String(error)}`,
      );
      // One call was still spent getting the refusal.
      return { values: EMPTY_INSIGHTS, apiCalls: 1 };
    }
  }
}

type ParsedReel = {
  externalPublicationId: string;
  publishedAt: Date | null;
  description: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  lengthSeconds: string | null;
  views: string | null;
  likes: string | null;
  comments: string | null;
};

type ReelInsightValues = {
  plays: string | null;
  blueReelsPlays: string | null;
  replays: string | null;
  uniqueViewers: string | null;
  totalWatchTimeMs: string | null;
  avgWatchTimeMs: string | null;
  reactionsTotal: string | null;
  reactions: Record<FacebookReactionType, string> | null;
  comments: string | null;
  shares: string | null;
  newFollowers: string | null;
  retentionGraph: Record<string, number> | null;
};

const EMPTY_INSIGHTS: ReelInsightValues = {
  plays: null,
  blueReelsPlays: null,
  replays: null,
  uniqueViewers: null,
  totalWatchTimeMs: null,
  avgWatchTimeMs: null,
  reactionsTotal: null,
  reactions: null,
  comments: null,
  shares: null,
  newFollowers: null,
  retentionGraph: null,
};

function parseReel(entry: unknown): ParsedReel | null {
  if (!entry || typeof entry !== 'object') return null;

  const row = entry as Record<string, unknown>;
  const id = row.id;

  if (typeof id !== 'string' || id.length === 0) return null;

  const timestamp =
    typeof row.created_time === 'string' ? Date.parse(row.created_time) : NaN;

  return {
    externalPublicationId: id,
    publishedAt: Number.isFinite(timestamp) ? new Date(timestamp) : null,
    description: readString(row.description),
    // Meta returns a path here (`/reel/885635650762805/`), not a URL. Stored as
    // given; the read layer absolutizes it.
    permalink: readString(row.permalink_url),
    thumbnailUrl: readString(row.picture),
    lengthSeconds:
      typeof row.length === 'number' && Number.isFinite(row.length)
        ? row.length.toFixed(3)
        : null,
    views: readCounter(row.views),
    likes: readSummaryCount(row.likes),
    comments: readSummaryCount(row.comments),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readCounter(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value).toString();
}

function readSummaryCount(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const summary = (value as { summary?: unknown }).summary;
  if (!summary || typeof summary !== 'object') return null;
  return readCounter((summary as { total_count?: unknown }).total_count);
}

/**
 * `/{reel}/video_insights` as a set of named values.
 *
 * Three different value shapes come back from one call and each needs its own
 * reader: plain numbers (`fb_reels_total_plays`), maps keyed by reaction or
 * action (`post_video_likes_by_reaction_type`, `post_video_social_actions`),
 * and the retention curve, which is a map keyed by second with fractional
 * values. Treating them uniformly is what would silently coerce a curve into a
 * counter.
 */
function readReelInsights(data: unknown[]): ReelInsightValues {
  const values = new Map<string, unknown>();

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;

    const row = entry as { name?: unknown; values?: unknown };
    if (typeof row.name !== 'string' || !Array.isArray(row.values)) continue;

    // Annotated rather than inferred: `Array.isArray` on an `unknown` narrows
    // to `any[]`, which would make every read below unchecked.
    const [first] = row.values as unknown[];
    if (!first || typeof first !== 'object') continue;

    values.set(row.name, (first as { value?: unknown }).value);
  }

  const counter = (name: string): string | null =>
    readCounter(values.get(name));

  const socialActions = values.get('post_video_social_actions');
  const actionCount = (key: string): string | null => {
    if (!socialActions || typeof socialActions !== 'object') return null;
    const map = socialActions as Record<string, unknown>;
    return key in map ? readCounter(map[key]) : null;
  };

  return {
    plays: counter('fb_reels_total_plays'),
    blueReelsPlays: counter('blue_reels_play_count'),
    replays: counter('fb_reels_replay_count'),
    uniqueViewers: counter(FACEBOOK_REEL_UNIQUE_VIEWERS_METRIC),
    totalWatchTimeMs: counter('post_video_view_time'),
    avgWatchTimeMs: counter('post_video_avg_time_watched'),
    ...readReactions(values.get('post_video_likes_by_reaction_type')),
    // Meta's own spelling on this edge is upper case: `{"COMMENT": 2}`.
    comments: actionCount('COMMENT'),
    shares: actionCount('SHARE'),
    newFollowers: counter('post_video_followers'),
    retentionGraph: readRetentionGraph(
      values.get('post_video_retention_graph'),
    ),
  };
}

/**
 * The reaction map, and its total.
 *
 * Meta omits types with no reactions and answers `{}` for a reel nobody reacted
 * to. An empty map is a measurement of zero; an absent metric is null. An
 * unrecognised key is dropped rather than added to the total, for the reason
 * the types module gives.
 */
function readReactions(value: unknown): {
  reactions: Record<FacebookReactionType, string> | null;
  reactionsTotal: string | null;
} {
  if (!value || typeof value !== 'object') {
    return { reactions: null, reactionsTotal: null };
  }

  const map = value as Record<string, unknown>;
  const reactions = {} as Record<FacebookReactionType, string>;
  let total = 0n;

  for (const type of FACEBOOK_REACTION_TYPES) {
    const counter = (type in map ? readCounter(map[type]) : null) ?? '0';
    reactions[type] = counter;
    total += BigInt(counter);
  }

  return { reactions, reactionsTotal: String(total) };
}

/**
 * The retention curve, kept in Meta's own shape.
 *
 * `{"0": 0.9822, "1": 0.9841, ...}` — one key per second, each the share of
 * viewers still watching. Values outside 0–1 are dropped rather than clamped:
 * a share above 1 is not a curve that needs correcting, it is a response this
 * reader does not understand, and clamping would hide that.
 */
function readRetentionGraph(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object') return null;

  const graph: Record<string, number> = {};

  for (const [second, share] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!/^\d+$/.test(second)) continue;
    if (typeof share !== 'number' || !Number.isFinite(share)) continue;
    if (share < 0 || share > 1) continue;

    graph[second] = share;
  }

  return Object.keys(graph).length > 0 ? graph : null;
}

/** Whether an instant falls inside a pair of inclusive calendar days. */
function inWindow(
  publishedAt: Date | null,
  fromDate: string,
  toDate: string,
): boolean {
  // A reel Meta gave no timestamp for is kept rather than dropped: its
  // identity and counters are still real, and excluding it would silently
  // shrink a ranking because of a missing field the reel does not control.
  if (!publishedAt) return true;

  const day = publishedAt.toISOString().slice(0, 10);

  return day >= fromDate && day <= toDate;
}
