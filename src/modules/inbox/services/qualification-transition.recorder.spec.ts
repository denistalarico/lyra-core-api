import {
  QUALIFICATION_STATUS_CHANGED_EVENT,
  recordQualificationTransition,
  type QualificationStatus,
} from './qualification-transition.recorder';

/**
 * The recorder's own rules, independent of any caller.
 */

const CONVERSATION = {
  id: 'conversation-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
};

function build() {
  const saved: Array<Record<string, unknown>> = [];
  const repository = {
    create: (value: Record<string, unknown>) => value,
    save: (value: Record<string, unknown>) => {
      saved.push(value);
      return Promise.resolve({ ...value, id: `event-${saved.length}` });
    },
  };
  const manager = { getRepository: () => repository };
  return { manager, saved };
}

function record(
  manager: unknown,
  previousStatus: QualificationStatus,
  newStatus: QualificationStatus,
  overrides: Partial<Parameters<typeof recordQualificationTransition>[1]> = {},
) {
  return recordQualificationTransition(manager as never, {
    conversation: CONVERSATION,
    previousStatus,
    newStatus,
    reason: 'whatsapp_default',
    actor: { type: 'system' },
    occurredAt: new Date('2026-07-15T12:00:00.000Z'),
    ...overrides,
  });
}

describe('recordQualificationTransition', () => {
  describe('what counts as a transition', () => {
    it('records a promotion to qualified', async () => {
      const { manager, saved } = build();

      const event = await record(manager, 'pending', 'qualified');

      expect(event).not.toBeNull();
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        eventType: QUALIFICATION_STATUS_CHANGED_EVENT,
        conversationId: 'conversation-1',
      });
      expect(saved[0].payload).toMatchObject({
        previousStatus: 'pending',
        newStatus: 'qualified',
      });
    });

    it('records a demotion away from qualified', async () => {
      const { manager, saved } = build();

      await record(manager, 'qualified', 'disqualified');

      expect(saved[0].payload).toMatchObject({
        previousStatus: 'qualified',
        newStatus: 'disqualified',
      });
    });

    it('records a transition that does not involve qualified at all', async () => {
      // pending -> internal is still a real change and still evidence.
      const { manager, saved } = build();

      await record(manager, 'pending', 'internal');

      expect(saved).toHaveLength(1);
    });

    /**
     * The guard that keeps the history countable. Without it, a writer that
     * re-asserts the current value would add a row that a naive
     * "count transitions to qualified" query would read as a second lead.
     */
    it('writes nothing when the status did not change', async () => {
      const { manager, saved } = build();

      const event = await record(manager, 'qualified', 'qualified');

      expect(event).toBeNull();
      expect(saved).toHaveLength(0);
    });

    it('treats every no-op status the same way', async () => {
      const { manager, saved } = build();

      for (const status of [
        'pending',
        'qualified',
        'disqualified',
        'internal',
      ] as QualificationStatus[]) {
        await record(manager, status, status);
      }

      expect(saved).toHaveLength(0);
    });
  });

  describe('requalification', () => {
    /**
     * The cycle the request asked about. All four transitions survive, so a
     * later consumer can choose to count the first one, the last one, or all
     * of them — the history does not make that choice for it.
     */
    it('preserves every leg of a qualify/unqualify/qualify cycle', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified');
      await record(manager, 'qualified', 'disqualified');
      await record(manager, 'disqualified', 'qualified');

      expect(saved).toHaveLength(3);
      expect(
        saved.map((row) => (row.payload as Record<string, string>).newStatus),
      ).toEqual(['qualified', 'disqualified', 'qualified']);
    });

    it('does not overwrite the earlier qualification with the later one', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', {
        occurredAt: new Date('2026-07-01T10:00:00.000Z'),
      });
      await record(manager, 'qualified', 'disqualified', {
        occurredAt: new Date('2026-07-05T10:00:00.000Z'),
      });
      await record(manager, 'disqualified', 'qualified', {
        occurredAt: new Date('2026-07-20T10:00:00.000Z'),
      });

      const first = saved[0].payload as Record<string, string>;
      expect(first.occurredAt).toBe('2026-07-01T10:00:00.000Z');
    });
  });

  describe('provenance', () => {
    it('records an operator with the user id', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', {
        actor: { type: 'user', userId: 'user-7' },
      });

      expect(saved[0]).toMatchObject({
        actorType: 'user',
        actorUserId: 'user-7',
      });
    });

    it('records an agent without pretending it was a user', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', {
        actor: { type: 'agent', agentId: 'agent-3' },
      });

      expect(saved[0]).toMatchObject({
        actorType: 'agent',
        actorUserId: null,
      });
      expect(saved[0].payload).toMatchObject({ actorAgentId: 'agent-3' });
    });

    /**
     * An automatic decision has no user behind it and says so, rather than
     * borrowing whatever id happened to be in scope.
     */
    it('records an automatic decision as system with no user', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', {
        actor: { type: 'system' },
      });

      expect(saved[0]).toMatchObject({
        actorType: 'system',
        actorUserId: null,
      });
      expect(saved[0].payload).not.toHaveProperty('actorAgentId');
    });

    it('keeps an unknown operator honest rather than inventing one', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', {
        actor: { type: 'user', userId: null },
      });

      expect(saved[0]).toMatchObject({ actorType: 'user', actorUserId: null });
    });

    it('carries the reason the domain recorded alongside the status', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', {
        reason: 'rule:lead-rule-whatsapp-dedicated',
      });

      expect((saved[0].payload as Record<string, string>).reason).toBe(
        'rule:lead-rule-whatsapp-dedicated',
      );
    });

    it('accepts a null reason without substituting a default', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', { reason: null });

      expect((saved[0].payload as Record<string, unknown>).reason).toBeNull();
    });
  });

  describe('time', () => {
    /**
     * The provider timestamp, not the moment the row was written. An inbound
     * message replayed an hour late qualified the lead when it was sent.
     */
    it('records the occurrence time the caller observed', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified', {
        occurredAt: new Date('2026-06-30T23:30:00.000Z'),
      });

      expect((saved[0].payload as Record<string, string>).occurredAt).toBe(
        '2026-06-30T23:30:00.000Z',
      );
    });
  });

  describe('scope', () => {
    it('carries the tenant and workspace of the conversation', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified');

      expect(saved[0]).toMatchObject({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      });
    });

    /**
     * The client is deliberately absent. `inbox_conversations` has no
     * `agency_client_id`: LeadFlow resolves the client through the channel's
     * metadata at query time, and that predicate is shared by every LeadFlow
     * screen. Freezing a client id here would create a second definition of
     * which client a conversation belongs to, and the two would drift the
     * first time a channel was reassigned.
     */
    it('stores no client id of its own', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified');

      expect(saved[0]).not.toHaveProperty('agencyClientId');
      expect(saved[0].payload).not.toHaveProperty('clientId');
    });
  });

  describe('privacy', () => {
    it('stores only the transition and its provenance', async () => {
      const { manager, saved } = build();

      await record(manager, 'pending', 'qualified');

      expect(Object.keys(saved[0].payload as object).sort()).toEqual([
        'newStatus',
        'occurredAt',
        'previousStatus',
        'reason',
      ]);
    });
  });
});
