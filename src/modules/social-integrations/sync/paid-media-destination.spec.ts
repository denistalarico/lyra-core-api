import { resolvePaidMediaDestination } from './paid-media-destination';

describe('resolvePaidMediaDestination', () => {
  describe('observed messaging destinations', () => {
    /**
     * The three single-app cases, which are the whole point of the slice: at
     * ad-set level these are the only fields that separate a WhatsApp lead from
     * an Instagram Direct one.
     */
    it.each([
      ['WHATSAPP', 'whatsapp'],
      ['INSTAGRAM_DIRECT', 'instagram_direct'],
      ['MESSENGER', 'messenger'],
    ])('resolves %s to %s', (providerValue, canonical) => {
      expect(
        resolvePaidMediaDestination({ destination_type: providerValue }),
      ).toEqual({ canonical, providerValue, resolution: 'observed' });
    });

    /**
     * Meta's multi-app destinations do not name one app, so neither does the
     * canonical value. Folding these into `whatsapp` would assert the very
     * thing the ad set leaves open.
     */
    it.each([
      'MESSAGING_INSTAGRAM_DIRECT_MESSENGER',
      'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP',
    ])('keeps %s as an undecided messaging destination', (providerValue) => {
      const resolved = resolvePaidMediaDestination({
        destination_type: providerValue,
      });

      expect(resolved.canonical).toBe('messaging_multi');
      expect(resolved.resolution).toBe('observed');
      // The specific apps on offer are not lost — they are in the raw value.
      expect(resolved.providerValue).toBe(providerValue);
    });
  });

  describe('other observed destinations', () => {
    it.each([
      ['WEBSITE', 'website'],
      ['INSTAGRAM_PROFILE', 'profile'],
      ['INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE', 'profile'],
      ['ON_POST', 'on_post'],
      ['ON_VIDEO', 'on_post'],
      ['ON_PAGE', 'profile'],
    ])('resolves %s to %s', (providerValue, canonical) => {
      expect(
        resolvePaidMediaDestination({ destination_type: providerValue }),
      ).toMatchObject({ canonical, resolution: 'observed' });
    });
  });

  describe('when the destination is not stated', () => {
    it('treats a missing field as unknown rather than guessing', () => {
      expect(resolvePaidMediaDestination({})).toEqual({
        canonical: 'unknown',
        providerValue: null,
        resolution: 'unavailable',
      });
    });

    it.each([[''], ['   '], [null], [undefined], [42], [{}]])(
      'treats %p as unknown',
      (destination_type) => {
        expect(resolvePaidMediaDestination({ destination_type })).toMatchObject(
          { canonical: 'unknown', resolution: 'unavailable' },
        );
      },
    );

    /**
     * `UNDEFINED` is a value Meta sends deliberately (11 of 126 ad sets in the
     * account this was built against). It resolves like an absent field, but
     * the string survives so the two remain distinguishable in the data.
     */
    it('keeps Meta UNDEFINED distinguishable from an absent field', () => {
      const explicit = resolvePaidMediaDestination({
        destination_type: 'UNDEFINED',
      });
      const absent = resolvePaidMediaDestination({});

      expect(explicit).toEqual({
        canonical: 'unknown',
        providerValue: 'UNDEFINED',
        resolution: 'unavailable',
      });
      expect(explicit.canonical).toBe(absent.canonical);
      expect(explicit.providerValue).not.toBe(absent.providerValue);
    });

    /**
     * The forward-compatibility rule. Meta ships new destination values without
     * notice, and the sync must survive one — the row's spend and reach are
     * still correct, only the destination is unmapped.
     */
    it('survives a destination Meta has not shipped yet', () => {
      const resolved = resolvePaidMediaDestination({
        destination_type: 'THREADS_DIRECT_MESSAGE',
      });

      expect(resolved).toEqual({
        canonical: 'unknown',
        // Preserved, so a corrected mapping can be re-derived from stored rows
        // rather than from a re-sync.
        providerValue: 'THREADS_DIRECT_MESSAGE',
        resolution: 'unavailable',
      });
    });
  });

  describe('signals that must not resolve a destination', () => {
    /**
     * The empirical core of the contract. In the production account,
     * `CONVERSATIONS` resolves to WHATSAPP 35 times, to a multi-app messaging
     * destination 6 times, to MESSENGER once and to INSTAGRAM_DIRECT once. It
     * is a bidding goal, not a place.
     */
    it('does not resolve a destination from optimization_goal alone', () => {
      expect(
        resolvePaidMediaDestination({ optimization_goal: 'CONVERSATIONS' }),
      ).toMatchObject({ canonical: 'unknown', resolution: 'unavailable' });
    });

    it('does not resolve a destination from objective alone', () => {
      expect(
        resolvePaidMediaDestination({
          objective: 'OUTCOME_ENGAGEMENT',
          billing_event: 'IMPRESSIONS',
        }),
      ).toMatchObject({ canonical: 'unknown', resolution: 'unavailable' });
    });

    /**
     * Names are advertiser prose. They stay unchanged in the report long after
     * the ad set has been pointed somewhere else, which is exactly when the
     * inference would be most confidently wrong.
     */
    it('does not infer a destination from the ad set or campaign name', () => {
      expect(
        resolvePaidMediaDestination({
          name: 'Campanha WhatsApp - Agosto',
          campaign_name: 'WhatsApp Leads',
        }),
      ).toMatchObject({ canonical: 'unknown', resolution: 'unavailable' });
    });

    it('does not infer a destination from promoted_object', () => {
      // A page id says which Page is promoted, not where the person ends up:
      // the same page_id appears on WhatsApp, Messenger and multi-app ad sets.
      expect(
        resolvePaidMediaDestination({
          promoted_object: { page_id: '102388249332602' },
        }),
      ).toMatchObject({ canonical: 'unknown', resolution: 'unavailable' });
    });

    it('lets the stated destination win over every surrounding signal', () => {
      expect(
        resolvePaidMediaDestination({
          destination_type: 'INSTAGRAM_DIRECT',
          optimization_goal: 'CONVERSATIONS',
          name: 'WhatsApp campaign',
          objective: 'OUTCOME_SALES',
        }),
      ).toMatchObject({ canonical: 'instagram_direct' });
    });
  });

  it('is case-insensitive about the provider value but stores it verbatim', () => {
    const resolved = resolvePaidMediaDestination({
      destination_type: 'whatsapp',
    });

    expect(resolved.canonical).toBe('whatsapp');
    expect(resolved.providerValue).toBe('whatsapp');
  });
});
