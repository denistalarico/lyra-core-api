import type { EntityManager } from 'typeorm';
import { ClientAreaMemberModuleAccessEntity } from '../entities/client-area-member-module-access.entity';
import type { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import type {
  ClientAreaModuleLevels,
  CLIENT_AREA_MODULE_KEYS,
} from '../client-area.types';
export async function replaceModuleLevels(
  manager: EntityManager,
  member: ClientAreaMembershipEntity,
  levels: ClientAreaModuleLevels,
  actor: { userId: string | null; surface: 'agency' | 'client_area' },
) {
  const repo = manager.getRepository(ClientAreaMemberModuleAccessEntity);
  await repo.delete({ membershipId: member.id });
  const rows = Object.entries(levels).map(([moduleKey, level]) =>
    repo.create({
      membershipId: member.id,
      moduleKey: moduleKey as (typeof CLIENT_AREA_MODULE_KEYS)[number],
      level,
      grantedByUserId: actor.userId,
      grantedBySurface: actor.surface,
    }),
  );
  if (rows.length) await repo.save(rows);
}
