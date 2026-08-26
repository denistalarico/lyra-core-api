import {
  META_ACTION_FAMILIES,
  META_ACTION_MAPPING_VERSION,
  UNCOUNTED_MESSAGING_ACTION_TYPES,
  VIDEO_VIEW_ACTION_TYPE,
  deriveActionFacts,
  readActionMap,
} from './meta-action-mapping';

/**
 * The exact `actions` array Meta returned for 2026-07-10 on the internal
 * account, trimmed to the types that matter. Four leads happened that day.
 */
const REAL_LEAD_DAY = [
  { action_type: 'post_engagement', value: '61' },
  { action_type: 'page_engagement', value: '61' },
  { action_type: 'video_view', value: '72' },
  { action_type: 'link_click', value: '3' },
  { action_type: 'lead', value: '2' },
  { action_type: 'onsite_conversion.lead', value: '2' },
  { action_type: 'onsite_web_lead', value: '2' },
  { action_type: 'onsite_conversion.lead_grouped', value: '2' },
  { action_type: 'offsite_complete_registration_add_meta_leads', value: '2' },
  { action_type: 'offsite_search_add_meta_leads', value: '2' },
  { action_type: 'offsite_content_view_add_meta_leads', value: '2' },
  {
    action_type: 'onsite_conversion.messaging_conversation_started_7d',
    value: '1',
  },
  { action_type: 'onsite_conversion.messaging_first_reply', value: '1' },
];

describe('meta action mapping — version', () => {
  it('is the version this codebase claims to implement', () => {
    // Bump it when a change makes the promoted columns come out differently for
    // the same input; this assertion is the reminder that stored rows carry it.
    expect(META_ACTION_MAPPING_VERSION).toBe(1);
  });

  it('describes exactly the families that version 1 counts', () => {
    // If this list changes, rows written before the change mean something
    // different from rows written after, and the version must move with it.
    expect(
      META_ACTION_FAMILIES.filter((family) => family.countsAsConversion).map(
        (family) => family.key,
      ),
    ).toEqual(['lead', 'purchase', 'complete_registration']);
  });
});

describe('meta action mapping — structure', () => {
  it('never lets one action type belong to two families', () => {
    const seen = new Map<string, string>();

    for (const family of META_ACTION_FAMILIES) {
      for (const type of family.types) {
        expect(seen.has(type)).toBe(false);
        seen.set(type, family.key);
      }
    }
  });

  // The lead family exists to absorb every alias Meta uses for a submission.
  // A messaging type landing in it would restore the double count it prevents.
  it('keeps the uncounted messaging types out of every family', () => {
    const claimed = META_ACTION_FAMILIES.flatMap((family) => family.types);

    for (const type of UNCOUNTED_MESSAGING_ACTION_TYPES) {
      expect(claimed).not.toContain(type);
    }
  });

  it('keeps the video view type out of every family, since it is not an outcome', () => {
    const claimed = META_ACTION_FAMILIES.flatMap((family) => family.types);

    expect(claimed).not.toContain(VIDEO_VIEW_ACTION_TYPE);
  });
});

describe('readActionMap', () => {
  it('keeps every reported type, including ones no family claims', () => {
    const map = readActionMap(REAL_LEAD_DAY);

    // The whole point of the column: a mapping change tomorrow must not need a
    // refetch, which only holds if what Meta said is still there in full.
    expect(Object.keys(map)).toHaveLength(REAL_LEAD_DAY.length);
    expect(map['onsite_conversion.messaging_first_reply']).toBe('1.000000');
    expect(map.some_future_action_type).toBeUndefined();
  });

  it('keeps a type nothing in this codebase knows about', () => {
    const map = readActionMap([
      { action_type: 'omni_view_content_2027', value: '9' },
    ]);

    expect(map.omni_view_content_2027).toBe('9.000000');
  });

  it('drops an entry whose value cannot be read, rather than storing a zero', () => {
    const map = readActionMap([
      { action_type: 'lead', value: 'three' },
      { action_type: 'purchase', value: '-1' },
      { action_type: '', value: '1' },
      { action_type: 'link_click', value: '4' },
    ]);

    expect(map).toEqual({ link_click: '4.000000' });
  });

  it('answers an empty map for a missing or malformed array', () => {
    expect(readActionMap(undefined)).toEqual({});
    expect(readActionMap('actions')).toEqual({});
    expect(readActionMap([null, 7])).toEqual({});
  });
});

describe('deriveActionFacts', () => {
  it('counts the real lead day once, not seven times', () => {
    const facts = deriveActionFacts({
      counts: readActionMap(REAL_LEAD_DAY),
      values: {},
    });

    // Meta reported the same two leads under seven names. Summing the array
    // would give fourteen.
    expect(facts.leads).toBe('2');
    expect(facts.conversions).toBe('2.000000');
  });

  it('leaves messaging conversations out of conversions', () => {
    const facts = deriveActionFacts({
      counts: readActionMap(REAL_LEAD_DAY),
      values: {},
    });

    // One conversation started on the same day as two leads. Adding it would
    // count a person who messaged and became a lead twice.
    expect(facts.conversions).toBe('2.000000');
  });

  it('makes leads a subset of conversions, never a sibling', () => {
    const facts = deriveActionFacts({
      counts: readActionMap([
        { action_type: 'lead', value: '4' },
        { action_type: 'purchase', value: '1' },
      ]),
      values: {},
    });

    // The lead family is one of the families `conversions` sums, so the four
    // leads are inside the five. `leads + conversions` is double counting with
    // extra steps — an inviting mistake, because the columns sit side by side.
    expect(facts.leads).toBe('4');
    expect(facts.conversions).toBe('5.000000');
    expect(Number(facts.conversions)).toBeGreaterThanOrEqual(
      Number(facts.leads),
    );
  });

  it('counts a lead reported only under a non-canonical alias', () => {
    const facts = deriveActionFacts({
      counts: readActionMap([
        { action_type: 'onsite_conversion.lead_grouped', value: '5' },
      ]),
      values: {},
    });

    expect(facts.leads).toBe('5');
  });

  it('adds distinct families, since a purchase and a lead are different events', () => {
    const facts = deriveActionFacts({
      counts: readActionMap([
        { action_type: 'lead', value: '2' },
        { action_type: 'purchase', value: '3' },
        { action_type: 'omni_purchase', value: '3' },
      ]),
      values: {},
    });

    expect(facts.leads).toBe('2');
    // 2 leads + 3 purchases; `omni_purchase` is the same purchase under another
    // name and contributes nothing.
    expect(facts.conversions).toBe('5.000000');
  });

  it('takes conversion value only from types a family counts', () => {
    const facts = deriveActionFacts({
      counts: readActionMap([{ action_type: 'purchase', value: '2' }]),
      values: readActionMap([
        { action_type: 'purchase', value: '250.50' },
        // Engagement carries no revenue; a summed total including it would be
        // an invented number.
        { action_type: 'post_engagement', value: '999' },
        { action_type: 'onsite_conversion.messaging_first_reply', value: '10' },
      ]),
    });

    expect(facts.conversionValue).toBe('250.500000');
  });

  it('takes a value attached to a different alias than the count', () => {
    const facts = deriveActionFacts({
      counts: readActionMap([{ action_type: 'lead', value: '4' }]),
      values: readActionMap([
        { action_type: 'onsite_conversion.lead_grouped', value: '80.00' },
      ]),
    });

    // Meta attaches value to whichever alias its optimization used. Demanding
    // the same name would zero the revenue of a value-optimized campaign.
    expect(facts.conversionValue).toBe('80.000000');
  });

  it('reads video views from the 3-second play action', () => {
    const facts = deriveActionFacts({
      counts: readActionMap(REAL_LEAD_DAY),
      values: {},
    });

    expect(facts.videoViews).toBe('72');
  });

  it('answers zeros for a row with no actions at all', () => {
    const facts = deriveActionFacts({ counts: {}, values: {} });

    expect(facts).toEqual({
      leads: '0',
      conversions: '0.000000',
      conversionValue: '0.000000',
      videoViews: '0',
    });
  });

  it('truncates a fractional lead rather than rounding one into existence', () => {
    const facts = deriveActionFacts({
      counts: readActionMap([{ action_type: 'lead', value: '1.75' }]),
      values: {},
    });

    // The column counts submissions. Attribution splitting can make the value
    // fractional; it cannot make it two leads.
    expect(facts.leads).toBe('1');
    expect(facts.conversions).toBe('1.750000');
  });
});
