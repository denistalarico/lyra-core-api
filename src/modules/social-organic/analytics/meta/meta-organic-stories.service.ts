import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import {
  SocialOrganicStoryWriterService,
  type OrganicStoryObservation,
} from '../social-organic-story-writer.service';
import { SocialOrganicSyncError } from '../social-organic-sync.error';
import {
  INSTAGRAM_STORY_LIFETIME_METRICS,
  INSTAGRAM_STORY_NAVIGATION_METRIC,
} from './meta-organic-insights.types';

export type SocialOrganicStoriesSyncSummary = {
  storiesSeen: number;
  rowsWritten: number;
  apiCalls: number;
};

/**
 * Captures the stories an account has live, while they are still readable.
 *
 * ## Why this is a capture and not a sync
 *
 * Every other collector in this module reads something that will still be there
 * tomorrow. A feed post or a reel stays on `/{ig-user}/media` indefinitely, so a
 * missed pass is caught by the next one and the table converges on the truth.
 *
 * A story does not. It is readable for 24 hours and then it cannot be read at
 * all, by anyone, ever — and it never appears on `/{ig-user}/media` even while
 * it is live (verified on 2026-09-24: 378 items across four pages of a real
 * account, not one story). The only edge that has it is `/{ig-user}/stories`,
 * and only for that day.
 *
 * So there is no convergence here and no backfill. What this pass does not
 * capture is permanently lost, which is why it runs on its own hourly schedule
 * rather than on the daily sync's: a story posted at 09:00 and gone by 09:00
 * tomorrow would be missed entirely by a collector that happens to run at
 * 03:00. Hourly bounds the loss to a story that is both posted and expired
 * inside one hour, which cannot happen — a story lives 24 hours.
 *
 * ## Why it re-reads stories it has already seen
 *
 * A story's counters keep moving for its whole day, so the reading that matters
 * is the last one before it expires. Re-reading is how the row gets there; the
 * writer upserts, so a re-read is a correction rather than a duplicate.
 *
 * ## What is unverified here, and why it degrades instead of failing
 *
 * The production account has never had a story live while one was being
 * observed, and an expired story cannot be asked about. So the story metric
 * names and the `navigation` breakdown come from Meta's reference and from its
 * own refusal message — which listed `replies` and `navigation` as valid for
 * *some* product type while rejecting them for feed and reel — rather than from
 * a measurement.
 *
 * Every read here is therefore written to tolerate refusal: the navigation call
 * is separate from the counters call so that losing one does not lose the
 * other, and a story whose insights fail is still stored with its creative and
 * timestamp. A wrong guess about a metric name costs a null column on a row
 * that exists, not a story that was never recorded — and the row is the part
 * that cannot be recovered later.
 */
@Injectable()
export class MetaOrganicStoriesService {
  private readonly logger = new Logger(MetaOrganicStoriesService.name);

  constructor(
    private readonly graph: MetaOrganicGraphService,
    private readonly writer: SocialOrganicStoryWriterService,
  ) {}

  async sync(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    syncRunId: string | null;
    syncedAt?: Date;
  }): Promise<SocialOrganicStoriesSyncSummary> {
    const { credential } = input.resolved;
    const observedAt = input.syncedAt ?? new Date();
    const empty: SocialOrganicStoriesSyncSummary = {
      storiesSeen: 0,
      rowsWritten: 0,
      apiCalls: 0,
    };

    if (credential.provider !== 'meta') {
      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    // Instagram only: a Facebook Page's stories are a different product with a
    // different edge, and asking here would spend a call to be refused.
    if (credential.assetType !== 'instagram_professional') return empty;

    const listing = await this.graph.listActiveStories({
      objectId: credential.externalAssetId,
      accessToken: credential.accessToken,
    });
    let apiCalls = listing.apiCalls;

    const stories = listing.data.flatMap((entry) => {
      const parsed = parseStory(entry);
      return parsed ? [parsed] : [];
    });

    if (stories.length === 0) return { ...empty, apiCalls };

    const observations: OrganicStoryObservation[] = [];

    for (const story of stories) {
      const counters = await this.readCounters(
        credential.accessToken,
        story.externalPublicationId,
      );
      apiCalls += counters.apiCalls;

      const navigation = await this.readNavigation(
        credential.accessToken,
        story.externalPublicationId,
      );
      apiCalls += navigation.apiCalls;

      observations.push({
        tenantId: credential.tenantId,
        workspaceId: credential.workspaceId,
        agencyClientId: credential.agencyClientId,
        assetId: credential.assetId,
        provider: credential.provider,
        externalPublicationId: story.externalPublicationId,
        publishedAt: story.publishedAt,
        mediaType: story.mediaType,
        permalink: story.permalink,
        mediaUrl: story.mediaUrl,
        thumbnailUrl: story.thumbnailUrl,
        reach: counters.values.reach,
        views: counters.values.views,
        replies: counters.values.replies,
        shares: counters.values.shares,
        totalInteractions: counters.values.total_interactions,
        profileVisits: counters.values.profile_visits,
        follows: counters.values.follows,
        navForward: navigation.forward,
        navNextStory: navigation.nextStory,
        navBack: navigation.back,
        navExit: navigation.exit,
        observedAt,
        syncRunId: input.syncRunId,
      });
    }

    const rowsWritten = await this.writer.upsert(observations);

    return { storiesSeen: stories.length, rowsWritten, apiCalls };
  }

  /**
   * The story's lifetime counters, or nulls if Meta refuses the list.
   *
   * A refusal is swallowed rather than thrown because the row is worth more
   * than the counters: the creative and the timestamp cannot be recovered after
   * the story expires, while a metric name can be corrected and re-read on the
   * next hourly pass.
   */
  private async readCounters(
    accessToken: string,
    storyId: string,
  ): Promise<{ values: Record<string, string | null>; apiCalls: number }> {
    const blank = Object.fromEntries(
      INSTAGRAM_STORY_LIFETIME_METRICS.map((name) => [name, null]),
    ) as Record<string, string | null>;

    try {
      const insights = await this.graph.getOrganicInsights({
        objectId: storyId,
        accessToken,
        metrics: INSTAGRAM_STORY_LIFETIME_METRICS,
        period: 'lifetime',
      });

      return {
        values: { ...blank, ...readLifetimeValues(insights.data) },
        apiCalls: insights.apiCalls,
      };
    } catch (error) {
      this.logger.warn(
        `Story ${storyId} insights unavailable; storing the story without counters: ${String(error)}`,
      );
      // One call was still spent getting the refusal.
      return { values: blank, apiCalls: 1 };
    }
  }

  /**
   * The retention breakdown, or nulls.
   *
   * Read separately from the counters because it needs a `breakdown` and a
   * `metric_type` the plain lifetime call does not take — and because keeping
   * it separate means an unsupported `navigation` costs only itself.
   */
  private async readNavigation(
    accessToken: string,
    storyId: string,
  ): Promise<{
    forward: string | null;
    nextStory: string | null;
    back: string | null;
    exit: string | null;
    apiCalls: number;
  }> {
    const blank = {
      forward: null,
      nextStory: null,
      back: null,
      exit: null,
    };

    try {
      const insights = await this.graph.getOrganicInsights({
        objectId: storyId,
        accessToken,
        metrics: [INSTAGRAM_STORY_NAVIGATION_METRIC],
        period: 'lifetime',
        metricType: 'total_value',
        breakdown: 'story_navigation_action_type',
      });

      return { ...readNavigation(insights.data), apiCalls: insights.apiCalls };
    } catch (error) {
      this.logger.debug(
        `Story ${storyId} navigation unavailable: ${String(error)}`,
      );
      return { ...blank, apiCalls: 1 };
    }
  }
}

type ParsedStory = {
  externalPublicationId: string;
  publishedAt: Date | null;
  mediaType: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
};

function parseStory(entry: unknown): ParsedStory | null {
  if (!entry || typeof entry !== 'object') return null;

  const row = entry as Record<string, unknown>;
  const id = row.id;

  if (typeof id !== 'string' || id.length === 0) return null;

  const timestamp =
    typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;

  return {
    externalPublicationId: id,
    publishedAt: Number.isFinite(timestamp) ? new Date(timestamp) : null,
    mediaType: readString(row.media_type),
    permalink: readString(row.permalink),
    mediaUrl: readString(row.media_url),
    thumbnailUrl: readString(row.thumbnail_url),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `[{ name, values: [{ value }] }]` as a map of digit strings. */
function readLifetimeValues(data: unknown[]): Record<string, string | null> {
  const values: Record<string, string | null> = {};

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;

    const row = entry as { name?: unknown; values?: unknown };
    if (typeof row.name !== 'string' || !Array.isArray(row.values)) continue;

    // Annotated rather than inferred: `Array.isArray` on an `unknown` narrows
    // to `any[]`, which would make every read below unchecked.
    const [first] = row.values as unknown[];
    if (!first || typeof first !== 'object') continue;

    const value = (first as { value?: unknown }).value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      continue;
    }

    values[row.name] = Math.trunc(value).toString();
  }

  return values;
}

/**
 * The four navigation actions out of the breakdown.
 *
 * Meta's spellings for `story_navigation_action_type` are `tap_forward`,
 * `tap_back`, `tap_exit` and `swipe_forward`. The mapping to the operator's
 * four columns follows Instagram's own reading of them: a forward tap is
 * "Avançar" within the story, a forward swipe is "Próximo story", a back tap is
 * "Voltar" and an exit is "Sair".
 *
 * Unverified against production, for the reason the class docblock gives. An
 * unrecognised action name is ignored rather than folded into a neighbour: a
 * wrong bucket is worse than an absent one, because it looks like a measurement.
 */
function readNavigation(data: unknown[]): {
  forward: string | null;
  nextStory: string | null;
  back: string | null;
  exit: string | null;
} {
  const buckets: Record<string, bigint> = {};
  const [first] = data;

  const totalValue =
    first && typeof first === 'object'
      ? (first as { total_value?: unknown }).total_value
      : null;
  const breakdowns =
    totalValue && typeof totalValue === 'object'
      ? (totalValue as { breakdowns?: unknown }).breakdowns
      : null;

  if (Array.isArray(breakdowns)) {
    for (const breakdown of breakdowns) {
      if (!breakdown || typeof breakdown !== 'object') continue;

      const results = (breakdown as { results?: unknown }).results;
      if (!Array.isArray(results)) continue;

      for (const result of results) {
        if (!result || typeof result !== 'object') continue;

        const row = result as { dimension_values?: unknown; value?: unknown };
        if (!Array.isArray(row.dimension_values)) continue;

        const action = String(row.dimension_values[0]).toLowerCase();
        const value = row.value;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          continue;
        }

        buckets[action] = (buckets[action] ?? 0n) + BigInt(Math.trunc(value));
      }
    }
  }

  const read = (action: string): string | null =>
    action in buckets ? String(buckets[action]) : null;

  return {
    forward: read('tap_forward'),
    nextStory: read('swipe_forward'),
    back: read('tap_back'),
    exit: read('tap_exit'),
  };
}
