import type { Repository } from 'typeorm';
import type { MediaAssetResolverService } from '../../../../common/media-assets';
import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import type { SocialOrganicCredentialResolver } from '../../credentials/social-organic-credential.resolver';
import type { SocialOrganicAssetEntity } from '../../entities/social-organic-asset.entity';
import type { MediaPreparationService } from '../../media/media-preparation.service';
import type { SocialPublicationEntity } from '../../publication/entities/social-publication.entity';
import type { SocialPublicationConfigService } from '../../publication/social-publication-config.service';
import { SocialPublicationExecutorService } from '../../publication/social-publication.executor';
import type { SocialPublicationRunService } from '../../publication/social-publication-run.service';
import { SocialPublicationWorker } from '../../publication/social-publication.worker';
import { SocialPublisherRegistry } from '../social-publisher.registry';
import { FacebookPublisherAdapter } from './facebook-publisher.adapter';
import { MetaOrganicGraphError } from './meta-organic-graph.error';
import type { MetaOrganicGraphService } from './meta-organic-graph.service';

/** Dedicated T18 regression: a lost response must never duplicate a public post. */
describe('Meta publisher retry after a lost response', () => {
  it('sends exactly once, fails closed, and never requeues without a provider identity', async () => {
    const graph = {
      publishFacebookFeed: jest.fn(() =>
        Promise.reject(
          new MetaOrganicGraphError({
            kind: 'transient',
            code: 'meta_network_error',
          }),
        ),
      ),
    };
    const registry = new SocialPublisherRegistry();
    registry.register(
      new FacebookPublisherAdapter(graph as unknown as MetaOrganicGraphService),
    );
    const publication = {
      id: 'publication-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      provider: 'meta',
      assetId: 'asset-1',
      mediaAssetId: null,
      status: 'processing',
      attempts: 1,
      maxAttempts: 5,
      idempotencyKey: 'idem-1',
      externalPublicationId: null,
      scheduledAt: new Date('2026-09-07T12:00:00Z'),
      payloadSnapshot: {
        placement: 'feed',
        caption: 'Exactly once',
        hashtags: [],
      },
    } as unknown as SocialPublicationEntity;
    const credential = createResolvedOrganicCredential({
      assetId: 'asset-1',
      connectionId: 'connection-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      provider: 'meta',
      assetType: 'facebook_page',
      externalAssetId: 'page-1',
      scopes: ['pages_manage_posts'],
      credentialVersion: 1,
      accessToken: 'page-token',
    });
    const executor = new SocialPublicationExecutorService(
      {
        findOne: jest.fn(() =>
          Promise.resolve({ id: 'asset-1', assetType: 'facebook_page' }),
        ),
      } as unknown as Repository<SocialOrganicAssetEntity>,
      registry,
      {
        resolve: jest.fn(() => Promise.resolve(credential)),
      } as unknown as SocialOrganicCredentialResolver,
      {} as MediaAssetResolverService,
      {} as MediaPreparationService,
      {
        get enabled() {
          return true;
        },
        isProviderEnabled: () => true,
      } as unknown as SocialPublicationConfigService,
    );

    let state: 'queued' | 'processing' | 'failed' = 'queued';
    const runService = {
      claim: jest.fn(() => {
        if (state !== 'queued') return Promise.resolve([]);
        state = 'processing';
        return Promise.resolve([publication]);
      }),
      markFailed: jest.fn(() => {
        state = 'failed';
        return Promise.resolve(true);
      }),
      reschedule: jest.fn(() => {
        state = 'queued';
        return Promise.resolve(true);
      }),
      markPublished: jest.fn(),
      markProcessing: jest.fn(),
    };
    const worker = new SocialPublicationWorker(
      runService as unknown as SocialPublicationRunService,
      executor,
      {
        get enabled() {
          return true;
        },
      } as unknown as SocialPublicationConfigService,
    );

    await worker.processDue();
    await worker.processDue();

    expect(graph.publishFacebookFeed).toHaveBeenCalledTimes(1);
    expect(runService.reschedule).not.toHaveBeenCalled();
    expect(runService.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'retry_safety_unavailable' }),
    );
    expect(state).toBe('failed');
  });
});
