/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any */
import {
  evaluateMetaWindow,
  loadMetaMessagingWindow,
  resolveMetaMessagingWindow,
} from './meta-messaging-window';

const HOUR = 60 * 60 * 1_000;
const at = (iso: string) => new Date(iso);

describe('Meta messaging window (D-IX-4)', () => {
  const lastInbound = { occurredAt: at('2026-10-20T12:00:00.000Z') };
  const on = { adWindow7dEnabled: true, humanAgentTagEnabled: true };

  it('is closed when the lead never wrote', () => {
    const window = resolveMetaMessagingWindow(null, null, on);

    expect(window).toEqual({
      lastInboundAt: null,
      standardExpiresAt: null,
      humanAgentExpiresAt: null,
      source: 'standard',
    });
    expect(evaluateMetaWindow(window, 'human')).toEqual({
      allowed: false,
      reason: 'outside_standard_window',
    });
  });

  it('opens 24h for everyone and 7 days for a person', () => {
    const window = resolveMetaMessagingWindow(lastInbound, null, on);

    expect(window.standardExpiresAt).toEqual(at('2026-10-21T12:00:00.000Z'));
    expect(window.humanAgentExpiresAt).toEqual(at('2026-10-27T12:00:00.000Z'));
    expect(window.source).toBe('standard');
  });

  it('extends the standard window from the ad click, behind its flag', () => {
    const adReferral = { observedAt: at('2026-10-19T12:00:00.000Z') };

    const extended = resolveMetaMessagingWindow(lastInbound, adReferral, on);
    const flagOff = resolveMetaMessagingWindow(lastInbound, adReferral, {
      ...on,
      adWindow7dEnabled: false,
    });

    expect(extended.source).toBe('ad_referral');
    expect(extended.standardExpiresAt).toEqual(at('2026-10-26T12:00:00.000Z'));
    expect(flagOff.source).toBe('standard');
    expect(flagOff.standardExpiresAt).toEqual(at('2026-10-21T12:00:00.000Z'));
  });

  it('ignores an ad click older than the ordinary window', () => {
    const window = resolveMetaMessagingWindow(
      lastInbound,
      { observedAt: at('2026-10-01T12:00:00.000Z') },
      on,
    );

    expect(window.source).toBe('standard');
  });

  it('offers no human extension when the tag is switched off', () => {
    const window = resolveMetaMessagingWindow(lastInbound, null, {
      ...on,
      humanAgentTagEnabled: false,
    });

    expect(window.humanAgentExpiresAt).toBeNull();
  });

  describe('evaluateMetaWindow', () => {
    const window = resolveMetaMessagingWindow(lastInbound, null, on);
    const inside = at('2026-10-21T11:00:00.000Z');
    const human = at('2026-10-23T12:00:00.000Z');
    const closed = at('2026-10-27T12:00:00.000Z');

    it('needs no tag inside the standard window, for any actor', () => {
      expect(evaluateMetaWindow(window, 'automated', inside)).toEqual({
        allowed: true,
        tag: null,
      });
    });

    it('tags a person past 24h and refuses the agent and automations', () => {
      expect(evaluateMetaWindow(window, 'human', human)).toEqual({
        allowed: true,
        tag: 'HUMAN_AGENT',
      });
      expect(evaluateMetaWindow(window, 'automated', human)).toEqual({
        allowed: false,
        reason: 'human_agent_tag_requires_human',
      });
    });

    it('closes for everyone after 7 days', () => {
      expect(evaluateMetaWindow(window, 'human', closed)).toEqual({
        allowed: false,
        reason: 'outside_standard_window',
      });
    });
  });

  it('reads the ad observation only when the extension is on', async () => {
    const observations = { findOne: jest.fn().mockResolvedValue(null) };
    const messages = {
      findOne: jest.fn().mockResolvedValue({
        id: 'inbound-1',
        occurredAt: new Date(Date.now() - HOUR),
      }),
      manager: { getRepository: jest.fn().mockReturnValue(observations) },
    };
    const input = {
      messages: messages as never,
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      conversationId: 'conversation-1',
    };

    await loadMetaMessagingWindow({ ...input, env: {} });
    expect(observations.findOne).not.toHaveBeenCalled();

    await loadMetaMessagingWindow({
      ...input,
      env: { INBOX_META_AD_WINDOW_7D_ENABLED: 'true' },
    });
    expect(observations.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: 'conversation-1' }),
      }),
    );
  });
});
