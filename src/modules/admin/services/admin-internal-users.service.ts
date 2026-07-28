import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { LoginRequestContext } from '../../auth/utils/login-context.util';
import {
  DataSource,
  type FindOptionsWhere,
  MoreThan,
  Repository,
} from 'typeorm';
import { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import type {
  ChangeAdminInternalUserRoleDto,
  ListAdminInternalUsersQueryDto,
} from '../dto/admin-internal-users.dto';
import {
  PlatformAdminSessionEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import {
  PLATFORM_ADMIN_ROLE_PERMISSIONS,
  type AdminPrincipal,
  type PlatformAdminRoleKey,
  type PlatformAdminStatus,
} from '../types/admin-access.types';
import { adminIdentityReference } from '../utils/admin-identity.util';
import { AdminAuditService } from './admin-audit.service';
import { AdminRolePolicyService } from './admin-role-policy.service';

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class AdminInternalUsersService {
  constructor(
    @InjectRepository(PlatformInternalAdminEntity, AGENCY_CONNECTION)
    private readonly adminRepository: Repository<PlatformInternalAdminEntity>,
    @InjectRepository(PlatformAdminSessionEntity, AGENCY_CONNECTION)
    private readonly sessionRepository: Repository<PlatformAdminSessionEntity>,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly identityGateway: AdminIdentityGateway,
    private readonly rolePolicy: AdminRolePolicyService,
    private readonly auditService: AdminAuditService,
  ) {}

  getRoleCatalog(principal: AdminPrincipal) {
    return {
      roles: Object.entries(PLATFORM_ADMIN_ROLE_PERMISSIONS).map(
        ([roleKey, permissions]) => ({
          roleKey: roleKey as PlatformAdminRoleKey,
          permissions,
          grantable: this.rolePolicy
            .grantableRoles(principal)
            .includes(roleKey as PlatformAdminRoleKey),
        }),
      ),
    };
  }

  async list(principal: AdminPrincipal, query: ListAdminInternalUsersQueryDto) {
    const where: FindOptionsWhere<PlatformInternalAdminEntity> = {};
    if (query.status) where.status = query.status;
    if (query.roleKey) where.roleKey = query.roleKey;
    const admins = await this.adminRepository.find({ where });
    const records = await Promise.all(
      admins.map(async (admin) => ({
        admin,
        identity: await (async () => {
          const reference = adminIdentityReference(admin);
          return reference
            ? this.identityGateway.findByReference(reference)
            : null;
        })(),
      })),
    );
    const normalizedSearch = query.search?.trim().toLowerCase();
    const filtered = records.filter(({ identity }) => {
      if (!normalizedSearch) return true;
      return (
        identity?.email.toLowerCase().includes(normalizedSearch) ||
        identity?.displayName.toLowerCase().includes(normalizedSearch)
      );
    });
    filtered.sort((left, right) => {
      if (query.sort.startsWith('name:')) {
        const comparison = (left.identity?.displayName ?? '').localeCompare(
          right.identity?.displayName ?? '',
        );
        return query.sort.endsWith(':desc') ? -comparison : comparison;
      }
      const comparison =
        left.admin.createdAt.getTime() - right.admin.createdAt.getTime();
      return query.sort.endsWith(':desc') ? -comparison : comparison;
    });
    const offset = (query.page - 1) * query.limit;
    const pageRecords = filtered.slice(offset, offset + query.limit);
    const [sessionCounts, activeSuperAdminCount] = await Promise.all([
      this.getActiveSessionCounts(pageRecords.map(({ admin }) => admin.id)),
      this.adminRepository.count({
        where: { roleKey: 'super_admin', status: 'active' },
      }),
    ]);
    return {
      items: pageRecords.map(({ admin, identity }) =>
        this.toSafeUser(
          admin,
          identity,
          sessionCounts.get(admin.id) ?? 0,
          principal,
          activeSuperAdminCount,
        ),
      ),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / query.limit)),
    };
  }

  async get(principal: AdminPrincipal, adminId: string) {
    const admin = await this.requireAdmin(adminId);
    const [identity, activeSessionsCount, activeSuperAdminCount] =
      await Promise.all([
        (() => {
          const reference = adminIdentityReference(admin);
          return reference
            ? this.identityGateway.findByReference(reference)
            : Promise.resolve(null);
        })(),
        this.sessionRepository.count({
          where: { adminId, status: 'active', expiresAt: MoreThan(new Date()) },
        }),
        this.adminRepository.count({
          where: { roleKey: 'super_admin', status: 'active' },
        }),
      ]);
    return this.toSafeUser(
      admin,
      identity,
      activeSessionsCount,
      principal,
      activeSuperAdminCount,
    );
  }

  async changeRole(
    principal: AdminPrincipal,
    adminId: string,
    dto: ChangeAdminInternalUserRoleDto,
    client: LoginRequestContext,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const target = await manager.findOne(PlatformInternalAdminEntity, {
        where: { id: adminId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!target) throw new NotFoundException('Administrator not found.');
      try {
        this.rolePolicy.assertCanManage(principal, target);
        this.rolePolicy.assertCanGrant(principal, dto.roleKey);
        if (target.roleKey === 'super_admin' && dto.roleKey !== 'super_admin') {
          await this.assertNotLastActiveSuperAdmin(manager, target);
        }
      } catch (error) {
        await this.auditDenied(principal, target, 'role_change', client, error);
        throw error;
      }
      const previousRole = target.roleKey;
      if (previousRole === dto.roleKey) {
        return;
      }
      target.roleKey = dto.roleKey;
      target.updatedBy = principal.userId;
      await manager.save(target);
      await this.revokeTargetSessions(manager, target.id);
      await this.auditService.record({
        actorAdminId: principal.adminId,
        actorUserId: principal.userId,
        action: 'admin.internal_user.role_changed',
        targetType: 'platform_internal_admin',
        targetId: target.id,
        outcome: 'success',
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
        metadata: {
          targetAdminId: target.id,
          targetUserId: target.userId,
          previousRole,
          newRole: dto.roleKey,
        },
      });
    });
    return this.get(principal, adminId);
  }

  suspend(
    principal: AdminPrincipal,
    adminId: string,
    client: LoginRequestContext,
  ) {
    return this.changeStatus(
      principal,
      adminId,
      'suspended',
      ['active'],
      'admin.internal_user.suspended',
      client,
    );
  }

  reactivate(
    principal: AdminPrincipal,
    adminId: string,
    client: LoginRequestContext,
  ) {
    return this.changeStatus(
      principal,
      adminId,
      'active',
      ['suspended'],
      'admin.internal_user.reactivated',
      client,
    );
  }

  disable(
    principal: AdminPrincipal,
    adminId: string,
    client: LoginRequestContext,
  ) {
    return this.changeStatus(
      principal,
      adminId,
      'disabled',
      ['active', 'suspended', 'pending'],
      'admin.internal_user.disabled',
      client,
    );
  }

  private async changeStatus(
    principal: AdminPrincipal,
    adminId: string,
    nextStatus: PlatformAdminStatus,
    allowedPrevious: readonly PlatformAdminStatus[],
    action: string,
    client: LoginRequestContext,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const target = await manager.findOne(PlatformInternalAdminEntity, {
        where: { id: adminId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!target) throw new NotFoundException('Administrator not found.');
      try {
        this.rolePolicy.assertCanManage(principal, target);
        if (!allowedPrevious.includes(target.status)) {
          throw new ConflictException(
            `Administrator cannot transition from ${target.status} to ${nextStatus}.`,
          );
        }
        if (
          target.roleKey === 'super_admin' &&
          target.status === 'active' &&
          nextStatus !== 'active'
        ) {
          await this.assertNotLastActiveSuperAdmin(manager, target);
        }
      } catch (error) {
        await this.auditDenied(
          principal,
          target,
          `status_change:${nextStatus}`,
          client,
          error,
        );
        throw error;
      }
      const previousStatus = target.status;
      target.status = nextStatus;
      target.updatedBy = principal.userId;
      await manager.save(target);
      if (nextStatus !== 'active') {
        await this.revokeTargetSessions(manager, target.id);
      }
      await this.auditService.record({
        actorAdminId: principal.adminId,
        actorUserId: principal.userId,
        action,
        targetType: 'platform_internal_admin',
        targetId: target.id,
        outcome: 'success',
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
        metadata: {
          targetAdminId: target.id,
          targetUserId: target.userId,
          previousStatus,
          newStatus: nextStatus,
        },
      });
    });
    return this.get(principal, adminId);
  }

  private async assertNotLastActiveSuperAdmin(
    manager: DataSource['manager'],
    target: PlatformInternalAdminEntity,
  ): Promise<void> {
    const activeSuperAdmins = await manager.find(PlatformInternalAdminEntity, {
      where: { roleKey: 'super_admin', status: 'active' },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      activeSuperAdmins.length <= 1 &&
      activeSuperAdmins.some((admin) => admin.id === target.id)
    ) {
      throw new ConflictException(
        'The last active super administrator is protected.',
      );
    }
  }

  private async revokeTargetSessions(
    manager: DataSource['manager'],
    adminId: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(PlatformAdminSessionEntity)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where('admin_id = :adminId', { adminId })
      .andWhere('status = :status', { status: 'active' })
      .execute();
  }

  private async requireAdmin(id: string) {
    const admin = await this.adminRepository.findOne({ where: { id } });
    if (!admin) throw new NotFoundException('Administrator not found.');
    return admin;
  }

  private async getActiveSessionCounts(adminIds: string[]) {
    const result = new Map<string, number>();
    if (adminIds.length === 0) return result;
    const rows = await this.sessionRepository
      .createQueryBuilder('session')
      .select('session.adminId', 'adminId')
      .addSelect('COUNT(*)', 'count')
      .where('session.adminId IN (:...adminIds)', { adminIds })
      .andWhere('session.status = :status', { status: 'active' })
      .andWhere('session.expiresAt > :now', { now: new Date() })
      .groupBy('session.adminId')
      .getRawMany<{ adminId: string; count: string }>();
    for (const row of rows) result.set(row.adminId, Number(row.count));
    return result;
  }

  private toSafeUser(
    admin: PlatformInternalAdminEntity,
    identity: Awaited<
      ReturnType<AdminIdentityGateway['findByReference']>
    > | null,
    activeSessionsCount: number,
    principal: AdminPrincipal,
    activeSuperAdminCount: number,
  ) {
    let canManage = false;
    try {
      this.rolePolicy.assertCanManage(principal, admin);
      canManage = true;
    } catch {
      canManage = false;
    }
    const isLastActiveSuperAdmin =
      admin.roleKey === 'super_admin' &&
      admin.status === 'active' &&
      activeSuperAdminCount <= 1;
    return {
      adminId: admin.id,
      userId: admin.userId,
      identitySource: admin.identitySource,
      platformAdminIdentityId: admin.platformAdminIdentityId,
      email: identity?.email ?? '',
      displayName: identity?.displayName ?? 'Identity unavailable',
      status: admin.status,
      roleKey: admin.roleKey,
      permissions: PLATFORM_ADMIN_ROLE_PERMISSIONS[admin.roleKey],
      twoFactorRequired: admin.twoFactorRequired,
      twoFactorEnabled: identity?.twoFactorEnabled ?? false,
      twoFactorMethod: identity?.twoFactorMethod ?? null,
      lastAdminLoginAt: admin.lastAdminLoginAt,
      activeSessionsCount,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
      allowedActions: {
        changeRole:
          canManage && admin.status !== 'disabled' && !isLastActiveSuperAdmin,
        suspend:
          canManage && admin.status === 'active' && !isLastActiveSuperAdmin,
        reactivate: canManage && admin.status === 'suspended',
        disable:
          canManage && admin.status !== 'disabled' && !isLastActiveSuperAdmin,
      },
      protectionReason: isLastActiveSuperAdmin
        ? 'The last active super administrator is protected.'
        : !canManage
          ? 'Self-management or role hierarchy protection applies.'
          : null,
    };
  }

  private async auditDenied(
    principal: AdminPrincipal,
    target: PlatformInternalAdminEntity,
    reason: string,
    client: LoginRequestContext,
    error: unknown,
  ) {
    if (
      !(
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      )
    ) {
      return;
    }
    await this.auditService.record({
      actorAdminId: principal.adminId,
      actorUserId: principal.userId,
      action: 'admin.internal_user.action_denied',
      targetType: 'platform_internal_admin',
      targetId: target.id,
      outcome: 'denied',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: {
        targetAdminId: target.id,
        targetUserId: target.userId,
        reason,
      },
    });
  }
}
