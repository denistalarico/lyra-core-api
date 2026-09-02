// Lyra Social S1.4.8 §13 / §19-C — the neutral routes enforce product-bound
// authorization at runtime, not an OR across products.
//
// `assertCanHolding` mirrors the real `PlatformPermissionService.assertCan`
// contract (rejects with ForbiddenException when the caller lacks the exact
// key) driven by the fixed set of keys the fake caller holds, so each test
// states its matrix cell directly.

import { ForbiddenException } from '@nestjs/common';
import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, PlatformPermissionService } from '../permissions';
import { LeadFlowTelemetryPrivacyService } from '../leadflow-privacy/services/leadflow-telemetry-privacy.service';
import { PlatformPrivacyController } from './platform-privacy.controller';
import { PLATFORM_PRODUCT_TELEMETRY_PURPOSE } from './platform-telemetry-purpose';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000003';

const SOCIAL_VIEW = 'social.settings.telemetry.view.admin';
const SOCIAL_MANAGE = 'social.settings.telemetry.manage.owner_only';
const LEADFLOW_VIEW = 'leadflow.settings.telemetry.view.admin';
const LEADFLOW_MANAGE = 'leadflow.settings.telemetry.manage.owner_only';

function assertCanHolding(...heldPermissionKeys: string[]) {
  return jest.fn((_context: unknown, permissionKey: string) => {
    if (!heldPermissionKeys.includes(permissionKey)) {
      return Promise.reject(
        new ForbiddenException(
          `You do not have the required permission: ${permissionKey}.`,
        ),
      );
    }
    return Promise.resolve();
  });
}

const statusFixture = {
  purpose: { key: PLATFORM_PRODUCT_TELEMETRY_PURPOSE, description: 'd' },
  notice: null,
  consent: {
    state: 'not_configured' as const,
    occurredAt: null,
    noticeVersion: null,
    noticeContentHash: null,
    requiresRenewal: false,
  },
  collection: {
    platformGateEnabled: false,
    eligible: false,
    lastCollectedAt: null,
    contributedDailyFacts: 0,
  },
  guarantees: {
    noMessageContent: true as const,
    noContactIdentity: true as const,
    pseudonymousFacts: true as const,
    identitySeparated: true as const,
    minimumAggregateScopes: 5,
    optOutStopsCollection: true as const,
    erasureAvailable: true as const,
  },
  recentAudit: [],
};

describe('/platform/privacy/telemetry — product-bound authorization', () => {
  let app: INestApplication;
  const assertCan = jest.fn();
  const getStatus = jest.fn();
  const optIn = jest.fn();
  const optOut = jest.fn();
  const eraseContribution = jest.fn();
  const findRelatedPurposeConsent = jest.fn();

  function guardsFor(
    productKey: 'leadflow' | 'social' | 'agency',
  ): CanActivate {
    return {
      canActivate(context: ExecutionContext) {
        const httpRequest = context.switchToHttp().getRequest<{
          user?: unknown;
          managedContext?: unknown;
        }>();
        httpRequest.user = {
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          sub: USER_ID,
          role: 'owner',
        };
        httpRequest.managedContext = {
          productKey,
          operatingMode: 'agency',
          clientId: null,
          managedTenantId: null,
        };
        return true;
      },
    };
  }

  async function buildApp(productKey: 'leadflow' | 'social' | 'agency') {
    const module = await Test.createTestingModule({
      controllers: [PlatformPrivacyController],
      providers: [
        {
          provide: LeadFlowTelemetryPrivacyService,
          useValue: {
            getStatus,
            optIn,
            optOut,
            eraseContribution,
            findRelatedPurposeConsent,
          },
        },
        { provide: PlatformPermissionService, useValue: { assertCan } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardsFor(productKey))
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const built = module.createNestApplication();
    await built.init();
    return built;
  }

  beforeEach(() => {
    getStatus.mockResolvedValue(statusFixture);
    findRelatedPurposeConsent.mockResolvedValue(null);
    optIn.mockResolvedValue(statusFixture);
    optOut.mockResolvedValue(statusFixture);
    eraseContribution.mockResolvedValue(statusFixture);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    if (app) await app.close();
  });

  it('7: viewing in a Social context requires social.settings.telemetry.view.admin', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_VIEW));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/platform/privacy/telemetry')
      .expect(200);

    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      SOCIAL_VIEW,
    );
  });

  it('7b: only the LeadFlow view key does not authorize a Social-context read', async () => {
    assertCan.mockImplementation(assertCanHolding(LEADFLOW_VIEW));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/platform/privacy/telemetry')
      .expect(403);

    expect(getStatus).not.toHaveBeenCalled();
  });

  it('8: mutating in a Social context requires social.settings.telemetry.manage.owner_only', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_MANAGE));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/platform/privacy/telemetry/opt-out')
      .send({ reasonCode: 'preference_changed' })
      .expect(201);

    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      SOCIAL_MANAGE,
    );
  });

  it('8b: the Social view key alone does not authorize a Social mutation', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_VIEW));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/platform/privacy/telemetry/opt-out')
      .send({ reasonCode: 'preference_changed' })
      .expect(403);

    expect(optOut).not.toHaveBeenCalled();
  });

  it('9: the LeadFlow manage key alone does not authorize a Social mutation', async () => {
    assertCan.mockImplementation(assertCanHolding(LEADFLOW_MANAGE));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/platform/privacy/telemetry/opt-out')
      .send({ reasonCode: 'preference_changed' })
      .expect(403);

    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      SOCIAL_MANAGE,
    );
    expect(optOut).not.toHaveBeenCalled();
  });

  it('9b: symmetrically, the Social manage key alone does not authorize a LeadFlow-context mutation', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_MANAGE));
    app = await buildApp('leadflow');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/platform/privacy/telemetry/opt-out')
      .send({ reasonCode: 'preference_changed' })
      .expect(403);

    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      LEADFLOW_MANAGE,
    );
  });

  it('an agency-only context (no product asking) is refused', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_VIEW, LEADFLOW_VIEW));
    app = await buildApp('agency');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/platform/privacy/telemetry')
      .expect(403);

    expect(getStatus).not.toHaveBeenCalled();
  });

  it('2: the route declares the neutral purpose as gated on legal review', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_MANAGE));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/platform/privacy/telemetry/opt-in')
      .send({
        noticeId: '11111111-1111-4111-8111-111111111111',
        contentHash: 'a'.repeat(64),
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
      })
      .expect(201);

    // The service enforces the gate; the controller's job is to hand it the
    // purpose that carries the flag. Without this, opt-in would be ungated
    // no matter what the service does.
    expect(optIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        key: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        requiresApprovedNoticeToOptIn: true,
      }),
    );
  });

  it('4: opt-out is not gated on legal review — the purpose flag only governs opt-in', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_MANAGE));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/platform/privacy/telemetry/opt-out')
      .send({ reasonCode: 'preference_changed' })
      .expect(201);

    expect(optOut).toHaveBeenCalled();
  });

  it('always operates on the neutral purpose, never the legacy one', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_VIEW));
    app = await buildApp('social');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/platform/privacy/telemetry')
      .expect(200);

    expect(getStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ key: PLATFORM_PRODUCT_TELEMETRY_PURPOSE }),
    );
  });

  it('surfaces the legacy acceptance as separate history, never merged into consent', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_VIEW));
    findRelatedPurposeConsent.mockResolvedValue({
      purposeKey: 'leadflow_product_improvement_v1',
      state: 'opted_in',
      occurredAt: '2026-07-30T12:00:00.000Z',
      noticeVersion: 1,
    });
    app = await buildApp('social');

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/platform/privacy/telemetry')
      .expect(200);

    const body = response.body as {
      consent: { state: string };
      legacyConsent: { purposeKey: string; state: string } | null;
    };

    expect(body.consent.state).toBe('not_configured');
    expect(body.legacyConsent).toMatchObject({
      purposeKey: 'leadflow_product_improvement_v1',
      state: 'opted_in',
    });
  });
});
