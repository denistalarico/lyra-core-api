import { isAllowedPort, isAllowedProtocol } from './url-policy.util';

describe('isAllowedProtocol', () => {
  it('allows http and https', () => {
    expect(isAllowedProtocol('http:')).toBe(true);
    expect(isAllowedProtocol('https:')).toBe(true);
  });

  it('rejects other schemes', () => {
    expect(isAllowedProtocol('file:')).toBe(false);
    expect(isAllowedProtocol('ftp:')).toBe(false);
    expect(isAllowedProtocol('gopher:')).toBe(false);
  });
});

describe('isAllowedPort', () => {
  it('allows the implicit default port', () => {
    expect(isAllowedPort('http:', '')).toBe(true);
    expect(isAllowedPort('https:', '')).toBe(true);
  });

  it('allows an explicit matching default port', () => {
    expect(isAllowedPort('http:', '80')).toBe(true);
    expect(isAllowedPort('https:', '443')).toBe(true);
  });

  it('rejects a non-default port', () => {
    expect(isAllowedPort('http:', '8080')).toBe(false);
    expect(isAllowedPort('https:', '8443')).toBe(false);
    expect(isAllowedPort('http:', '6379')).toBe(false);
  });

  it('rejects the other protocol default port', () => {
    expect(isAllowedPort('http:', '443')).toBe(false);
    expect(isAllowedPort('https:', '80')).toBe(false);
  });
});
