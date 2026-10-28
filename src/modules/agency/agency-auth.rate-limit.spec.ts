import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import request from 'supertest';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { AuthRateLimitService } from '../../common/security/auth-rate-limit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { EmailService } from '../email/email.service';
import { AgencyAuthController } from './agency-auth.controller';
import { AgencyAuthService } from './agency-auth.service';
import { AgencyIdentityCredentialsService } from './agency-identity-credentials.service';

// otplib is ESM-only; the credentials service imports it.
jest.mock('otplib', () => ({ verify: jest.fn() }));

const EMAIL = 'ana@agencia.com';
const PASSWORD = 'right-password';

type EventRow = {
  tenantId: string;
  userId: string;
  eventType: string;
  createdAt: Date;
};

/** Stands in for `user_login_events`: the only state that survives a restart. */
function loginEventsTable() {
  const rows: EventRow[] = [];
  return {
    rows,
    create: (row: Omit<EventRow, 'createdAt'>) => row,
    save: (row: Omit<EventRow, 'createdAt'>) => {
      rows.push({ ...row, createdAt: new Date() });
      return Promise.resolve(row);
    },
    find: ({ where }: { where: Array<{ tenantId: string; userId: string }> }) =>
      Promise.resolve(
        rows
          .filter(
            (row) =>
              row.eventType !== 'logout' &&
              where.some(
                (id) =>
                  id.tenantId === row.tenantId && id.userId === row.userId,
              ),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
  };
}

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD);
});

/** One API process: fresh in-memory limits, shared persisted events. */
function bootProcess(events = loginEventsTable()) {
  const identity = {
    tenantId: 't1',
    userId: 'u1',
    currentEmail: EMAIL,
    passwordHash,
    twoFactorEnabled: false,
    twoFactorSecretEncrypted: null,
    loginAlertsEnabled: false,
  };
  const securityRepo = {
    find: jest.fn(({ where }: { where: { currentEmail: string } }) =>
      Promise.resolve(where.currentEmail === EMAIL ? [identity] : []),
    ),
    findOne: jest.fn(() => Promise.resolve(identity)),
  };
  const emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const credentials = new AgencyIdentityCredentialsService(
    securityRepo as never,
    {} as never,
    events as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    emailService as unknown as EmailService,
    new SettingsCryptoService(),
  );
  const rateLimit = new AuthRateLimitService();
  const service = new AgencyAuthService(
    securityRepo as never,
    {
      findOne: jest.fn().mockResolvedValue({
        id: 'wu1',
        workspaceId: 'w1',
        role: 'owner',
        name: 'Ana',
        email: EMAIL,
      }),
    } as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    {
      update: jest.fn(),
      create: (row: object) => row,
      save: (row: object) => Promise.resolve({ ...row, id: 's1' }),
    } as never,
    {
      create: (row: object) => row,
      save: jest.fn().mockResolvedValue(undefined),
    } as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    new JwtService(),
    new ConfigService({ JWT_ACCESS_SECRET: 'sec-02-test-secret-0123456789' }),
    emailService as unknown as EmailService,
    credentials,
    rateLimit,
  );

  return { service, credentials, events, emailService, securityRepo };
}

const fromIp = (ip: string) =>
  ({
    ip,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as Request;

async function attempt(
  service: AgencyAuthService,
  ip: string,
  password = 'wrong-password',
  email = EMAIL,
) {
  try {
    await service.login({ email, password }, fromIp(ip));
    return { status: 200 };
  } catch (error) {
    const httpError = error as {
      getStatus?: () => number;
      getResponse?: () => unknown;
      retryAfterSeconds?: number;
    };
    return {
      status: httpError.getStatus?.() ?? 500,
      body: httpError.getResponse?.(),
      retryAfter: httpError.retryAfterSeconds,
    };
  }
}

describe('SEC-02 Agency login over HTTP (trust proxy = loopback)', () => {
  let app: NestExpressApplication;
  let bundle: ReturnType<typeof bootProcess>;

  beforeEach(async () => {
    bundle = bootProcess();
    const moduleRef = await Test.createTestingModule({
      controllers: [AgencyAuthController],
      providers: [{ provide: AgencyAuthService, useValue: bundle.service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 'loopback');
    await app.init();
  });

  afterEach(() => app.close());

  const login = (forwardedFor: string) =>
    request(app.getHttpServer())
      .post('/agency/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: EMAIL, password: 'wrong-password' });

  it('criterion 1 + 6: the 6th failure of the same account and client IP is 429 with Retry-After', async () => {
    // Each request forges a different left-most entry; nginx's appended
    // address (the real client) is what counts.
    for (let index = 0; index < 5; index += 1) {
      await login(`10.9.9.${index}, 203.0.113.9`).expect(401);
    }

    const blocked = await login('10.9.9.99, 203.0.113.9').expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(14 * 60);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);

    // Another real client is unaffected.
    await login('10.9.9.99, 198.51.100.20').expect(401);
  });
});

describe('SEC-02 Agency login limits', () => {
  it('a correct password resets the IP+account counter', async () => {
    const { service } = bootProcess();
    for (let index = 0; index < 4; index += 1) {
      expect((await attempt(service, '203.0.113.1')).status).toBe(401);
    }
    expect((await attempt(service, '203.0.113.1', PASSWORD)).status).toBe(200);
    for (let index = 0; index < 5; index += 1) {
      expect((await attempt(service, '203.0.113.1')).status).toBe(401);
    }
  });

  it('criterion 2: 10 failures from different IPs lock the account, and the lock survives a restart', async () => {
    const first = bootProcess();
    for (let index = 0; index < 10; index += 1) {
      expect((await attempt(first.service, `198.51.100.${index}`)).status).toBe(
        401,
      );
    }

    const locked = await attempt(first.service, '192.0.2.1', PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.retryAfter).toBeGreaterThan(14 * 60);

    // Restart: new process, empty memory, same persisted login events.
    const restarted = bootProcess(first.events);
    const afterRestart = await attempt(
      restarted.service,
      '192.0.2.2',
      PASSWORD,
    );
    expect(afterRestart.status).toBe(429);
    expect(afterRestart.retryAfter).toBeGreaterThan(14 * 60);
  });

  it('criterion 3: an attacker on one IP does not lock the victim on another IP before the account limit', async () => {
    const { service } = bootProcess();
    for (let index = 0; index < 5; index += 1) {
      await attempt(service, '203.0.113.66');
    }
    expect((await attempt(service, '203.0.113.66')).status).toBe(429);

    expect((await attempt(service, '198.51.100.7', PASSWORD)).status).toBe(200);
  });

  it('criterion 4: unknown email and wrong password give the same answer, both paying one argon2 verification', async () => {
    const { service, credentials } = bootProcess();
    const decoy = jest.spyOn(credentials, 'verifyDecoyPassword');
    const verify = jest.spyOn(credentials, 'verifyPassword');

    const wrongPassword = await attempt(service, '203.0.113.2');
    const unknownEmail = await attempt(
      service,
      '203.0.113.3',
      'wrong-password',
      'ninguem@agencia.com',
    );

    expect(unknownEmail).toEqual(wrongPassword);
    expect(wrongPassword).toMatchObject({
      status: 401,
      body: { message: 'Invalid credentials' },
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(decoy).toHaveBeenCalledTimes(1);
  });

  it('an unknown email locks like a known one (a 429 does not reveal existence)', async () => {
    const { service } = bootProcess();
    for (let index = 0; index < 10; index += 1) {
      await attempt(
        service,
        `198.51.100.${index}`,
        'x-password',
        'ghost@agencia.com',
      );
    }
    const known = bootProcess();
    for (let index = 0; index < 10; index += 1) {
      await attempt(known.service, `198.51.100.${index}`);
    }

    const ghost = await attempt(
      service,
      '192.0.2.9',
      'x-password',
      'ghost@agencia.com',
    );
    const real = await attempt(known.service, '192.0.2.9');
    expect(ghost.status).toBe(429);
    expect(ghost.body).toEqual(real.body);
    expect(ghost.retryAfter).toBeGreaterThan(14 * 60);
    expect(real.retryAfter).toBeGreaterThan(14 * 60);
  });

  it('criterion 5: forgot answers the same for existing and unknown emails, and hides send failures', async () => {
    const { service, emailService } = bootProcess();
    emailService.sendEmail.mockRejectedValueOnce(new Error('smtp down'));

    await expect(
      service.forgotPassword(EMAIL, fromIp('203.0.113.4')),
    ).resolves.toEqual({ success: true });
    await expect(
      service.forgotPassword('ninguem@agencia.com', fromIp('203.0.113.4')),
    ).resolves.toEqual({ success: true });

    // The per-email limit is spent whether or not the email exists.
    for (let index = 0; index < 4; index += 1) {
      await service.forgotPassword(
        'ninguem@agencia.com',
        fromIp(`192.0.2.${index}`),
      );
    }
    await expect(
      service.forgotPassword('ninguem@agencia.com', fromIp('192.0.2.50')),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('2FA verification is limited per identity, whatever the IP', async () => {
    const { service } = bootProcess();
    const token = await new JwtService().signAsync(
      {
        sub: 'u1',
        tenantId: 't1',
        type: 'agency-2fa',
        method: 'authenticator',
      },
      { secret: 'sec-02-test-secret-0123456789', expiresIn: '5m' },
    );
    const verifyCode = (ip: string) =>
      service
        .loginWith2FA(token, '000000', fromIp(ip))
        .catch((error: { getStatus: () => number }) => error.getStatus());

    for (let index = 0; index < 5; index += 1) {
      expect(await verifyCode(`198.51.100.${index}`)).toBe(401);
    }
    expect(await verifyCode('192.0.2.77')).toBe(429);
  });
});
