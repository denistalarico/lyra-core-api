import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV } from './meta-organic-webhook.support';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * Comments are stripped before scanning, deliberately.
 *
 * These files explain *why* they must not touch Inbox or the Messaging app, so
 * they necessarily name those things in prose. A boundary spec that matched
 * prose would either fail on a correct file or force the explanation out of the
 * code — and the explanation is the part that stops the next person from
 * reintroducing the coupling. What must be free of those names is the code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The build-time proof that this endpoint belongs to the Social Meta app.
 *
 * The historical incident these assertions exist for: mixing one Meta app's
 * identifiers with another's produces authentication that *looks* correct and
 * trusts the wrong signer. For a webhook that is worse than for OAuth, because
 * the endpoint is public and the only thing standing between it and a forged
 * payload is which secret verifies the HMAC.
 */
describe('Meta Organic webhook boundaries', () => {
  const paths = sourceFiles(__dirname);
  const source = paths
    .map((path) => stripComments(readFileSync(path, 'utf8')))
    .join('\n');

  it('imports nothing from Inbox', () => {
    expect(source).not.toMatch(/modules\/inbox/);
    expect(source).not.toMatch(/\.\.\/\.\.\/inbox/);
    expect(source).not.toMatch(/inbox_webhook_logs/);
    expect(source).not.toMatch(/InboxWebhookLog|WebhookLogService/);
  });

  it('imports nothing from Meta Ads or the paid module', () => {
    expect(source).not.toMatch(/modules\/social-integrations/);
    expect(source).not.toMatch(/MetaAds/);
    expect(source).not.toMatch(/SOCIAL_META_ADS_OAUTH_CALLBACK_URL/);
  });

  it('verifies HMAC with the Social app secret', () => {
    expect(source).toContain('requireSocialMetaAppSecret');
  });

  it('never reads the Messaging app secret or verify token', () => {
    // Bare-word match: SOCIAL_META_APP_SECRET must not satisfy this by
    // containing META_APP_SECRET as a substring.
    expect(source).not.toMatch(/(?<![A-Z_])META_APP_SECRET/);
    expect(source).not.toMatch(/(?<![A-Z_])META_APP_ID/);
    expect(source).not.toMatch(/(?<![A-Z_])META_WEBHOOK_VERIFY_TOKEN/);
    expect(source).not.toMatch(/META_INSTAGRAM_APP_SECRET/);
  });

  it('uses its own verify token env var', () => {
    expect(SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV).toBe(
      'SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN',
    );
    expect(source).toContain(SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV);
  });

  it('compares signatures and tokens in constant time', () => {
    expect(source).toContain('timingSafeEqual');
  });

  it('performs no outbound side effect — W1.2 handlers are inbound only', () => {
    // W1.2 added interpretation, which W1.1 deliberately lacked. What it must
    // NOT have added is an outbound edge: no Graph call (so no replying,
    // hiding, deleting or publishing), no notification, no LeadFlow write.
    // Each name below is a collaborator whose presence would mean one of those
    // landed inside an inbound handler.
    for (const forbidden of [
      'MetaOrganicGraphService',
      'MetaOrganicInsightsService',
      'SocialOrganicSyncRunService',
      'SocialPublicationService',
      'SocialPublisherRegistry',
      'NotificationsService',
      'LeadFlow',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('makes no HTTP request of its own', () => {
    // A handler that fetched a comment's author would be Graph enrichment,
    // which W1.2 explicitly defers (§16, payload-first).
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/HttpService/);
  });

  it('registers no messaging field', () => {
    // Messaging belongs to the Messaging app and the Inbox/LeadFlow surface.
    // These are the field names an organic module must never claim.
    for (const forbidden of [
      'messaging_postbacks',
      'messaging_referrals',
      'messaging_handovers',
      'messaging_optins',
      'message_reactions',
      'message_echoes',
      'message_reads',
      'story_insights',
      'live_comments',
    ]) {
      expect(source).not.toContain(`'${forbidden}'`);
    }
  });

  it('adds no message broker', () => {
    for (const forbidden of ['nats', 'bullmq', 'temporal', 'ioredis']) {
      expect(source.toLowerCase()).not.toContain(`from '${forbidden}`);
    }
  });

  it('keeps the canonical webhook path', () => {
    const controller = stripComments(
      readFileSync(
        join(__dirname, 'meta-organic-webhook.controller.ts'),
        'utf8',
      ),
    );

    // With main.ts's global `api` prefix this is
    // https://api.lyrasuite.com/api/social/organic/webhooks/meta — the URL
    // registered in the Meta App dashboard.
    expect(controller).toContain("@Controller('social/organic/webhooks')");
    expect(controller).toMatch(/@Get\('meta'\)/);
    expect(controller).toMatch(/@Post\('meta'\)/);
  });

  it('leaves the webhook routes unauthenticated by guard and authorized by signature', () => {
    const controller = stripComments(
      readFileSync(
        join(__dirname, 'meta-organic-webhook.controller.ts'),
        'utf8',
      ),
    );

    // A guard here would break Meta's own requests. Authorization is the app
    // secret (POST) and the verify token (GET), which is why scope must be
    // derived server-side rather than taken from a request context.
    expect(controller).not.toContain('JwtAuthGuard');
    expect(controller).not.toContain('PermissionsGuard');
    expect(controller).not.toContain('RequestContextData');
  });
});
