/**
 * SSRF guard: decides whether a resolved IP address is safe to connect to
 * from the server. Used to reject private/loopback/link-local/reserved
 * ranges before (and after DNS-pinning, instead of) connecting to a
 * user-supplied URL — see ssrf-safe-url-fetcher.service.ts.
 */

const IPV4_PRIVATE_RANGES: Array<[number, number]> = [
  [ipToInt('0.0.0.0'), ipToInt('0.255.255.255')], // "this" network
  [ipToInt('10.0.0.0'), ipToInt('10.255.255.255')], // RFC1918
  [ipToInt('100.64.0.0'), ipToInt('100.127.255.255')], // CGNAT
  [ipToInt('127.0.0.0'), ipToInt('127.255.255.255')], // loopback
  [ipToInt('169.254.0.0'), ipToInt('169.254.255.255')], // link-local
  [ipToInt('172.16.0.0'), ipToInt('172.31.255.255')], // RFC1918
  [ipToInt('192.0.0.0'), ipToInt('192.0.0.255')], // IETF protocol assignments
  [ipToInt('192.0.2.0'), ipToInt('192.0.2.255')], // TEST-NET-1
  [ipToInt('192.168.0.0'), ipToInt('192.168.255.255')], // RFC1918
  [ipToInt('198.18.0.0'), ipToInt('198.19.255.255')], // benchmarking
  [ipToInt('198.51.100.0'), ipToInt('198.51.100.255')], // TEST-NET-2
  [ipToInt('203.0.113.0'), ipToInt('203.0.113.255')], // TEST-NET-3
  [ipToInt('224.0.0.0'), ipToInt('255.255.255.255')], // multicast + reserved
];

function ipToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part));
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isPublicIpv4(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const value = ipToInt(ip);
  return !IPV4_PRIVATE_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isPublicIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === '::1' || normalized === '::') return false;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses
  // must be checked against the IPv4 rules, not treated as "some IPv6 address".
  const mappedMatch = normalized.match(
    /^::(ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (mappedMatch) return isPublicIpv4(mappedMatch[2]);

  // Unique local addresses (fc00::/7)
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return false;

  // Link-local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return false;

  // Multicast (ff00::/8)
  if (normalized.startsWith('ff')) return false;

  return true;
}

export function isPublicIp(ip: string): boolean {
  if (ip.includes(':')) return isPublicIpv6(ip);
  return isPublicIpv4(ip);
}
