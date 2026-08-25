import type { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import {
  TOKEN_EXPIRY_WARNING_DAYS,
  findForbiddenSocialIntegrationFields,
  maskExternalAccountId,
  readAccountOptions,
  resolveConnectionState,
  toSocialAdConnectionView,
} from './social-ad-connection.view';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function buildConnection(
  overrides: Partial<SocialAdAccountConnectionEntity> = {},
): SocialAdAccountConnectionEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    workspaceId: '33333333-3333-4333-8333-333333333333',
    agencyClientId: null,
    provider: 'meta_ads',
    externalAccountId: 'act_1234567890',
    externalBusinessId: 'biz_9',
    accountName: 'Cliente Alfa — Institucional',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    connectionStatus: 'connected',
    credentialVersion: 3,
    accessTokenEncrypted: 'ENCRYPTED-TOKEN-SHOULD-NEVER-LEAVE',
    refreshTokenEncrypted: 'ENCRYPTED-REFRESH-SHOULD-NEVER-LEAVE',
    tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
    scopes: ['ads_read', 'business_management'],
    lastSyncedAt: null,
    lastSyncError: null,
    oauthStateHash: 'a'.repeat(64),
    oauthExpiresAt: null,
    createdById: '44444444-4444-4444-8444-444444444444',
    metadata: { businessName: 'Alfa Holding', selectableAccounts: [] },
    credentialRemovedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  } as SocialAdAccountConnectionEntity;
}

describe('maskExternalAccountId', () => {
  it('keeps the provider prefix and the last four digits', () => {
    expect(maskExternalAccountId('act_1234567890')).toBe('act_••••••7890');
  });

  it('returns null when there is no account yet', () => {
    expect(maskExternalAccountId(null)).toBeNull();
  });

  it('does not pad a very short id into something longer', () => {
    expect(maskExternalAccountId('act_12')).toBe('act_12');
  });
});

describe('resolveConnectionState', () => {
  it.each([
    ['pending', 'connecting'],
    ['awaiting_selection', 'awaiting_selection'],
    ['error', 'error'],
    ['disconnected', 'disconnected'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(
      resolveConnectionState(
        {
          connectionStatus: status,
          tokenExpiresAt: null,
          credentialRemovedAt: null,
        },
        NOW,
      ),
    ).toBe(expected);
  });

  it('reports a live connection as connected', () => {
    expect(
      resolveConnectionState(
        {
          connectionStatus: 'connected',
          tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
          credentialRemovedAt: null,
        },
        NOW,
      ),
    ).toBe('connected');
  });

  it('reports a token inside the warning window as expiring', () => {
    const expiresAt = new Date(
      NOW.getTime() + (TOKEN_EXPIRY_WARNING_DAYS - 1) * 24 * 60 * 60 * 1000,
    );

    expect(
      resolveConnectionState(
        {
          connectionStatus: 'connected',
          tokenExpiresAt: expiresAt,
          credentialRemovedAt: null,
        },
        NOW,
      ),
    ).toBe('expiring');
  });

  it('treats a removed credential as disconnected regardless of status', () => {
    expect(
      resolveConnectionState(
        {
          connectionStatus: 'connected',
          tokenExpiresAt: null,
          credentialRemovedAt: NOW,
        },
        NOW,
      ),
    ).toBe('disconnected');
  });
});

describe('toSocialAdConnectionView', () => {
  it('never serializes a credential', () => {
    const view = toSocialAdConnectionView(buildConnection(), NOW);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('ENCRYPTED-TOKEN-SHOULD-NEVER-LEAVE');
    expect(serialized).not.toContain('ENCRYPTED-REFRESH-SHOULD-NEVER-LEAVE');
    expect(findForbiddenSocialIntegrationFields(view)).toEqual([]);
  });

  it('never serializes the raw account id or the oauth state', () => {
    const view = toSocialAdConnectionView(buildConnection(), NOW);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('act_1234567890');
    expect(serialized).not.toContain('a'.repeat(64));
    expect(view.maskedAccountId).toBe('act_••••••7890');
  });

  it('never serializes tenant or workspace identifiers', () => {
    const connection = buildConnection();
    const serialized = JSON.stringify(
      toSocialAdConnectionView(connection, NOW),
    );

    expect(serialized).not.toContain(connection.tenantId);
    expect(serialized).not.toContain(connection.workspaceId);
  });

  it('reports a credential without exposing it', () => {
    expect(toSocialAdConnectionView(buildConnection(), NOW).hasCredential).toBe(
      true,
    );

    expect(
      toSocialAdConnectionView(
        buildConnection({ credentialRemovedAt: NOW }),
        NOW,
      ).hasCredential,
    ).toBe(false);
  });

  it('offers the selectable accounts only while awaiting selection', () => {
    const metadata = {
      selectableAccounts: [
        {
          externalAccountId: 'act_1',
          accountName: 'Conta 1',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          businessName: 'Alfa',
          accountStatus: '1',
        },
      ],
    };

    const awaiting = toSocialAdConnectionView(
      buildConnection({ connectionStatus: 'awaiting_selection', metadata }),
      NOW,
    );
    const connected = toSocialAdConnectionView(
      buildConnection({ connectionStatus: 'connected', metadata }),
      NOW,
    );

    expect(awaiting.availableAccounts).toHaveLength(1);
    expect(awaiting.availableAccounts?.[0].externalAccountId).toBe('act_1');
    expect(connected.availableAccounts).toBeUndefined();
  });

  it('does not copy unknown metadata keys into the account options', () => {
    const options = readAccountOptions({
      selectableAccounts: [
        {
          externalAccountId: 'act_1',
          accountName: 'Conta 1',
          accessToken: 'EAAG-leaked',
          internalFlag: true,
        },
      ],
    });

    expect(JSON.stringify(options)).not.toContain('EAAG-leaked');
    expect(Object.keys(options[0]).sort()).toEqual([
      'accountName',
      'accountStatus',
      'businessName',
      'currency',
      'externalAccountId',
      'timezone',
    ]);
  });

  it('drops metadata entries without an account id', () => {
    expect(
      readAccountOptions({ selectableAccounts: [{ accountName: 'Órfã' }] }),
    ).toEqual([]);
  });
});

describe('findForbiddenSocialIntegrationFields', () => {
  it('finds a forbidden key nested at any depth', () => {
    expect(
      findForbiddenSocialIntegrationFields({
        items: [{ nested: { accessTokenEncrypted: 'x' } }],
      }),
    ).toEqual(['accessTokenEncrypted']);
  });
});
