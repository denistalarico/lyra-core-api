import {
  META_ACTION_TYPE_GROUPS,
  findActionTypeGroup,
  findActionTypeLabel,
  isGroupedActionType,
  readActionGroup,
} from './meta-action-type-catalog';
import {
  META_ACTION_FAMILIES,
  META_ACTION_MAPPING_VERSION,
  deriveActionFacts,
  type MetaActionBreakdown,
} from '../sync/meta-action-mapping';

const breakdown = (counts: Record<string, string>): MetaActionBreakdown => ({
  counts,
  values: {},
});

describe('meta action type catalog', () => {
  describe('structure', () => {
    it('never lets two groups claim the same type', () => {
      const seen = new Map<string, string>();

      for (const group of META_ACTION_TYPE_GROUPS) {
        for (const type of [group.canonical, ...group.aliases]) {
          const owner = seen.get(type);

          expect(owner ?? group.canonical).toBe(group.canonical);

          seen.set(type, group.canonical);
        }
      }
    });

    it('never lists a canonical type among its own aliases', () => {
      for (const group of META_ACTION_TYPE_GROUPS) {
        expect(group.aliases).not.toContain(group.canonical);
      }
    });

    it('gives every group a label and at least one alias', () => {
      for (const group of META_ACTION_TYPE_GROUPS) {
        // A group with no alias collapses nothing and should be a standalone
        // label instead — the structure would claim an overlap that is not
        // there, and the row would name absorbed types that do not exist.
        expect(group.aliases.length).toBeGreaterThan(0);
        expect(group.label.length).toBeGreaterThan(0);
      }
    });

    /**
     * The table must not contradict the KPI cards above it. The lead group is
     * the same set of names the lead family counts, so if one list grows and
     * the other does not, one screen reports two different lead counts.
     */
    it('groups leads exactly as the lead family does', () => {
      const family = META_ACTION_FAMILIES.find((one) => one.key === 'lead');
      const group = findActionTypeGroup('lead');

      expect(family).toBeDefined();
      expect(group).not.toBeNull();

      const inGroup = [group!.canonical, ...group!.aliases].sort();

      expect(inGroup).toEqual([...family!.types].sort());
    });

    /**
     * The conversations row must agree with the promoted column, which uses the
     * `_7d` type rather than the larger `total_messaging_connection`.
     */
    it('makes the Ads Manager messaging type the canonical one', () => {
      const group = findActionTypeGroup(
        'onsite_conversion.total_messaging_connection',
      );

      expect(group?.canonical).toBe(
        'onsite_conversion.messaging_conversation_started_7d',
      );
    });
  });

  describe('collapsing a group', () => {
    /**
     * The double count this file exists to prevent, as measured in production:
     * both names reported 1 036, and the honest answer is 1 036.
     */
    it('answers the shared total once when two names report the same event', () => {
      const total = readActionGroup(
        breakdown({
          page_engagement: '1036.000000',
          post_engagement: '1036.000000',
        }),
        findActionTypeGroup('page_engagement')!,
      );

      expect(total).toBe('1036');
    });

    /**
     * Not the first present, and not the sum. 12 and 11 are two counts of one
     * overlapping thing; the fuller one is the better answer and 23 is a
     * fiction.
     */
    it('takes the largest member when two names disagree', () => {
      const total = readActionGroup(
        breakdown({
          'onsite_conversion.messaging_conversation_started_7d': '11.000000',
          'onsite_conversion.total_messaging_connection': '12.000000',
        }),
        findActionTypeGroup(
          'onsite_conversion.messaging_conversation_started_7d',
        )!,
      );

      expect(total).toBe('12');
    });

    it('answers from an alias when the canonical name is absent', () => {
      const total = readActionGroup(
        breakdown({ post_engagement: '40.000000' }),
        findActionTypeGroup('page_engagement')!,
      );

      expect(total).toBe('40');
    });

    it('answers null when no member appeared', () => {
      expect(
        readActionGroup(breakdown({}), findActionTypeGroup('lead')!),
      ).toBeNull();
    });

    /** Truncated, like every other count in this module. */
    it('truncates a fractional count rather than rounding it', () => {
      const total = readActionGroup(
        breakdown({ lead: '4.800000' }),
        findActionTypeGroup('lead')!,
      );

      expect(total).toBe('4');
    });

    /**
     * Four names for four leads is four, not sixteen — the exact shape of the
     * production payload.
     */
    it('reports one lead count for the four names Meta sends', () => {
      const total = readActionGroup(
        breakdown({
          lead: '4.000000',
          'onsite_conversion.lead': '4.000000',
          'onsite_conversion.lead_grouped': '4.000000',
          onsite_web_lead: '4.000000',
        }),
        findActionTypeGroup('lead')!,
      );

      expect(total).toBe('4');
    });
  });

  describe('labels', () => {
    it('labels a grouped type by its group', () => {
      expect(findActionTypeLabel('post_engagement')).toBe(
        'Envolvimento com a publicação',
      );
    });

    it('labels a standalone type', () => {
      expect(findActionTypeLabel('video_view')).toBe(
        'Visualizações do vídeo (3s)',
      );
    });

    /**
     * An unknown type has no invented label. The table shows the raw name so it
     * can be looked up against Meta's documentation.
     */
    it('answers null for a type it has never seen', () => {
      expect(findActionTypeLabel('some_future_meta_type')).toBeNull();
    });

    it('knows which types a group claims', () => {
      expect(isGroupedActionType('onsite_web_lead')).toBe(true);
      expect(isGroupedActionType('video_view')).toBe(false);
    });
  });

  describe('independence from the promoted columns', () => {
    /**
     * Same guarantee the conversion catalog carries, and the reason the mapping
     * version is untouched: grouping is a read-time presentation choice, so a
     * payload of grouped types must leave every promoted column exactly as the
     * families decide. The lead group is skipped because leads legitimately
     * feed `leads` — that is the family's job, not this catalog's.
     */
    it('changes no promoted column by grouping', () => {
      const counts: Record<string, string> = {};

      for (const group of META_ACTION_TYPE_GROUPS) {
        if (group.canonical === 'lead') continue;

        for (const type of [group.canonical, ...group.aliases]) {
          counts[type] = '5.000000';
        }
      }

      const facts = deriveActionFacts(breakdown(counts));

      expect(facts.leads).toBe('0');
      expect(facts.conversions).toBe('0.000000');
      expect(facts.conversionValue).toBe('0.000000');
    });

    it('stays on mapping version 1', () => {
      expect(META_ACTION_MAPPING_VERSION).toBe(1);
    });
  });
});
