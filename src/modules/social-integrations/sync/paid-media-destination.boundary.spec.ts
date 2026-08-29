import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Architectural rules for the destination dimension.
 *
 * Two of them cannot be expressed as a test of behaviour. The first is what the
 * resolver is allowed to *look at*: a future edit that quietly starts reading
 * the campaign name would pass every behavioural test that exists, because the
 * cases where a name agrees with the real destination are the common ones — it
 * fails only on the rows nobody has fixtures for. The second is the direction
 * of the dependency: Social produces this dimension, and Intelligence or
 * LeadFlow may read it later, never the reverse.
 *
 * Both are checked by reading the source, with comments stripped first because
 * the files below discuss in prose the very identifiers being forbidden.
 */

const SYNC_DIR = __dirname;

function readCode(...segments: string[]): string {
  const raw = readFileSync(join(SYNC_DIR, ...segments), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const RESOLVER = readCode('paid-media-destination.ts');

describe('paid media destination boundary', () => {
  describe('what may decide a destination', () => {
    /**
     * The single input rule. `destination_type` is the only provider field the
     * resolver is permitted to branch on; everything else in the payload is
     * either a different question or advertiser prose.
     */
    it('reads the destination field and no other provider signal', () => {
      expect(RESOLVER).toContain('providerFields.destination_type');

      for (const forbidden of [
        'providerFields.name',
        'providerFields.objective',
        'providerFields.optimization_goal',
        'providerFields.campaign_name',
        'providerFields.promoted_object',
        'providerFields.adset_name',
      ]) {
        expect(RESOLVER).not.toContain(forbidden);
      }
    });

    /**
     * Name inference is the specific mistake this slice exists to avoid. An ad
     * set called "Campanha WhatsApp" keeps that name long after it has been
     * repointed, so the guess is most confident exactly when it is wrong.
     */
    it('never matches on advertiser-authored text', () => {
      expect(RESOLVER).not.toMatch(/toLowerCase\(\)\.includes/);
      expect(RESOLVER).not.toMatch(/\/whatsapp\/i/);
      expect(RESOLVER).not.toMatch(/\bname\b\s*\./);
    });

    /**
     * No probability. The provider either stated a destination or it did not,
     * and a number in between would be read as a measurement by anyone who
     * later renders it.
     */
    it('expresses confidence as observed or unavailable, never as a score', () => {
      expect(RESOLVER).toContain("'observed'");
      expect(RESOLVER).toContain("'unavailable'");

      for (const forbidden of [
        'probability',
        'confidenceScore',
        'likelihood',
        'inferred',
      ]) {
        expect(RESOLVER).not.toContain(forbidden);
      }
    });
  });

  describe('dependency direction', () => {
    it('imports nothing at all', () => {
      // A pure mapping function. Anything it imported would be something a
      // caller could not substitute, and this must stay callable from a test
      // with a plain object.
      expect(RESOLVER).not.toMatch(/^\s*import\s/m);
    });

    it('does not reach into Intelligence, LeadFlow or the Inbox', () => {
      for (const forbidden of [
        'common/intelligence',
        'IntelligenceFactSource',
        'intelligence-analytics',
        'leadflow',
        'inbox_conversations',
        'qualification',
        'InboxConversation',
      ]) {
        expect(RESOLVER).not.toContain(forbidden);
      }
    });

    /**
     * The provider-agnostic naming rule. Google Ads and TikTok will bring their
     * own mapping into the same canonical set, and a type named after Meta
     * would force them to either widen it or sit beside it.
     */
    it('names the concept after paid media, not after Meta', () => {
      expect(RESOLVER).toContain('CanonicalPaidMediaDestination');
      expect(RESOLVER).not.toMatch(/MetaWhatsApp\w*Destination/);
      expect(RESOLVER).not.toMatch(/export type Meta\w*Destination/);
    });
  });

  describe('safety', () => {
    it('logs nothing, least of all a token', () => {
      for (const forbidden of [
        'console.',
        'Logger',
        'access_token',
        'accessToken',
      ]) {
        expect(RESOLVER).not.toContain(forbidden);
      }
    });

    it('performs no I/O', () => {
      for (const forbidden of [
        'fetch(',
        'Repository',
        'DataSource',
        'await ',
      ]) {
        expect(RESOLVER).not.toContain(forbidden);
      }
    });

    /**
     * A destination Meta ships tomorrow must not stop the mirror of an entire
     * account: the row's spend and reach are still correct, only the
     * destination is unmapped.
     */
    it('cannot throw on an unrecognised provider value', () => {
      expect(RESOLVER).not.toMatch(/throw\s+new/);
    });
  });

  describe('the dimension stays out of the fact table', () => {
    it('does not write destination onto daily metrics', () => {
      const metricsEntity = readFileSync(
        join(SYNC_DIR, '..', 'entities', 'social-ad-metric-daily.entity.ts'),
        'utf8',
      );

      // Destination is an attribute of the ad set, not of a day's numbers.
      // Copying it onto every daily row would multiply a mutable
      // classification across the largest table in the module.
      expect(metricsEntity).not.toContain('destination_type');
      expect(metricsEntity).not.toContain('destinationType');
    });
  });
});
