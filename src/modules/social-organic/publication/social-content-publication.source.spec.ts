import { In, IsNull, type Repository } from 'typeorm';
import { SocialContentPublicationGuard } from '../../social-planner/services/content-publication-guard.port';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import { SocialContentPublicationSourceService } from './social-content-publication.source';

const TENANT_ID = 'tenant-1';
const WORKSPACE_ID = 'workspace-1';
const CLIENT_ID = 'client-1';
const CONTENT_A = 'content-a';
const CONTENT_B = 'content-b';

describe('SocialContentPublicationSourceService', () => {
  let publicationsRepository: { find: jest.Mock };
  let guard: SocialContentPublicationGuard;
  let service: SocialContentPublicationSourceService;

  beforeEach(() => {
    jest.clearAllMocks();

    publicationsRepository = { find: jest.fn(() => Promise.resolve([])) };
    guard = new SocialContentPublicationGuard();

    service = new SocialContentPublicationSourceService(
      publicationsRepository as unknown as Repository<SocialPublicationEntity>,
      guard,
    );
  });

  /**
   * The registration is what makes the Planner able to ask at all. Without it
   * the guard stays unavailable and every delete is refused, so this wiring is
   * load-bearing rather than incidental.
   */
  it('registers itself into the Planner guard on init', () => {
    expect(guard.isAvailable).toBe(false);

    service.onModuleInit();

    expect(guard.isAvailable).toBe(true);
  });

  it('queries only live statuses, within the caller scope', async () => {
    await service.findBlockingPublications({
      scope: {
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        agencyClientId: CLIENT_ID,
      },
      contentItemIds: [CONTENT_A],
    });

    const [{ where }] = publicationsRepository.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];

    expect(where.tenantId).toBe(TENANT_ID);
    expect(where.workspaceId).toBe(WORKSPACE_ID);
    expect(where.agencyClientId).toBe(CLIENT_ID);
    expect(where.contentItemId).toEqual(In([CONTENT_A]));
    expect(where.status).toEqual(
      In(['scheduled', 'queued', 'processing', 'published']),
    );
  });

  it('uses IsNull for the agency context', async () => {
    await service.findBlockingPublications({
      scope: {
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        agencyClientId: null,
      },
      contentItemIds: [CONTENT_A],
    });

    const [{ where }] = publicationsRepository.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];

    expect(where.agencyClientId).toEqual(IsNull());
  });

  /**
   * A publication carries a payload snapshot, provider metadata and external
   * ids. None of that should be loaded to answer a yes/no question, and none of
   * it should be within reach of the Planner.
   */
  it('selects only the columns the answer is made of', async () => {
    await service.findBlockingPublications({
      scope: {
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        agencyClientId: null,
      },
      contentItemIds: [CONTENT_A],
    });

    const [{ select }] = publicationsRepository.find.mock.calls[0] as [
      { select: Record<string, boolean> },
    ];

    expect(select).toEqual({ id: true, contentItemId: true, status: true });
  });

  it('groups statuses per content item and deduplicates them', async () => {
    publicationsRepository.find.mockResolvedValue([
      { id: '1', contentItemId: CONTENT_A, status: 'scheduled' },
      { id: '2', contentItemId: CONTENT_A, status: 'scheduled' },
      { id: '3', contentItemId: CONTENT_A, status: 'published' },
      { id: '4', contentItemId: CONTENT_B, status: 'queued' },
    ]);

    const blockers = await service.findBlockingPublications({
      scope: {
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        agencyClientId: null,
      },
      contentItemIds: [CONTENT_A, CONTENT_B],
    });

    expect(blockers).toEqual([
      { contentItemId: CONTENT_A, statuses: ['published', 'scheduled'] },
      { contentItemId: CONTENT_B, statuses: ['queued'] },
    ]);
  });

  /** An item with no live publication is simply absent from the answer. */
  it('returns nothing for content with no blocking publication', async () => {
    publicationsRepository.find.mockResolvedValue([]);

    await expect(
      service.findBlockingPublications({
        scope: {
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          agencyClientId: null,
        },
        contentItemIds: [CONTENT_A],
      }),
    ).resolves.toEqual([]);
  });

  it('does not query at all for an empty selection', async () => {
    await service.findBlockingPublications({
      scope: {
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        agencyClientId: null,
      },
      contentItemIds: [],
    });

    expect(publicationsRepository.find).not.toHaveBeenCalled();
  });
});
