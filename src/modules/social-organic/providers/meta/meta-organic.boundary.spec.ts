import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  SOCIAL_META_ORGANIC_CALLBACK_URL_ENV,
  SOCIAL_META_ORGANIC_SCOPES,
} from './meta-organic-oauth.support';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('Meta Organic boundaries', () => {
  const source = sourceFiles(__dirname)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  it('has no dependency on Inbox or the Ads module', () => {
    expect(source).not.toMatch(/modules\/inbox|\.\.\/\.\.\/\.\.\/inbox/);
    expect(source).not.toMatch(/modules\/social-integrations/);
  });

  it('keeps Organic callback and scopes separate from Ads and Messaging', () => {
    expect(SOCIAL_META_ORGANIC_CALLBACK_URL_ENV).toBe(
      'SOCIAL_META_ORGANIC_OAUTH_CALLBACK_URL',
    );
    expect(source).not.toContain('SOCIAL_META_ADS_OAUTH_CALLBACK_URL');
    expect(source).not.toContain('META_FACEBOOK_OAUTH_CALLBACK_URL');

    for (const forbidden of [
      // Ads
      'ads_management',
      'ads_read',
      'pages_manage_ads',
      'catalog_management',
      // Messaging / Inbox
      'pages_messaging',
      'pages_messaging_subscriptions',
      'whatsapp_business_management',
      'whatsapp_business_messaging',
      // Reserved for future, separately-scoped capability work — MA1.1
      // adds only the two v1 publishing scopes, never these "just in case"
      'pages_manage_engagement',
      'pages_manage_metadata',
      'pages_read_user_content',
      'read_insights',
      'instagram_manage_comments',
      'instagram_manage_contents',
      'instagram_manage_engagement',
      'instagram_manage_insights',
    ]) {
      expect(SOCIAL_META_ORGANIC_SCOPES).not.toContain(forbidden);
    }
  });

  it('declares exactly the MA1 discovery scopes plus the MA1.1 publishing scopes — a single source of truth', () => {
    expect([...SOCIAL_META_ORGANIC_SCOPES].sort()).toEqual(
      [
        'business_management',
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'pages_manage_posts',
        'instagram_content_publish',
      ].sort(),
    );
  });
});
