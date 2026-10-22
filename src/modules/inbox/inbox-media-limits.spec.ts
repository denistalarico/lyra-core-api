import { assertInboxMediaSize } from './inbox-media-limits';

describe('Inbox media limits before upload', () => {
  it.each([
    ['whatsapp', 'image', 5],
    ['whatsapp', 'audio', 16],
    ['whatsapp', 'video', 16],
    ['whatsapp', 'file', 100],
    ['instagram', 'image', 8],
    ['instagram', 'audio', 25],
    ['instagram', 'video', 25],
    ['facebook_messenger', 'image', 25],
    ['facebook_messenger', 'audio', 25],
    ['facebook_messenger', 'video', 25],
    ['facebook_messenger', 'file', 25],
  ] as const)(
    'accepts the %s/%s boundary and refuses one byte above it',
    (channel, kind, mb) => {
      const size = mb * 1024 * 1024;
      expect(
        assertInboxMediaSize(channel, kind, { size, buffer: Buffer.alloc(0) }),
      ).toBe(size);
      expect(() =>
        assertInboxMediaSize(channel, kind, {
          size: size + 1,
          buffer: Buffer.alloc(0),
        }),
      ).toThrow(`O arquivo excede o limite de ${mb} MB`);
    },
  );

  it('checks the actual bytes as well as the descriptor', () => {
    expect(() =>
      assertInboxMediaSize('whatsapp', 'image', {
        size: 1,
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).toThrow('5 MB');
  });
});
