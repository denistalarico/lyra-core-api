import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  SOCIAL_CONTENT_BLOCKING_PUBLICATION_STATUSES,
  SocialContentPublicationGuard,
  type SocialContentPublicationBlocker,
  type SocialContentPublicationSource,
} from '../../social-planner/services/content-publication-guard.port';
import { SocialPublicationEntity } from './entities/social-publication.entity';

/**
 * Answers the Planner's question "does this content still have publications?"
 * (Planner E6).
 *
 * WHY THIS EXISTS INSTEAD OF THE PLANNER QUERYING PUBLICATIONS
 * -----------------------------------------------------------
 * `social-organic` imports `social-planner`; nothing goes the other way. A
 * Planner service holding a `SocialPublicationEntity` repository would invert
 * that arrow and create a module cycle, the same constraint that decided where
 * `DestinationCreativeService` lives in E5. So the Planner declares the port,
 * this class implements it, and registration happens on init — the direction
 * that was always safe.
 *
 * WHY IT IS THE NARROWEST POSSIBLE ANSWER
 * ---------------------------------------
 * It returns statuses, never publication rows or ids. The Planner has no
 * business reading execution evidence, and an editorial refusal message needs
 * to say what is in the way, not which record proved it. Keeping the answer
 * this thin is also what makes the arrow honest: the Planner gains no ability
 * to inspect publications, only to be told no.
 */
@Injectable()
export class SocialContentPublicationSourceService
  implements SocialContentPublicationSource, OnModuleInit
{
  readonly publicationSourceKey = 'social-organic.publications';

  constructor(
    @InjectRepository(SocialPublicationEntity, 'agency')
    private readonly publicationsRepository: Repository<SocialPublicationEntity>,

    private readonly guard: SocialContentPublicationGuard,
  ) {}

  onModuleInit(): void {
    this.guard.register(this);
  }

  async findBlockingPublications(input: {
    scope: {
      tenantId: string;
      workspaceId: string;
      agencyClientId: string | null;
    };
    contentItemIds: string[];
  }): Promise<SocialContentPublicationBlocker[]> {
    if (input.contentItemIds.length === 0) {
      return [];
    }

    const publications = await this.publicationsRepository.find({
      where: {
        tenantId: input.scope.tenantId,
        workspaceId: input.scope.workspaceId,
        agencyClientId:
          input.scope.agencyClientId === null
            ? IsNull()
            : input.scope.agencyClientId,
        contentItemId: In(input.contentItemIds),
        status: In([...SOCIAL_CONTENT_BLOCKING_PUBLICATION_STATUSES]),
      },
      /**
       * Only what the answer is made of. A publication carries a payload
       * snapshot, provider metadata and external ids; none of that should be
       * loaded to answer a yes/no question, and `provider_metadata` is
       * `select: false` precisely because it must never travel casually.
       */
      select: { id: true, contentItemId: true, status: true },
    });

    const byContentItem = new Map<string, Set<string>>();

    for (const publication of publications) {
      const statuses =
        byContentItem.get(publication.contentItemId) ?? new Set();
      statuses.add(publication.status);
      byContentItem.set(publication.contentItemId, statuses);
    }

    return [...byContentItem.entries()].map(([contentItemId, statuses]) => ({
      contentItemId,
      statuses: [...statuses].sort(),
    }));
  }
}
