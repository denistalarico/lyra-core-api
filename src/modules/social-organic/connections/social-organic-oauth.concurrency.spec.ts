/* eslint-disable @typescript-eslint/require-await -- the serialized transaction double models commit ordering. */
import { createHash } from 'crypto';
import type { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialOrganicCredentialResolver } from '../credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import {
  SocialOrganicOAuthProviderHooks,
  SocialOrganicOAuthProviderRegistry,
} from './social-organic-oauth.provider';
import { SocialOrganicOAuthService } from './social-organic-oauth.service';

describe('SocialOrganicOAuthService callback concurrency', () => {
  const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'organic-oauth-concurrency-key';
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  });

  it('serializes double callback consumption so exactly one exchanges the code', async () => {
    const provider = 'network_alpha';
    const state = 'single-use-state';
    const row = {
      id: 'connection-id',
      provider,
      connectionStatus: 'pending',
      oauthStateHash: createHash('sha256').update(state).digest('hex'),
      oauthExpiresAt: new Date(Date.now() + 60_000),
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      scopes: [],
      lastError: null,
      metadata: {},
    } as unknown as SocialOrganicConnectionEntity;
    const lockCalls: string[] = [];
    const repository = {
      createQueryBuilder: jest.fn(() => {
        const builder: Record<string, jest.Mock> = {};
        for (const method of ['where', 'andWhere']) {
          builder[method] = jest.fn(() => builder);
        }
        builder.setLock = jest.fn((mode: string) => {
          lockCalls.push(mode);
          return builder;
        });
        builder.getOne = jest.fn(async () => (row.oauthStateHash ? row : null));
        return builder;
      }),
      save: jest.fn(async () => row),
    };
    let transactionTail: Promise<unknown> = Promise.resolve();
    const dataSource = {
      transaction: jest.fn(
        <T>(callback: (manager: unknown) => Promise<T>): Promise<T> => {
          const result = transactionTail.then(() =>
            callback({ getRepository: () => repository }),
          );
          transactionTail = result.catch(() => undefined);
          return result;
        },
      ),
    };
    const hooks: SocialOrganicOAuthProviderHooks = {
      configuration: {
        provider,
        authorizationMethod: 'oauth_user',
        scopes: ['publish'],
        loginConfig: {},
        callbackUrl: new URL('https://api.example.test/callback'),
        frontendRedirectUrl: new URL(
          'https://app.example.test/social/settings',
        ),
      },
      buildAuthorizationUrl: jest.fn(() => 'https://authorize.example.test'),
      exchangeCode: jest.fn(async () => ({ accessToken: 'token' })),
      discoverAssets: jest.fn(async () => [
        { externalAssetId: 'asset-1', assetType: 'profile' },
      ]),
      prepareAsset: jest.fn(async () => ({})),
    };
    const crypto = new SettingsCryptoService();
    const service = new SocialOrganicOAuthService(
      {} as Repository<SocialOrganicConnectionEntity>,
      dataSource as unknown as DataSource,
      crypto,
      new SocialOrganicCredentialResolver(
        {} as Repository<SocialOrganicAssetEntity>,
        {} as Repository<SocialOrganicConnectionEntity>,
        crypto,
      ),
      new SocialOrganicOAuthProviderRegistry([hooks]),
    );

    const [first, second] = await Promise.all([
      service.handleCallback({ provider, state, code: 'code-a' }),
      service.handleCallback({ provider, state, code: 'code-a' }),
    ]);

    expect(
      [first, second].map((redirect) =>
        new URL(redirect).searchParams.get('status'),
      ),
    ).toEqual(expect.arrayContaining(['select_assets', 'error']));
    expect(
      [first, second].map((redirect) =>
        new URL(redirect).searchParams.get('reason'),
      ),
    ).toContain('invalid_state');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const exchangeCode = hooks.exchangeCode as jest.Mock;
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(lockCalls).toEqual(['pessimistic_write', 'pessimistic_write']);
  });
});
