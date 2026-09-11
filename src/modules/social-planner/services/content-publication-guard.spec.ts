import {
  SOCIAL_CONTENT_BLOCKING_PUBLICATION_STATUSES,
  SocialContentPublicationGuard,
  type SocialContentPublicationSource,
} from './content-publication-guard.port';

const SCOPE = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
};

/**
 * Returns the source and its spy separately, so assertions never read a method
 * off the object (which would be an unbound-method access).
 */
function buildSource(
  key: string,
  result: Array<{ contentItemId: string; statuses: string[] }>,
): { source: SocialContentPublicationSource; findBlocking: jest.Mock } {
  const findBlocking = jest.fn(() => Promise.resolve(result));

  return {
    source: {
      publicationSourceKey: key,
      findBlockingPublications: findBlocking,
    },
    findBlocking,
  };
}

describe('SocialContentPublicationGuard', () => {
  /**
   * The defining property of this registry, and the one that separates it from
   * the telemetry registry it is modelled on: an empty registry means the
   * question cannot be answered, NOT that the answer is "nothing blocks it".
   * A caller that read an empty result as permission would be deleting content
   * on the strength of an answer nobody gave.
   */
  it('reports unavailable when nothing is registered', async () => {
    const guard = new SocialContentPublicationGuard();

    expect(guard.isAvailable).toBe(false);
    await expect(
      guard.check({ scope: SCOPE, contentItemIds: ['content-1'] }),
    ).resolves.toEqual({ available: false });
  });

  it('reports available with an empty blocker map once a source registers', async () => {
    const guard = new SocialContentPublicationGuard();
    guard.register(buildSource('a', []).source);

    const result = await guard.check({
      scope: SCOPE,
      contentItemIds: ['content-1'],
    });

    expect(result.available).toBe(true);
    expect(result.available && result.blockers.size).toBe(0);
  });

  it('merges and deduplicates statuses reported by several sources', async () => {
    const guard = new SocialContentPublicationGuard();
    guard.register(
      buildSource('a', [{ contentItemId: 'content-1', statuses: ['queued'] }])
        .source,
    );
    guard.register(
      buildSource('b', [
        { contentItemId: 'content-1', statuses: ['queued', 'scheduled'] },
      ]).source,
    );

    const result = await guard.check({
      scope: SCOPE,
      contentItemIds: ['content-1'],
    });

    expect(result.available && result.blockers.get('content-1')).toEqual({
      contentItemId: 'content-1',
      statuses: ['queued', 'scheduled'],
    });
  });

  /** A rebuilt test graph must not register the same source twice. */
  it('ignores a repeated registration of the same source key', async () => {
    const guard = new SocialContentPublicationGuard();
    const { source, findBlocking } = buildSource('a', []);

    guard.register(source);
    guard.register(source);

    await guard.check({ scope: SCOPE, contentItemIds: ['content-1'] });

    expect(findBlocking).toHaveBeenCalledTimes(1);
  });

  it('does not call a source for an empty selection', async () => {
    const guard = new SocialContentPublicationGuard();
    const { source, findBlocking } = buildSource('a', []);
    guard.register(source);

    const result = await guard.check({ scope: SCOPE, contentItemIds: [] });

    expect(result.available).toBe(true);
    expect(findBlocking).not.toHaveBeenCalled();
  });

  /**
   * `draft` and `cancelled` reserve nothing, and `failed` is terminal — none of
   * them should stop an operator from removing editorial content. Pinning the
   * list stops a later edit from quietly making cancelled posts undeletable.
   */
  it('blocks on exactly the four live statuses', () => {
    expect([...SOCIAL_CONTENT_BLOCKING_PUBLICATION_STATUSES]).toEqual([
      'scheduled',
      'queued',
      'processing',
      'published',
    ]);
  });
});
