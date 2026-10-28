import { randomUUID } from 'crypto';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { ACCOUNT_LOCKOUT_POLICY } from '../../common/security/account-lockout.policy';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import type { EmailService } from '../email/email.service';
import { AgencyIdentityCredentialsService } from './agency-identity-credentials.service';
import { AgencyUserLoginEventEntity } from './entities/agency-auth.entities';

// otplib is ESM-only; the credentials service imports it.
jest.mock('otplib', () => ({ verify: jest.fn() }));

const run = describePostgresIntegration();
const MINUTE = 60 * 1000;

run('SEC-02 account lock rebuilt from user_login_events (PostgreSQL)', () => {
  const tenantId = randomUUID();
  const victim = { tenantId, userId: randomUUID() };
  const other = { tenantId, userId: randomUUID() };
  let credentials: AgencyIdentityCredentialsService;

  // Only this run's random tenant; `user_login_events` has no dependants.
  const resetFixtures = () =>
    AgencyDataSource.query(
      'DELETE FROM user_login_events WHERE tenant_id = $1',
      [tenantId],
    );

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    credentials = new AgencyIdentityCredentialsService(
      {} as never,
      {} as never,
      AgencyDataSource.getRepository(AgencyUserLoginEventEntity),
      {} as never,
      {} as EmailService,
      new SettingsCryptoService(),
    );
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  beforeEach(resetFixtures);

  async function insertEvents(
    identity: { tenantId: string; userId: string },
    eventType: string,
    times: Date[],
    surface = 'agency',
  ) {
    for (const createdAt of times) {
      await AgencyDataSource.query(
        `INSERT INTO user_login_events
           (id, tenant_id, user_id, event_type, surface, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          identity.tenantId,
          identity.userId,
          eventType,
          surface,
          createdAt,
        ],
      );
    }
  }

  const minutesAgo = (now: number, minutes: number[]) =>
    minutes.map((minute) => new Date(now - minute * MINUTE));

  it('locks after 10 failures across surfaces, and only that identity', async () => {
    const now = Date.now();
    await insertEvents(
      victim,
      'login_failed',
      minutesAgo(now, [9, 8, 7, 6, 5]),
    );
    await insertEvents(
      victim,
      'login_failed',
      minutesAgo(now, [4.5, 4, 3, 2, 1]),
      'client_area',
    );
    await insertEvents(victim, 'logout', minutesAgo(now, [0.5]));

    const lockedUntil = await credentials.accountLockedUntil([victim], now);
    expect(lockedUntil).toBe(now - MINUTE + ACCOUNT_LOCKOUT_POLICY.lockMs);
    expect(await credentials.accountLockedUntil([other], now)).toBeNull();
    expect(await credentials.accountLockedUntil([other, victim], now)).toBe(
      lockedUntil,
    );
  });

  it('a recorded success restarts the count', async () => {
    const now = Date.now();
    await insertEvents(
      victim,
      'login_failed',
      minutesAgo(now, [9, 8, 7, 6, 5]),
    );
    await insertEvents(victim, 'login_success', minutesAgo(now, [4.5]));
    await insertEvents(victim, 'login_failed', minutesAgo(now, [4, 3, 2, 1]));

    expect(await credentials.accountLockedUntil([victim], now)).toBeNull();
  });

  it('applies the 60-minute repeat lock from the persisted history', async () => {
    const now = Date.now();
    const burst = (endMinutesAgo: number) =>
      minutesAgo(
        now,
        Array.from({ length: 10 }, (_, index) => endMinutesAgo + 9 - index),
      );
    await insertEvents(victim, 'login_failed', burst(5 * 60));
    await insertEvents(victim, 'login_failed', burst(1));

    expect(await credentials.accountLockedUntil([victim], now)).toBe(
      now - MINUTE + ACCOUNT_LOCKOUT_POLICY.repeatLockMs,
    );
  });
});
