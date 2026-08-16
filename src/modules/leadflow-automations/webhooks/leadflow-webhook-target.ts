import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';

/**
 * Whether an address belongs to a network that is only reachable from inside.
 *
 * This is the SSRF guard. A webhook URL is typed by a customer, and the server
 * that fetches it sits in the same network as the database, the metadata
 * service and every internal API — so "https://169.254.169.254/latest/…" is not
 * a webhook, it is a request for our cloud credentials, and it would arrive
 * from a perfectly ordinary-looking configuration screen.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) return true;

  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is an IPv4 address wearing a costume.
  const mapped = value.startsWith('::ffff:') ? value.slice(7) : value;

  if (isIPv4(mapped)) {
    const parts = mapped.split('.').map(Number);
    if (
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return true;
    }
    const [a, b] = parts;
    return (
      a === 0 || // "this network"
      a === 10 ||
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, and the cloud metadata service
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // IETF protocol assignments
      (a === 198 && b >= 18 && b <= 19) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }

  return (
    value === '::' ||
    value === '::1' ||
    value.startsWith('fc') || // unique local
    value.startsWith('fd') ||
    value.startsWith('fe80') || // link-local
    value.startsWith('ff') // multicast
  );
}

export type WebhookTargetRefusal =
  | 'webhook_url_invalid'
  | 'webhook_url_not_https'
  | 'webhook_url_unresolvable'
  | 'webhook_url_private_network';

export class WebhookTargetError extends Error {
  constructor(readonly reason: WebhookTargetRefusal) {
    super(reason);
    this.name = 'WebhookTargetError';
  }
}

/**
 * Validates the URL and refuses anything that points back inside.
 *
 * HTTPS is required rather than preferred: the payload carries customer data
 * and is signed with a shared secret, and neither survives being sent in clear
 * text over someone else's network.
 *
 * Known limit, written down rather than papered over: resolving here and
 * connecting afterwards leaves a rebinding window, because Node's fetch offers
 * no way to pin the connection to the address that was checked. Closing it
 * needs a custom agent, which is the right next step if this ever leaves the
 * allowlisted-tenant gate.
 */
export async function assertPublicWebhookTarget(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookTargetError('webhook_url_invalid');
  }

  if (parsed.protocol !== 'https:') {
    throw new WebhookTargetError('webhook_url_not_https');
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new WebhookTargetError('webhook_url_unresolvable');
  }

  if (addresses.length === 0) {
    throw new WebhookTargetError('webhook_url_unresolvable');
  }
  // Every address, not the first: a hostname that resolves to one public and
  // one private address must not be reachable by retry roulette.
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new WebhookTargetError('webhook_url_private_network');
  }

  return parsed;
}
