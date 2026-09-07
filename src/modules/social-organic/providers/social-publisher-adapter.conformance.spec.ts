/* eslint-disable @typescript-eslint/require-await -- the fake adapter mirrors the async adapter contract. */
import { createResolvedOrganicCredential } from '../credentials/resolved-organic-credential';
import type { PublisherCapabilities } from './provider-capabilities';
import { describeSocialPublisherAdapterConformance } from './social-publisher-adapter.conformance';
import type {
  PublicationPayload,
  SocialPublisherAdapter,
} from './social-publisher.adapter';

function buildTestCredential() {
  return createResolvedOrganicCredential({
    assetId: 'asset-1',
    connectionId: 'connection-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
    provider: 'fake',
    assetType: 'facebook_page',
    externalAssetId: 'external-asset-1',
    scopes: ['publish'],
    credentialVersion: 1,
    accessToken: 'token',
  });
}

function buildTestPayload(): PublicationPayload {
  return {
    assetType: 'facebook_page',
    placement: 'feed',
    caption: 'hello world',
    firstComment: null,
    hashtags: [],
    cta: null,
    mediaAssetId: null,
    scheduledAt: new Date('2026-09-06T12:00:00Z'),
  };
}

function buildFakeAdapter(): SocialPublisherAdapter {
  return {
    provider: 'fake',
    capabilities: (assetType: string): PublisherCapabilities => ({
      provider: 'fake',
      assetType,
      placements: ['feed'],
      media: { feed: { acceptedMimeTypes: ['image/jpeg'], maxBytes: 1_000 } },
      supportsScheduling: true,
      supportsCaption: true,
      supportsFirstComment: false,
      supportsHashtags: false,
      requiresReconciliation: false,
      supportsRemoval: false,
    }),
    validate: () => ({ valid: true }),
    prepareMedia: async () => ({ providerMediaRef: 'ref', expiresAt: null }),
    publish: async () => ({
      outcome: 'published',
      externalPublicationId: 'external-1',
      externalPermalink: null,
      publishedAt: new Date(),
      providerMetadata: { raw: 'provider-shaped, but only here' },
    }),
  };
}

describeSocialPublisherAdapterConformance({
  createAdapter: buildFakeAdapter,
  assetType: 'facebook_page',
  credential: buildTestCredential(),
  payload: buildTestPayload(),
});
