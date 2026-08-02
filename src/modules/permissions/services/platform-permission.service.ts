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
  CLIENT_PRODUCT_ROLE_ORDER,
  PlatformRoleKey,
} from '../enums/permission.enums';
import { AgencyClientAccessEntity } from '../entities/agency-client-access.entity';
import { AgencyClientProductAccessEntity } from '../entities/agency-client-product-access.entity';
import { PlatformPermissionAuditEventEntity } from '../entities/platform-permission-audit-event.entity';
import { PlatformRoleEntity } from '../entities/platform-role.entity';
import { PlatformRolePermissionEntity } from '../entities/platform-role-permission.entity';
import { PlatformUserPermissionEntity } from '../entities/platform-user-permission.entity';
import { PlatformContextService } from '../../platform/platform-context.service';
import { AgencyClient } from '../../clients/entities';
import { AgencyClientStatus } from '../../clients/enums';
import {
  PlatformProductKey,
  ProductEntitlementStatus,
  TenantProductEntitlementEntity,
} from '../../platform';
import {
  AuthorizedManagedClientEntry,
  ClientAccessCheck,
  ClientProductAccessCheck,
  PermissionAuditDecision,
  PermissionContext,
  PermissionScopeRequest,
} from '../types/permission-context.types';
import { PermissionScopeEvaluatorService } from './permission-scope-evaluator.service';

const AGENCY_CONNECTION = 'agency';
const CLIENT_PRODUCT_KEYS = new Set<string>([
  PlatformProductKey.LeadFlow,
  PlatformProductKey.Social,
]);
const ACTIVE_ENTITLEMENT_STATUSES = new Set<string>([
  ProductEntitlementStatus.Active,
  ProductEntitlementStatus.Trial,
]);

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
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepository: Repository<AgencyClient>,
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepository: Repository<TenantProductEntitlementEntity>,
    @InjectRepository(PlatformPermissionAuditEventEntity, AGENCY_CONNECTION)
    private readonly auditRepository: Repository<PlatformPermissionAuditEventEntity>,
    private readonly platformContextService: PlatformContextService,
    private readonly scopeEvaluator: PermissionScopeEvaluatorService,
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

    const role = await this.resolveRole(context.tenantId, roleKey);

    if (!role) {
      return new Set();
    }

    const [systemRows, tenantRows] = await Promise.all([
      this.rolePermissionsRepository.find({
        where: { roleId: role.id, tenantId: IsNull() },
      }),
      this.rolePermissionsRepository.find({
        where: { roleId: role.id, tenantId: context.tenantId },
      }),
    ]);

    const effective = new Map<string, boolean>();

    for (const row of systemRows) {
      effective.set(row.permissionKey, row.enabled);
    }

    for (const row of tenantRows) {
      effective.set(row.permissionKey, row.enabled);
    }

    const permissions = new Set(
      [...effective.entries()]
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    );

    await this.applyUserOverrides(context, permissions);

    return permissions;
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
   */
  async canAccessClientProduct(
    check: ClientProductAccessCheck,
  ): Promise<boolean> {
    const roleKey = normalizeRole(check.role);

    if (
      !check.tenantId ||
      !check.workspaceId ||
      !check.clientId ||
      !check.userId ||
      !CLIENT_PRODUCT_KEYS.has(check.productKey)
    ) {
      return false;
    }

    const client = await this.clientsRepository.findOne({
      where: {
        id: check.clientId,
        tenantId: check.tenantId,
        workspaceId: check.workspaceId,
      },
    });

    if (
      !client ||
      client.status === AgencyClientStatus.Archived ||
      client.archivedAt ||
      !client.managedTenantId
    ) {
      return false;
    }

    const entitlement = await this.entitlementsRepository.findOne({
      where: {
        tenantId: client.managedTenantId,
        productKey: check.productKey as PlatformProductKey,
      },
    });

    if (!this.isActiveEntitlement(entitlement)) {
      return false;
    }

    if (
      roleKey === PlatformRoleKey.Owner ||
      roleKey === PlatformRoleKey.Admin
    ) {
      return true;
    }

    const clientAccessWhere: FindOptionsWhere<AgencyClientAccessEntity> = {
      tenantId: check.tenantId,
      clientId: check.clientId,
      userId: check.userId,
      workspaceId: check.workspaceId,
    };

    const clientAccess = await this.clientAccessRepository.findOne({
      where: clientAccessWhere,
    });

    if (
      !clientAccess ||
      clientAccess.managedTenantId !== client.managedTenantId
    ) {
      return false;
    }

    const where: FindOptionsWhere<AgencyClientProductAccessEntity> = {
      tenantId: check.tenantId,
      workspaceId: check.workspaceId,
      clientId: check.clientId,
      managedTenantId: client.managedTenantId,
      productKey:
        check.productKey as AgencyClientProductAccessEntity['productKey'],
      userId: check.userId,
    };

    const access = await this.clientProductAccessRepository.findOne({
      where,
    });

    if (!access) {
      return false;
    }

    if (!check.requiredRole) {
      return true;
    }

    const requiredIndex = CLIENT_PRODUCT_ROLE_ORDER.indexOf(check.requiredRole);
    const grantedIndex = CLIENT_PRODUCT_ROLE_ORDER.indexOf(access.roleKey);

    return grantedIndex >= requiredIndex;
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
    if (!context.workspaceId || !CLIENT_PRODUCT_KEYS.has(productKey)) {
      return [];
    }

    const clients = await this.clientsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        status: AgencyClientStatus.Active,
        archivedAt: IsNull(),
      },
    });

    const managedTenantIds = [
      ...new Set(
        clients
          .map((client) => client.managedTenantId)
          .filter((managedTenantId): managedTenantId is string =>
            Boolean(managedTenantId),
          ),
      ),
    ];

    if (managedTenantIds.length === 0) {
      return [];
    }

    const entitlements = await this.entitlementsRepository.find({
      where: {
        tenantId: In(managedTenantIds),
        productKey: productKey as PlatformProductKey,
      },
    });

    const entitlementByManagedTenantId = new Map(
      entitlements.map((entitlement) => [entitlement.tenantId, entitlement]),
    );

    const roleKey = normalizeRole(context.role);
    const isPrivileged =
      roleKey === PlatformRoleKey.Owner || roleKey === PlatformRoleKey.Admin;

    let accessByClientId: Map<string, AgencyClientAccessEntity> | null = null;
    let productAccessByClientId: Map<
      string,
      AgencyClientProductAccessEntity
    > | null = null;

    if (!isPrivileged) {
      const clientIds = clients.map((client) => client.id);

      const [accessRows, productAccessRows] = await Promise.all([
        this.clientAccessRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            userId: context.userId,
            clientId: In(clientIds),
          },
        }),
        this.clientProductAccessRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            userId: context.userId,
            clientId: In(clientIds),
            productKey: productKey as AgencyClientProductAccessEntity['productKey'],
          },
        }),
      ]);

      accessByClientId = new Map(accessRows.map((row) => [row.clientId, row]));
      productAccessByClientId = new Map(
        productAccessRows.map((row) => [row.clientId, row]),
      );
    }

    const entries: AuthorizedManagedClientEntry[] = [];

    for (const client of clients) {
      if (!client.managedTenantId) continue;

      const entitlement =
        entitlementByManagedTenantId.get(client.managedTenantId) ?? null;

      if (!this.isActiveEntitlement(entitlement)) continue;

      if (!isPrivileged) {
        const access = accessByClientId?.get(client.id);
        const productAccess = productAccessByClientId?.get(client.id);

        if (!access || access.managedTenantId !== client.managedTenantId) {
          continue;
        }

        if (
          !productAccess ||
          productAccess.managedTenantId !== client.managedTenantId
        ) {
          continue;
        }
      }

      entries.push({
        clientId: client.id,
        displayName: client.displayName,
        avatarUrl: this.extractClientAvatarUrl(client),
        status: client.status,
        managedTenantId: client.managedTenantId,
        entitlement: {
          status: entitlement!.status,
          planKey: entitlement!.planKey,
          source: entitlement!.source,
          startsAt: this.toIsoStringOrNull(entitlement!.startsAt),
          endsAt: this.toIsoStringOrNull(entitlement!.endsAt),
          trialEndsAt: this.toIsoStringOrNull(entitlement!.trialEndsAt),
        },
      });
    }

    entries.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return entries;
  }

  private extractClientAvatarUrl(client: AgencyClient): string | null {
    const contactAvatarUrl = client.metadata?.contactAvatarUrl;

    return typeof contactAvatarUrl === 'string' && contactAvatarUrl.trim()
      ? contactAvatarUrl
      : null;
  }

  private toIsoStringOrNull(value: Date | null): string | null {
    return value ? value.toISOString() : null;
  }

  private isActiveEntitlement(
    entitlement: TenantProductEntitlementEntity | null,
  ): boolean {
    if (!entitlement || !ACTIVE_ENTITLEMENT_STATUSES.has(entitlement.status)) {
      return false;
    }

    const now = new Date();

    if (entitlement.startsAt && entitlement.startsAt > now) {
      return false;
    }

    if (entitlement.endsAt && entitlement.endsAt <= now) {
      return false;
    }

    if (
      entitlement.status === ProductEntitlementStatus.Trial &&
      entitlement.trialEndsAt &&
      entitlement.trialEndsAt <= now
    ) {
      return false;
    }

    return true;
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

  private async resolveRole(
    tenantId: string,
    roleKey: PlatformRoleKey,
  ): Promise<PlatformRoleEntity | null> {
    const tenantRole = await this.rolesRepository.findOne({
      where: { tenantId, key: roleKey },
    });

    if (tenantRole) {
      return tenantRole;
    }

    return this.rolesRepository.findOne({
      where: { tenantId: IsNull(), key: roleKey },
    });
  }

  private async applyUserOverrides(
    context: PermissionContext,
    permissions: Set<string>,
  ): Promise<void> {
    const now = new Date();

    const where: FindOptionsWhere<PlatformUserPermissionEntity>[] = [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        workspaceId: IsNull(),
      },
    ];

    if (context.workspaceId) {
      where.push({
        tenantId: context.tenantId,
        userId: context.userId,
        workspaceId: context.workspaceId,
      });
    }

    const overrides = await this.userPermissionsRepository.find({ where });

    for (const override of overrides) {
      if (override.expiresAt && override.expiresAt <= now) {
        continue;
      }

      if (override.enabled) {
        permissions.add(override.permissionKey);
      } else {
        permissions.delete(override.permissionKey);
      }
    }
  }
}
