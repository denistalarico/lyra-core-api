import {
  META_CONVERSION_CATALOG,
  conversionTypesClaimedByFamilies,
  findConversionDefinition,
  readConversion,
  type MetaConversionDefinition,
} from './meta-conversion-catalog';
import {
  META_ACTION_MAPPING_VERSION,
  deriveActionFacts,
  type MetaActionBreakdown,
} from '../sync/meta-action-mapping';

const breakdown = (
  counts: Record<string, string>,
  values: Record<string, string> = {},
): MetaActionBreakdown => ({ counts, values });

const find = (id: string): MetaConversionDefinition => {
  const definition = findConversionDefinition(id);

  if (!definition) throw new Error(`missing catalog entry: ${id}`);

  return definition;
};

describe('meta conversion catalog', () => {
  describe('structure', () => {
    it('gives every entry a unique id', () => {
      const ids = META_CONVERSION_CATALOG.map((one) => one.id);

      expect(new Set(ids).size).toBe(ids.length);
    });

    /**
     * The failure this whole structure exists to prevent, restated as a test.
     * A type in two entries would be counted once under each, and both numbers
     * would look individually correct.
     */
    it('never lets two entries claim the same action type', () => {
      const seen = new Map<string, string>();

      for (const entry of META_CONVERSION_CATALOG) {
        for (const type of entry.types) {
          const owner = seen.get(type);

          expect(owner ?? entry.id).toBe(entry.id);

          seen.set(type, entry.id);
        }
      }
    });

    it('gives every entry at least one alias', () => {
      for (const entry of META_CONVERSION_CATALOG) {
        expect(entry.types.length).toBeGreaterThan(0);
      }
    });

    /**
     * Purchase is the one event that is both a family and a catalog entry, and
     * that overlap is deliberate — the family feeds ROAS, the entry exposes the
     * count on its own. Any *other* overlap means a type feeding a promoted
     * column is also being presented as a standalone conversion, which would
     * let one report show the same event twice under two names.
     */
    it('overlaps the action families only on purchase', () => {
      expect(conversionTypesClaimedByFamilies()).toEqual([
        'offsite_conversion.fb_pixel_purchase',
        'omni_purchase',
        'purchase',
      ]);
    });

    /**
     * Messaging conversations have their own column and their own rules about
     * never being summed with leads. A messaging type reaching this catalog
     * would route around all of that.
     */
    it('catalogues no messaging action type', () => {
      for (const entry of META_CONVERSION_CATALOG) {
        for (const type of entry.types) {
          expect(type).not.toContain('messaging');
        }
      }
    });

    /**
     * Nothing here has been seen on a real account, because no connected
     * account has ever had a pixel. When one does, flipping a flag should be a
     * deliberate act with a measurement behind it — so this test is expected to
     * be edited, not to quietly keep passing.
     */
    it('marks every entry unverified until an account reports one', () => {
      for (const entry of META_CONVERSION_CATALOG) {
        expect(entry.verified).toBe(false);
      }
    });
  });

  describe('reading a conversion', () => {
    it('answers null for an event no alias reported', () => {
      expect(readConversion(breakdown({}), find('add_to_cart'))).toEqual({
        count: null,
        value: null,
      });
    });

    /**
     * The alias rule, and the reason it is ordered. Three names for one sale
     * summed would report three.
     */
    it('takes the first alias present and ignores the rest', () => {
      const facts = readConversion(
        breakdown({
          purchase: '4.000000',
          omni_purchase: '4.000000',
          'offsite_conversion.fb_pixel_purchase': '4.000000',
        }),
        find('purchase'),
      );

      expect(facts.count).toBe('4');
    });

    it('falls through to a later alias when the canonical one is absent', () => {
      const facts = readConversion(
        breakdown({ 'offsite_conversion.fb_pixel_add_to_cart': '9.000000' }),
        find('add_to_cart'),
      );

      expect(facts.count).toBe('9');
    });

    /**
     * Truncated, not rounded — the same rule `leads` follows. Half a purchase
     * from an attribution split is not a purchase.
     */
    it('truncates a fractional count rather than rounding it up', () => {
      const facts = readConversion(
        breakdown({ purchase: '1.800000' }),
        find('purchase'),
      );

      expect(facts.count).toBe('1');
    });

    it('reads value independently of which alias supplied the count', () => {
      const facts = readConversion(
        breakdown({ purchase: '2.000000' }, { omni_purchase: '150.000000' }),
        find('purchase'),
      );

      expect(facts).toEqual({ count: '2', value: '150.000000' });
    });

    /**
     * A non-monetary event has no value even when Meta sends one. Reporting it
     * would invent revenue for an add-to-payment-info.
     */
    it('refuses a value for a non-monetary event', () => {
      const facts = readConversion(
        breakdown({ search: '5.000000' }, { search: '99.000000' }),
        find('search'),
      );

      expect(facts).toEqual({ count: '5', value: null });
    });

    it('answers a count with no value when the event carried none', () => {
      const facts = readConversion(
        breakdown({ purchase: '3.000000' }),
        find('purchase'),
      );

      expect(facts).toEqual({ count: '3', value: null });
    });
  });

  describe('independence from the promoted columns', () => {
    /**
     * The claim that lets this ship without a mapping version bump, asserted
     * rather than argued: a payload full of catalogued events must leave every
     * promoted column exactly as an empty payload does. If a catalogue entry
     * ever starts feeding one of these, this fails.
     */
    it('changes no promoted column for any catalogued event', () => {
      const counts: Record<string, string> = {};

      for (const entry of META_CONVERSION_CATALOG) {
        // Skip purchase: it is a family by design, and the family is what ROAS
        // divides. Every other entry must be inert.
        if (entry.id === 'purchase') continue;

        for (const type of entry.types) counts[type] = '7.000000';
      }

      const facts = deriveActionFacts(breakdown(counts));

      expect(facts).toEqual({
        leads: '0',
        conversions: '0.000000',
        conversionValue: '0.000000',
        videoViews: '0',
        messagingConversations: null,
      });
    });

    it('stays on mapping version 1', () => {
      // Not a version assertion for its own sake: the catalog is only safe to
      // add to without a bump while the test above holds, and this pins the
      // pair together so a future bump is a deliberate edit of both.
      expect(META_ACTION_MAPPING_VERSION).toBe(1);
    });
  });
});
