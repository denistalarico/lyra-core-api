import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
/** Profiles are already shared. Membership supplies the label, never an invented workspace user. */
@Injectable()
export class ActorDirectoryService {
  constructor(
    @InjectRepository(AgencyUserProfileEntity, 'agency')
    private readonly profiles: Repository<AgencyUserProfileEntity>,
    @InjectRepository(ClientAreaMembershipEntity, 'agency')
    private readonly memberships: Repository<ClientAreaMembershipEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, 'agency')
    private readonly operators: Repository<AgencyWorkspaceUserEntity>,
  ) {}
  async resolveNames(
    tenantId: string,
    userIds: readonly string[],
  ): Promise<Record<string, string>> {
    if (!userIds.length) return {};
    const ids = [...new Set(userIds)];
    const [profiles, members, operators] = await Promise.all([
      this.profiles.find({ where: { tenantId, userId: In(ids) } }),
      this.memberships.find({ where: { tenantId, userId: In(ids) } }),
      this.operators.find({
        where: { tenantId, userId: In(ids), status: 'active' },
      }),
    ]);
    const clients = new Set(members.map((row) => row.userId)),
      staff = new Set(operators.map((row) => row.userId));
    const displayNames = new Map(
      profiles.map((row) => [row.userId, row.displayName?.trim() || 'Usuário']),
    );
    return Object.fromEntries(
      ids.map((id) => [
        id,
        `${displayNames.get(id) || 'Usuário'}${clients.has(id) && !staff.has(id) ? ' (cliente)' : ''}`,
      ]),
    );
  }
}
