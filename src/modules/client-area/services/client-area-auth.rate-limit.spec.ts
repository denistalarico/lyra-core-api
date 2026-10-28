import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import type { Server } from 'http';
import request from 'supertest';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { AuthRateLimitService } from '../../../common/security/auth-rate-limit.service';
import { AgencyIdentityCredentialsService } from '../../agency/agency-identity-credentials.service';
import type { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import type { EmailService } from '../../email/email.service';
import { ClientAreaAuthController } from '../controllers/client-area-auth.controller';
import { ClientAreaEnabledGuard } from '../guards/client-area.guards';
import { ClientAreaAuthService } from './client-area-auth.service';
import { ClientAreaPasswordResetService } from './client-area-password-reset.service';
import {
  ClientAreaRateLimitService,
  CLIENT_AREA_RATE_LIMIT_RULES,
} from './client-area-rate-limit.service';

// otplib is ESM-only; the credentials service imports it.
jest.mock('otplib', () => ({ verify: jest.fn() }));

const EMAIL = 'cliente@empresa.com';
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
  } as unknown as AgencyUserSecuritySettingsEntity;
  const credentials = new AgencyIdentityCredentialsService(
    {} as never,
    {} as never,
    events as never,
    {} as never,
    {} as EmailService,
    new SettingsCryptoService(),
  );
  const auth = new ClientAreaAuthService(
    {} as never,
    {
      create: (row: object) => row,
      save: (row: object) => Promise.resolve({ ...row, id: 's1' }),
    } as never,
    {} as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    credentials,
    {} as never,
    new JwtService(),
    new ConfigService({
      CLIENT_AREA_ENABLED: 'true',
      JWT_CLIENT_AREA_ACCESS_SECRET: 'sec-02-client-area-012345678901234567890',
    }),
    {} as never,
    undefined,
    new AuthRateLimitService(),
  );
  jest
    .spyOn(auth, 'findEligibleIdentities')
    .mockImplementation((email: string) =>
      Promise.resolve(email.trim().toLowerCase() === EMAIL ? [identity] : []),
    );

  return { auth, credentials, events };
}

const fromIp = (ip: string) =>
  ({
    headers: { 'x-real-ip': ip },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as Request;

async function attempt(
  auth: ClientAreaAuthService,
  password = 'wrong-password',
  email = EMAIL,
) {
  try {
    await auth.login(email, password, fromIp('203.0.113.1'));
    return { status: 200 };
  } catch (error) {
    const httpError = error as {
      getStatus: () => number;
      getResponse: () => unknown;
      retryAfterSeconds?: number;
    };
    return {
      status: httpError.getStatus(),
      body: httpError.getResponse(),
      retryAfter: httpError.retryAfterSeconds,
    };
  }
}

describe('SEC-02 Client Area login over HTTP', () => {
  let app: INestApplication;
  let limits: ClientAreaRateLimitService;
  let login: jest.Mock;

  beforeEach(async () => {
    limits = new ClientAreaRateLimitService();
    login = jest.fn((_email: string, password: string) =>
      password === PASSWORD
        ? Promise.resolve({ accessToken: 'a' })
        : Promise.reject(new UnauthorizedException('Invalid credentials')),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [ClientAreaAuthController],
      providers: [
        { provide: ClientAreaAuthService, useValue: { login } },
        { provide: ClientAreaPasswordResetService, useValue: {} },
        { provide: ClientAreaRateLimitService, useValue: limits },
      ],
    })
      .overrideGuard(ClientAreaEnabledGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  const post = (ip: string, password = 'wrong-password') =>
    request(app.getHttpServer() as Server)
      .post('/client-area/auth/login')
      .set('X-Real-IP', ip)
      .send({ email: EMAIL, password });

  it('criterion 1: the 6th attempt of the same account and IP is 429 with Retry-After', async () => {
    expect(CLIENT_AREA_RATE_LIMIT_RULES.login_account.limit).toBe(5);
    for (let index = 0; index < 5; index += 1) {
      await post('203.0.113.9').expect(401);
    }

    const blocked = await post('203.0.113.9').expect(429);
    expect(blocked.body).toMatchObject({ code: 'client_area_rate_limited' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(14 * 60);
    await post('198.51.100.20').expect(401);
  });

  it('a correct password resets the IP+account counter', async () => {
    for (let index = 0; index < 4; index += 1) {
      await post('203.0.113.9').expect(401);
    }
    await post('203.0.113.9', PASSWORD).expect(200);
    for (let index = 0; index < 5; index += 1) {
      await post('203.0.113.9').expect(401);
    }
  });
});

describe('SEC-02 Client Area account lock', () => {
  it('criterion 2: 10 failures lock the account, and the lock survives a restart', async () => {
    const first = bootProcess();
    for (let index = 0; index < 10; index += 1) {
      expect((await attempt(first.auth)).status).toBe(401);
    }
    expect(first.events.rows).toHaveLength(10);

    const locked = await attempt(first.auth, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ statusCode: 429 });

    const restarted = bootProcess(first.events);
    const afterRestart = await attempt(restarted.auth, PASSWORD);
    expect(afterRestart.status).toBe(429);
    expect(afterRestart.retryAfter).toBeGreaterThan(14 * 60);
  });

  it('criterion 4: unknown email and wrong password give the same answer, both paying one argon2 verification', async () => {
    const { auth, credentials } = bootProcess();
    const decoy = jest.spyOn(credentials, 'verifyDecoyPassword');

    const wrongPassword = await attempt(auth);
    const unknownEmail = await attempt(
      auth,
      'wrong-password',
      'ninguem@empresa.com',
    );

    expect(unknownEmail).toEqual(wrongPassword);
    expect(wrongPassword).toMatchObject({
      status: 401,
      body: { code: 'client_area_invalid_credentials' },
    });
    expect(decoy).toHaveBeenCalledTimes(1);
  });

  it('an unknown email locks like a known one', async () => {
    const { auth } = bootProcess();
    for (let index = 0; index < 10; index += 1) {
      await attempt(auth, 'wrong-password', 'ghost@empresa.com');
    }
    expect(
      (await attempt(auth, 'wrong-password', 'ghost@empresa.com')).status,
    ).toBe(429);
  });
});
