import { Logger } from '@nestjs/common';
import {
  createResolvedAdCredential,
  type ResolvedAdCredential,
} from '../credentials/resolved-ad-credential';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';
import type { NormalizedAdEntity } from '../sync/meta-ads-entity.contract';
import { MetaGraphError } from './meta-graph-error';
import type { MetaAdsEntityReaderService } from './meta-ads-entity-reader.service';
import type { SocialAdEntityWriterService } from './social-ad-entity-writer.service';
import { SocialAdHierarchySyncService } from './social-ad-hierarchy-sync.service';

const ACCOUNT_ID = 'act_415877197389621';
const SYSTEM_USER_TOKEN = 'EAAG-system-user-token-value';

function entity(
  level: SocialAdEntityLevel,
  externalId: string,
  overrides: Partial<NormalizedAdEntity> = {},
): NormalizedAdEntity {
  return {
    entityLevel: level,
    externalId,
    parentExternalId: null,
    campaignExternalId: null,
    name: `${level}-${externalId}`,
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    objective: null,
    optimizationGoal: null,
    billingEvent: null,
    dailyBudgetMinor: null,
    lifetimeBudgetMinor: null,
    budgetRemainingMinor: null,
    currency: 'BRL',
    startTime: null,
    stopTime: null,
    providerCreatedTime: null,
    providerUpdatedTime: null,
    metadata: {},
    ...overrides,
  };
}

function page(rows: NormalizedAdEntity[], truncated = false) {
  return { rows, truncated, skipped: 0 };
}

type Harness = {
  service: SocialAdHierarchySyncService;
  archived: SocialAdEntityLevel[];
  upserted: { level: SocialAdEntityLevel; count: number; seenAt: Date }[];
  resolve: jest.Mock;
};

function createHarness(
  options: {
    credentialError?: SocialAdCredentialError;
    readFailure?: { level: 'campaigns' | 'adsets' | 'ads'; error: Error };
    truncated?: 'campaigns' | 'adsets' | 'ads';
    accessToken?: string;
    authorizationMethod?: 'business_login' | 'internal_system_user';
  } = {},
): Harness {
  const archived: SocialAdEntityLevel[] = [];
  const upserted: {
    level: SocialAdEntityLevel;
    count: number;
    seenAt: Date;
  }[] = [];

  const credential: ResolvedAdCredential = createResolvedAdCredential({
    connectionId: 'connection-id',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    provider: 'meta_ads',
    authorizationMethod: options.authorizationMethod ?? 'business_login',
    externalAccountId: ACCOUNT_ID,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    credentialVersion: 1,
    tokenExpiresAt: null,
    accessToken: options.accessToken ?? 'token-abc',
  });

  const resolve = jest.fn(() =>
    options.credentialError
      ? Promise.reject(options.credentialError)
      : Promise.resolve(credential),
  );

  const level = (
    name: 'campaigns' | 'adsets' | 'ads',
    rows: NormalizedAdEntity[],
  ) =>
    options.readFailure?.level === name
      ? Promise.reject(options.readFailure.error)
      : Promise.resolve(page(rows, options.truncated === name));

  const reader = {
    readAccount: jest.fn(() =>
      Promise.resolve(entity('account', ACCOUNT_ID, { currency: 'BRL' })),
    ),
    readCampaigns: jest.fn(() =>
      level('campaigns', [
        entity('campaign', 'campaign-1', {
          parentExternalId: ACCOUNT_ID,
          campaignExternalId: 'campaign-1',
        }),
      ]),
    ),
    readAdSets: jest.fn(() =>
      level('adsets', [
        entity('adset', 'adset-1', {
          parentExternalId: 'campaign-1',
          campaignExternalId: 'campaign-1',
        }),
      ]),
    ),
    readAds: jest.fn(() =>
      level('ads', [
        entity('ad', 'ad-1', {
          parentExternalId: 'adset-1',
          campaignExternalId: 'campaign-1',
        }),
      ]),
    ),
  };

  const writer = {
    upsert: jest.fn(
      (input: {
        rows: NormalizedAdEntity[];
        seenAt: Date;
      }): Promise<number> => {
        if (input.rows.length) {
          upserted.push({
            level: input.rows[0].entityLevel,
            count: input.rows.length,
            seenAt: input.seenAt,
          });
        }

        return Promise.resolve(input.rows.length);
      },
    ),
    archiveMissing: jest.fn((input: { entityLevel: SocialAdEntityLevel }) => {
      archived.push(input.entityLevel);
      return Promise.resolve(1);
    }),
  };

  return {
    service: new SocialAdHierarchySyncService(
      { resolve } as unknown as SocialAdCredentialResolver,
      reader as unknown as MetaAdsEntityReaderService,
      writer as unknown as SocialAdEntityWriterService,
    ),
    archived,
    upserted,
    resolve,
  };
}

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  connectionId: 'connection-id',
};

describe('SocialAdHierarchySyncService', () => {
  it('walks the four levels and reports what it did', async () => {
    const harness = createHarness();

    const summary = await harness.service.syncHierarchy(scope);

    expect(summary).toMatchObject({
      connectionId: 'connection-id',
      externalAccountId: ACCOUNT_ID,
      accountCount: 1,
      campaignsCount: 1,
      adsetsCount: 1,
      adsCount: 1,
      entitiesWritten: 4,
      partial: false,
    });
    expect(summary.levels.map((level) => level.level)).toEqual([
      'account',
      'campaign',
      'adset',
      'ad',
    ]);
  });

  it('stamps every level of one run with the same instant', async () => {
    const harness = createHarness();

    await harness.service.syncHierarchy(scope);

    // The archive step is `last_seen_at < seenAt`, so a second clock reading
    // between levels would make rows written earlier in the same run look
    // stale to the level that follows.
    const instants = new Set(
      harness.upserted.map((write) => write.seenAt.getTime()),
    );

    expect(harness.upserted).toHaveLength(4);
    expect(instants.size).toBe(1);
  });

  it('archives each level only after seeing it whole', async () => {
    const harness = createHarness();

    await harness.service.syncHierarchy(scope);

    expect(harness.archived).toEqual(['account', 'campaign', 'adset', 'ad']);
  });

  it('archives nothing at or after a level whose read failed', async () => {
    const harness = createHarness({
      readFailure: {
        level: 'adsets',
        error: new MetaGraphError({
          kind: 'rate_limited',
          safeMessage: 'Meta Ads adsets read failed.',
        }),
      },
    });

    await expect(harness.service.syncHierarchy(scope)).rejects.toBeInstanceOf(
      MetaGraphError,
    );

    // Absence is evidence of deletion only against a complete snapshot. The
    // levels that did complete keep their archive; the ones that never ran
    // cannot archive anything, because the code that would is not reached.
    expect(harness.archived).toEqual(['account', 'campaign']);
  });

  it('refuses to archive a level it only partly walked', async () => {
    const harness = createHarness({ truncated: 'ads' });

    const summary = await harness.service.syncHierarchy(scope);

    // A truncated walk returns rows and no error, so it reaches the writer.
    // Archiving then would declare every ad past the page ceiling deleted.
    expect(harness.archived).toEqual(['account', 'campaign', 'adset']);
    expect(summary.partial).toBe(true);
    expect(summary.levels.find((level) => level.level === 'ad')).toMatchObject({
      truncated: true,
      archived: 0,
    });
  });

  it('reports a connection outside the scope as not found', async () => {
    const harness = createHarness({
      credentialError: new SocialAdCredentialError('connection_not_found'),
    });

    // Cross-tenant, cross-workspace and wrong-managed-client are all this same
    // refusal: the resolver's lookup is scoped, so it never confirms that an
    // id outside the caller's scope exists.
    await expect(harness.service.syncHierarchy(scope)).rejects.toMatchObject({
      code: 'connection_not_found',
    });
  });

  it('writes under the scope of the resolved connection, not the request', async () => {
    const harness = createHarness();

    await harness.service.syncHierarchy({
      ...scope,
      // A caller that reached this far with a different client id still cannot
      // steer the write: the scope is rebuilt from the row the resolver found.
      agencyClientId: 'client-a',
    });

    expect(harness.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'connection-id' }),
    );
  });

  it('never lets the token reach the summary or the log', async () => {
    const logged: unknown[] = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });

    const harness = createHarness({
      accessToken: SYSTEM_USER_TOKEN,
      authorizationMethod: 'internal_system_user',
    });

    const summary = await harness.service.syncHierarchy(scope);

    expect(JSON.stringify(summary)).not.toContain(SYSTEM_USER_TOKEN);
    expect(JSON.stringify(logged)).not.toContain(SYSTEM_USER_TOKEN);
    expect(logged.join(' ')).toContain('connection-id');

    jest.restoreAllMocks();
  });

  it('produces the same pipeline for both authorization methods', async () => {
    const businessLogin = await createHarness({
      authorizationMethod: 'business_login',
    }).service.syncHierarchy(scope);

    const systemUser = await createHarness({
      authorizationMethod: 'internal_system_user',
      accessToken: SYSTEM_USER_TOKEN,
    }).service.syncHierarchy(scope);

    // Same levels, same counts, same shape: the two ways of authorizing differ
    // only inside `SocialAdCredentialResolver`, and nothing downstream may be
    // able to tell them apart.
    expect(systemUser.levels).toEqual(businessLogin.levels);
    expect(systemUser.entitiesWritten).toBe(businessLogin.entitiesWritten);
  });
});
