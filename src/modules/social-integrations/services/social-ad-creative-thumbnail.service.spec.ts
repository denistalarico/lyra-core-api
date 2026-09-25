import type { Repository } from 'typeorm';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import type { SocialAdEntity } from '../entities/social-ad-entity.entity';
import type { MetaAdsGraphService } from './meta-ads-graph.service';
import { SocialAdCreativeThumbnailService } from './social-ad-creative-thumbnail.service';

const SCOPE = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  connectionId: 'connection-a',
  adExternalId: '120250205947130411',
};

const CREATIVE_ID = '1606435724534548';
const THUMBNAIL = 'https://scontent.example/creative.jpg?oe=6ABCC3C4';

function createHarness(
  options: {
    ad?: Partial<SocialAdEntity> | null;
    thumbnailUrl?: unknown;
    graphError?: Error;
    credentialError?: Error;
  } = {},
) {
  const findOneCalls: unknown[] = [];
  const graphCalls: Record<string, unknown>[] = [];

  const ad =
    options.ad === undefined
      ? { id: 'row-a', creativeId: CREATIVE_ID }
      : options.ad;

  const entities = {
    findOne: jest.fn((args: unknown) => {
      findOneCalls.push(args);
      return Promise.resolve(ad as SocialAdEntity | null);
    }),
  };

  const credentials = {
    resolve: jest.fn(() =>
      options.credentialError
        ? Promise.reject(options.credentialError)
        : Promise.resolve({ accessToken: 'token-a' }),
    ),
  };

  const graph = {
    readNode: jest.fn((args: Record<string, unknown>) => {
      graphCalls.push(args);
      if (options.graphError) return Promise.reject(options.graphError);
      return Promise.resolve({
        thumbnail_url:
          'thumbnailUrl' in options ? options.thumbnailUrl : THUMBNAIL,
      });
    }),
  };

  return {
    findOneCalls,
    graphCalls,
    entities,
    credentials,
    graph,
    service: new SocialAdCreativeThumbnailService(
      entities as unknown as Repository<SocialAdEntity>,
      credentials as unknown as SocialAdCredentialResolver,
      graph as unknown as MetaAdsGraphService,
    ),
  };
}

describe('SocialAdCreativeThumbnailService', () => {
  it('resolves the creative the mirror names for the ad', async () => {
    const harness = createHarness();

    await expect(harness.service.resolve(SCOPE)).resolves.toBe(THUMBNAIL);

    expect(harness.graphCalls[0]).toMatchObject({ path: CREATIVE_ID });
  });

  it('proves the ad inside the caller scope before touching a credential', async () => {
    const harness = createHarness();

    await harness.service.resolve(SCOPE);

    // An ad id from a URL is not permission to read a connection. Every scope
    // field is part of the lookup, not a check afterwards.
    expect(harness.findOneCalls[0]).toMatchObject({
      where: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        connectionId: 'connection-a',
        entityLevel: 'ad',
        externalId: SCOPE.adExternalId,
      },
    });
  });

  it('asks Meta for nothing when the ad is not in this scope', async () => {
    const harness = createHarness({ ad: null });

    await expect(harness.service.resolve(SCOPE)).resolves.toBeNull();

    // The order is the security property: no credential is resolved and no
    // provider call is made for an ad this caller cannot see.
    expect(harness.credentials.resolve).not.toHaveBeenCalled();
    expect(harness.graph.readNode).not.toHaveBeenCalled();
  });

  it('never requests a creative the caller supplied', async () => {
    // The only creative ever asked for is the one the scoped lookup returned.
    const harness = createHarness({
      ad: { id: 'row-a', creativeId: CREATIVE_ID },
    });

    await harness.service.resolve({
      ...SCOPE,
      // A caller cannot pass one at all — the input has no such field — and
      // this asserts the path came from the row rather than from anywhere else.
      adExternalId: SCOPE.adExternalId,
    });

    expect(harness.graphCalls[0].path).toBe(CREATIVE_ID);
  });

  it('gives up quietly when the mirror has learned no creative yet', async () => {
    const harness = createHarness({ ad: { id: 'row-a', creativeId: null } });

    await expect(harness.service.resolve(SCOPE)).resolves.toBeNull();
    expect(harness.graph.readNode).not.toHaveBeenCalled();
  });

  it('asks the creative node for a size the ads edge refuses to honour', async () => {
    const harness = createHarness();

    await harness.service.resolve(SCOPE);

    // Measured: `thumbnail_width` is ignored on `/ads` — every URL there is
    // stamped p64x64 — and honoured here. This parameter is the entire reason
    // the picture is a separate request instead of a free ride on the sync.
    expect(harness.graphCalls[0]).toMatchObject({
      fields: 'thumbnail_url',
      params: { thumbnail_width: '320', thumbnail_height: '320' },
    });
  });

  it('caches a resolved URL rather than calling Meta once per row', async () => {
    const harness = createHarness();

    await harness.service.resolve(SCOPE);
    await harness.service.resolve(SCOPE);

    expect(harness.graph.readNode).toHaveBeenCalledTimes(1);
  });

  it('caches per scope, so one tenant cannot be served another tenant picture', async () => {
    const harness = createHarness();

    await harness.service.resolve(SCOPE);
    await harness.service.resolve({ ...SCOPE, tenantId: 'tenant-b' });

    // The same ad id under a different tenant is a different object, and a
    // cache keyed only on the ad would hand the first tenant's creative to the
    // second.
    expect(harness.graph.readNode).toHaveBeenCalledTimes(2);
  });

  it('separates the agency own scope from a managed client', async () => {
    const harness = createHarness();

    await harness.service.resolve(SCOPE);
    await harness.service.resolve({ ...SCOPE, agencyClientId: 'client-a' });

    expect(harness.graph.readNode).toHaveBeenCalledTimes(2);
  });

  it('refuses a URL whose scheme it did not expect', async () => {
    // The value is interpolated into a redirect. A `javascript:` or `data:`
    // target must not become one.
    for (const hostile of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'http://scontent.example/x.jpg',
      '//scontent.example/x.jpg',
      42,
      null,
    ]) {
      const harness = createHarness({ thumbnailUrl: hostile });

      await expect(harness.service.resolve(SCOPE)).resolves.toBeNull();
    }
  });

  it('degrades to a placeholder when the provider fails', async () => {
    const harness = createHarness({ graphError: new Error('graph down') });

    // A thumbnail is decoration on a page whose subject is the metrics. A
    // provider failure must not fail the row beside it.
    await expect(harness.service.resolve(SCOPE)).resolves.toBeNull();
  });

  it('degrades to a placeholder when the credential cannot be resolved', async () => {
    const harness = createHarness({
      credentialError: new Error('connection_not_found'),
    });

    await expect(harness.service.resolve(SCOPE)).resolves.toBeNull();
  });

  it('does not cache a failure, so a reconnected account recovers', async () => {
    const harness = createHarness({ graphError: new Error('graph down') });

    await harness.service.resolve(SCOPE);
    await harness.service.resolve(SCOPE);

    expect(harness.graph.readNode).toHaveBeenCalledTimes(2);
  });

  it('selects id alongside the nullable column TypeORM would null the row for', async () => {
    const harness = createHarness();

    await harness.service.resolve(SCOPE);

    // TypeORM 0.3.28 hydrates `findOne` to null when every selected column is
    // NULL in the row, and `creative_id` is nullable.
    expect(harness.findOneCalls[0]).toMatchObject({
      select: ['id', 'creativeId'],
    });
  });
});
