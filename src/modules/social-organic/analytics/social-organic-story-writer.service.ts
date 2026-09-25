import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialOrganicStoryEntity } from './entities/social-organic-story.entity';

/** One story as observed, in the shape the writer stores. */
export type OrganicStoryObservation = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  externalPublicationId: string;
  publishedAt: Date | null;
  mediaType: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  reach: string | null;
  views: string | null;
  replies: string | null;
  shares: string | null;
  totalInteractions: string | null;
  profileVisits: string | null;
  follows: string | null;
  navForward: string | null;
  navNextStory: string | null;
  navBack: string | null;
  navExit: string | null;
  observedAt: Date;
  syncRunId: string | null;
};

/**
 * Stores story observations, one row per story.
 *
 * ## Why the counters overwrite and the timestamps do not
 *
 * A story's numbers keep moving for the 24 hours it is live, so a later
 * observation is strictly better than an earlier one and simply replaces it —
 * there is no history worth keeping between two readings of the same story an
 * hour apart, and keeping one would leave a reader choosing between them.
 *
 * `first_observed_at` is the exception and is deliberately never overwritten.
 * It records when the collector first saw the story, which is the only evidence
 * of *when it was captured* as opposed to when it was posted, and a re-read
 * must not push it forward — that would make a story the collector has watched
 * all day look like one it only just found.
 *
 * ## Why a null does not overwrite
 *
 * The navigation counters may be absent from one read and present in another:
 * Meta's support for them could not be verified against the production account
 * (it has never had a story live while one was being observed), so the
 * collector is built to tolerate a refusal. A refused read must not erase what
 * a successful one stored, hence `COALESCE` on every counter rather than a
 * straight replace. The cost is that a counter Meta revises *down to null*
 * keeps its old value, which is not a case Meta has.
 */
@Injectable()
export class SocialOrganicStoryWriterService {
  constructor(
    @InjectRepository(SocialOrganicStoryEntity, 'agency')
    private readonly repository: Repository<SocialOrganicStoryEntity>,
  ) {}

  /** Upserts a batch and returns how many rows were written. */
  async upsert(
    observations: readonly OrganicStoryObservation[],
  ): Promise<number> {
    let written = 0;

    for (const story of observations) {
      await this.repository.query(
        `INSERT INTO social_organic_stories (
           tenant_id, workspace_id, agency_client_id, asset_id, provider,
           external_publication_id, published_at, media_type, permalink,
           media_url, thumbnail_url,
           reach, views, replies, shares, total_interactions,
           profile_visits, follows,
           nav_forward, nav_next_story, nav_back, nav_exit,
           observed_at, first_observed_at, sync_run_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, $13, $14, $15, $16, $17, $18,
                   $19, $20, $21, $22, $23, $23, $24)
         ON CONFLICT (asset_id, external_publication_id) DO UPDATE SET
           published_at = COALESCE(EXCLUDED.published_at, social_organic_stories.published_at),
           media_type = COALESCE(EXCLUDED.media_type, social_organic_stories.media_type),
           permalink = COALESCE(EXCLUDED.permalink, social_organic_stories.permalink),
           -- The creative URL is the one field where fresher is strictly
           -- better: Meta's signed URLs expire, so a new one replaces an old
           -- one that may already be dead.
           media_url = COALESCE(EXCLUDED.media_url, social_organic_stories.media_url),
           thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, social_organic_stories.thumbnail_url),
           reach = COALESCE(EXCLUDED.reach, social_organic_stories.reach),
           views = COALESCE(EXCLUDED.views, social_organic_stories.views),
           replies = COALESCE(EXCLUDED.replies, social_organic_stories.replies),
           shares = COALESCE(EXCLUDED.shares, social_organic_stories.shares),
           total_interactions = COALESCE(EXCLUDED.total_interactions, social_organic_stories.total_interactions),
           profile_visits = COALESCE(EXCLUDED.profile_visits, social_organic_stories.profile_visits),
           follows = COALESCE(EXCLUDED.follows, social_organic_stories.follows),
           nav_forward = COALESCE(EXCLUDED.nav_forward, social_organic_stories.nav_forward),
           nav_next_story = COALESCE(EXCLUDED.nav_next_story, social_organic_stories.nav_next_story),
           nav_back = COALESCE(EXCLUDED.nav_back, social_organic_stories.nav_back),
           nav_exit = COALESCE(EXCLUDED.nav_exit, social_organic_stories.nav_exit),
           observed_at = EXCLUDED.observed_at,
           -- Never EXCLUDED: this is when the story was first caught, and a
           -- re-read must not push it forward. See the class docblock.
           sync_run_id = COALESCE(EXCLUDED.sync_run_id, social_organic_stories.sync_run_id),
           updated_at = now()`,
        [
          story.tenantId,
          story.workspaceId,
          story.agencyClientId,
          story.assetId,
          story.provider,
          story.externalPublicationId,
          story.publishedAt,
          story.mediaType,
          story.permalink,
          story.mediaUrl,
          story.thumbnailUrl,
          story.reach,
          story.views,
          story.replies,
          story.shares,
          story.totalInteractions,
          story.profileVisits,
          story.follows,
          story.navForward,
          story.navNextStory,
          story.navBack,
          story.navExit,
          story.observedAt,
          story.syncRunId,
        ],
      );
      written += 1;
    }

    return written;
  }
}
