import { ActorDirectoryService } from './actor-directory.service';
import { replaceModuleLevels } from './client-area-module-levels.persistence';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, In } from 'typeorm';
import { ClientAreaMemberModuleAccessEntity } from '../entities/client-area-member-module-access.entity';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import { ClientAreaCompanySettingsEntity } from '../entities/client-area-settings.entity';
import type {
  ClientAreaContext,
  ClientAreaModuleLevels,
} from '../client-area.types';
import { CLIENT_AREA_MODULE_KEYS, isUuid } from '../client-area.types';
import { validateModuleLevels } from '../client-area-access-validation';
import { AuditChangeService, recordChange } from './audit-change.service';
import { ClientAreaMembershipService } from './client-area-membership.service';
import { ClientAreaMemberAuditService } from './client-area-member-audit.service';
import type { ClientAreaAgencyActor } from './client-area-invitation.service';
import { resolveMemberAccess } from '../client-area-permissions.catalog';

@Injectable()
export class ClientAreaMemberAccessService {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly memberships: ClientAreaMembershipService,
    private readonly memberAudit: ClientAreaMemberAuditService,
    private readonly audit: AuditChangeService,
    @Optional() private readonly actors?: ActorDirectoryService,
  ) {}
  async levels(
    membershipId: string,
    manager = this.db.manager,
  ): Promise<ClientAreaModuleLevels> {
    const rows = await manager
      .getRepository(ClientAreaMemberModuleAccessEntity)
      .find({ where: { membershipId } });
    return Object.fromEntries(rows.map((row) => [row.moduleKey, row.level]));
  }
  async resolveMemberAccess(
    member: ClientAreaMembershipEntity,
    modules: Partial<Record<string, boolean>>,
  ) {
    return resolveMemberAccess(
      member.role,
      modules,
      await this.levels(member.id),
    );
  }
  private async company(
    manager: EntityManager,
    actor: ClientAreaAgencyActor | ClientAreaContext,
    clientId: string,
    companyContextId: string,
  ) {
    const { company } = await this.memberships.findUsableCompany(
      manager,
      actor.tenantId,
      companyContextId,
    );
    if (
      company.workspaceId !== actor.workspaceId ||
      company.agencyClientId !== clientId
    )
      throw new NotFoundException('Company is not available.');
    if ('surface' in actor) {
      if (
        actor.companyContextId !== company.id ||
        actor.agencyClientId !== clientId
      )
        throw new NotFoundException('Company is not available.');
      const owner = await manager
        .getRepository(ClientAreaMembershipEntity)
        .findOne({
          where: {
            id: actor.membershipId,
            tenantId: actor.tenantId,
            companyContextId: company.id,
            userId: actor.userId,
            status: 'active',
            role: 'client_owner',
          },
        });
      if (!owner)
        throw new ForbiddenException('Only the Owner manages company access.');
    } else
      await this.memberships.assertAgencyActor(
        manager,
        actor.tenantId,
        actor.workspaceId,
        actor.userId,
      );
    return company;
  }
  private async member(
    manager: EntityManager,
    tenantId: string,
    companyContextId: string,
    id: string,
  ) {
    if (!isUuid(id))
      throw new NotFoundException('Membership is not available.');
    const row = await manager
      .getRepository(ClientAreaMembershipEntity)
      .findOne({
        where: { id, tenantId, companyContextId, status: 'active' },
        lock: manager.queryRunner?.isTransactionActive
          ? { mode: 'pessimistic_write' }
          : undefined,
      });
    if (!row) throw new NotFoundException('Membership is not available.');
    return row;
  }
  async list(
    actor: ClientAreaAgencyActor | ClientAreaContext,
    clientId: string,
    companyContextId: string,
  ) {
    await this.company(this.db.manager, actor, clientId, companyContextId);
    const rows = await this.db.getRepository(ClientAreaMembershipEntity).find({
      where: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        agencyClientId: clientId,
        companyContextId,
        status: 'active',
      },
      order: { grantedAt: 'ASC' },
    });
    const ids = rows.map((row) => row.id);
    const [levels, names] = await Promise.all([
      ids.length
        ? this.db
            .getRepository(ClientAreaMemberModuleAccessEntity)
            .find({ where: { membershipId: In(ids) } })
        : Promise.resolve([]),
      this.actors?.resolveNames(
        actor.tenantId,
        rows.map((row) => row.userId),
      ) ?? Promise.resolve({} as Record<string, string>),
    ]);
    return {
      members: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        displayName: names[row.userId] ?? 'Usuário',
        accountRole: row.role,
        moduleLevels: Object.fromEntries(
          levels
            .filter((level) => level.membershipId === row.id)
            .map((level) => [level.moduleKey, level.level]),
        ),
      })),
    };
  }

  async get(
    actor: ClientAreaAgencyActor | ClientAreaContext,
    clientId: string,
    companyContextId: string,
    membershipId: string,
  ) {
    await this.company(this.db.manager, actor, clientId, companyContextId);
    const member = await this.member(
      this.db.manager,
      actor.tenantId,
      companyContextId,
      membershipId,
    );
    return {
      membershipId: member.id,
      accountRole: member.role,
      moduleLevels: await this.levels(member.id),
    };
  }
  async put(
    actor: ClientAreaAgencyActor | ClientAreaContext,
    clientId: string,
    companyContextId: string,
    membershipId: string,
    input: unknown,
  ) {
    const levels = validateModuleLevels(input);
    const result = await this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `client_area_access:${companyContextId}`,
      ]);
      const company = await this.company(
        manager,
        actor,
        clientId,
        companyContextId,
      );
      const member = await this.member(
        manager,
        actor.tenantId,
        companyContextId,
        membershipId,
      );
      if ('surface' in actor && member.userId === actor.userId)
        throw new ForbiddenException(
          'The Owner cannot modify their own access.',
        );
      if (member.role === 'client_owner')
        throw new ConflictException(
          'Transfer ownership before changing Owner access.',
        );
      const settings = await manager
        .getRepository(ClientAreaCompanySettingsEntity)
        .findOne({ where: { tenantId: actor.tenantId, companyContextId } });
      for (const key of Object.keys(
        levels,
      ) as (keyof ClientAreaModuleLevels)[]) {
        if (key === 'agency_billing')
          throw new BadRequestException('Billing is reserved to the Owner.');
        if (!settings?.moduleSettings?.[key]?.enabled)
          throw new ForbiddenException(
            'The Agency has not enabled this module.',
          );
      }
      const before = await this.levels(member.id, manager);
      await replaceModuleLevels(manager, member, levels, {
        userId: actor.userId,
        surface: 'surface' in actor ? 'client_area' : 'agency',
      });
      await this.memberAudit.record(manager, {
        company: { ...company, companyContextId: company.id },
        action: 'module_access_changed',
        actorSurface: 'surface' in actor ? 'client_area' : 'agency',
        actorUserId: actor.userId,
        membershipId: member.id,
        targetUserId: member.userId,
        metadata: { moduleLevels: levels },
      });
      return recordChange(before, levels, CLIENT_AREA_MODULE_KEYS);
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      agencyClientId: clientId,
      companyContextId,
      actorUserId: actor.userId,
      actorSurface: 'surface' in actor ? 'client_area' : 'agency',
      moduleKey: 'settings',
      entityType: 'member_module_access',
      entityId: membershipId,
      action: 'update',
      ...result,
    });
    return this.get(actor, clientId, companyContextId, membershipId);
  }
  async transfer(
    actor: ClientAreaAgencyActor | ClientAreaContext,
    clientId: string,
    companyContextId: string,
    membershipId: string,
  ) {
    const result = await this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `client_area_access:${companyContextId}`,
      ]);
      const company = await this.company(
        manager,
        actor,
        clientId,
        companyContextId,
      );
      const target = await this.member(
        manager,
        actor.tenantId,
        companyContextId,
        membershipId,
      );
      if ('surface' in actor && target.userId === actor.userId)
        throw new ForbiddenException('Select another member.');
      if (target.role === 'client_owner') return null;
      const repo = manager.getRepository(ClientAreaMembershipEntity);
      const previous = await repo.findOne({
        where: {
          tenantId: actor.tenantId,
          companyContextId,
          role: 'client_owner',
          status: 'active',
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (previous)
        await repo.update({ id: previous.id }, { role: 'client_member' });
      await repo.update({ id: target.id }, { role: 'client_owner' });
      await this.memberAudit.record(manager, {
        company: { ...company, companyContextId: company.id },
        action: 'owner_transferred',
        actorSurface: 'surface' in actor ? 'client_area' : 'agency',
        actorUserId: actor.userId,
        membershipId: target.id,
        targetUserId: target.userId,
        previousRole: 'client_member',
        newRole: 'client_owner',
        metadata: { previousMembershipId: previous?.id ?? null },
      });
      return recordChange(
        { ownerMembershipId: previous?.id ?? null },
        { ownerMembershipId: target.id },
        ['ownerMembershipId'],
      );
    });
    if (result)
      await this.audit.record({
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        agencyClientId: clientId,
        companyContextId,
        actorUserId: actor.userId,
        actorSurface: 'surface' in actor ? 'client_area' : 'agency',
        moduleKey: 'settings',
        entityType: 'ownership',
        entityId: membershipId,
        action: 'state_change',
        ...result,
      });
    // After transfer the old Owner can no longer use management endpoints.
    return { membershipId, accountRole: 'client_owner' as const };
  }
  async revoke(actor: ClientAreaContext, membershipId: string) {
    return this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `client_area_access:${actor.companyContextId}`,
      ]);
      await this.company(
        manager,
        actor,
        actor.agencyClientId,
        actor.companyContextId,
      );
      const member = await this.member(
        manager,
        actor.tenantId,
        actor.companyContextId,
        membershipId,
      );
      if (member.userId === actor.userId || member.role === 'client_owner')
        throw new ForbiddenException(
          'Transfer ownership before removing yourself.',
        );
      // revokeInTransaction's historical audit actor must reflect the real surface.
      await this.memberships.revokeInTransaction(manager, member, {
        revokedByUserId: actor.userId,
        actorSurface: 'client_area',
      });
      return { membershipId: member.id, status: 'revoked' };
    });
  }
}
