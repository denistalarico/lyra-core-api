import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import {
  getPermissionDefinition,
  isKnownPermissionKey,
  PERMISSION_KEYS,
} from '../catalog/permission-keys.catalog';
import { isOwnerOnlyPermissionKey } from '../catalog/permission-groups.catalog';
import {
  CLIENT_ACCESS_LEVEL_ORDER,
  ClientAccessLevel,
  type ClientProductKey,
  ClientProductRoleKey,
  PlatformRoleKey,
} from '../enums/permission.enums';
import { ManagedContextDirectoryService } from '../../../common/context/managed-context-directory.service';
import { AgencyClientAccessEntity } from '../entities/agency-client-access.entity';
import { AgencyClientProductAccessEntity } from '../entities/agency-client-product-access.entity';
import { PlatformPermissionAuditEventEntity } from '../entities/platform-permission-audit-event.entity';
import { PlatformRoleEntity } from '../entities/platform-role.entity';
import { PlatformRolePermissionEntity } from '../entities/platform-role-permission.entity';
import { PlatformUserPermissionEntity } from '../entities/platform-user-permission.entity';
import { PlatformContextService } from '../../platform/platform-context.service';
import {
  AuthorizedManagedClientEntry,
  ClientAccessCheck,
  ClientProductAccessCheck,
  PermissionAuditDecision,
  PermissionContext,
  PermissionScopeRequest,
} from '../types/permission-context.types';
import { PermissionScopeEvaluatorService } from './permission-scope-evaluator.service';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../catalog/role-permission-matrix.catalog';
import {
  isModuleScopedRole,
  type ModuleAccessLevel,
  permissionsForModuleAccess,
  resolveModuleAccess,
} from '../catalog/module-access.catalog';
import {
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from '../../agency/entities/agency-settings.entities';

const AGENCY_CONNECTION = 'agency';

function normalizeRole(role: string): PlatformRoleKey {
  if (role === 'owner') return PlatformRoleKey.Owner;
  if (role === 'admin' || role === 'administrator')
    return PlatformRoleKey.Admin;
  if (role === 'manager') return PlatformRoleKey.Manager;
  return PlatformRoleKey.Member;
}

@Injectable()
export class PlatformPermissionService {
  constructor(
    @InjectRepository(PlatformRoleEntity, AGENCY_CONNECTION)
    private readonly rolesRepository: Repository<PlatformRoleEntity>,
    @InjectRepository(PlatformRolePermissionEntity, AGENCY_CONNECTION)
    private readonly rolePermissionsRepository: Repository<PlatformRolePermissionEntity>,
    @InjectRepository(PlatformUserPermissionEntity, AGENCY_CONNECTION)
    private readonly userPermissionsRepository: Repository<PlatformUserPermissionEntity>,
    @InjectRepository(AgencyClientAccessEntity, AGENCY_CONNECTION)
    private readonly clientAccessRepository: Repository<AgencyClientAccessEntity>,
    @InjectRepository(AgencyClientProductAccessEntity, AGENCY_CONNECTION)
    private readonly clientProductAccessRepository: Repository<AgencyClientProductAccessEntity>,
    @InjectRepository(PlatformPermissionAuditEventEntity, AGENCY_CONNECTION)
    private readonly auditRepository: Repository<PlatformPermissionAuditEventEntity>,
    private readonly platformContextService: PlatformContextService,
    private readonly scopeEvaluator: PermissionScopeEvaluatorService,
    private readonly managedContextDirectory: ManagedContextDirectoryService,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepository: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyWorkspaceUserPermissionEntity, AGENCY_CONNECTION)
    private readonly moduleAccessRepository: Repository<AgencyWorkspaceUserPermissionEntity>,
  ) {}

  /**
   * Checks whether the tenant has an active entitlement for the given
   * product (blueprint section 6.4). Owner is still subject to entitlement
   * checks: a product that is not contracted stays locked even for Owner.
   */
  async canAccessProduct(
    context: PermissionContext,
    productKey: string,
  ): Promise<boolean> {
    const platformContext = await this.platformContextService.getContext({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId ?? '',
      userId: context.userId,
      role: context.role,
    });

    const product = platformContext.products.find(
      (entry) => entry.key === productKey,
    );

    return product?.access === 'available';
  }

  /**
   * Resolves the full set of permission keys a user currently holds.
   * Owner always receives every permission key (blueprint section 7.1).
   */
  async getEffectivePermissions(
    context: PermissionContext,
  ): Promise<Set<string>> {
    const roleKey = normalizeRole(context.role);

    if (roleKey === PlatformRoleKey.Owner) {
      return new Set(PERMISSION_KEYS);
    }

    // The catalog is the single source of truth (Settings > Users
    // simplification): Admin holds its role keys; Manager/Member are cut by
    // their level per product/module. Role rows in `platform_role_permissions`
    // and per-key user overrides are no longer read.
    if (!isModuleScopedRole(roleKey)) {
      return new Set(DEFAULT_ROLE_PERMISSION_MATRIX[roleKey]);
    }

    const levels = await this.getModuleAccess(context);
    return new Set(permissionsForModuleAccess(roleKey, levels));
  }

  /**
   * Resolved product/module levels for the caller (`null` = no access).
   * Owner/Admin get `manager` on everything.
   */
  async getModuleAccess(
    context: PermissionContext,
  ): Promise<Record<string, ModuleAccessLevel | null>> {
    const roleKey = normalizeRole(context.role);

    if (!isModuleScopedRole(roleKey) || !context.workspaceId) {
      return resolveModuleAccess(roleKey, []);
    }

    const workspaceUser = await this.workspaceUsersRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });
    const rows = workspaceUser
      ? await this.moduleAccessRepository.find({
          where: { workspaceUserId: workspaceUser.id },
        })
      : [];

    return resolveModuleAccess(roleKey, rows);
  }

  async can(
    context: PermissionContext,
    permissionKey: string,
  ): Promise<boolean> {
    const roleKey = normalizeRole(context.role);

    if (roleKey === PlatformRoleKey.Owner) {
      return true;
    }

    const effective = await this.getEffectivePermissions(context);

    return effective.has(permissionKey);
  }

  async assertCan(
    context: PermissionContext,
    permissionKey: string,
    scopeRequest?: PermissionScopeRequest,
  ): Promise<void> {
    const allowed = await this.can(context, permissionKey);

    if (!allowed) {
      await this.auditPermissionDecision({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId ?? null,
        actorUserId: context.userId,
        action: 'access_denied',
        permissionKey,
        riskLevel: getPermissionDefinition(permissionKey)?.riskLevel ?? null,
      });

      throw new ForbiddenException(
        `You do not have the required permission: ${permissionKey}.`,
      );
    }

    await this.scopeEvaluator.assertScope(context, permissionKey, scopeRequest);
  }

  async assertAny(
    context: PermissionContext,
    permissionKeys: string[],
    scopeRequest?: PermissionScopeRequest,
  ): Promise<void> {
    for (const permissionKey of permissionKeys) {
      const allowed = await this.can(context, permissionKey);

      if (!allowed) {
        continue;
      }

      try {
        await this.scopeEvaluator.assertScope(
          context,
          permissionKey,
          scopeRequest,
        );
        return;
      } catch {
        // Try the next permission alternative before denying the route.
      }
    }

    await this.auditPermissionDecision({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId ?? null,
      actorUserId: context.userId,
      action: 'access_denied',
      permissionKey: permissionKeys.join('|'),
      riskLevel: null,
    });

    throw new ForbiddenException(
      `You do not have any of the required permissions: ${permissionKeys.join(', ')}.`,
    );
  }

  /**
   * Checks whether the user can access a managed client, optionally
   * requiring a minimum visibility tier (blueprint sections 8.2 and 9.6).
   */
  async canAccessClient(check: ClientAccessCheck): Promise<boolean> {
    const roleKey = normalizeRole(check.role);

    if (roleKey === PlatformRoleKey.Owner) {
      return true;
    }

    const where: FindOptionsWhere<AgencyClientAccessEntity> = {
      tenantId: check.tenantId,
      clientId: check.clientId,
      userId: check.userId,
    };

    if (check.workspaceId) {
      where.workspaceId = check.workspaceId;
    }

    const access = await this.clientAccessRepository.findOne({
      where,
    });

    if (!access) {
      return false;
    }

    if (!check.requiredLevel) {
      return true;
    }

    const requiredIndex = CLIENT_ACCESS_LEVEL_ORDER.indexOf(
      check.requiredLevel,
    );
    const grantedIndex = CLIENT_ACCESS_LEVEL_ORDER.indexOf(access.accessLevel);

    return grantedIndex >= requiredIndex;
  }

  /**
   * Checks whether the user can operate a product (LeadFlow, Social, ...)
   * contracted by a managed client (blueprint sections 8.3 and 10/11).
   *
   * Delegates to {@link ManagedContextDirectoryService}, which is the single
   * implementation shared with the shell context contract (LF-RF-F12-001).
   */
  async canAccessClientProduct(
    check: ClientProductAccessCheck,
  ): Promise<boolean> {
    return this.managedContextDirectory.canAccessClientProduct(check);
  }

  /**
   * Lists the managed clients the caller is authorized to operate a given
   * product in: active client with an active entitlement on its managed
   * tenant, plus (unless owner/admin) an explicit client + client-product
   * access grant for the caller. This is the authoritative "which contexts
   * can I operate" source — no client is ever returned solely because it
   * belongs to the tenant (blueprint sections 8.3, 9.6 and 12.6).
   */
  async listAuthorizedManagedClients(
    context: PermissionContext,
    productKey: string,
  ): Promise<AuthorizedManagedClientEntry[]> {
    const entries = await this.managedContextDirectory.listAuthorizedClients(
      context,
      productKey,
    );

    return entries as AuthorizedManagedClientEntry[];
  }

  /**
   * Lists the users explicitly granted access to a product (LeadFlow,
   * Social, ...) for one managed client, from `agency_client_product_access`
   * (blueprint sections 8.3 and 12.6). This is a read of the same rows
   * `canAccessClientProduct` checks — it grants no access itself and does
   * not resolve display data (name/avatar), which the caller cross-references
   * against `/agency/settings/users` (Social Settings decision D-5).
   *
   * The caller's own authorization for this client + product must already
   * be verified by the controller before calling this method; it performs
   * no access check of its own.
   */
  async listClientProductAccess(
    tenantId: string,
    clientId: string,
    productKey: string,
  ): Promise<Array<{ userId: string; roleKey: ClientProductRoleKey }>> {
    const rows = await this.clientProductAccessRepository.find({
      where: {
        tenantId,
        clientId,
        productKey: productKey as AgencyClientProductAccessEntity['productKey'],
      },
      order: { createdAt: 'ASC' },
    });

    return rows.map((row) => ({ userId: row.userId, roleKey: row.roleKey }));
  }

  /** Per-client LeadFlow/Social grants for the given users (Settings > Users). */
  async listUsersClientProductAccess(
    tenantId: string,
    workspaceId: string,
    userIds: string[],
  ): Promise<Array<{ userId: string; clientId: string; productKey: string }>> {
    if (userIds.length === 0) return [];
    const rows = await this.clientProductAccessRepository.find({
      where: { tenantId, workspaceId, userId: In(userIds) },
    });
    return rows.map((row) => ({
      userId: row.userId,
      clientId: row.clientId,
      productKey: row.productKey,
    }));
  }

  /**
   * Replaces a user's LeadFlow/Social client grants. Each grant also ensures
   * the `agency_client_access` row the managed-context check requires. The
   * stored product role mirrors the user's level in that product.
   */
  async replaceUserClientProductAccess(params: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    actorUserId: string | null;
    grants: Array<{ clientId: string; productKey: ClientProductKey }>;
    levels: Partial<Record<ClientProductKey, ModuleAccessLevel | null>>;
  }): Promise<void> {
    const { tenantId, workspaceId, userId } = params;
    const clientIds = [...new Set(params.grants.map((grant) => grant.clientId))];
    const clients = clientIds.length
      ? await this.managedContextDirectory.findWorkspaceClients(
          tenantId,
          workspaceId,
          clientIds,
        )
      : [];
    const managedTenantByClientId = new Map(
      clients.map((client) => [client.id, client.managedTenantId]),
    );

    await this.clientProductAccessRepository.delete({
      tenantId,
      workspaceId,
      userId,
    });

    const rows = params.grants
      .filter((grant) => managedTenantByClientId.has(grant.clientId))
      .map((grant) =>
        this.clientProductAccessRepository.create({
          tenantId,
          workspaceId,
          userId,
          clientId: grant.clientId,
          managedTenantId: managedTenantByClientId.get(grant.clientId) ?? null,
          productKey: grant.productKey,
          roleKey:
            params.levels[grant.productKey] === 'manager'
              ? ClientProductRoleKey.Manager
              : ClientProductRoleKey.Member,
          scopeKey: null,
          createdById: params.actorUserId,
        }),
      );
    if (rows.length > 0) await this.clientProductAccessRepository.save(rows);

    const grantedClientIds = [...new Set(rows.map((row) => row.clientId))];
    const existingAccess = grantedClientIds.length
      ? await this.clientAccessRepository.find({
          where: {
            tenantId,
            workspaceId,
            userId,
            clientId: In(grantedClientIds),
          },
        })
      : [];
    const withAccess = new Set(existingAccess.map((row) => row.clientId));
    const missing = grantedClientIds.filter((id) => !withAccess.has(id));
    if (missing.length > 0) {
      await this.clientAccessRepository.save(
        missing.map((clientId) =>
          this.clientAccessRepository.create({
            tenantId,
            workspaceId,
            userId,
            clientId,
            managedTenantId: managedTenantByClientId.get(clientId) ?? null,
            roleKey: PlatformRoleKey.Member,
            accessLevel: ClientAccessLevel.Basic,
            createdById: params.actorUserId,
          }),
        ),
      );
    }

    await this.auditPermissionDecision({
      tenantId,
      workspaceId,
      actorUserId: params.actorUserId,
      targetUserId: userId,
      action: 'client_product_access_granted',
      metadata: {
        grants: rows.map((row) => ({
          clientId: row.clientId,
          productKey: row.productKey,
        })),
      },
    });
  }

  isDangerousAction(permissionKey: string): boolean {
    return getPermissionDefinition(permissionKey)?.isDangerous ?? false;
  }

  async auditPermissionDecision(
    decision: PermissionAuditDecision,
  ): Promise<void> {
    const event = this.auditRepository.create({
      tenantId: decision.tenantId,
      workspaceId: decision.workspaceId ?? null,
      actorUserId: decision.actorUserId ?? null,
      targetUserId: decision.targetUserId ?? null,
      action: decision.action,
      permissionKey: decision.permissionKey ?? null,
      resourceType: decision.resourceType ?? null,
      resourceId: decision.resourceId ?? null,
      riskLevel:
        (decision.riskLevel as PlatformPermissionAuditEventEntity['riskLevel']) ??
        null,
      metadata: decision.metadata ?? {},
    });

    await this.auditRepository.save(event);
  }

  /**
   * Lists active permission overrides for a given user (Sprint 13 - Settings
   * Users admin UI). Includes both tenant-wide and workspace-scoped rows.
   */
  async listUserPermissionOverrides(
    tenantId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<PlatformUserPermissionEntity[]> {
    const where: FindOptionsWhere<PlatformUserPermissionEntity>[] = [
      { tenantId, userId, workspaceId: IsNull() },
    ];

    if (workspaceId) {
      where.push({ tenantId, userId, workspaceId });
    }

    return this.userPermissionsRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Grants or revokes a single permission override for a user. Owner-only
   * permission keys can never be managed through this admin entry point
   * (Sprint 13 decision: owner-only permissions stay out of functional
   * groups and per-user overrides).
   */
  async addUserPermissionOverride(params: {
    tenantId: string;
    workspaceId?: string;
    userId: string;
    permissionKey: string;
    enabled: boolean;
    reason?: string;
    actorUserId: string;
  }): Promise<PlatformUserPermissionEntity> {
    if (!isKnownPermissionKey(params.permissionKey)) {
      throw new BadRequestException(
        `Unknown permission key: ${params.permissionKey}.`,
      );
    }

    if (isOwnerOnlyPermissionKey(params.permissionKey)) {
      throw new ForbiddenException(
        `Permission ${params.permissionKey} is owner-only and cannot be managed through user overrides.`,
      );
    }

    const existing = await this.userPermissionsRepository.findOne({
      where: {
        tenantId: params.tenantId,
        userId: params.userId,
        workspaceId: params.workspaceId ?? IsNull(),
        permissionKey: params.permissionKey,
      },
    });

    const entity =
      existing ??
      this.userPermissionsRepository.create({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId ?? null,
        userId: params.userId,
        permissionKey: params.permissionKey,
      });

    entity.enabled = params.enabled;
    entity.reason = params.reason ?? null;
    entity.createdById = params.actorUserId;

    const saved = await this.userPermissionsRepository.save(entity);

    await this.auditPermissionDecision({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId ?? null,
      actorUserId: params.actorUserId,
      targetUserId: params.userId,
      action: params.enabled ? 'permission_granted' : 'permission_revoked',
      permissionKey: params.permissionKey,
      riskLevel: getPermissionDefinition(params.permissionKey)?.riskLevel ?? null,
    });

    return saved;
  }

  /**
   * Removes a permission override for a user, restoring the role-based
   * default for that permission key.
   */
  async removeUserPermissionOverride(params: {
    tenantId: string;
    workspaceId?: string;
    userId: string;
    permissionKey: string;
    actorUserId: string;
  }): Promise<void> {
    const existing = await this.userPermissionsRepository.findOne({
      where: {
        tenantId: params.tenantId,
        userId: params.userId,
        workspaceId: params.workspaceId ?? IsNull(),
        permissionKey: params.permissionKey,
      },
    });

    if (!existing) {
      return;
    }

    await this.userPermissionsRepository.remove(existing);

    await this.auditPermissionDecision({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId ?? null,
      actorUserId: params.actorUserId,
      targetUserId: params.userId,
      action: 'permission_revoked',
      permissionKey: params.permissionKey,
      riskLevel: getPermissionDefinition(params.permissionKey)?.riskLevel ?? null,
    });
  }
}
