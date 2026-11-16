import { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialInternalAccessService } from '../internal/social-internal-access.service';
import { SocialAdCredentialResolver } from './social-ad-credential.resolver';

const crypto = new SettingsCryptoService();

function row(overrides: Partial<SocialAdAccountConnectionEntity> = {}) {
  return {
    id: 'c1',
    tenantId: 't1',
    workspaceId: 'w1',
    agencyClientId: null,
    companyContextId: null,
    provider: 'linkedin_ads',
    authorizationMethod: 'linkedin_oauth',
    externalAccountId: '506333826',
    currency: 'BRL',
    timezone: 'UTC',
    connectionStatus: 'connected',
    credentialVersion: 2,
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    credentialRemovedAt: null,
    ...overrides,
  } as SocialAdAccountConnectionEntity;
}

function resolverFor(
  connection: SocialAdAccountConnectionEntity,
  token: string | null = 'linkedin-token',
) {
  const stored = token ? crypto.encrypt(token) : null;
  const queryBuilder = {
    select: () => queryBuilder,
    where: () => queryBuilder,
    getOne: () => Promise.resolve({ accessTokenEncrypted: stored } as unknown),
  };
  const repository = {
    findOne: () => Promise.resolve(connection),
    createQueryBuilder: () => queryBuilder,
  } as unknown as Repository<SocialAdAccountConnectionEntity>;

  return new SocialAdCredentialResolver(
    repository,
    crypto,
    new SocialInternalAccessService(),
  );
}

const input = {
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
};

describe('SocialAdCredentialResolver — linkedin_ads (D-I7)', () => {
  it('resolves the token stored in the row, the id as digits, zone UTC', async () => {
    const credential = await resolverFor(row()).resolve(input);

    expect(credential).toMatchObject({
      provider: 'linkedin_ads',
      authorizationMethod: 'linkedin_oauth',
      externalAccountId: '506333826',
      timezone: 'UTC',
    });
    expect(credential.accessToken).toBe('linkedin-token');
    // The token never serializes.
    expect(JSON.stringify(credential)).not.toContain('linkedin-token');
  });

  it('asks for reconnection once the 60-day token expired', async () => {
    await expect(
      resolverFor(row({ tokenExpiresAt: new Date(Date.now() - 1000) })).resolve(
        input,
      ),
    ).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('refuses an account id that is not digits', async () => {
    await expect(
      resolverFor(row({ externalAccountId: 'act_123' })).resolve(input),
    ).rejects.toMatchObject({ code: 'account_not_bound' });
  });

  it('refuses a provider/method pair that does not belong together', async () => {
    await expect(
      resolverFor(row({ authorizationMethod: 'business_login' })).resolve(
        input,
      ),
    ).rejects.toMatchObject({ code: 'unsupported_authorization_method' });
    await expect(
      resolverFor(
        row({ provider: 'meta_ads', externalAccountId: 'act_123' }),
      ).resolve(input),
    ).rejects.toMatchObject({ code: 'unsupported_authorization_method' });
  });

  it('refuses a connection whose token is gone', async () => {
    await expect(resolverFor(row(), null).resolve(input)).rejects.toMatchObject(
      { code: 'token_missing' },
    );
  });
});
