import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { TeamMember } from '../../team/entities/team-member.entity';
import { TeamMemberStatus } from '../../team/enums';
import { AgencyKnowledgeAuthorDisplayMode } from '../enums';
import type { KnowledgeContext } from './knowledge-context';

/** Separator between name and job title in `name_and_role`. */
const NAME_ROLE_SEPARATOR = ' — ';

export interface KnowledgeAuthorIdentity {
  /** Name of the authorized membership (what the app shows as the user). */
  name: string;
  /** Job title from the user's active Team record, maintained by Team admins. */
  jobTitle: string | null;
}

export interface KnowledgeAuthorship {
  authorDisplayMode: AgencyKnowledgeAuthorDisplayMode;
  authorDisplayValue: string;
}

/**
 * SEC-A1 — composes how the *authenticated* author is shown on Knowledge
 * content. The browser only chooses the mode; the name comes from the active
 * workspace membership and the job title from the user's active Team member
 * record (the self-declared profile title is deliberately not used: an author
 * cannot grant themselves a title). Nothing here reads request text, and no
 * lookup is keyed by a client-supplied name.
 */
@Injectable()
export class KnowledgeAuthorshipService {
  constructor(
    @InjectRepository(AgencyWorkspaceUserEntity, 'agency')
    private readonly workspaceUsersRepo: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(TeamMember, 'agency')
    private readonly teamMembersRepo: Repository<TeamMember>,
  ) {}

  async getIdentity(
    context: KnowledgeContext,
  ): Promise<KnowledgeAuthorIdentity> {
    const [membership, member] = await Promise.all([
      this.workspaceUsersRepo.findOne({
        select: { id: true, name: true },
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          status: 'active',
        },
      }),
      this.teamMembersRepo.findOne({
        select: { id: true, jobTitle: true },
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          status: TeamMemberStatus.Active,
        },
        order: { updatedAt: 'DESC' },
      }),
    ]);

    // The SEC-A1 authority already required this membership; fail closed if it
    // disappeared in between rather than publishing an anonymous author.
    if (!membership) {
      throw new ForbiddenException('Request context is not authorized.');
    }

    return {
      name: membership.name.trim(),
      jobTitle: member?.jobTitle?.trim() || null,
    };
  }

  /** Every label the author could publish under, for the UI preview. */
  describe(identity: KnowledgeAuthorIdentity) {
    return {
      name: identity.name,
      jobTitle: identity.jobTitle,
      options: {
        [AgencyKnowledgeAuthorDisplayMode.NAME_AND_ROLE]: this.compose(
          identity,
          AgencyKnowledgeAuthorDisplayMode.NAME_AND_ROLE,
        ),
        [AgencyKnowledgeAuthorDisplayMode.ROLE_ONLY]: identity.jobTitle,
      },
    };
  }

  async resolve(
    context: KnowledgeContext,
    mode: AgencyKnowledgeAuthorDisplayMode = AgencyKnowledgeAuthorDisplayMode.NAME_AND_ROLE,
  ): Promise<KnowledgeAuthorship> {
    const identity = await this.getIdentity(context);

    // Never fall back to the name when the author asked to hide it.
    if (
      mode === AgencyKnowledgeAuthorDisplayMode.ROLE_ONLY &&
      !identity.jobTitle
    ) {
      throw new BadRequestException(
        'Nenhuma função cadastrada no Time para exibir somente a função.',
      );
    }

    return {
      authorDisplayMode: mode,
      authorDisplayValue: this.compose(identity, mode),
    };
  }

  private compose(
    identity: KnowledgeAuthorIdentity,
    mode: AgencyKnowledgeAuthorDisplayMode,
  ): string {
    if (mode === AgencyKnowledgeAuthorDisplayMode.ROLE_ONLY) {
      return identity.jobTitle ?? '';
    }

    return identity.jobTitle
      ? `${identity.name}${NAME_ROLE_SEPARATOR}${identity.jobTitle}`
      : identity.name;
  }
}
