import type { Repository } from 'typeorm';
import type { SocialAdDestinationObservationEntity } from '../entities/social-ad-destination-observation.entity';
import { SocialAdDestinationObserverService } from './social-ad-destination-observer.service';
import type { SocialAdEntityWriteScope } from './social-ad-entity-writer.service';

const SCOPE: SocialAdEntityWriteScope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  connectionId: 'connection-a',
  provider: 'meta_ads',
};

const OBSERVED_AT = new Date('2026-08-28T10:00:00.000Z');

type LatestRow = {
  adEntityId: string;
  destinationType: string;
  destinationRaw: string | null;
};

/**
 * The repository, mocked at the query-builder seam.
 *
 * `latest` is what the "what did we last see" query returns; `inserted` records
 * the values the service tried to append, which is the whole behaviour under
 * test.
 */
type InsertBuilder = {
  insert: jest.Mock;
  into: jest.Mock;
  values: jest.Mock;
  orIgnore: jest.Mock;
  execute: jest.Mock;
};

function createHarness(latest: LatestRow[] = []) {
  const inserted: Record<string, unknown>[][] = [];

  const insertBuilder: InsertBuilder = {
    insert: jest.fn(() => insertBuilder),
    into: jest.fn(() => insertBuilder),
    values: jest.fn((rows: Record<string, unknown>[]) => {
      inserted.push(rows);
      return insertBuilder;
    }),
    orIgnore: jest.fn(() => insertBuilder),
    execute: jest.fn(() =>
      Promise.resolve({
        // One identifier per row accepted, mirroring what Postgres returns when
        // the conflict clause drops nothing.
        identifiers: inserted[inserted.length - 1].map((_, index) => ({
          id: `observation-${index}`,
        })),
      }),
    ),
  };

  const selectBuilder: Record<string, jest.Mock> = {
    select: jest.fn(() => selectBuilder),
    addSelect: jest.fn(() => selectBuilder),
    where: jest.fn(() => selectBuilder),
    orderBy: jest.fn(() => selectBuilder),
    addOrderBy: jest.fn(() => selectBuilder),
    getRawMany: jest.fn(() => Promise.resolve(latest)),
  };

  const repository = {
    createQueryBuilder: jest.fn((alias?: string) =>
      alias ? selectBuilder : insertBuilder,
    ),
  };

  return {
    service: new SocialAdDestinationObserverService(
      repository as unknown as Repository<SocialAdDestinationObservationEntity>,
    ),
    inserted,
    insertBuilder,
    selectBuilder,
  };
}

const observation = (overrides: Partial<Record<string, unknown>> = {}) => ({
  adEntityId: 'entity-1',
  destinationType: 'whatsapp',
  destinationRaw: 'WHATSAPP',
  hasEvidence: true,
  ...overrides,
});

describe('SocialAdDestinationObserverService', () => {
  describe('first observation', () => {
    it('records the first destination ever seen for an ad set', async () => {
      const harness = createHarness([]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [observation()],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-1',
      });

      expect(written).toBe(1);
      expect(harness.inserted[0][0]).toMatchObject({
        adEntityId: 'entity-1',
        destinationType: 'whatsapp',
        destinationRaw: 'WHATSAPP',
        observedAt: OBSERVED_AT,
        syncRunId: 'run-1',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        connectionId: 'connection-a',
      });
    });

    /**
     * The semantic the brief insists on: a first observation says "this is the
     * first destination Lyra saw", never "the ad set always had it". The column
     * is `observed_at`, and nothing in the row claims an effective date.
     */
    it('claims only an observation instant, never an effective date', async () => {
      const harness = createHarness([]);

      await harness.service.record({
        scope: SCOPE,
        observations: [observation()],
        observedAt: OBSERVED_AT,
        syncRunId: null,
      });

      const row = harness.inserted[0][0];

      expect(row).toHaveProperty('observedAt');
      expect(row).not.toHaveProperty('effectiveAt');
      expect(row).not.toHaveProperty('changedAt');
      expect(row).not.toHaveProperty('effectiveFrom');
    });
  });

  describe('unchanged destination', () => {
    it('appends nothing when the destination is identical', async () => {
      const harness = createHarness([
        {
          adEntityId: 'entity-1',
          destinationType: 'whatsapp',
          destinationRaw: 'WHATSAPP',
        },
      ]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [observation()],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-2',
      });

      // A daily sweep over an account whose destinations never move must not
      // add a row a day; a year of that is tens of thousands of rows all
      // saying the same thing.
      expect(written).toBe(0);
      expect(harness.inserted).toHaveLength(0);
    });

    /**
     * A new Meta enum that this build cannot map is still a real provider
     * change. Comparing canonical values alone would swallow a move from one
     * unmapped value to another — exactly the evidence a corrected mapping
     * would later need.
     */
    it('treats a changed raw value as a change even when canonical is unchanged', async () => {
      const harness = createHarness([
        {
          adEntityId: 'entity-1',
          destinationType: 'unknown',
          destinationRaw: 'SOME_NEW_THING',
        },
      ]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [
          observation({
            destinationType: 'unknown',
            destinationRaw: 'ANOTHER_NEW_THING',
          }),
        ],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-2',
      });

      expect(written).toBe(1);
      expect(harness.inserted[0][0]).toMatchObject({
        destinationRaw: 'ANOTHER_NEW_THING',
      });
    });
  });

  describe('changed destination', () => {
    it('appends a second observation without touching the first', async () => {
      const harness = createHarness([
        {
          adEntityId: 'entity-1',
          destinationType: 'whatsapp',
          destinationRaw: 'WHATSAPP',
        },
      ]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [
          observation({
            destinationType: 'instagram_direct',
            destinationRaw: 'INSTAGRAM_DIRECT',
          }),
        ],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-3',
      });

      expect(written).toBe(1);
      // Append-only: the builder only ever inserts.
      expect(harness.insertBuilder.insert).toHaveBeenCalled();
      expect(harness.insertBuilder).not.toHaveProperty('update');
    });

    it('records a return to a previous destination', async () => {
      // whatsapp -> instagram_direct -> whatsapp. The third leg is a real
      // event, and any uniqueness rule keyed on (entity, destination) would
      // reject it.
      const harness = createHarness([
        {
          adEntityId: 'entity-1',
          destinationType: 'instagram_direct',
          destinationRaw: 'INSTAGRAM_DIRECT',
        },
      ]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [observation()],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-4',
      });

      expect(written).toBe(1);
      expect(harness.inserted[0][0]).toMatchObject({
        destinationType: 'whatsapp',
      });
    });
  });

  describe('evidence', () => {
    /**
     * The distinction the brief singles out. Provider silence is not a
     * transition to unknown: treating it as one would let a degraded response
     * close a known period and make an ad set look like it stopped pointing
     * anywhere.
     */
    it('records nothing when the provider did not answer', async () => {
      const harness = createHarness([]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [
          observation({
            destinationType: 'unknown',
            destinationRaw: null,
            hasEvidence: false,
          }),
        ],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-5',
      });

      expect(written).toBe(0);
      expect(harness.inserted).toHaveLength(0);
    });

    /**
     * Meta's explicit `UNDEFINED` is the opposite case: an advertiser who
     * configured no destination is a real, observed state.
     */
    it('records an explicit provider UNDEFINED as a real observation', async () => {
      const harness = createHarness([]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [
          observation({
            destinationType: 'unknown',
            destinationRaw: 'UNDEFINED',
            hasEvidence: true,
          }),
        ],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-6',
      });

      expect(written).toBe(1);
      expect(harness.inserted[0][0]).toMatchObject({
        destinationType: 'unknown',
        destinationRaw: 'UNDEFINED',
      });
    });

    it('does not query for history when nothing is observable', async () => {
      const harness = createHarness([]);

      await harness.service.record({
        scope: SCOPE,
        observations: [observation({ hasEvidence: false })],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-7',
      });

      // A sweep with no evidence should cost no reads either.
      expect(harness.selectBuilder.getRawMany).not.toHaveBeenCalled();
    });
  });

  describe('batching', () => {
    it('appends only the ad sets that actually changed', async () => {
      const harness = createHarness([
        {
          adEntityId: 'entity-same',
          destinationType: 'whatsapp',
          destinationRaw: 'WHATSAPP',
        },
        {
          adEntityId: 'entity-changed',
          destinationType: 'whatsapp',
          destinationRaw: 'WHATSAPP',
        },
      ]);

      const written = await harness.service.record({
        scope: SCOPE,
        observations: [
          observation({ adEntityId: 'entity-same' }),
          observation({
            adEntityId: 'entity-changed',
            destinationType: 'messenger',
            destinationRaw: 'MESSENGER',
          }),
          observation({ adEntityId: 'entity-new' }),
        ],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-8',
      });

      expect(written).toBe(2);
      expect(harness.inserted[0].map((row) => row.adEntityId)).toEqual([
        'entity-changed',
        'entity-new',
      ]);
    });

    it('carries the managed client scope onto the observation', async () => {
      const harness = createHarness([]);

      await harness.service.record({
        scope: { ...SCOPE, agencyClientId: 'client-a' },
        observations: [observation()],
        observedAt: OBSERVED_AT,
        syncRunId: null,
      });

      expect(harness.inserted[0][0]).toMatchObject({
        agencyClientId: 'client-a',
      });
    });
  });

  describe('idempotency', () => {
    it('lets the database drop a duplicate rather than counting it', async () => {
      const harness = createHarness([]);

      await harness.service.record({
        scope: SCOPE,
        observations: [observation()],
        observedAt: OBSERVED_AT,
        syncRunId: 'run-9',
      });

      // The read-then-write above is not atomic, so the insert must be the
      // thing that refuses a duplicate.
      expect(harness.insertBuilder.orIgnore).toHaveBeenCalled();
    });
  });
});
