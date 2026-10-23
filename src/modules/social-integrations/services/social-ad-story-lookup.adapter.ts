import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  SocialAdStory,
  SocialAdStoryLookupPort,
} from '../../inbox/comments/social-ad-story-lookup.port';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';

/**
 * The Social side of the Inbox's ad-story port (IX3 item 7): which mirrored
 * ad renders a given Page post, and its campaign's name.
 *
 * Read-only over `social_ad_entities` in the caller's tenant and workspace.
 * The story id is the Page's own `<page>_<post>`, so a match cannot cross
 * Pages; a live ad wins over an archived one.
 */
@Injectable()
export class SocialAdStoryLookupAdapter implements SocialAdStoryLookupPort {
  constructor(
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entities: Repository<SocialAdEntity>,
  ) {}

  async findByStoryId(input: {
    tenantId: string;
    workspaceId: string;
    storyId: string;
  }): Promise<SocialAdStory | null> {
    if (!/^\d+_\d+$/.test(input.storyId)) return null;
    const [row] = await this.entities.query<
      Array<{
        ad_id: string;
        ad_name: string | null;
        campaign_name: string | null;
      }>
    >(
      `SELECT ad.external_id AS ad_id, ad.name AS ad_name,
              campaign.name AS campaign_name
         FROM social_ad_entities ad
         LEFT JOIN social_ad_entities campaign
           ON campaign.tenant_id = ad.tenant_id
          AND campaign.workspace_id = ad.workspace_id
          AND campaign.connection_id = ad.connection_id
          AND campaign.entity_level = 'campaign'
          AND campaign.external_id = ad.campaign_external_id
        WHERE ad.tenant_id = $1 AND ad.workspace_id = $2
          AND ad.entity_level = 'ad'
          AND ad.effective_object_story_id = $3
        ORDER BY ad.archived_at IS NOT NULL, ad.last_seen_at DESC
        LIMIT 1`,
      [input.tenantId, input.workspaceId, input.storyId],
    );
    return row
      ? {
          adId: row.ad_id,
          adName: row.ad_name,
          campaignName: row.campaign_name,
        }
      : null;
  }
}
