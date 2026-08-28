import {
  hasAttributionIdentifier,
  readAttributionObservation,
} from './inbound-attribution-observation';

describe('inbound attribution observation contract', () => {
  describe('readAttributionObservation', () => {
    it('reads the identifiers the WhatsApp adapter normalizes', () => {
      expect(
        readAttributionObservation({
          referral: {
            adId: '120210000000000000',
            clickId: 'ARAaBbCcDd_ctwa_clid',
            sourceType: 'ad',
          },
        }),
      ).toEqual({
        adId: '120210000000000000',
        clickId: 'ARAaBbCcDd_ctwa_clid',
        sourceType: 'ad',
      });
    });

    it('returns null when the provider sent no referral at all', () => {
      expect(readAttributionObservation({ phoneNumberId: '123' })).toBeNull();
      expect(readAttributionObservation(undefined)).toBeNull();
      expect(readAttributionObservation({ referral: null })).toBeNull();
    });

    // Meta genuinely sends this: a referral block whose ids are absent. A row
    // built from it would assert "an ad, somewhere", which is not an
    // observation of anything.
    it('returns null for a referral that identifies nothing', () => {
      expect(
        readAttributionObservation({
          referral: { sourceType: 'ad', adId: null, clickId: null },
        }),
      ).toBeNull();
    });

    it('keeps an organic-surface referral that has only a click id', () => {
      expect(
        readAttributionObservation({
          referral: { adId: null, clickId: 'clid-only', sourceType: 'post' },
        }),
      ).toEqual({ adId: null, clickId: 'clid-only', sourceType: 'post' });
    });

    it('ignores non-string identifiers rather than coercing them', () => {
      expect(
        readAttributionObservation({
          referral: { adId: 12021, clickId: { nested: true }, sourceType: [] },
        }),
      ).toBeNull();
    });

    // The column is varchar(180). Truncating would produce an id that looks
    // valid and joins to nothing.
    it('rejects an identifier longer than the column', () => {
      expect(
        readAttributionObservation({
          referral: { adId: 'x'.repeat(181), clickId: null },
        }),
      ).toBeNull();

      expect(
        readAttributionObservation({
          referral: { adId: 'x'.repeat(180), clickId: null },
        }),
      ).toEqual({ adId: 'x'.repeat(180), clickId: null, sourceType: null });
    });

    it('treats an array as an absent referral', () => {
      expect(readAttributionObservation({ referral: [] })).toBeNull();
    });
  });

  describe('hasAttributionIdentifier', () => {
    it('requires at least one identifier', () => {
      expect(hasAttributionIdentifier({ adId: 'a' })).toBe(true);
      expect(hasAttributionIdentifier({ clickId: 'c' })).toBe(true);
      expect(hasAttributionIdentifier({ sourceType: 'ad' })).toBe(false);
      expect(hasAttributionIdentifier(null)).toBe(false);
    });
  });
});
