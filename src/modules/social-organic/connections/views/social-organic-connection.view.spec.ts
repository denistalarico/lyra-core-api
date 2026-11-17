import type { SocialOrganicConnectionEntity } from '../../entities';
import {
  readSelectableAssets,
  toSocialOrganicConnectionView,
} from './social-organic-connection.view';

describe('social organic connection view', () => {
  it('constructs output without credentials, scope ids or opaque provider metadata', () => {
    const connection = {
      id: 'connection-id',
      tenantId: 'tenant-secret',
      workspaceId: 'workspace-secret',
      agencyClientId: null,
      provider: 'network_alpha',
      connectionStatus: 'awaiting_selection',
      authorizationMethod: 'oauth_user',
      credentialVersion: 1,
      accessTokenEncrypted: 'encrypted-secret',
      refreshTokenEncrypted: 'refresh-secret',
      tokenExpiresAt: null,
      scopes: ['publish'],
      oauthStateHash: null,
      oauthExpiresAt: new Date('2026-09-01T00:15:00.000Z'),
      createdById: 'user-a',
      lastError: null,
      credentialRemovedAt: null,
      metadata: {
        opaqueSecret: 'must-not-leak',
        selectableAssets: [
          {
            externalAssetId: 'external-asset',
            assetType: 'profile',
            displayName: 'Profile',
            selectionData: { opaqueSecret: 'must-not-leak' },
          },
        ],
      },
      assets: [],
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    } as SocialOrganicConnectionEntity;

    const serialized = JSON.stringify(
      toSocialOrganicConnectionView(connection),
    );

    expect(serialized).not.toContain('encrypted-secret');
    expect(serialized).not.toContain('refresh-secret');
    expect(serialized).not.toContain('tenant-secret');
    expect(serialized).not.toContain('workspace-secret');
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).toContain('external-asset');
  });

  it.each(['tiktok_business', 'tiktok', 'linkedin', 'instagram_direct'])(
    'keeps the %s connector mode so the panel can place the selection',
    (mode) => {
      const view = toSocialOrganicConnectionView({
        id: 'c',
        provider: mode,
        connectionStatus: 'awaiting_selection',
        authorizationMethod: 'oauth_user',
        agencyClientId: null,
        scopes: [],
        tokenExpiresAt: null,
        lastError: null,
        credentialRemovedAt: null,
        metadata: { connectionMode: mode, selectableAssets: [] },
        assets: [],
        createdAt: new Date('2026-11-17T00:00:00.000Z'),
        updatedAt: new Date('2026-11-17T00:00:00.000Z'),
      } as unknown as SocialOrganicConnectionEntity);
      expect(view.connectionMode).toBe(mode);
    },
  );

  it('drops an unknown connector mode', () => {
    const view = toSocialOrganicConnectionView({
      id: 'c',
      provider: 'x',
      connectionStatus: 'connected',
      authorizationMethod: 'oauth_user',
      agencyClientId: null,
      scopes: [],
      tokenExpiresAt: null,
      lastError: null,
      credentialRemovedAt: null,
      metadata: { connectionMode: 'made_up' },
      assets: [],
      createdAt: new Date('2026-11-17T00:00:00.000Z'),
      updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    } as unknown as SocialOrganicConnectionEntity);
    expect(view.connectionMode).toBeNull();
  });

  it('drops malformed selectable assets', () => {
    expect(
      readSelectableAssets({
        selectableAssets: [null, {}, { externalAssetId: 'id-only' }],
      }),
    ).toEqual([]);
  });
});
