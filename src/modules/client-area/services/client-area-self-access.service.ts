import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceUserEntity,
  type AgencyWorkspaceRole,
} from '../../agency/entities/agency-settings.entities';
import { isClientAreaEnabled } from '../client-area.config';
import { permissionsForClientAreaRole } from '../client-area-permissions.catalog';
import {
  AGENCY_SELF_CONTEXT_ID,
  CLIENT_AREA_ERROR_CODES,
  isClientAreaRole,
  isUuid,
  type ClientAreaIdentity,
  type ClientAreaRole,
  type ClientAreaSelfAccessEventAction,
  type ClientAreaSelfContext,
} from '../client-area.types';
import {
  ClientAreaSelfAccessEntity,
  ClientAreaSelfAccessEventEntity,
} from '../entities/client-area-self-access.entity';
import { ClientAreaSettingsEntity } from '../entities/client-area-settings.entity';
import {
  clientAreaCodedError,
  isUniqueViolation,
} from './client-area-membership.service';
import { ClientAreaSessionService } from './client-area-session.service';

const AGENCY_CONNECTION = 'agency';

/**
 * PD3 §12 — which Agency roles may hold self access.
 *
 * Owner and Admin only, matching `ADMIN_UP` on the two Client Area permission
 * keys in the catalog (`permission-keys.catalog.ts:196,198`). Manager and
 * Member are not enabled by default: there is no product reason yet, and the
 * brief forbids widening access silently.
 */
export const SELF_ACCESS_ELIGIBLE_AGENCY_ROLES: readonly AgencyWorkspaceRole[] =
  ['owner', 'admin'];

/**
 * PD3 §12 — client-side role mapping, stated explicitly rather than inferred.
 *
 * Both eligible Agency roles map to `client_admin`, because the self-context
 * is the agency looking at itself: there is no third party whose data could be
 * over-exposed by the more capable preset, and an Owner/Admin already sees
 * everything in the Agency surface. The caller may still override with any
 * valid Client Area role (the UI offers all three).
 */
export const SELF_ACCESS_DEFAULT_ROLE_BY_AGENCY_ROLE: Readonly<
  Partial<Record<AgencyWorkspaceRole, ClientAreaRole>>
> = {
  owner: 'client_admin',
  admin: 'client_admin',
};

export type SelfAccessWorkspaceScope = {
  tenantId: string;
  workspaceId: string;
};

/**
 * PD3 — the agency's own Client Area access.
 *
 * The invariant this service introduces (§5): being an Agency operator stops
 * meaning "cannot use the Client Area" and starts meaning "cannot use the
 * Client Area *as an external client*". `isAgencyOperator` is unchanged and
 * still blocks external memberships at every one of its four call sites; here
 * it is required to be **true**, because the self-context is only for people
 * who actually operate the agency.
 */
@Injectable()
export class ClientAreaSelfAccessService {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(ClientAreaSelfAccessEntity, AGENCY_CONNECTION)
    private readonly selfAccessRepo: Repository<ClientAreaSelfAccessEntity>,
    @InjectRepository(ClientAreaSettingsEntity, AGENCY_CONNECTION)
    private readonly settingsRepo: Repository<ClientAreaSettingsEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepo: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profilesRepo: Repository<AgencyUserProfileEntity>,
    @InjectRepository(AgencyWorkspaceCompanySettingsEntity, AGENCY_CONNECTION)
    private readonly companyIdentityRepo: Repository<AgencyWorkspaceCompanySettingsEntity>,
    private readonly sessions: ClientAreaSessionService,
  ) {}

  private notFound() {
    // One generic answer for "platform off", "self not enabled", "no access",
    // "revoked", "not an operator" and "wrong tenant": §28, no enumeration.
    return clientAreaCodedError(
      NotFoundException,
      404,
      CLIENT_AREA_ERROR_CODES.selfContextNotFound,
      'Self context is not available.',
    );
  }

  /**
   * The *active* self access of a person, or `null`. Fail-closed on every
   * link: platform flag, the agency's Client Area being on, its self-context
   * being on, the access row being active, and the person still being an
   * Agency operator of that same workspace.
   *
   * Re-evaluated per request (never cached from login), so disabling the self
   * area or revoking the access takes effect on the next call.
   */
  async resolveActiveSelfAccess(
    identity: Pick<ClientAreaIdentity, 'tenantId' | 'userId'>,
    manager?: EntityManager,
  ): Promise<ClientAreaSelfAccessEntity | null> {
    if (!isClientAreaEnabled(this.config)) return null;
    if (!isUuid(identity.tenantId) || !isUuid(identity.userId)) return null;

    const selfRepo = manager
      ? manager.getRepository(ClientAreaSelfAccessEntity)
      : this.selfAccessRepo;

    const access = await selfRepo.findOne({
      where: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        status: 'active',
      },
    });
    if (!access || !isClientAreaRole(access.role)) return null;

    const settings = await (
      manager
        ? manager.getRepository(ClientAreaSettingsEntity)
        : this.settingsRepo
    ).findOne({
      where: { tenantId: access.tenantId, workspaceId: access.workspaceId },
    });
    // Both switches must be on: the Client Area itself and the self-context.
    if (!settings?.enabled || !settings.selfEnabled) return null;

    // The person must still be an eligible Agency operator *of this
    // workspace*. A demoted or deactivated operator loses the self-context on
    // the next request, without anyone revoking the row.
    const operator = await this.findEligibleOperator(
      { tenantId: access.tenantId, workspaceId: access.workspaceId },
      access.userId,
      manager,
    );
    if (!operator) return null;

    return access;
  }

  /** Does this identity have a usable self-context right now? */
  async hasActiveSelfAccess(
    identity: Pick<ClientAreaIdentity, 'tenantId' | 'userId'>,
  ): Promise<boolean> {
    return (await this.resolveActiveSelfAccess(identity)) !== null;
  }

  /**
   * The full self-context for an authenticated request. Deliberately returns
   * a shape with no company fields at all (§18): downstream services that
   * require a company scope cannot compile against it.
   */
  async resolveSelfContext(
    identity: ClientAreaIdentity,
  ): Promise<ClientAreaSelfContext | null> {
    const access = await this.resolveActiveSelfAccess(identity);
    if (!access) return null;

    // PD4 — the Agency role of this operator, from the same `workspace_users`
    // row `resolveActiveSelfAccess` just required to be active and eligible.
    // Read again rather than threaded out of that method so its contract
    // stays "is there a usable access row?"; the lookup is by primary-key-like
    // columns and `SELF_ACCESS_ELIGIBLE_AGENCY_ROLES` guarantees the narrowing
    // below can only fail if the row vanished between the two reads, in which
    // case the context is refused.
    const operator = await this.findEligibleOperator(
      { tenantId: access.tenantId, workspaceId: access.workspaceId },
      access.userId,
    );
    if (!operator) return null;
    const agencyRole = operator.role;
    if (agencyRole !== 'owner' && agencyRole !== 'admin') return null;

    return {
      surface: 'client_area',
      kind: AGENCY_SELF_CONTEXT_ID,
      userId: identity.userId,
      tenantId: identity.tenantId,
      sessionId: identity.sessionId,
      selfAccessId: access.id,
      workspaceId: access.workspaceId,
      agencyDisplayName: await this.agencyDisplayName(
        access.tenantId,
        access.workspaceId,
      ),
      role: access.role,
      agencyRole,
      permissions: permissionsForClientAreaRole(access.role),
      // V1: no module is company-free yet (§15). Not a placeholder for a
      // future fake scope — approvals/conversations stay off until they have
      // real self semantics.
      modules: { approvals: false, conversations: false },
    };
  }

  async requireSelfContext(
    identity: ClientAreaIdentity,
  ): Promise<ClientAreaSelfContext> {
    const context = await this.resolveSelfContext(identity);
    if (!context) throw this.notFound();
    return context;
  }

  /** Agency display name, from the same identity source branding uses. */
  async agencyDisplayName(
    tenantId: string,
    workspaceId: string,
  ): Promise<string> {
    const identity = await this.companyIdentityRepo.findOne({
      where: { tenantId, workspaceId },
    });
    return (
      identity?.tradeName?.trim() ||
      identity?.workspaceName?.trim() ||
      identity?.legalName?.trim() ||
      'Minha Agência'
    );
  }

  /**
   * An active `workspace_users` row of this workspace whose role may hold
   * self access. Returns `null` for Manager/Member, inactive rows, and rows
   * of another workspace or tenant.
   */
  private async findEligibleOperator(
    scope: SelfAccessWorkspaceScope,
    userId: string,
    manager?: EntityManager,
  ): Promise<AgencyWorkspaceUserEntity | null> {
    const repo = manager
      ? manager.getRepository(AgencyWorkspaceUserEntity)
      : this.workspaceUsersRepo;
    const row = await repo.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId,
        status: 'active',
      },
    });
    if (!row) return null;
    return SELF_ACCESS_ELIGIBLE_AGENCY_ROLES.includes(row.role) ? row : null;
  }

  // ---------------------------------------------------------------- management

  /** §14 — the agency's own self-context switch, plus its audit row. */
  async setSelfEnabled(
    scope: SelfAccessWorkspaceScope,
    enabled: boolean,
    actorUserId: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ClientAreaSettingsEntity);
      const current = await repo.findOne({ where: scope });
      if (!current) {
        // Activating the self area requires the Client Area itself to exist
        // and be on; CA3 owns that row and its own activation.
        throw clientAreaCodedError(
          NotFoundException,
          404,
          CLIENT_AREA_ERROR_CODES.disabled,
          'Client Area is not configured for this workspace.',
        );
      }
      if (enabled && !current.enabled) {
        throw clientAreaCodedError(
          ConflictException,
          409,
          CLIENT_AREA_ERROR_CODES.disabled,
          'Enable the Client Area before enabling it for your own agency.',
        );
      }

      if (current.selfEnabled !== enabled) {
        await repo.update({ id: current.id }, { selfEnabled: enabled });
        await this.recordEvent(manager, {
          ...scope,
          action: enabled ? 'self_area_enabled' : 'self_area_disabled',
          actorUserId,
          targetUserId: null,
        });
        // §22 — turning the self area off ends the Client Area sessions of
        // everyone who holds self access, and nothing else. Agency sessions
        // are never touched.
        if (!enabled) await this.revokeSelfSessions(manager, scope);
      }

      return manager
        .getRepository(ClientAreaSettingsEntity)
        .findOneOrFail({ where: { id: current.id } });
    });
  }

  /** §14 — grant self access to one eligible Agency user. */
  async grant(input: {
    scope: SelfAccessWorkspaceScope;
    userId: string;
    role?: ClientAreaRole;
    grantedByUserId: string;
  }): Promise<ClientAreaSelfAccessEntity> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const settings = await manager
          .getRepository(ClientAreaSettingsEntity)
          .findOne({ where: input.scope });
        if (!settings?.enabled || !settings.selfEnabled) {
          throw clientAreaCodedError(
            ConflictException,
            409,
            CLIENT_AREA_ERROR_CODES.disabled,
            'Enable the Client Area for your own agency first.',
          );
        }

        if (!isUuid(input.userId)) {
          throw clientAreaCodedError(
            BadRequestException,
            400,
            CLIENT_AREA_ERROR_CODES.selfIdentityIneligible,
            'Invalid user reference.',
          );
        }

        // §11 — no invitation for self: the grant is the activation. The
        // target must already be an eligible Agency operator, which is a
        // stronger check than an invitation would be.
        const operator = await this.findEligibleOperator(
          input.scope,
          input.userId,
          manager,
        );
        if (!operator) {
          throw clientAreaCodedError(
            ConflictException,
            409,
            CLIENT_AREA_ERROR_CODES.selfIdentityNotOperator,
            'Only an Owner or Admin of this workspace can hold self access.',
          );
        }

        const identity = await manager
          .getRepository(AgencyUserSecuritySettingsEntity)
          .findOne({
            where: { tenantId: input.scope.tenantId, userId: input.userId },
          });
        if (!identity) {
          throw clientAreaCodedError(
            NotFoundException,
            404,
            CLIENT_AREA_ERROR_CODES.identityNotFound,
            'Identity not found in this tenant.',
          );
        }

        const role =
          input.role ??
          SELF_ACCESS_DEFAULT_ROLE_BY_AGENCY_ROLE[operator.role] ??
          'client_admin';
        if (!isClientAreaRole(role)) {
          throw clientAreaCodedError(
            BadRequestException,
            400,
            CLIENT_AREA_ERROR_CODES.roleInvalid,
            'Invalid Client Area role.',
          );
        }

        const repo = manager.getRepository(ClientAreaSelfAccessEntity);
        if (
          await repo.exists({
            where: { ...input.scope, userId: input.userId, status: 'active' },
          })
        ) {
          throw this.selfAccessExists();
        }

        const saved = await repo.save(
          repo.create({
            ...input.scope,
            userId: input.userId,
            role,
            status: 'active',
            grantedByUserId: input.grantedByUserId,
            grantedAt: new Date(),
            revokedAt: null,
            revokedByUserId: null,
          }),
        );

        await this.recordEvent(manager, {
          ...input.scope,
          action: 'self_access_granted',
          actorUserId: input.grantedByUserId,
          targetUserId: input.userId,
          newRole: role,
        });

        return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.selfAccessExists();
      throw error;
    }
  }

  /** Changes the client-side role of an existing self access. */
  async changeRole(input: {
    scope: SelfAccessWorkspaceScope;
    userId: string;
    role: ClientAreaRole;
    actorUserId: string;
  }): Promise<ClientAreaSelfAccessEntity> {
    if (!isClientAreaRole(input.role)) {
      throw clientAreaCodedError(
        BadRequestException,
        400,
        CLIENT_AREA_ERROR_CODES.roleInvalid,
        'Invalid Client Area role.',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ClientAreaSelfAccessEntity);
      const access = await repo.findOne({
        where: { ...input.scope, userId: input.userId, status: 'active' },
      });
      if (!access) throw this.selfAccessNotFound();

      if (access.role !== input.role) {
        const previousRole = access.role;
        await repo.update({ id: access.id }, { role: input.role });
        await this.recordEvent(manager, {
          ...input.scope,
          action: 'self_access_role_changed',
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          previousRole,
          newRole: input.role,
        });
      }
      return repo.findOneOrFail({ where: { id: access.id } });
    });
  }

  /**
   * §22 — revokes one person's self access and ends only their Client Area
   * sessions. The row is kept as history, never deleted.
   */
  async revoke(input: {
    scope: SelfAccessWorkspaceScope;
    userId: string;
    revokedByUserId: string;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ClientAreaSelfAccessEntity);
      const access = await repo.findOne({
        where: { ...input.scope, userId: input.userId, status: 'active' },
      });
      if (!access) throw this.selfAccessNotFound();

      await repo.update(
        { id: access.id },
        {
          status: 'revoked',
          revokedAt: new Date(),
          revokedByUserId: input.revokedByUserId,
        },
      );
      await this.recordEvent(manager, {
        ...input.scope,
        action: 'self_access_revoked',
        actorUserId: input.revokedByUserId,
        targetUserId: input.userId,
        previousRole: access.role,
      });

      // Only this person, and only their Client Area sessions. An Agency
      // operator who loses self access keeps operating the Agency normally.
      await this.sessions.revokeAll(access.tenantId, access.userId, manager);
    });
  }

  /** Ends the Client Area sessions of every self-access holder of a workspace. */
  private async revokeSelfSessions(
    manager: EntityManager,
    scope: SelfAccessWorkspaceScope,
  ) {
    const holders = await manager
      .getRepository(ClientAreaSelfAccessEntity)
      .find({ where: { ...scope, status: 'active' } });
    for (const holder of holders) {
      await this.sessions.revokeAll(holder.tenantId, holder.userId, manager);
    }
  }

  /** §13/§31 — the "Minha Agência" projection. No internal ids are exposed. */
  async overview(scope: SelfAccessWorkspaceScope) {
    const [settings, accesses, operators] = await Promise.all([
      this.settingsRepo.findOne({ where: scope }),
      this.selfAccessRepo.find({ where: { ...scope, status: 'active' } }),
      this.workspaceUsersRepo.find({
        where: { ...scope, status: 'active' },
      }),
    ]);

    const eligible = operators.filter(
      (operator) =>
        operator.userId !== null &&
        SELF_ACCESS_ELIGIBLE_AGENCY_ROLES.includes(operator.role),
    );
    const accessByUser = new Map(
      accesses.map((access) => [access.userId, access]),
    );
    const userIds = eligible
      .map((operator) => operator.userId)
      .filter((id): id is string => id !== null);
    const [identities, profiles] = userIds.length
      ? await Promise.all([
          this.securityRepo.find({
            where: userIds.map((userId) => ({
              tenantId: scope.tenantId,
              userId,
            })),
          }),
          this.profilesRepo.find({
            where: userIds.map((userId) => ({
              tenantId: scope.tenantId,
              userId,
            })),
          }),
        ])
      : [[], []];
    const emailBy = new Map(
      identities.map((item) => [item.userId, item.currentEmail]),
    );
    const nameBy = new Map(
      profiles.map((item) => [item.userId, item.displayName]),
    );

    return {
      platformEnabled: isClientAreaEnabled(this.config),
      clientAreaEnabled: Boolean(settings?.enabled),
      selfEnabled: Boolean(settings?.selfEnabled),
      agencyDisplayName: await this.agencyDisplayName(
        scope.tenantId,
        scope.workspaceId,
      ),
      // V1 is honest about this: no module is available in the self-context
      // yet, because approvals and conversations are company-bound (§15).
      modules: { approvals: false, conversations: false },
      activeAccessCount: accesses.filter((access) =>
        eligible.some((operator) => operator.userId === access.userId),
      ).length,
      users: eligible
        .map((operator) => {
          const userId = operator.userId as string;
          const access = accessByUser.get(userId);
          return {
            userId,
            displayName:
              nameBy.get(userId)?.trim() ||
              operator.name?.trim() ||
              emailBy.get(userId) ||
              'Usuário',
            email: emailBy.get(userId) ?? operator.email,
            agencyRole: operator.role,
            hasSelfAccess: Boolean(access),
            role: access?.role ?? null,
            suggestedRole:
              SELF_ACCESS_DEFAULT_ROLE_BY_AGENCY_ROLE[operator.role] ??
              'client_admin',
          };
        })
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName, 'pt-BR'),
        ),
    };
  }

  private async recordEvent(
    manager: EntityManager,
    event: SelfAccessWorkspaceScope & {
      action: ClientAreaSelfAccessEventAction;
      actorUserId: string | null;
      targetUserId: string | null;
      previousRole?: ClientAreaRole | null;
      newRole?: ClientAreaRole | null;
    },
  ) {
    await manager.getRepository(ClientAreaSelfAccessEventEntity).insert({
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      action: event.action,
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId,
      previousRole: event.previousRole ?? null,
      newRole: event.newRole ?? null,
    });
  }

  private selfAccessExists() {
    return clientAreaCodedError(
      ConflictException,
      409,
      CLIENT_AREA_ERROR_CODES.selfAccessExists,
      'This user already has access to the agency Client Area.',
    );
  }

  private selfAccessNotFound() {
    return clientAreaCodedError(
      NotFoundException,
      404,
      CLIENT_AREA_ERROR_CODES.selfAccessNotFound,
      'Self access not found.',
    );
  }
}
