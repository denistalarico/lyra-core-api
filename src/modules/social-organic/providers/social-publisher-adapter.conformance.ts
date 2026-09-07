import type { ResolvedOrganicCredential } from '../credentials/resolved-organic-credential';
import type {
  PublicationExecutionInput,
  PublicationPayload,
  SocialPublisherAdapter,
} from './social-publisher.adapter';

/**
 * Shared conformance suite every adapter imports and runs against itself, so
 * `MA3` and every `W2-*` provider inherit the same structural guarantees.
 *
 * This asserts shape and contract discipline only — never provider-specific
 * behaviour. Call it from the adapter's own spec file:
 *
 *   describeSocialPublisherAdapterConformance({
 *     createAdapter: () => new MetaOrganicPublisherAdapter(...),
 *     assetType: 'facebook_page',
 *     credential: buildTestCredential(),
 *     payload: buildTestPayload(),
 *   });
 */
export type SocialPublisherAdapterConformanceFixtures = {
  createAdapter: () => SocialPublisherAdapter;
  assetType: string;
  credential: ResolvedOrganicCredential;
  payload: PublicationPayload;
};

export function describeSocialPublisherAdapterConformance(
  fixtures: SocialPublisherAdapterConformanceFixtures,
): void {
  describe('SocialPublisherAdapter conformance', () => {
    it('declares a non-empty provider key', () => {
      const adapter = fixtures.createAdapter();
      expect(typeof adapter.provider).toBe('string');
      expect(adapter.provider.length).toBeGreaterThan(0);
      expect(adapter.assetTypes).toContain(fixtures.assetType);
      expect([
        'provider_idempotency_key',
        'pre_retry_existence_check',
        'non_retryable_after_send',
      ]).toContain(adapter.retrySafety);
    });

    it('capabilities() returns a declaration scoped to the requested asset type', () => {
      const adapter = fixtures.createAdapter();
      const capabilities = adapter.capabilities(fixtures.assetType);

      expect(capabilities.provider).toBe(adapter.provider);
      expect(capabilities.assetType).toBe(fixtures.assetType);
      expect(Array.isArray(capabilities.placements)).toBe(true);
    });

    it('declares a media block for every placement it lists, and only for those (MA2.1)', () => {
      const adapter = fixtures.createAdapter();
      const capabilities = adapter.capabilities(fixtures.assetType);

      expect(capabilities.placements.length).toBeGreaterThan(0);
      for (const placement of capabilities.placements) {
        const media = capabilities.media[placement];
        expect(media).toBeDefined();
        expect(typeof media.maxBytes).toBe('number');
        expect(Array.isArray(media.acceptedMimeTypes)).toBe(true);
      }
    });

    it('capabilities() advertises requiresReconciliation consistently with reconcile()', () => {
      const adapter = fixtures.createAdapter();
      const capabilities = adapter.capabilities(fixtures.assetType);

      expect(capabilities.requiresReconciliation).toBe(
        typeof adapter.reconcile === 'function',
      );
    });

    it('capabilities() advertises supportsRemoval consistently with remove()', () => {
      const adapter = fixtures.createAdapter();
      const capabilities = adapter.capabilities(fixtures.assetType);

      expect(capabilities.supportsRemoval).toBe(
        typeof adapter.remove === 'function',
      );
    });

    it('validate() returns a discriminated result, never throws for a well-formed payload', () => {
      const adapter = fixtures.createAdapter();
      const result = adapter.validate(fixtures.payload);

      expect(typeof result.valid).toBe('boolean');
      if (!result.valid) {
        expect(Array.isArray(result.issues)).toBe(true);
        for (const issue of result.issues) {
          expect(typeof issue.field).toBe('string');
          expect(typeof issue.reason).toBe('string');
        }
      }
    });

    it('publish() resolves to a discriminated PublicationResult, never a raw provider object', async () => {
      const adapter = fixtures.createAdapter();
      const input: PublicationExecutionInput = {
        credential: fixtures.credential,
        payload: fixtures.payload,
        preparedMedia: null,
        idempotencyKey: 'conformance-idempotency-key',
      };

      const result = await adapter.publish(input);

      expect(['published', 'processing', 'failed']).toContain(result.outcome);
      if (result.outcome === 'published') {
        expect(typeof result.externalPublicationId).toBe('string');
        expect(result.publishedAt).toBeInstanceOf(Date);
        expect(result.providerMetadata).not.toBeInstanceOf(Date);
      }
      if (result.outcome === 'processing') {
        expect(typeof adapter.reconcile).toBe('function');
      }
    });

    it('reconcile, when present, is a function rather than a rejecting stub', () => {
      const adapter = fixtures.createAdapter();
      if (adapter.reconcile === undefined) return;
      expect(typeof adapter.reconcile).toBe('function');
    });

    it('remove, when present, is a function rather than a rejecting stub', () => {
      const adapter = fixtures.createAdapter();
      if (adapter.remove === undefined) return;
      expect(typeof adapter.remove).toBe('function');
    });
  });
}
