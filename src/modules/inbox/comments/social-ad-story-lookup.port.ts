import { Injectable } from '@nestjs/common';

export type SocialAdStory = {
  adId: string;
  adName: string | null;
  campaignName: string | null;
};

/**
 * IX3 item 7 — names the ad behind a Facebook comment.
 *
 * A Facebook ad is an unpublished Page post; the Social hierarchy sync knows
 * which ad renders which story (`creative.effective_object_story_id`). The
 * Inbox only *reads* that through this port: it never uses a Social token
 * (D-IX-12), and without the Social module the port stays empty and the
 * comment shows "Post patrocinado".
 */
export type SocialAdStoryLookupPort = {
  findByStoryId(input: {
    tenantId: string;
    workspaceId: string;
    storyId: string;
  }): Promise<SocialAdStory | null>;
};

/**
 * Provided by the Inbox (the module that reads it) and filled by the join
 * module on init — the `client-conversation-approvals.port.ts` pattern: a
 * token bound elsewhere would resolve to `undefined` here, silently.
 */
@Injectable()
export class SocialAdStoryLookupRegistry {
  private port: SocialAdStoryLookupPort | null = null;

  register(port: SocialAdStoryLookupPort): void {
    this.port = port;
  }

  get(): SocialAdStoryLookupPort | null {
    return this.port;
  }
}
