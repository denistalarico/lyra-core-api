import { chooseAssignee } from './lead-distribution.strategy';

const pool = ['user-a', 'user-b', 'user-c'];

describe('chooseAssignee', () => {
  it('returns null when no one is eligible', () => {
    expect(chooseAssignee({ strategy: 'least_volume', eligible: [] })).toBeNull();
  });

  it('de-duplicates the pool before choosing', () => {
    const choice = chooseAssignee({
      strategy: 'round_robin',
      eligible: ['user-a', 'user-a', 'user-b'],
      cursorUserId: 'user-a',
    });
    expect(choice).toEqual({ userId: 'user-b', reasonCode: 'round_robin' });
  });

  describe('least_volume', () => {
    it('picks the user with the fewest open opportunities', () => {
      expect(
        chooseAssignee({
          strategy: 'least_volume',
          eligible: pool,
          loads: { 'user-a': 5, 'user-b': 2, 'user-c': 9 },
        }),
      ).toEqual({ userId: 'user-b', reasonCode: 'least_volume' });
    });

    it('treats a missing load as zero and breaks ties by pool order', () => {
      expect(
        chooseAssignee({
          strategy: 'least_volume',
          eligible: pool,
          loads: { 'user-a': 0, 'user-c': 0 },
        }),
      ).toEqual({ userId: 'user-a', reasonCode: 'least_volume' });
    });
  });

  describe('round_robin', () => {
    it('assigns the next user after the cursor', () => {
      expect(
        chooseAssignee({ strategy: 'round_robin', eligible: pool, cursorUserId: 'user-b' }),
      ).toEqual({ userId: 'user-c', reasonCode: 'round_robin' });
    });

    it('wraps around at the end of the pool', () => {
      expect(
        chooseAssignee({ strategy: 'round_robin', eligible: pool, cursorUserId: 'user-c' }),
      ).toEqual({ userId: 'user-a', reasonCode: 'round_robin' });
    });

    it('starts over when the cursor is absent or no longer eligible', () => {
      expect(
        chooseAssignee({ strategy: 'round_robin', eligible: pool, cursorUserId: null }),
      ).toEqual({ userId: 'user-a', reasonCode: 'round_robin' });
      expect(
        chooseAssignee({ strategy: 'round_robin', eligible: pool, cursorUserId: 'gone' }),
      ).toEqual({ userId: 'user-a', reasonCode: 'round_robin' });
    });
  });

  describe('by_channel', () => {
    it('routes to the mapped user when eligible', () => {
      expect(
        chooseAssignee({
          strategy: 'by_channel',
          eligible: pool,
          channelMap: { whatsapp: 'user-c' },
          source: 'whatsapp',
        }),
      ).toEqual({ userId: 'user-c', reasonCode: 'by_channel' });
    });

    it('falls back when the channel is unmapped or maps outside the pool', () => {
      expect(
        chooseAssignee({
          strategy: 'by_channel',
          eligible: pool,
          channelMap: { whatsapp: 'stranger' },
          source: 'whatsapp',
          fallbackUserId: 'user-b',
        }),
      ).toEqual({ userId: 'user-b', reasonCode: 'fallback' });
      expect(
        chooseAssignee({
          strategy: 'by_channel',
          eligible: pool,
          channelMap: {},
          source: 'email',
        }),
      ).toEqual({ userId: 'user-a', reasonCode: 'fallback' });
    });
  });

  it('ignores a fallback that is not eligible', () => {
    expect(
      chooseAssignee({
        strategy: 'by_channel',
        eligible: pool,
        source: null,
        fallbackUserId: 'stranger',
      }),
    ).toEqual({ userId: 'user-a', reasonCode: 'fallback' });
  });
});
