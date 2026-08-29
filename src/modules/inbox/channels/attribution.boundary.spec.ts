import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The Inbox observes an origin. It does not evaluate one.
 *
 * The attribution row exists so a future Intelligence layer can ask "which
 * conversations carried this ad id?". The temptation, the moment that question
 * is asked, is to answer it here — to resolve the ad against the Social
 * hierarchy at write time so the row arrives "enriched". That inverts the
 * dependency: ingestion would then fail, or block, when a Graph token expires
 * or the ad account is unreachable, and a webhook that Meta will not resend
 * would be lost for a reason that has nothing to do with the message.
 *
 * The direction this locks:
 *
 *     Inbox attribution  ←  future Intelligence adapter
 *
 * and never:
 *
 *     Inbox attribution  →  Social Graph / Ads credentials
 *
 * The observation is true on its own terms. An `ad_id` from an account this
 * agency does not manage is still a real observation, and it stays storable
 * precisely because nothing here tries to resolve it.
 */
const CHANNELS_DIR = __dirname;
const INBOX_DIR = join(CHANNELS_DIR, '..');

const ATTRIBUTION_SOURCES: Array<[label: string, path: string]> = [
  [
    'inbound-attribution-observation.ts',
    join(CHANNELS_DIR, 'types', 'inbound-attribution-observation.ts'),
  ],
  [
    'inbox-attribution-observation.entity.ts',
    join(INBOX_DIR, 'entities', 'inbox-attribution-observation.entity.ts'),
  ],
];

const INGESTION_SOURCE = join(
  CHANNELS_DIR,
  'services',
  'inbound-message-ingestion.service.ts',
);

/**
 * Comments are stripped before matching.
 *
 * Every file here explains, in prose, the very couplings this spec forbids —
 * naming Social, the Graph and the Intelligence layer in order to say why it
 * does not reach for them. A naive substring search would punish the
 * explanation of the rule and reward silence, so the rule is checked against
 * code only.
 */
function readCode(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Inbox attribution boundary', () => {
  /**
   * Whole-word patterns, not substrings: `social` matches nothing useful and
   * `meta` matches `metadata`, which the reader legitimately parses. A boundary
   * test that fails on an unrelated word is one the next person weakens.
   */
  const FORBIDDEN_DEPENDENCIES: Array<[rule: string, pattern: RegExp]> = [
    ['imports Social', /from\s+'[^']*social-integrations/],
    ['imports Intelligence', /from\s+'[^']*\/intelligence/],
    ['names the Social read model', /\bsocial_ad_\w+/],
    ['names a Social service', /\bSocialAnalytics\w*|\bSocialPaidMedia\w*/],
    ['reaches the Graph', /\bGraphApi\w*|\bgraph\.facebook\.com/],
    ['resolves Ads credentials', /\bAdsCredential\w*|\bcredentialResolver\b/],
    ['writes telemetry', /\btelemetry\b|\banonymous\w*Learning\b/],
  ];

  describe.each(ATTRIBUTION_SOURCES)('%s', (_label, path) => {
    it.each(FORBIDDEN_DEPENDENCIES)('never %s', (_rule, pattern) => {
      expect(readCode(path)).not.toMatch(pattern);
    });
  });

  /**
   * The ingestion service is the one file that legitimately touches both the
   * observation and the rest of Inbox, so it is checked against the same rules
   * rather than exempted. It is also the file where an "enrich on write" change
   * would actually land.
   */
  it.each(FORBIDDEN_DEPENDENCIES)(
    'inbound-message-ingestion.service.ts never %s',
    (_rule, pattern) => {
      expect(readCode(INGESTION_SOURCE)).not.toMatch(pattern);
    },
  );

  /**
   * The reader parses a metadata bag it is handed. If it imported an adapter it
   * would become channel-specific, and the shared shape — the thing that lets
   * Instagram and Messenger fill it later without a second table — would be a
   * shape with one legal producer.
   */
  it('the observation contract knows no channel adapter', () => {
    const source = readCode(
      join(CHANNELS_DIR, 'types', 'inbound-attribution-observation.ts'),
    );

    for (const adapter of [
      'WhatsAppMetaAdapter',
      'InstagramMetaAdapter',
      'MessengerMetaAdapter',
      'whatsapp-meta.adapter',
    ]) {
      expect(source).not.toContain(adapter);
    }
  });

  /**
   * No causal language, anywhere in the stored contract.
   *
   * The row means "the provider reported these identifiers on this inbound".
   * It does not mean the ad caused the sale. That distinction survives only as
   * long as nothing names a column or a type for the conclusion — a field
   * called `attributedRevenue` or `convertedFrom` would be read as the claim
   * itself, by code written years from now that never saw this reasoning.
   */
  it.each(ATTRIBUTION_SOURCES)('%s makes no causal claim', (_label, path) => {
    const source = readCode(path);

    for (const causal of [
      'attributedTo',
      'attributedRevenue',
      'convertedFrom',
      'causedBy',
      'influencedBy',
      'creditedTo',
    ]) {
      expect(source).not.toContain(causal);
    }
  });

  /**
   * The whole point of storing five identifiers and not the webhook. A raw
   * payload column would make this table an unbounded copy of Meta's schema,
   * and would put ad creative — and whatever Meta adds to it next — into the
   * Inbox permanently, for no query that wants it.
   */
  it('the entity stores identifiers, never a payload', () => {
    const source = readCode(
      join(INBOX_DIR, 'entities', 'inbox-attribution-observation.entity.ts'),
    );

    for (const forbidden of [
      'rawPayload',
      'raw_payload',
      'payload',
      'jsonb',
      'headline',
      'thumbnail',
      'accessToken',
      'access_token',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
