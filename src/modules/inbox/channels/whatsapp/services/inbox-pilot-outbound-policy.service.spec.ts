import { InboxPilotOutboundPolicyService } from './inbox-pilot-outbound-policy.service';

describe('InboxPilotOutboundPolicyService', () => {
  const original = new Map<string, string | undefined>();
  const names = [
    'INBOX_PILOT_MODE',
    'INBOX_PILOT_ALLOWED_SENDERS_E164',
    'INBOX_TEST_ALLOWED_SENDER_E164',
  ];

  beforeEach(() => {
    for (const name of names) {
      original.set(name, process.env[name]);
      delete process.env[name];
    }
  });
  afterEach(() => {
    for (const name of names) {
      const value = original.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('fails closed at bootstrap when pilot mode has no allowlist', () => {
    process.env.INBOX_PILOT_MODE = 'true';
    expect(() => new InboxPilotOutboundPolicyService().onModuleInit()).toThrow(
      'inbox_pilot_allowlist_missing',
    );
  });

  it('rejects an invalid configured E.164 value', () => {
    process.env.INBOX_PILOT_MODE = 'true';
    process.env.INBOX_PILOT_ALLOWED_SENDERS_E164 = '5511999999999';
    expect(() => new InboxPilotOutboundPolicyService()).toThrow(
      'inbox_pilot_allowlist_invalid',
    );
  });

  it('allows exact canonical matches and supports the legacy variable', () => {
    process.env.INBOX_PILOT_MODE = 'true';
    process.env.INBOX_TEST_ALLOWED_SENDER_E164 = '+5511999999999';
    const policy = new InboxPilotOutboundPolicyService();
    policy.onModuleInit();
    const result = policy.authorize('5511999999999', '+5511999999999');
    expect(result.transportRecipient).toBe('5511999999999');
    expect(result.recipientHash).toHaveLength(64);
    expect(result.recipientMasked).not.toContain('999999999');
  });

  it('blocks non-members and destination changes in pilot mode', () => {
    process.env.INBOX_PILOT_MODE = 'true';
    process.env.INBOX_PILOT_ALLOWED_SENDERS_E164 = '+5511999999999';
    const policy = new InboxPilotOutboundPolicyService();
    expect(() => policy.authorize('+5511888888888')).toThrow(
      'outbound_recipient_not_allowlisted',
    );
    expect(() => policy.authorize('+5511999999999', '+5511777777777')).toThrow(
      'outbound_recipient_changed',
    );
  });

  it('does not impose a global allowlist outside pilot mode', () => {
    const policy = new InboxPilotOutboundPolicyService();
    expect(policy.authorize('+5511888888888').canonicalE164).toBe(
      '+5511888888888',
    );
  });
});
