import { ConflictException } from '@nestjs/common';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LEADFLOW_PRODUCT_TELEMETRY_PURPOSE } from '../dto/telemetry-consent.dto';
import {
  LeadFlowProductTelemetryDailyEntity,
  LeadFlowTelemetryAuditEventEntity,
  LeadFlowTelemetryConsentEntity,
  LeadFlowTelemetryIdentityLinkEntity,
} from '../entities';
import { LeadFlowTelemetryPrivacyService } from './leadflow-telemetry-privacy.service';

const tenantId = '3fcf6e35-9881-4713-b704-795956eec0c8';
const workspaceId = 'b9c311c3-96e9-4bc4-b2a4-f02763063b1b';
const userId = 'c821ac23-bf9f-46aa-87b9-fe1b34351941';
const noticeId = '83f31024-cce4-4397-87ea-3527a9e9aa73';
const contentHash = 'a'.repeat(64);
const pseudonym = '58135121-52ef-4c45-82cb-6c41b1ea8a3f';

function repositoryMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
    save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    remove: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
  };
}

function createFixture() {
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(),
  };
  const notices = repositoryMock();
  const consents = repositoryMock();
  const identities = repositoryMock();
  const dailyFacts = repositoryMock();
  const auditEvents = repositoryMock();
  const service = new LeadFlowTelemetryPrivacyService(
    dataSource as never,
    notices as never,
    consents as never,
    identities as never,
    dailyFacts as never,
    auditEvents as never,
  );
  return {
    service,
    dataSource,
    notices,
    consents,
    identities,
    dailyFacts,
    auditEvents,
  };
}

const notice = {
  id: noticeId,
  purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  version: 1,
  locale: 'pt-BR',
  title: 'Telemetria agregada',
  body: 'Texto técnico.',
  contentHash,
  categories: ['automation_live_terminal_runs', 'automation_live_failed_runs'],
  retentionDays: 90,
  kAnonymityThreshold: 5,
  legalReviewStatus: 'pending' as const,
  status: 'active' as const,
  effectiveAt: new Date('2026-07-30T00:00:00.000Z'),
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
};
const approvedNotice = {
  ...notice,
  legalReviewStatus: 'approved' as const,
};

const ctx = {
  tenantId,
  workspaceId,
  userId,
  role: 'owner',
  managedContext: {
    productKey: 'leadflow' as const,
    operatingMode: 'agency' as const,
    clientId: null,
    managedTenantId: null,
  },
};

describe('LeadFlowTelemetryPrivacyService', () => {
  const previousGate = process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;

  afterEach(() => {
    if (previousGate === undefined) {
      delete process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;
    } else {
      process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = previousGate;
    }
    jest.clearAllMocks();
  });

  it('marks collection eligible only for the exact active consent version', async () => {
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
    const fixture = createFixture();
    fixture.notices.findOne.mockResolvedValue(approvedNotice);
    fixture.consents.findOne.mockResolvedValue({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      noticeId,
      status: 'opted_in',
      noticeVersion: 1,
      noticeContentHash: contentHash,
      occurredAt: new Date('2026-07-30T12:00:00.000Z'),
      createdAt: new Date('2026-07-30T12:00:00.000Z'),
    });
    fixture.identities.findOne.mockResolvedValue(null);

    const result = await fixture.service.getStatus(ctx);

    expect(result.collection.eligible).toBe(true);
    expect(result.consent.requiresRenewal).toBe(false);
    expect(result.notice?.legalReviewStatus).toBe('approved');
    expect(result.guarantees.minimumAggregateScopes).toBe(5);
  });

  it('fails closed when collection has no current explicit opt-in', async () => {
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
    const fixture = createFixture();
    fixture.notices.findOne.mockResolvedValue(notice);
    fixture.consents.findOne.mockResolvedValue(null);

    await expect(
      fixture.service.collectSnapshot(ctx, {
        from: '2026-07-29T00:00:00.000Z',
        to: '2026-07-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.dataSource.query).not.toHaveBeenCalled();
  });

  it('keeps collection blocked while the notice is not cleared for consent', async () => {
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
    const fixture = createFixture();
    fixture.notices.findOne.mockResolvedValue(notice);
    fixture.consents.findOne.mockResolvedValue({
      noticeId,
      status: 'opted_in',
      noticeContentHash: contentHash,
    });

    await expect(
      fixture.service.collectSnapshot(ctx, {
        from: '2026-07-29T00:00:00.000Z',
        to: '2026-07-30T00:00:00.000Z',
      }),
    ).rejects.toThrow('bloqueada até que o texto vigente seja liberado');
    expect(fixture.dataSource.query).not.toHaveBeenCalled();
  });

  it('writes only pseudonymous daily facts from structured live run counts', async () => {
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
    const fixture = createFixture();
    fixture.notices.findOne.mockResolvedValue(approvedNotice);
    fixture.consents.findOne.mockResolvedValue({
      noticeId,
      status: 'opted_in',
      noticeContentHash: contentHash,
    });
    fixture.dataSource.query.mockResolvedValue([
      { observed_on: '2026-07-29', status: 'succeeded', total: '8' },
      { observed_on: '2026-07-29', status: 'failed', total: '2' },
    ]);
    fixture.identities.findOne.mockResolvedValue({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      scopePseudonym: pseudonym,
      lastCollectedAt: null,
      optedOutAt: null,
    });

    const result = await fixture.service.collectSnapshot(ctx, {
      from: '2026-07-29T00:00:00.000Z',
      to: '2026-07-30T00:00:00.000Z',
    });

    const [query] = fixture.dataSource.query.mock.calls[0] as [string];
    expect(query).toContain('leadflow_automation_runs');
    expect(query).toContain("run.mode = 'live'");
    expect(query).not.toContain('inbox_messages');
    expect(query).not.toContain('contacts');
    const upsertCalls = fixture.dailyFacts.upsert.mock
      .calls as unknown as Array<[Array<Record<string, unknown>>]>;
    const facts = upsertCalls[0][0];
    expect(facts).toHaveLength(2);
    expect(facts.every((fact) => fact.scopePseudonym === pseudonym)).toBe(true);
    expect(facts.some((fact) => 'tenantId' in fact)).toBe(false);
    expect(facts.some((fact) => 'workspaceId' in fact)).toBe(false);
    expect(facts.some((fact) => 'agencyClientId' in fact)).toBe(false);
    expect(result).toMatchObject({
      factsWritten: 2,
      terminalRuns: 10,
      failedRuns: 2,
    });
  });

  it('suppresses product aggregate groups below the configured k floor', async () => {
    const fixture = createFixture();
    fixture.dataSource.query.mockResolvedValue([]);

    await fixture.service.getProductAggregates(
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-08-01T00:00:00.000Z'),
    );

    const [query, params] = fixture.dataSource.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(query).toContain('HAVING COUNT(DISTINCT scope_pseudonym) >= $3');
    expect(query).not.toContain('tenant_id');
    expect(params[2]).toBeGreaterThanOrEqual(5);
  });

  it('performs erasure transactionally and records how many pseudonymous facts were removed', async () => {
    const fixture = createFixture();
    const consentRepository = repositoryMock();
    const identityRepository = repositoryMock();
    const auditRepository = repositoryMock();
    const identity = {
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      scopePseudonym: pseudonym,
    };
    consentRepository.findOne.mockResolvedValue({
      noticeId,
      purposeKey: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
      status: 'opted_in',
      noticeVersion: 1,
      noticeContentHash: contentHash,
    });
    identityRepository.findOne.mockResolvedValue(identity);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === LeadFlowTelemetryConsentEntity) return consentRepository;
        if (entity === LeadFlowTelemetryIdentityLinkEntity) {
          return identityRepository;
        }
        if (entity === LeadFlowTelemetryAuditEventEntity)
          return auditRepository;
        throw new Error('unexpected_repository');
      }),
      delete: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    fixture.dataSource.transaction.mockImplementation(
      async (operation: (value: typeof manager) => Promise<void>) =>
        operation(manager),
    );
    jest
      .spyOn(fixture.service, 'getStatus')
      .mockResolvedValue({ status: 'erased' } as never);

    await expect(
      fixture.service.eraseContribution(ctx, {
        reasonCode: 'user_request',
      }),
    ).resolves.toEqual({ status: 'erased' });

    expect(manager.delete).toHaveBeenCalledWith(
      LeadFlowProductTelemetryDailyEntity,
      { scopePseudonym: pseudonym },
    );
    expect(identityRepository.remove).toHaveBeenCalledWith(identity);
    expect(consentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'erased' }),
    );
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'telemetry_erasure_completed',
        details: expect.objectContaining({ deletedFacts: 2 }),
      }),
    );
  });
});
