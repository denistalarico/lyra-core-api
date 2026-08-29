import {
  DESTINATION_INTERVALS_SQL,
  DESTINATION_OBSERVATION_CADENCE_HOURS,
  destinationOnDay,
  summarizeDestinationCoverage,
  type DestinationObservationInterval,
} from './social-ad-destination-timeline';

const interval = (
  overrides: Partial<DestinationObservationInterval> = {},
): DestinationObservationInterval => ({
  adEntityId: 'adset-1',
  observedDestination: 'whatsapp',
  observedRaw: 'WHATSAPP',
  observedFrom: '2026-08-10',
  observedUntil: null,
  ...overrides,
});

describe('destination timeline', () => {
  describe('before the first observation', () => {
    /**
     * The single most important behaviour here. Back-projecting the first
     * observation over earlier days would attribute months of spend to a
     * destination that was only ever confirmed once, at the end of the period.
     */
    it('is unknown, and never the earliest destination later seen', () => {
      const intervals = [interval({ observedFrom: '2026-08-10' })];

      expect(destinationOnDay(intervals, 'adset-1', '2026-08-09')).toBeNull();
      expect(destinationOnDay(intervals, 'adset-1', '2026-08-01')).toBeNull();
      // And the day itself is known.
      expect(destinationOnDay(intervals, 'adset-1', '2026-08-10')).toBe(
        'whatsapp',
      );
    });

    it('is unknown for an ad set with no observations at all', () => {
      expect(destinationOnDay([interval()], 'adset-other', '2026-08-15')).toBe(
        null,
      );
    });
  });

  describe('an observed transition', () => {
    const intervals = [
      interval({
        observedDestination: 'whatsapp',
        observedFrom: '2026-08-01',
        observedUntil: '2026-08-15',
      }),
      interval({
        observedDestination: 'instagram_direct',
        observedRaw: 'INSTAGRAM_DIRECT',
        observedFrom: '2026-08-15',
        observedUntil: null,
      }),
    ];

    it('holds the previous value up to the day of the next observation', () => {
      expect(destinationOnDay(intervals, 'adset-1', '2026-08-14')).toBe(
        'whatsapp',
      );
    });

    /**
     * Half-open, so the boundary day belongs to the newer observation and to
     * exactly one interval. Inclusive-on-both-ends would double count the
     * boundary day into two destinations.
     */
    it('switches on the observation day itself, and only once', () => {
      expect(destinationOnDay(intervals, 'adset-1', '2026-08-15')).toBe(
        'instagram_direct',
      );

      const matching = intervals.filter(
        (item) =>
          '2026-08-15' >= item.observedFrom &&
          (item.observedUntil === null || '2026-08-15' < item.observedUntil),
      );
      expect(matching).toHaveLength(1);
    });

    it('keeps the newest value open-ended', () => {
      expect(destinationOnDay(intervals, 'adset-1', '2026-12-31')).toBe(
        'instagram_direct',
      );
    });

    /**
     * whatsapp → instagram_direct → whatsapp. The third leg is a real event and
     * must resolve to its own interval rather than being folded into the first.
     */
    it('resolves a return to a previous destination', () => {
      const returning = [
        ...intervals.slice(0, 1),
        interval({
          observedDestination: 'instagram_direct',
          observedFrom: '2026-08-15',
          observedUntil: '2026-08-20',
        }),
        interval({ observedFrom: '2026-08-20', observedUntil: null }),
      ];

      expect(destinationOnDay(returning, 'adset-1', '2026-08-19')).toBe(
        'instagram_direct',
      );
      expect(destinationOnDay(returning, 'adset-1', '2026-08-20')).toBe(
        'whatsapp',
      );
    });
  });

  describe('the buckets it carries', () => {
    it.each([
      'whatsapp',
      'instagram_direct',
      'messenger',
      'messaging_multi',
      'unknown',
    ])('resolves %s temporally without reinterpreting it', (destination) => {
      const intervals = [interval({ observedDestination: destination })];

      expect(destinationOnDay(intervals, 'adset-1', '2026-08-11')).toBe(
        destination,
      );
    });

    /**
     * `unknown` from an explicit provider `UNDEFINED` is an observed state, and
     * resolving it must not collapse into the same null as "never observed" —
     * the two are different facts and the coverage numbers depend on it.
     */
    it('distinguishes an observed unknown from no observation', () => {
      const observed = [
        interval({ observedDestination: 'unknown', observedRaw: 'UNDEFINED' }),
      ];

      expect(destinationOnDay(observed, 'adset-1', '2026-08-11')).toBe(
        'unknown',
      );
      expect(destinationOnDay(observed, 'adset-1', '2026-08-09')).toBeNull();
    });
  });

  describe('coverage', () => {
    const days = ['2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11'];

    it('counts only days an observation was in force', () => {
      const coverage = summarizeDestinationCoverage({
        intervals: [interval({ observedFrom: '2026-08-10' })],
        days,
        firstObservedAt: '2026-08-10T09:00:00.000Z',
        lastObservedAt: '2026-08-10T09:00:00.000Z',
      });

      expect(coverage.expectedDays).toBe(4);
      expect(coverage.coveredDays).toBe(2);
      expect(coverage.unknownDays).toBe(2);
    });

    it('reports no coverage at all when nothing was ever observed', () => {
      const coverage = summarizeDestinationCoverage({
        intervals: [],
        days,
        firstObservedAt: null,
        lastObservedAt: null,
      });

      expect(coverage.coveredDays).toBe(0);
      expect(coverage.unknownDays).toBe(4);
      expect(coverage.firstObservedAt).toBeNull();
    });

    /**
     * The uncertainty the brief insists must survive into the output: the sweep
     * is daily, so no reader may treat an observation instant as the moment of
     * change.
     */
    it('states the observation cadence rather than implying hourly precision', () => {
      const coverage = summarizeDestinationCoverage({
        intervals: [interval()],
        days,
        firstObservedAt: '2026-08-10T09:13:44.000Z',
        lastObservedAt: '2026-08-11T09:14:02.000Z',
      });

      expect(coverage.observationCadenceHours).toBe(24);
      expect(DESTINATION_OBSERVATION_CADENCE_HOURS).toBe(24);
    });
  });

  describe('the query', () => {
    /**
     * Set-based, not correlated. The two forms were measured on a 5k-ad-set,
     * 15k-observation, 450k-metric fixture over 90 days: 1948ms for a
     * correlated subquery per metric row, 666ms for this. A later edit that
     * reintroduced the correlated form would be three times slower with no
     * failing test to say so — hence this one.
     */
    it('resolves intervals with a window function', () => {
      expect(DESTINATION_INTERVALS_SQL).toContain('LEAD(');
      expect(DESTINATION_INTERVALS_SQL).toContain('PARTITION BY');
    });

    it('binds the timezone rather than interpolating it', () => {
      expect(DESTINATION_INTERVALS_SQL).toContain('$4::text');
      expect(DESTINATION_INTERVALS_SQL).not.toMatch(/AT TIME ZONE '[A-Za-z]/);
    });

    /**
     * The vocabulary is the contract. Meta does not report when a destination
     * changed, so every name here says "observed"; a rename to effective/changed
     * would be a claim the evidence cannot support.
     */
    it('never claims an effective or change time', () => {
      expect(DESTINATION_INTERVALS_SQL).toContain('observedFrom');
      expect(DESTINATION_INTERVALS_SQL).not.toContain('effective');
      expect(DESTINATION_INTERVALS_SQL).not.toContain('changed_at');
    });

    it('scopes every read by tenant, workspace and connection', () => {
      expect(DESTINATION_INTERVALS_SQL).toContain('observation.tenant_id = $1');
      expect(DESTINATION_INTERVALS_SQL).toContain(
        'observation.workspace_id = $2',
      );
      expect(DESTINATION_INTERVALS_SQL).toContain(
        'observation.connection_id = $3',
      );
    });
  });
});
