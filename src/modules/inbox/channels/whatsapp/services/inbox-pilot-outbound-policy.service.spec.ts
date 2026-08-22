import { InboxPilotOutboundPolicyService } from './inbox-pilot-outbound-policy.service';

describe('InboxPilotOutboundPolicyService', () => {
  it('normalizes a valid recipient to E.164, with no allowlist restriction', () => {
    const policy = new InboxPilotOutboundPolicyService();
    const result = policy.authorize('5511999999999');
    expect(result.canonicalE164).toBe('+5511999999999');
    expect(result.transportRecipient).toBe('5511999999999');
    expect(result.recipientHash).toHaveLength(64);
    expect(result.recipientMasked).not.toContain('999999999');
  });

  it('accepts any well-formed recipient, unrelated to any other', () => {
    const policy = new InboxPilotOutboundPolicyService();
    expect(policy.authorize('+5511888888888').canonicalE164).toBe(
      '+5511888888888',
    );
    expect(policy.authorize('+5511777777777').canonicalE164).toBe(
      '+5511777777777',
    );
  });

  it('rejects a malformed recipient', () => {
    const policy = new InboxPilotOutboundPolicyService();
    expect(() => policy.authorize('not-a-number')).toThrow(
      'outbound_recipient_invalid',
    );
  });

  it('rejects a destination that changed from the expected recipient', () => {
    const policy = new InboxPilotOutboundPolicyService();
    expect(() =>
      policy.authorize('+5511999999999', '+5511777777777'),
    ).toThrow('outbound_recipient_changed');
  });

  describe('isAuthorized', () => {
    it('returns true for a well-formed recipient', () => {
      const policy = new InboxPilotOutboundPolicyService();
      expect(policy.isAuthorized('+5511999999999')).toBe(true);
    });

    it('returns false for a missing or malformed recipient', () => {
      const policy = new InboxPilotOutboundPolicyService();
      expect(policy.isAuthorized(null)).toBe(false);
      expect(policy.isAuthorized('not-a-number')).toBe(false);
    });
  });
});
