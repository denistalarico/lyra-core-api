import { resolveCanonicalIdentity } from './inbox-governed-action.worker';

describe('canonical inbound identity', () => {
  it.each(['whatsapp', 'sms'])('normalizes %s as a phone', (channel) => {
    expect(
      resolveCanonicalIdentity(channel, '+55 (11) 99999-0000'),
    ).toMatchObject({
      identity: '+5511999990000',
      methodType: channel === 'sms' ? 'phone' : 'whatsapp',
    });
  });

  it.each([
    [
      'instagram',
      'instagram:account:12345678901234567',
      'instagram:12345678901234567',
      'instagram',
      'leadflow_instagram',
    ],
    [
      'facebook_messenger',
      'facebook_messenger:page:12345678901234567',
      'messenger:12345678901234567',
      'facebook',
      'leadflow_messenger',
    ],
  ])(
    'keeps %s scoped IDs separate from phones',
    (channel, thread, identity, methodType, source) => {
      expect(resolveCanonicalIdentity(channel, thread)).toMatchObject({
        identity,
        methodType,
        source,
      });
    },
  );

  it('rejects unsupported channels', () => {
    expect(() => resolveCanonicalIdentity('email', '123456789')).toThrow(
      'canonical_identity_unsupported',
    );
  });

  it('rejects invalid social identifiers', () => {
    expect(() => resolveCanonicalIdentity('instagram', 'instagram:')).toThrow(
      'canonical_identity_invalid',
    );
    expect(() =>
      resolveCanonicalIdentity('instagram', 'facebook_messenger:page:123'),
    ).toThrow('canonical_identity_invalid');
  });
});
