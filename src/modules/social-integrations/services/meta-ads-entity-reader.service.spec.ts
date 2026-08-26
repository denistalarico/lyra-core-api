import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { createResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { MetaAdsEntityReaderService } from './meta-ads-entity-reader.service';
import type { MetaAdsGraphService } from './meta-ads-graph.service';

const ACCOUNT_ID = 'act_415877197389621';

function credential(
  overrides: Partial<{ accessToken: string; authorizationMethod: string }> = {},
): ResolvedAdCredential {
  return createResolvedAdCredential({
    connectionId: 'connection-id',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    provider: 'meta_ads',
    authorizationMethod:
      (overrides.authorizationMethod as 'business_login') ?? 'business_login',
    externalAccountId: ACCOUNT_ID,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    credentialVersion: 1,
    tokenExpiresAt: null,
    accessToken: overrides.accessToken ?? 'token-abc',
  });
}

function createReader(
  edges: Record<string, { rows: unknown[]; truncated?: boolean }> = {},
  node: Record<string, unknown> = {},
) {
  const edgeRequests: Record<string, unknown>[] = [];
  const nodeRequests: Record<string, unknown>[] = [];

  const graph = {
    readNode: jest.fn((input: Record<string, unknown>) => {
      nodeRequests.push(input);
      return Promise.resolve(node);
    }),
    readEdge: jest.fn((input: Record<string, unknown>) => {
      edgeRequests.push(input);
      const edge = String(input.path).split('/')[1];
      const page = edges[edge] ?? { rows: [] };

      return Promise.resolve({
        rows: page.rows,
        usage: {},
        truncated: page.truncated ?? false,
      });
    }),
  };

  return {
    reader: new MetaAdsEntityReaderService(
      graph as unknown as MetaAdsGraphService,
    ),
    graph,
    edgeRequests,
    nodeRequests,
  };
}

describe('MetaAdsEntityReaderService', () => {
  it('reads the account the credential is bound to', async () => {
    const harness = createReader({}, { id: ACCOUNT_ID, currency: 'brl' });

    const account = await harness.reader.readAccount(credential());

    expect(harness.nodeRequests[0].path).toBe(ACCOUNT_ID);
    expect(account?.externalId).toBe(ACCOUNT_ID);
  });

  it('asks each edge for the fields the read model has columns for', async () => {
    const harness = createReader();
    const resolved = credential();

    await harness.reader.readCampaigns(resolved, { currency: 'BRL' });
    await harness.reader.readAdSets(resolved, { currency: 'BRL' });
    await harness.reader.readAds(resolved, {
      currency: 'BRL',
      campaignByAdSetId: new Map(),
    });

    const [campaigns, adSets, ads] = harness.edgeRequests;

    expect(campaigns.path).toBe(`${ACCOUNT_ID}/campaigns`);
    expect(adSets.path).toBe(`${ACCOUNT_ID}/adsets`);
    expect(ads.path).toBe(`${ACCOUNT_ID}/ads`);

    // Read-only and cheap: nothing here asks for a creative payload, an image,
    // a video or a targeting spec, all of which cost quota and none of which
    // has a column.
    for (const request of harness.edgeRequests) {
      const fields = String(request.fields);
      for (const forbidden of [
        'creative',
        'image_url',
        'video_id',
        'targeting',
        'insights',
      ]) {
        expect(fields).not.toContain(forbidden);
      }
    }

    expect(String(adSets.fields)).toContain('campaign_id');
    expect(String(ads.fields)).toContain('adset_id');
  });

  it('pages through the walker rather than a parallel implementation', async () => {
    const harness = createReader({
      campaigns: { rows: [{ id: '1' }, { id: '2' }, { id: '3' }] },
    });

    const page = await harness.reader.readCampaigns(credential(), {
      currency: 'BRL',
    });

    expect(page.rows).toHaveLength(3);
    // Every guarantee about pagination — the URL rebuilt with our credentials,
    // a `next` bound to the same path, a repeated cursor ending the walk — is a
    // property of that one loop.
    expect(harness.graph.readEdge).toHaveBeenCalledTimes(1);
    expect(harness.edgeRequests[0].maxPages).toBeGreaterThan(1);
  });

  it('carries truncation out of the reader untouched', async () => {
    const harness = createReader({
      ads: { rows: [{ id: '1' }], truncated: true },
    });

    const page = await harness.reader.readAds(credential(), {
      currency: 'BRL',
      campaignByAdSetId: new Map(),
    });

    expect(page.truncated).toBe(true);
  });

  it('counts unkeyable rows instead of failing the level', async () => {
    const harness = createReader({
      campaigns: { rows: [{ id: '1' }, { name: 'no id' }, 'nonsense'] },
    });

    const page = await harness.reader.readCampaigns(credential(), {
      currency: 'BRL',
    });

    // One odd row out of ten thousand should not leave the account with no
    // mirror at all — but it must be visible.
    expect(page.rows).toHaveLength(1);
    expect(page.skipped).toBe(2);
  });

  it('builds the ad set → campaign map from the level already read', async () => {
    const harness = createReader({
      adsets: { rows: [{ id: 'adset-1', campaign_id: 'campaign-1' }] },
    });

    const adSets = await harness.reader.readAdSets(credential(), {
      currency: 'BRL',
    });
    const map = MetaAdsEntityReaderService.campaignByAdSetId(adSets.rows);

    expect(map.get('adset-1')).toBe('campaign-1');
  });

  it('cannot tell how the connection was authorized', async () => {
    // Both authorization methods travel the same pipeline: the reader receives
    // a credential and calls Meta, and the only difference between them was
    // settled inside the resolver.
    const harness = createReader({ campaigns: { rows: [{ id: '1' }] } });

    await harness.reader.readCampaigns(credential(), { currency: 'BRL' });
    await harness.reader.readCampaigns(
      credential({
        authorizationMethod: 'internal_system_user',
        accessToken: 'system-user-token',
      }),
      { currency: 'BRL' },
    );

    const [first, second] = harness.edgeRequests;

    expect(second.path).toBe(first.path);
    expect(second.fields).toBe(first.fields);
    expect(second.accessToken).toBe('system-user-token');
  });
});
