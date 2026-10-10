import {
  Controller,
  Get,
  Req,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import type { ClientAreaRequest } from './client-area.types';
import { ClientAreaAuthGuard } from './guards/client-area.guards';
import { ClientAreaManagementService } from './services/client-area-management.service';
import { ClientAreaSessionService } from './services/client-area-session.service';
import { ClientAreaJwtStrategy } from './strategies/client-area-jwt.strategy';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';

const AGENCY_SECRET = 'agency-access-secret-for-ca1-spec-000000';
const CLIENT_SECRET = 'client-area-secret-for-ca1-spec-11111111';
const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const SESSION = '00000000-0000-4000-8000-000000000003';

@Controller('probe')
class ProbeController {
  @Get('agency')
  @UseGuards(JwtAuthGuard)
  agency() {
    return { ok: true };
  }

  @Get('client')
  @UseGuards(ClientAreaAuthGuard)
  client(@Req() req: ClientAreaRequest) {
    return { identity: req.clientAreaIdentity };
  }
}

/**
 * CA1 blocking gate (§52) at the token layer: each surface's access token is
 * rejected by the other surface's strategy, whatever the headers say. The
 * PostgreSQL matrix repeats this end-to-end with real sessions/refresh.
 */
describe('CA1 cross-surface access tokens', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const authenticate = jest.fn();
  const assertIdentityAgencyEnabled = jest.fn();
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = AGENCY_SECRET;
    process.env.JWT_CLIENT_AREA_ACCESS_SECRET = CLIENT_SECRET;
    process.env.CLIENT_AREA_ENABLED = 'true';
    delete process.env.JWT_2FA_SECRET;
    authenticate.mockReset();
    authenticate.mockImplementation(
      (payload: { sub: string; tenantId: string; sessionId: string }) =>
        Promise.resolve({
          userId: payload.sub,
          tenantId: payload.tenantId,
          sessionId: payload.sessionId,
          email: 'u1@example.com',
        }),
    );
    // `assertIdentityAgencyEnabled` is the CA3 Agency-enabled-gate business
    // rule (DB-backed: active memberships + `client_area_settings.enabled`).
    // It is exercised end-to-end by the Postgres security-matrix spec; this
    // suite is about the token/strategy boundary between the two surfaces,
    // so it fakes this single downstream call (same pattern as
    // `ClientAreaSessionService.authenticate` below) without touching
    // `ClientAreaAuthGuard`, `ClientAreaJwtStrategy` or `JwtStrategy`, all of
    // which run for real here.
    assertIdentityAgencyEnabled.mockReset();
    assertIdentityAgencyEnabled.mockResolvedValue({ enabled: true });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        PassportModule,
        JwtModule.register({}),
      ],
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        // SEC-A1: the real authority, over a stubbed active membership — this
        // suite is about the token boundary, not membership.
        {
          provide: TenantContextAuthority,
          useValue: new TenantContextAuthority({
            getRepository: () => ({
              findOne: () =>
                Promise.resolve({ id: 'membership', role: 'owner' }),
            }),
          } as never),
        },
        ClientAreaJwtStrategy,
        ClientAreaAuthGuard,
        { provide: ClientAreaSessionService, useValue: { authenticate } },
        {
          provide: ClientAreaManagementService,
          useValue: { assertIdentityAgencyEnabled },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
    process.env = { ...savedEnv };
  });

  const agencyToken = () =>
    jwt.signAsync(
      {
        sub: USER,
        tenantId: TENANT,
        workspaceId: TENANT,
        role: 'owner',
        sessionId: SESSION,
        email: 'op@example.com',
      },
      { secret: AGENCY_SECRET, expiresIn: '15m' },
    );
  const clientToken = (
    overrides: Record<string, unknown> = {},
    secret = CLIENT_SECRET,
  ) =>
    jwt.signAsync(
      {
        sub: USER,
        tenantId: TENANT,
        sessionId: SESSION,
        typ: 'client_area',
        ...overrides,
      },
      { secret, expiresIn: '15m' },
    );
  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  it('keeps legacy Agency tokens (no typ) working on Agency routes', async () => {
    await get('/probe/agency', await agencyToken()).expect(200);
  });

  it('Client token → Agency route: 401', async () => {
    await get('/probe/agency', await clientToken()).expect(401);
  });

  it('Agency token → Client Area route: 401', async () => {
    await get('/probe/client', await agencyToken()).expect(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('a client-shaped token signed with the Agency secret is rejected by both surfaces', async () => {
    const forged = await clientToken({}, AGENCY_SECRET);
    await get('/probe/client', forged).expect(401);
    await get('/probe/agency', forged).expect(401);
  });

  it('the Client Area 2FA challenge token is not an access token', async () => {
    const challenge = await clientToken({
      typ: 'client_area_2fa',
      method: 'email',
    });
    await get('/probe/client', challenge).expect(401);
  });

  it('CA2: the invitation-acceptance 2FA token is no bearer on either surface', async () => {
    const challenge = await clientToken({
      typ: 'client_area_invite_2fa',
      invitationId: '00000000-0000-4000-8000-000000000009',
      method: 'authenticator',
    });
    await get('/probe/client', challenge).expect(401);
    await get('/probe/agency', challenge).expect(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('Agency/Suite 2FA challenge tokens signed with the access secret no longer pass JwtAuthGuard', async () => {
    for (const type of ['agency-2fa', '2fa']) {
      const challenge = await jwt.signAsync(
        { sub: USER, tenantId: TENANT, type, method: 'authenticator' },
        { secret: AGENCY_SECRET, expiresIn: '5m' },
      );
      await get('/probe/agency', challenge).expect(401);
    }
  });

  it('rejects malformed ids before touching the session store', async () => {
    await get(
      '/probe/client',
      await clientToken({ sessionId: 'not-a-uuid' }),
    ).expect(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('takes identity from the token, never from forged headers', async () => {
    const response = await get('/probe/client', await clientToken())
      .set('x-tenant-id', '00000000-0000-4000-8000-0000000000ff')
      .set('x-user-id', '00000000-0000-4000-8000-0000000000fe')
      .set('x-workspace-id', '00000000-0000-4000-8000-0000000000fd')
      .set('x-lyra-company-context-id', '00000000-0000-4000-8000-0000000000fc')
      .expect(200);

    expect((response.body as { identity: unknown }).identity).toMatchObject({
      userId: USER,
      tenantId: TENANT,
      sessionId: SESSION,
    });
    expect(authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: USER,
        tenantId: TENANT,
        sessionId: SESSION,
      }),
    );
  });

  it('kill switch off: 404 even with a valid token', async () => {
    const token = await clientToken();
    process.env.CLIENT_AREA_ENABLED = 'false';
    await get('/probe/client', token).expect(404);
  });

  it('missing dedicated secret: surface closed, never verified with the Agency secret', async () => {
    const token = await clientToken({}, AGENCY_SECRET);
    delete process.env.JWT_CLIENT_AREA_ACCESS_SECRET;
    await get('/probe/client', token).expect(404);
  });
});
