import { In, type EntityManager } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';

export type ApprovalCommentAuthor = {
  name: string;
  side: 'agency' | 'client' | 'system';
  /** Written by whoever is reading: the chat puts it on the right. */
  mine: boolean;
};

/**
 * E4: who wrote each message of the piece chat, for the agency. Unlike the
 * client view (§17), the team sees operator names. A person with a membership
 * in this company is the client side, even after losing access.
 */
export async function approvalCommentAuthors(
  manager: EntityManager,
  scope: CompanyAwareScope,
  readerId: string,
  userIds: readonly (string | null)[],
): Promise<(userId: string | null) => ApprovalCommentAuthor> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const [profiles, memberships] = ids.length
    ? await Promise.all([
        manager.getRepository(AgencyUserProfileEntity).find({
          where: ids.map((userId) => ({ tenantId: scope.tenantId, userId })),
        }),
        scope.companyContextId
          ? manager.getRepository(ClientAreaMembershipEntity).find({
              where: {
                tenantId: scope.tenantId,
                companyContextId: scope.companyContextId,
                userId: In(ids),
              },
            })
          : Promise.resolve([]),
      ])
    : [[], []];
  const names = new Map(
    profiles
      .filter((profile) => profile.displayName?.trim())
      .map((profile) => [profile.userId, profile.displayName.trim()]),
  );
  const clients = new Set(memberships.map((membership) => membership.userId));
  return (userId) => {
    if (!userId) return { name: 'Lyra', side: 'system', mine: false };
    const client = clients.has(userId);
    return {
      name: names.get(userId) ?? (client ? 'Cliente' : 'Equipe'),
      side: client ? 'client' : 'agency',
      mine: userId === readerId,
    };
  };
}
