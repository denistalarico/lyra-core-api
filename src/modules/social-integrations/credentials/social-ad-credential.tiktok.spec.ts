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
    provider: 'tiktok_ads',
    authorizationMethod: 'tiktok_business',
    externalAccountId: '7012345678901234567',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    connectionStatus: 'connected',
    credentialVersion: 1,
    tokenExpiresAt: null,
    credentialRemovedAt: null,
    ...overrides,
  } as SocialAdAccountConnectionEntity;
}

function resolverFor(connection: SocialAdAccountConnectionEntity) {
  const stored = crypto.encrypt('tiktok-token');
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

describe('SocialAdCredentialResolver — tiktok_ads (D-I7)', () => {
  it('resolves the token stored in the row with the advertiser zone', async () => {
    const credential = await resolverFor(row()).resolve(input);

    expect(credential).toMatchObject({
      provider: 'tiktok_ads',
      authorizationMethod: 'tiktok_business',
      externalAccountId: '7012345678901234567',
      timezone: 'America/Sao_Paulo',
    });
    expect(credential.accessToken).toBe('tiktok-token');
  });

  it('refuses an advertiser without a usable zone instead of guessing', async () => {
    await expect(
      resolverFor(row({ timezone: null })).resolve(input),
    ).rejects.toMatchObject({ code: 'timezone_missing' });
  });

  it('refuses a method of another provider on a TikTok row, and vice versa', async () => {
    await expect(
      resolverFor(row({ authorizationMethod: 'linkedin_oauth' })).resolve(
        input,
      ),
    ).rejects.toMatchObject({ code: 'unsupported_authorization_method' });
    await expect(
      resolverFor(
        row({ provider: 'linkedin_ads', externalAccountId: '506333826' }),
      ).resolve(input),
    ).rejects.toMatchObject({ code: 'unsupported_authorization_method' });
  });

  it('honours an expiry when TikTok stated one', async () => {
    await expect(
      resolverFor(row({ tokenExpiresAt: new Date(Date.now() - 1000) })).resolve(
        input,
      ),
    ).rejects.toMatchObject({ code: 'token_expired' });
  });
});
