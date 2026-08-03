const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function isAllowedProtocol(protocol: string): boolean {
  return ALLOWED_PROTOCOLS.has(protocol);
}

/**
 * Only the default port for the given protocol is allowed — a legitimate
 * pasted business URL is practically always plain http(s), and rejecting
 * non-default ports also blocks this fetcher being used to probe arbitrary
 * ports on a target host.
 */
export function isAllowedPort(protocol: string, port: string): boolean {
  const expected = protocol === 'https:' ? '443' : '80';
  const actual = port === '' ? expected : port;
  return actual === expected;
}
