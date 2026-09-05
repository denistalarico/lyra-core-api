// Lyra Social S1.4.8 — legacy vs. neutral consent semantics.
//
// These are the tests decision D-4 calls "obrigatórios em S1.4.8": a legacy
// `leadflow_product_improvement_v1` acceptance must never be read, promoted
// or rewritten as the neutral `platform_product_improvement_v1` one, and a
// neutral acceptance must be the shared state both products converge on.
//
// The consent repository mock below is deliberately a small real store rather
// than a fixed `findOne` value: the whole risk this phase guards against is a
// missing `purpose_key` filter, and a mock that ignores the `where` clause
// would pass whether or not the filter exists.

import { ConflictException } from '@nestjs/common';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
} from '../../leadflow-privacy/dto/telemetry-consent.dto';
import {
  LeadFlowTelemetryPrivacyService,
  LEADFLOW_TELEMETRY_PURPOSE,
  type TelemetryPurpose,
} from '../../leadflow-privacy/services/leadflow-telemetry-privacy.service';
import { PLATFORM_TELEMETRY_PURPOSE_DESCRIPTION } from '../platform-telemetry-purpose';

const tenantId = '3fcf6e35-9881-4713-b704-795956eec0c8';
const workspaceId = 'b9c311c3-96e9-4bc4-b2a4-f02763063b1b';
const otherWorkspaceId = 'd1e2f3a4-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const userId = 'c821ac23-bf9f-46aa-87b9-fe1b34351941';
const clientId = '2f0f1f4a-8f77-4a2f-9a6a-0f6f0b1c2d3e';

const legacyNoticeId = '83f31024-cce4-4397-87ea-3527a9e9aa73';
const neutralNoticeId = '4c9d7c1e-2b6a-4f3d-9c5e-7a8b9c0d1e2f';
const legacyHash = 'a'.repeat(64);
const neutralHash = 'b'.repeat(64);

/**
 * The neutral purpose as the controller declares it: gated on legal review
 * for opt-in (S1.4.8 pointed correction).
 */
const PLATFORM_PURPOSE: TelemetryPurpose = {
  key: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
  description: PLATFORM_TELEMETRY_PURPOSE_DESCRIPTION,
  requiresApprovedNoticeToOptIn: true,
};

type ConsentRow = {
  tenantId: string;
  workspaceId: string;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
  purposeKey: string;
  noticeId: string | null;
  status: 'opted_in' | 'opted_out' | 'erased';
  noticeVersion: number | null;
  noticeContentHash: string | null;
  occurredAt: Date;
  createdAt: Date;
  actorUserId?: string | null;
  reasonCode?: string | null;
};

function legacyConsentRow(overrides: Partial<ConsentRow> = {}): ConsentRow {
  return {
    tenantId,
    workspaceId,
    contextType: LeadFlowSettingsContextType.Agency,
    agencyClientId: null,
    purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
    noticeId: legacyNoticeId,
    status: 'opted_in',
    noticeVersion: 1,
    noticeContentHash: legacyHash,
    occurredAt: new Date('2026-07-30T12:00:00.000Z'),
    createdAt: new Date('2026-07-30T12:00:00.000Z'),
    ...overrides,
  };
}

function neutralConsentRow(overrides: Partial<ConsentRow> = {}): ConsentRow {
  return {
    tenantId,
    workspaceId,
    contextType: LeadFlowSettingsContextType.Agency,
    agencyClientId: null,
    purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
    noticeId: neutralNoticeId,
    status: 'opted_in',
    noticeVersion: 1,
    noticeContentHash: neutralHash,
    occurredAt: new Date('2026-08-15T12:00:00.000Z'),
    createdAt: new Date('2026-08-15T12:00:00.000Z'),
    ...overrides,
  };
}

const legacyNotice = {
  id: legacyNoticeId,
  purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  version: 1,
  locale: 'pt-BR',
  title: 'Telemetria agregada para melhoria do LeadFlow',
  body: 'Texto legado.',
  contentHash: legacyHash,
  categories: [],
  retentionDays: 90,
  kAnonymityThreshold: 5,
  legalReviewStatus: 'approved' as const,
  status: 'active' as const,
  effectiveAt: new Date('2026-07-30T00:00:00.000Z'),
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
};

const neutralNotice = {
  ...legacyNotice,
  id: neutralNoticeId,
  purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
  title: 'Telemetria agregada para melhoria dos produtos Lyra',
  body: 'Texto neutro.',
  contentHash: neutralHash,
};

/**
 * Applies the subset of the TypeORM `where` contract the service actually
 * uses: plain equality on scope columns, plus `IsNull()` for
 * `agency_client_id`. Anything unmatched fails the row, so a *missing* filter
 * in production code shows up as a wrong row being returned — the failure
 * mode these tests exist to catch.
 */
function matchesWhere(row: ConsentRow, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected && typeof expected === 'object' && '_type' in expected) {
      // TypeORM `IsNull()` operator instance.
      return actual === null || actual === undefined;
    }
    return actual === expected;
  });
}

function consentStore(initialRows: ConsentRow[]) {
  const rows = [...initialRows];
  return {
    rows,
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const matches = rows
        .filter((row) => matchesWhere(row, where))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return Promise.resolve(matches[0] ?? null);
    }),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((value: ConsentRow) => ({ ...value })),
    save: jest.fn((value: ConsentRow) => {
      rows.push({ ...value, createdAt: value.createdAt ?? new Date() });
      return Promise.resolve(value);
    }),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    remove: jest.fn((value: unknown) => Promise.resolve(value)),
  };
}

function plainRepositoryMock() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
    save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    remove: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
  };
}

function createFixture(
  initialConsents: ConsentRow[] = [],
  options: {
    neutralLegalReviewStatus?:
      | 'pending'
      | 'provisional'
      | 'approved'
      | 'rejected';
    legacyLegalReviewStatus?:
      | 'pending'
      | 'provisional'
      | 'approved'
      | 'rejected';
  } = {},
) {
  const consents = consentStore(initialConsents);
  const notices = plainRepositoryMock();
  const identities = plainRepositoryMock();
  const dailyFacts = plainRepositoryMock();
  const auditEvents = plainRepositoryMock();

  const activeNeutralNotice = {
    ...neutralNotice,
    legalReviewStatus:
      options.neutralLegalReviewStatus ?? neutralNotice.legalReviewStatus,
  };
  const activeLegacyNotice = {
    ...legacyNotice,
    legalReviewStatus:
      options.legacyLegalReviewStatus ?? legacyNotice.legalReviewStatus,
  };

  // Notices resolve by purpose (getCurrentNotice) or by id (optIn).
  notices.findOne.mockImplementation(
    ({ where }: { where: Record<string, unknown> }) => {
      const candidates = [activeLegacyNotice, activeNeutralNotice];
      const found = candidates.find((candidate) => {
        if (where.id) return candidate.id === where.id;
        return (
          candidate.purposeKey === where.purposeKey &&
          candidate.locale === where.locale &&
          candidate.status === where.status
        );
      });
      return Promise.resolve(found ?? null);
    },
  );

  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn((callback: (manager: unknown) => Promise<unknown>) =>
      callback({
        getRepository: (entity: { name?: string }) => {
          const name = entity?.name ?? '';
          if (name.includes('Consent') && !name.includes('Notice')) {
            return consents;
          }
          if (name.includes('Audit')) return auditEvents;
          if (name.includes('Identity')) return identities;
          return plainRepositoryMock();
        },
        delete: jest.fn().mockResolvedValue({ affected: 0 }),
      }),
    ),
  };

  const service = new LeadFlowTelemetryPrivacyService(
    dataSource as never,
    notices as never,
    consents as never,
    identities as never,
    dailyFacts as never,
    auditEvents as never,
  );

  return { service, consents, notices, identities, auditEvents, dataSource };
}

function contextFor(
  productKey: 'leadflow' | 'social',
  operating: { clientId?: string; workspaceId?: string } = {},
) {
  return {
    tenantId,
    workspaceId: operating.workspaceId ?? workspaceId,
    userId,
    role: 'owner',
    managedContext: {
      productKey,
      operatingMode: operating.clientId
        ? ('client' as const)
        : ('agency' as const),
      clientId: operating.clientId ?? null,
      managedTenantId: null,
    },
  };
}

describe('S1.4.8 — legacy vs. neutral telemetry consent', () => {
  afterEach(() => jest.clearAllMocks());

  describe('A. Legacy consent is never promoted', () => {
    it('1: a scope holding only the legacy acceptance is NOT consented for the neutral purpose', async () => {
      const fixture = createFixture([legacyConsentRow()]);

      const status = await fixture.service.getStatus(
        contextFor('social'),
        PLATFORM_PURPOSE,
      );

      expect(status.purpose.key).toBe(PLATFORM_PRODUCT_TELEMETRY_PURPOSE);
      expect(status.consent.state).toBe('not_configured');
      expect(status.consent.occurredAt).toBeNull();
      expect(status.collection.eligible).toBe(false);
    });

    it('1b: the very same scope IS still consented for the legacy purpose (LeadFlow unaffected)', async () => {
      const fixture = createFixture([legacyConsentRow()]);

      const status = await fixture.service.getStatus(
        contextFor('leadflow'),
        LEADFLOW_TELEMETRY_PURPOSE,
      );

      expect(status.purpose.key).toBe(LEADFLOW_PRODUCT_TELEMETRY_PURPOSE);
      expect(status.consent.state).toBe('opted_in');
      expect(status.consent.noticeContentHash).toBe(legacyHash);
    });

    it('2: reading the neutral status leaves the legacy row untouched', async () => {
      const fixture = createFixture([legacyConsentRow()]);
      const before = JSON.stringify(fixture.consents.rows);

      await fixture.service.getStatus(contextFor('social'), PLATFORM_PURPOSE);

      expect(JSON.stringify(fixture.consents.rows)).toBe(before);
      expect(fixture.consents.save).not.toHaveBeenCalled();
      expect(fixture.consents.delete).not.toHaveBeenCalled();
      expect(fixture.consents.remove).not.toHaveBeenCalled();
    });

    it('3: accepting the neutral notice adds a row and never erases or rewrites the legacy one', async () => {
      const fixture = createFixture([legacyConsentRow()]);

      await fixture.service.optIn(
        contextFor('social'),
        {
          noticeId: neutralNoticeId,
          contentHash: neutralHash,
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        },
        PLATFORM_PURPOSE,
      );

      const legacyRows = fixture.consents.rows.filter(
        (row) => row.purposeKey === LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
      );
      const neutralRows = fixture.consents.rows.filter(
        (row) => row.purposeKey === PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
      );

      expect(legacyRows).toHaveLength(1);
      expect(legacyRows[0]).toMatchObject({
        status: 'opted_in',
        noticeId: legacyNoticeId,
        noticeContentHash: legacyHash,
      });
      expect(neutralRows).toHaveLength(1);
      expect(neutralRows[0]).toMatchObject({
        status: 'opted_in',
        noticeId: neutralNoticeId,
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
      });
    });

    it('3c: widening the DTO does not let a LeadFlow call consent to the neutral purpose', async () => {
      const fixture = createFixture();

      // The DTO now accepts either purpose string, but the LeadFlow route
      // resolves the LeadFlow purpose, so a payload naming the neutral
      // notice is refused rather than silently recorded.
      await expect(
        fixture.service.optIn(
          contextFor('leadflow'),
          {
            noticeId: neutralNoticeId,
            contentHash: neutralHash,
            purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
          },
          LEADFLOW_TELEMETRY_PURPOSE,
        ),
      ).rejects.toThrow();

      expect(fixture.consents.save).not.toHaveBeenCalled();
    });

    it('3b: the neutral purpose cannot be consented to by pointing at the legacy notice', async () => {
      const fixture = createFixture();

      await expect(
        fixture.service.optIn(
          contextFor('social'),
          {
            noticeId: legacyNoticeId,
            contentHash: legacyHash,
            purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
          },
          PLATFORM_PURPOSE,
        ),
      ).rejects.toThrow();

      expect(fixture.consents.save).not.toHaveBeenCalled();
    });
  });

  describe('B. Neutral consent is the shared state', () => {
    it('4: a neutral acceptance shows as accepted for Social', async () => {
      const fixture = createFixture([neutralConsentRow()]);

      const status = await fixture.service.getStatus(
        contextFor('social'),
        PLATFORM_PURPOSE,
      );

      expect(status.consent.state).toBe('opted_in');
      expect(status.consent.requiresRenewal).toBe(false);
      expect(status.consent.noticeContentHash).toBe(neutralHash);
    });

    it('5: the same neutral row is the state LeadFlow reads through the neutral purpose', async () => {
      const fixture = createFixture([neutralConsentRow()]);

      const [social, leadflow] = await Promise.all([
        fixture.service.getStatus(contextFor('social'), PLATFORM_PURPOSE),
        fixture.service.getStatus(contextFor('leadflow'), PLATFORM_PURPOSE),
      ]);

      expect(social.consent).toEqual(leadflow.consent);
      expect(social.consent.state).toBe('opted_in');
    });

    it('5b: an opt-out through one product is the state the other product reads (same row, no sync)', async () => {
      const fixture = createFixture([neutralConsentRow()]);

      await fixture.service.optOut(
        contextFor('social'),
        { reasonCode: 'preference_changed' },
        PLATFORM_PURPOSE,
      );

      const leadflow = await fixture.service.getStatus(
        contextFor('leadflow'),
        PLATFORM_PURPOSE,
      );

      expect(leadflow.consent.state).toBe('opted_out');
    });

    it('6: a different scope does not inherit the acceptance (grain is respected)', async () => {
      const fixture = createFixture([neutralConsentRow()]);

      const otherWorkspace = await fixture.service.getStatus(
        contextFor('social', { workspaceId: otherWorkspaceId }),
        PLATFORM_PURPOSE,
      );
      const managedClient = await fixture.service.getStatus(
        contextFor('social', { clientId }),
        PLATFORM_PURPOSE,
      );

      expect(otherWorkspace.consent.state).toBe('not_configured');
      expect(managedClient.consent.state).toBe('not_configured');
    });
  });

  describe('D. Mutation semantics', () => {
    it('10: accepting records purpose, notice, version, hash and actor', async () => {
      const fixture = createFixture();

      await fixture.service.optIn(
        contextFor('social'),
        {
          noticeId: neutralNoticeId,
          contentHash: neutralHash,
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        },
        PLATFORM_PURPOSE,
      );

      expect(fixture.consents.save).toHaveBeenCalledWith(
        expect.objectContaining({
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
          noticeId: neutralNoticeId,
          noticeVersion: 1,
          noticeContentHash: neutralHash,
          status: 'opted_in',
          actorUserId: userId,
          tenantId,
          workspaceId,
        }),
      );
      expect(fixture.auditEvents.save).toHaveBeenCalled();
    });

    it('11: revoking appends a new row and preserves the acceptance as history', async () => {
      const fixture = createFixture([neutralConsentRow()]);

      await fixture.service.optOut(
        contextFor('social'),
        { reasonCode: 'preference_changed' },
        PLATFORM_PURPOSE,
      );

      const neutralRows = fixture.consents.rows.filter(
        (row) => row.purposeKey === PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
      );

      expect(neutralRows).toHaveLength(2);
      expect(neutralRows[0].status).toBe('opted_in');
      expect(neutralRows[1].status).toBe('opted_out');
      expect(fixture.auditEvents.save).toHaveBeenCalled();
    });

    it('12: refusing telemetry changes no entitlement and no product configuration', async () => {
      const fixture = createFixture([neutralConsentRow()]);

      await fixture.service.optOut(
        contextFor('social'),
        { reasonCode: 'preference_changed' },
        PLATFORM_PURPOSE,
      );

      // The only tables written are the consent trail and its audit trail:
      // no entitlement, no settings, no product row is touched by a refusal.
      const writtenTables = [
        fixture.consents.save.mock.calls.length > 0 && 'consents',
        fixture.auditEvents.save.mock.calls.length > 0 && 'audit',
        fixture.notices.save.mock.calls.length > 0 && 'notices',
      ].filter(Boolean);

      expect(writtenTables).toEqual(['consents', 'audit']);
    });
  });

  describe('Legal-review gate on opt-in (S1.4.8 pointed correction)', () => {
    it('2: opting in to a pending neutral notice is refused server-side', async () => {
      const fixture = createFixture([], {
        neutralLegalReviewStatus: 'pending',
      });

      await expect(
        fixture.service.optIn(
          contextFor('social'),
          {
            noticeId: neutralNoticeId,
            contentHash: neutralHash,
            purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
          },
          PLATFORM_PURPOSE,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(fixture.consents.save).not.toHaveBeenCalled();
    });

    it('2b: a rejected notice is refused too — only "approved" opens opt-in', async () => {
      const fixture = createFixture([], {
        neutralLegalReviewStatus: 'rejected',
      });

      await expect(
        fixture.service.optIn(
          contextFor('social'),
          {
            noticeId: neutralNoticeId,
            contentHash: neutralHash,
            purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
          },
          PLATFORM_PURPOSE,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(fixture.consents.save).not.toHaveBeenCalled();
    });

    it('4: a historical acceptance can still be withdrawn while the notice is pending', async () => {
      const fixture = createFixture([neutralConsentRow()], {
        neutralLegalReviewStatus: 'pending',
      });

      await fixture.service.optOut(
        contextFor('social'),
        { reasonCode: 'preference_changed' },
        PLATFORM_PURPOSE,
      );

      const status = await fixture.service.getStatus(
        contextFor('social'),
        PLATFORM_PURPOSE,
      );

      expect(status.consent.state).toBe('opted_out');
    });

    it('4b: erasure is likewise never blocked by legal review status', async () => {
      const fixture = createFixture([neutralConsentRow()], {
        neutralLegalReviewStatus: 'pending',
      });

      await expect(
        fixture.service.eraseContribution(
          contextFor('social'),
          { reasonCode: 'user_request' },
          PLATFORM_PURPOSE,
        ),
      ).resolves.toBeDefined();
    });

    it('3/5: collection stays fail-closed on a pending notice even with a historical acceptance', async () => {
      const previousGate = process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;
      process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';

      const fixture = createFixture([neutralConsentRow()], {
        neutralLegalReviewStatus: 'pending',
      });

      // The status the UI renders must not claim collection is happening...
      const status = await fixture.service.getStatus(
        contextFor('social'),
        PLATFORM_PURPOSE,
      );
      expect(status.consent.state).toBe('opted_in');
      expect(status.collection.eligible).toBe(false);

      // ...and the collection path itself refuses, independently.
      await expect(
        fixture.service.collectSnapshot(
          contextFor('social'),
          { from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' },
          PLATFORM_PURPOSE,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      if (previousGate === undefined) {
        delete process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;
      } else {
        process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = previousGate;
      }
    });

    it('5/6: with an approved notice, opt-in is accepted and recorded', async () => {
      const fixture = createFixture([], {
        neutralLegalReviewStatus: 'approved',
      });

      await fixture.service.optIn(
        contextFor('social'),
        {
          noticeId: neutralNoticeId,
          contentHash: neutralHash,
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        },
        PLATFORM_PURPOSE,
      );

      expect(fixture.consents.save).toHaveBeenCalledWith(
        expect.objectContaining({
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
          status: 'opted_in',
        }),
      );
    });

    it('7: with an approved notice, opt-out is recorded as opted_out', async () => {
      const fixture = createFixture([neutralConsentRow()], {
        neutralLegalReviewStatus: 'approved',
      });

      const result = await fixture.service.optOut(
        contextFor('social'),
        { reasonCode: 'preference_changed' },
        PLATFORM_PURPOSE,
      );

      expect(result.consent.state).toBe('opted_out');
    });

    /**
     * I6.2: `provisional` clears the gate exactly like `approved`.
     *
     * These mirror the `'5/6'` and `'7'` approved-notice tests above, with the
     * one substitution the whole slice is about — `neutralLegalReviewStatus:
     * 'provisional'` — to prove `isNoticeClearedForConsent` really is used at
     * both call sites rather than only in one.
     */
    it('I6.2/a: a provisional notice accepts a NEW opt-in, exactly like approved', async () => {
      const fixture = createFixture([], {
        neutralLegalReviewStatus: 'provisional',
      });

      await fixture.service.optIn(
        contextFor('social'),
        {
          noticeId: neutralNoticeId,
          contentHash: neutralHash,
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        },
        PLATFORM_PURPOSE,
      );

      expect(fixture.consents.save).toHaveBeenCalledWith(
        expect.objectContaining({
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
          status: 'opted_in',
        }),
      );
    });

    it('I6.2/b: a provisional notice allows opt-out, same as any other', async () => {
      const fixture = createFixture([neutralConsentRow()], {
        neutralLegalReviewStatus: 'provisional',
      });

      const result = await fixture.service.optOut(
        contextFor('social'),
        { reasonCode: 'preference_changed' },
        PLATFORM_PURPOSE,
      );

      expect(result.consent.state).toBe('opted_out');
    });

    /**
     * I6.2's actual product decision: a provisional consent, with the
     * platform gate ON, really collects — the gate (which stays off in
     * production) is the fence, not formal legal sign-off. This is the one
     * assertion that would fail if `collectSnapshot` still hard-required
     * `'approved'` while `optIn` had been loosened.
     */
    it('I6.2/c: with the gate on, a provisional consent lets collectSnapshot actually collect', async () => {
      const previousGate = process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;
      process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';

      const fixture = createFixture([neutralConsentRow()], {
        neutralLegalReviewStatus: 'provisional',
      });

      const status = await fixture.service.getStatus(
        contextFor('social'),
        PLATFORM_PURPOSE,
      );
      expect(status.collection.eligible).toBe(true);

      await expect(
        fixture.service.collectSnapshot(
          contextFor('social'),
          { from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' },
          PLATFORM_PURPOSE,
        ),
      ).resolves.toBeDefined();

      if (previousGate === undefined) {
        delete process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;
      } else {
        process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = previousGate;
      }
    });

    /** §10: with the gate OFF, a provisional opt-in still collects nothing. */
    it('I6.2/d: gate off + provisional consent opted in → collectSnapshot still refuses', async () => {
      const fixture = createFixture([neutralConsentRow()], {
        neutralLegalReviewStatus: 'provisional',
      });

      const status = await fixture.service.getStatus(
        contextFor('social'),
        PLATFORM_PURPOSE,
      );
      expect(status.consent.state).toBe('opted_in');
      expect(status.collection.eligible).toBe(false);
      expect(status.collection.platformGateEnabled).toBe(false);

      await expect(
        fixture.service.collectSnapshot(
          contextFor('social'),
          { from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' },
          PLATFORM_PURPOSE,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('11: the legacy purpose is NOT subject to the new gate — its notice is pending by design', async () => {
      // Migration 1788200000000 seeds the legacy notice as 'pending', and
      // LeadFlow has been accepting it in that state. Applying the gate
      // globally would retroactively break that flow, so the LeadFlow purpose
      // declares the gate off and this test pins that.
      expect(LEADFLOW_TELEMETRY_PURPOSE.requiresApprovedNoticeToOptIn).toBe(
        false,
      );

      const fixture = createFixture([], {
        legacyLegalReviewStatus: 'pending',
      });

      await expect(
        fixture.service.optIn(
          contextFor('leadflow'),
          {
            noticeId: legacyNoticeId,
            contentHash: legacyHash,
            purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
          },
          LEADFLOW_TELEMETRY_PURPOSE,
        ),
      ).resolves.toBeDefined();

      expect(fixture.consents.save).toHaveBeenCalledWith(
        expect.objectContaining({
          purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
          status: 'opted_in',
        }),
      );
    });
  });

  describe('Legacy history is readable without being counted', () => {
    it('exposes the legacy acceptance as separate read-only history', async () => {
      const fixture = createFixture([legacyConsentRow()]);

      const legacy = await fixture.service.findRelatedPurposeConsent(
        contextFor('social'),
        LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
      );

      expect(legacy).toMatchObject({
        purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
        state: 'opted_in',
      });
    });

    it('returns null when the scope has no legacy acceptance', async () => {
      const fixture = createFixture([neutralConsentRow()]);

      const legacy = await fixture.service.findRelatedPurposeConsent(
        contextFor('social'),
        LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
      );

      expect(legacy).toBeNull();
    });
  });
});
