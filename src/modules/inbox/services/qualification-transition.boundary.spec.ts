import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The architectural rules this history depends on.
 *
 * Two of them cannot be expressed in a unit test of behaviour. The first is
 * that every writer of `qualification_status` also records the transition —
 * a new writer added next year would not fail any behavioural test, it would
 * just silently create a hole in the history that no backfill can repair. The
 * second is the direction of the dependency: this domain produces the fact and
 * Intelligence reads it, never the reverse.
 *
 * Both are checked by reading the source. Comments are stripped first, because
 * the files below discuss in prose the very things being forbidden.
 */

const SRC = join(__dirname, '..', '..', '..');

function readCode(...segments: string[]): string {
  const raw = readFileSync(join(SRC, ...segments), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const RECORDER = readCode(
  'modules',
  'inbox',
  'services',
  'qualification-transition.recorder.ts',
);

/**
 * Every file that assigns `qualification_status`. If a future writer appears
 * outside this list, the "no writer bypasses the recorder" test below fails —
 * which is the point: adding a writer must be a deliberate act that also adds
 * the transition.
 */
const KNOWN_WRITERS: Array<{ label: string; segments: string[] }> = [
  {
    label: 'inbound ingestion',
    segments: [
      'modules',
      'inbox',
      'channels',
      'services',
      'inbound-message-ingestion.service.ts',
    ],
  },
  {
    label: 'conversation ownership',
    segments: [
      'modules',
      'inbox',
      'services',
      'conversation-ownership.service.ts',
    ],
  },
  {
    label: 'agent runtime',
    segments: [
      'modules',
      'inbox',
      'services',
      'inbox-agent-runtime.service.ts',
    ],
  },
];

describe('qualification transition boundary', () => {
  describe('write path', () => {
    it.each(KNOWN_WRITERS)(
      'records a transition wherever $label assigns the status',
      ({ segments }) => {
        const code = readCode(...segments);
        const assignments = code.match(
          /conversation\.qualificationStatus\s*=/g,
        );

        // Every assignment site must be accompanied by a recorder call.
        if (assignments) {
          expect(code).toContain('recordQualificationTransition');
        }
      },
    );

    /**
     * The creation path assigns through an object literal rather than a
     * property write, so the regex above cannot see it. It is the highest
     * volume qualification in production, so it gets its own assertion.
     */
    it('records the qualification a conversation is created with', () => {
      const code = readCode(...KNOWN_WRITERS[0].segments);
      // The literal that builds a new conversation sets the status directly;
      // the recorder call must follow it before the next branch of the
      // if/else chain begins.
      const created = code.indexOf('qualificationStatus: qualification.status');
      expect(created).toBeGreaterThan(-1);

      const nextBranch = code.indexOf('} else if (internalContact)', created);
      expect(nextBranch).toBeGreaterThan(created);

      expect(code.slice(created, nextBranch)).toContain(
        'recordQualificationTransition',
      );
    });

    it('keeps the no-op guard in the recorder, not in the callers', () => {
      // If each caller had to remember the guard, one of them eventually would
      // not, and the history would gain a qualified -> qualified row.
      expect(RECORDER).toContain(
        'if (input.previousStatus === input.newStatus) return null;',
      );
    });
  });

  describe('dependency direction', () => {
    it('imports nothing from the Intelligence layer', () => {
      expect(RECORDER).not.toMatch(/common\/intelligence/);
      expect(RECORDER).not.toMatch(/IntelligenceFactSource/);
      expect(RECORDER).not.toMatch(/intelligence-analytics/);
      expect(RECORDER).not.toMatch(/SocialPaidMedia/);
    });

    it('does not reach into another product to decide a transition', () => {
      expect(RECORDER).not.toMatch(/social_ad_/);
      expect(RECORDER).not.toMatch(/crm_lead_score/);
      expect(RECORDER).not.toMatch(/LeadScore/);
    });
  });

  describe('privacy', () => {
    it('copies no message content or contact identity into the payload', () => {
      for (const forbidden of [
        'lastMessagePreview',
        'content',
        'phone',
        'email',
        'reasoning',
        'prompt',
        'rawPayload',
      ]) {
        expect(RECORDER).not.toContain(forbidden);
      }
    });

    it('writes no telemetry', () => {
      expect(RECORDER).not.toMatch(/telemetry/i);
    });
  });

  describe('storage', () => {
    it('appends to the existing conversation event log', () => {
      // Reusing the log is what makes this change migration-free; a new table
      // would have needed one.
      expect(RECORDER).toContain('InboxConversationEventEntity');
    });

    it('never updates or deletes an existing row', () => {
      expect(RECORDER).not.toMatch(/\.update\(/);
      expect(RECORDER).not.toMatch(/\.delete\(/);
      expect(RECORDER).not.toMatch(/\.remove\(/);
    });

    it('writes through the caller transaction manager', () => {
      // Not through an injected DataSource, which would commit independently
      // of the status change it is supposed to be evidence for.
      expect(RECORDER).toContain('manager: EntityManager');
      expect(RECORDER).not.toMatch(/InjectDataSource/);
      expect(RECORDER).not.toMatch(/InjectRepository/);
    });
  });
});
