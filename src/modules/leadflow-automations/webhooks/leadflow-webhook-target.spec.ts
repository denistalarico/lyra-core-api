import {
  assertPublicWebhookTarget,
  isPrivateAddress,
  WebhookTargetError,
} from './leadflow-webhook-target';

describe('webhook target', () => {
  it('refuses every network only reachable from inside', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.10',
      // The one that matters most: the cloud metadata service holds our own
      // credentials, and it answers to anything that can make an HTTP request.
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it('accepts an ordinary public address', () => {
    expect(isPrivateAddress('203.0.113.10')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });

  it('requires https, because the payload is customer data', () => {
    return expect(
      assertPublicWebhookTarget('http://example.com/hook'),
    ).rejects.toMatchObject({ reason: 'webhook_url_not_https' });
  });

  it('refuses something that is not a URL at all', async () => {
    await expect(assertPublicWebhookTarget('nope')).rejects.toBeInstanceOf(
      WebhookTargetError,
    );
  });

  it('refuses a hostname that resolves inside the network', async () => {
    // localhost is the honest version of the attack: a perfectly valid URL that
    // points at the machine running the dispatcher.
    await expect(
      assertPublicWebhookTarget('https://localhost/hook'),
    ).rejects.toMatchObject({ reason: 'webhook_url_private_network' });
  });
});
