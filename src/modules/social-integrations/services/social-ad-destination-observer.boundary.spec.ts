import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Architectural rules for the destination history.
 *
 * The one that cannot be expressed behaviourally is the vocabulary. Nothing
 * about the observer *behaves* differently if a column is renamed
 * `destination_changed_at`, and every test would still pass — but the claim the
 * data makes would go from "we saw this at T" to "the provider changed it at
 * T", which Meta gives no basis for. The Marketing API was probed directly:
 * `last_modified_time`, `effective_time` and `destination_type_updated_time`
 * are all dropped from the ad set payload, and the generic `updated_time` moves
 * for any edit at all.
 *
 * Comments are stripped first, because the files below discuss in prose exactly
 * the words being forbidden.
 */

const SERVICES_DIR = __dirname;

function readCode(...segments: string[]): string {
  const raw = readFileSync(join(SERVICES_DIR, ...segments), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const OBSERVER = readCode('social-ad-destination-observer.service.ts');
const ENTITY = readCode(
  '..',
  'entities',
  'social-ad-destination-observation.entity.ts',
);

describe('destination observation boundary', () => {
  describe('observation vocabulary', () => {
    /**
     * The whole contract in one assertion: the timestamp is what Lyra saw, not
     * when the provider changed anything.
     */
    it('names the timestamp after the observation', () => {
      expect(ENTITY).toContain('observed_at');
      expect(OBSERVER).toContain('observedAt');
    });

    it.each([OBSERVER, ENTITY])(
      'never claims an effective or change time',
      (source) => {
        for (const forbidden of [
          'effectiveAt',
          'effective_at',
          'changedAt',
          'changed_at',
          'effectiveFrom',
          'effective_from',
          'validFrom',
          'valid_from',
        ]) {
          expect(source).not.toContain(forbidden);
        }
      },
    );

    /**
     * `updated_time` is the one timestamp Meta does return, and it moves for
     * any edit — a budget change, a rename, a schedule tweak. Reading it as a
     * destination-change stamp is the specific mistake this table exists to
     * avoid, so neither file may even reach for it.
     */
    it('does not borrow the provider generic update timestamp', () => {
      for (const source of [OBSERVER, ENTITY]) {
        expect(source).not.toContain('updated_time');
        expect(source).not.toContain('providerUpdatedTime');
      }
    });
  });

  describe('append-only', () => {
    it('never updates or deletes an observation', () => {
      for (const forbidden of ['.update(', '.delete(', '.remove(', '.save(']) {
        expect(OBSERVER).not.toContain(forbidden);
      }
    });

    it('inserts through a conflict-tolerant path', () => {
      // `orIgnore` is what makes a concurrent duplicate a no-op instead of an
      // error, since the read-then-write above it is not atomic.
      expect(OBSERVER).toContain('.insert()');
      expect(OBSERVER).toContain('orIgnore');
    });
  });

  describe('inference', () => {
    /**
     * The history must inherit the resolver's discipline: a destination comes
     * from `destination_type` and nothing else. An observer that reached for a
     * name or a goal would write inferred history, which is worse than no
     * history at all.
     */
    it('decides nothing from names, goals or objectives', () => {
      for (const forbidden of [
        'optimization_goal',
        'optimizationGoal',
        'campaign_name',
        'campaignName',
        'objective',
        'toLowerCase',
      ]) {
        expect(OBSERVER).not.toContain(forbidden);
      }
    });

    it('does not resolve a destination itself', () => {
      // Resolution belongs to the shared resolver; the observer only records
      // what it is handed, so there is exactly one mapping in the codebase.
      expect(OBSERVER).not.toContain('resolvePaidMediaDestination');
      expect(OBSERVER).not.toContain('WHATSAPP');
    });
  });

  describe('dependency direction', () => {
    it('does not reach into Intelligence, LeadFlow or the Inbox', () => {
      for (const source of [OBSERVER, ENTITY]) {
        for (const forbidden of [
          'common/intelligence',
          'IntelligenceFactSource',
          'intelligence-analytics',
          'leadflow',
          'inbox_conversations',
          'InboxConversation',
          'qualification',
        ]) {
          expect(source).not.toContain(forbidden);
        }
      }
    });

    it('does not write metrics', () => {
      for (const source of [OBSERVER, ENTITY]) {
        expect(source).not.toContain('social_ad_metrics_daily');
        expect(source).not.toContain('SocialAdMetricDaily');
      }
    });
  });

  describe('privacy', () => {
    it('stores no person and no creative copy', () => {
      for (const source of [OBSERVER, ENTITY]) {
        for (const forbidden of [
          'userId',
          'user_id',
          'leadId',
          'lead_id',
          'message',
          'phone',
          'email',
          'creative',
        ]) {
          expect(source).not.toContain(forbidden);
        }
      }
    });

    it('logs nothing, least of all a token', () => {
      for (const forbidden of ['console.', 'accessToken', 'access_token']) {
        expect(OBSERVER).not.toContain(forbidden);
      }
    });
  });

  describe('retention', () => {
    /**
     * These are historical facts, not operational logs. S2.9's sweep is for
     * `social_ad_sync_runs`, and the observation must outlive the run that made
     * it — which is why the FK is `ON DELETE SET NULL` rather than CASCADE.
     */
    it('declares no TTL of its own', () => {
      for (const forbidden of ['retainUntil', 'retain_until', 'expiresAt']) {
        expect(ENTITY).not.toContain(forbidden);
      }
    });
  });

  describe('current state is not replaced', () => {
    it('leaves the read model column in place', () => {
      const entity = readCode('..', 'entities', 'social-ad-entity.entity.ts');

      // The history answers "what did we see and when"; the mirror still
      // answers "where does this send people now", which every screen reads.
      expect(entity).toContain('destinationType');
      expect(entity).toContain('destination_observed_at');
    });
  });
});
