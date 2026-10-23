import { Module, type OnModuleInit } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module';
import { SocialAdStoryLookupRegistry } from '../inbox/comments/social-ad-story-lookup.port';
import { SocialAdStoryLookupAdapter } from './services/social-ad-story-lookup.adapter';
import { SocialIntegrationsModule } from './social-integrations.module';

/**
 * IX3 item 7 — the join between the Inbox comments and the Social ad mirror.
 *
 * A third module, as in `ClientConversationApprovalsModule`: the Inbox
 * provides the registry it reads, Social provides the adapter, and this module
 * fills one with the other on init. Neither imports the other; without this
 * module the Inbox still works and a Facebook ad comment reads "Post
 * patrocinado".
 */
@Module({
  imports: [InboxModule, SocialIntegrationsModule],
})
export class InboxSocialAdLookupModule implements OnModuleInit {
  constructor(
    private readonly registry: SocialAdStoryLookupRegistry,
    private readonly adapter: SocialAdStoryLookupAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.adapter);
  }
}
