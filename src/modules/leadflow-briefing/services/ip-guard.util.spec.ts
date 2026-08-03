import { isPublicIp } from './ip-guard.util';

describe('isPublicIp', () => {
  it.each([
    ['0.0.0.0'],
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['100.64.0.1'],
    ['127.0.0.1'],
    ['127.255.255.254'],
    ['169.254.169.254'], // cloud metadata endpoint
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.0.0.1'],
    ['192.0.2.1'],
    ['192.168.0.1'],
    ['192.168.255.255'],
    ['198.18.0.1'],
    ['198.51.100.1'],
    ['203.0.113.1'],
    ['224.0.0.1'],
    ['255.255.255.255'],
  ])('rejects private/reserved IPv4 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each([['8.8.8.8'], ['1.1.1.1'], ['93.184.216.34'], ['172.15.255.255'], ['172.32.0.0']])(
    'accepts public IPv4 %s',
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it.each([
    ['::1'],
    ['::'],
    ['fc00::1'],
    ['fd12:3456:789a::1'],
    ['fe80::1'],
    ['ff02::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:10.0.0.1'],
    ['::192.168.1.1'],
  ])('rejects private/reserved IPv6 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each([['2606:4700:4700::1111'], ['::ffff:8.8.8.8']])(
    'accepts public IPv6 %s',
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it('rejects malformed IPv4-looking input', () => {
    expect(isPublicIp('999.999.999.999')).toBe(false);
    expect(isPublicIp('1.2.3')).toBe(false);
  });
});
