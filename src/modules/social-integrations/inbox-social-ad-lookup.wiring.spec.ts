import { SocialAdStoryLookupRegistry } from '../inbox/comments/social-ad-story-lookup.port';
import { InboxSocialAdLookupModule } from './inbox-social-ad-lookup.module';
import { SocialAdStoryLookupAdapter } from './services/social-ad-story-lookup.adapter';

/**
 * IX3 item 7 — the ad-story port is actually filled at runtime.
 *
 * Same reason as `ccom2-wiring.spec.ts`: a token bound by a third module would
 * compile, boot and resolve to `undefined` in the Inbox. The registry is
 * provided by the Inbox and filled by the join module; this proves the handoff
 * and the adapter's read, without booting two database connections.
 */
describe('IX3 Social ad-story port', () => {
  it('an unfilled registry reports no implementation (the Inbox shows "Post patrocinado")', () => {
    expect(new SocialAdStoryLookupRegistry().get()).toBeNull();
  });

  it('the join module registers the Social adapter on init', () => {
    const registry = new SocialAdStoryLookupRegistry();
    const adapter = new SocialAdStoryLookupAdapter({
      query: jest.fn(),
    } as never);
    new InboxSocialAdLookupModule(registry, adapter).onModuleInit();
    expect(registry.get()).toBe(adapter);
  });

  it('the adapter matches the story in the caller scope and names ad and campaign', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([
        { ad_id: '1202', ad_name: 'Black Friday', campaign_name: 'Vendas Q4' },
      ]);
    const adapter = new SocialAdStoryLookupAdapter({ query } as never);
    await expect(
      adapter.findByStoryId({
        tenantId: 't',
        workspaceId: 'w',
        storyId: '100_200',
      }),
    ).resolves.toEqual({
      adId: '1202',
      adName: 'Black Friday',
      campaignName: 'Vendas Q4',
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ad.effective_object_story_id = $3');
    expect(sql).toContain("ad.entity_level = 'ad'");
    expect(params).toEqual(['t', 'w', '100_200']);
  });

  it('a malformed story id never reaches the database', async () => {
    const query = jest.fn();
    const adapter = new SocialAdStoryLookupAdapter({ query } as never);
    await expect(
      adapter.findByStoryId({
        tenantId: 't',
        workspaceId: 'w',
        storyId: "1' OR 1=1",
      }),
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
