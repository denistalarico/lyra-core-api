import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { AgencyClientStatus } from '../../clients/enums';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import {
  CLIENT_AREA_ERROR_CODES,
  isClientAreaRole,
  isUuid,
  type ClientAreaRole,
} from '../client-area.types';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import { ClientAreaMemberAuditService } from './client-area-member-audit.service';
import { ClientAreaSessionService } from './client-area-session.service';

const AGENCY_CONNECTION = 'agency';

export type GrantClientAreaMembershipInput = {
  tenantId: string;
  companyContextId: string;
  userId: string;
  role: string;
  /**
   * The Agency operator granting access. `null` is reserved for operational
   * bootstrap (scripts/tests); when set it must be an active Agency user of
   * the company's workspace. For an accepted invitation it is the inviter.
   */
  grantedByUserId: string | null;
};

export type RevokeClientAreaMembershipInput = {
  tenantId: string;
  membershipId: string;
  revokedByUserId: string | null;
  /**
   * CA2 — when set (Agency management routes), the membership must belong to
   * this company; a membership of another company answers 404.
   */
  companyContextId?: string;
};

export type ChangeClientAreaMembershipRoleInput = {
  tenantId: string;
  companyContextId: string;
  membershipId: string;
  role: string;
  changedByUserId: string;
};

export function clientAreaCodedError<T extends new (body: object) => Error>(
  Exception: T,
  statusCode: number,
  code: string,
  message: string,
) {
  return new Exception({ statusCode, message, code });
}

const codedError = clientAreaCodedError;

/**
 * Internal application service for Client Area memberships (CA1), used by
 * the Agency member management routes and by invitation acceptance (CA2).
 *
 * Invariants enforced here (and backed by the database where possible):
 *  - the grantee is an existing identity of the same agency tenant;
 *  - the grantee is NOT an Agency operator (no active `workspace_users`):
 *    Agency operator XOR Client Area member, with no Owner/Admin exception,
 *    so one `actor_user_id` can never decide both approval stages;
 *  - the Company Context, its organization and Agency Client are usable;
 *  - one active membership per (company, person) — partial unique index;
 *  - revocation never deletes; losing the last membership ends every Client
 *    Area session of the person;
 *  - every Agency-attributed change (revoke, role change) writes an audit row
 *    in the same transaction.
 *
 * `grantInTransaction` is the single grant primitive: `grant()` wraps it in
 * its own transaction, invitation acceptance calls it inside the acceptance
 * transaction so the invitation and the membership commit together.
 */
@Injectable()
export class ClientAreaMembershipService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly membershipsRepo: Repository<ClientAreaMembershipEntity>,
    private readonly sessions: ClientAreaSessionService,
    private readonly audit: ClientAreaMemberAuditService,
  ) {}

  async grant(
    input: GrantClientAreaMembershipInput,
  ): Promise<ClientAreaMembershipEntity> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.grantInTransaction(manager, input),
      );
    } catch (error) {
      // Concurrent grant lost the race against the partial unique index.
      if (isUniqueViolation(error)) {
        throw this.membershipExists();
      }
      throw error;
    }
  }

  /**
   * Validates and inserts one active membership with the caller's manager.
   * A concurrent duplicate surfaces as a unique violation (`23505`) that
   * aborts the caller's transaction; callers map it with
   * {@link isUniqueViolation}.
   */
  async grantInTransaction(
    manager: EntityManager,
    input: GrantClientAreaMembershipInput,
  ): Promise<ClientAreaMembershipEntity> {
    if (!isClientAreaRole(input.role)) {
      throw codedError(
        BadRequestException,
        400,
        CLIENT_AREA_ERROR_CODES.roleInvalid,
        'Invalid Client Area role.',
      );
    }

    if (
      !isUuid(input.tenantId) ||
      !isUuid(input.companyContextId) ||
      !isUuid(input.userId) ||
      (input.grantedByUserId !== null && !isUuid(input.grantedByUserId))
    ) {
      throw codedError(
        BadRequestException,
        400,
        CLIENT_AREA_ERROR_CODES.companyUnavailable,
        'Invalid membership reference.',
      );
    }

    const { company } = await this.findUsableCompany(
      manager,
      input.tenantId,
      input.companyContextId,
    );

    const identity = await manager
      .getRepository(AgencyUserSecuritySettingsEntity)
      .findOne({ where: { tenantId: input.tenantId, userId: input.userId } });

    if (!identity) {
      throw codedError(
        NotFoundException,
        404,
        CLIENT_AREA_ERROR_CODES.identityNotFound,
        'Identity not found in this tenant.',
      );
    }

    if (await this.isAgencyOperator(manager, input.tenantId, input.userId)) {
      throw codedError(
        ConflictException,
        409,
        CLIENT_AREA_ERROR_CODES.identityIsAgencyOperator,
        'An Agency operator cannot be a Client Area member.',
      );
    }

    if (input.grantedByUserId) {
      await this.assertAgencyActor(
        manager,
        input.tenantId,
        company.workspaceId,
        input.grantedByUserId,
      );
    }

    const repo = manager.getRepository(ClientAreaMembershipEntity);
    const existing = await repo.exists({
      where: {
        companyContextId: company.id,
        userId: input.userId,
        status: 'active',
      },
    });

    if (existing) {
      throw this.membershipExists();
    }

    return repo.save(
      repo.create({
        tenantId: company.tenantId,
        workspaceId: company.workspaceId,
        agencyClientId: company.agencyClientId,
        companyContextId: company.id,
        userId: input.userId,
        role: input.role,
        status: 'active',
        grantedByUserId: input.grantedByUserId,
        grantedAt: new Date(),
        revokedByUserId: null,
        revokedAt: null,
      }),
    );
  }

  async revoke(
    input: RevokeClientAreaMembershipInput,
  ): Promise<ClientAreaMembershipEntity> {
    if (
      !isUuid(input.tenantId) ||
      !isUuid(input.membershipId) ||
      (input.revokedByUserId !== null && !isUuid(input.revokedByUserId)) ||
      (input.companyContextId !== undefined && !isUuid(input.companyContextId))
    ) {
      throw this.membershipNotFound();
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ClientAreaMembershipEntity);
      const membership = await repo.findOne({
        where: {
          id: input.membershipId,
          tenantId: input.tenantId,
          status: 'active',
          ...(input.companyContextId
            ? { companyContextId: input.companyContextId }
            : {}),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!membership) {
        // Unknown, of another company, or already revoked: revoking twice is
        // not an idempotent success — the second call is a 404 and writes no
        // second audit row.
        throw this.membershipNotFound();
      }

      if (input.revokedByUserId) {
        await this.assertAgencyActor(
          manager,
          membership.tenantId,
          membership.workspaceId,
          input.revokedByUserId,
        );
      }

      const revokedAt = new Date();
      await repo.update(
        { id: membership.id, tenantId: membership.tenantId, status: 'active' },
        {
          status: 'revoked',
          revokedAt,
          revokedByUserId: input.revokedByUserId,
        },
      );

      const remaining = await repo.exists({
        where: {
          tenantId: membership.tenantId,
          userId: membership.userId,
          status: 'active',
        },
      });

      if (!remaining) {
        await this.sessions.revokeAll(
          membership.tenantId,
          membership.userId,
          manager,
        );
      }

      if (input.revokedByUserId) {
        await this.audit.record(manager, {
          company: membership,
          action: 'membership_revoked',
          actorSurface: 'agency',
          actorUserId: input.revokedByUserId,
          membershipId: membership.id,
          targetUserId: membership.userId,
          previousRole: membership.role,
          metadata: { lastMembership: !remaining },
        });
      }

      return {
        ...membership,
        status: 'revoked' as const,
        revokedAt,
        revokedByUserId: input.revokedByUserId,
      };
    });
  }

  /**
   * CA2 — Agency changes the role of an active membership. The row keeps its
   * id (the person's access is the same grant); before/after, actor and time
   * go to the audit trail. Setting the current role again is a no-op.
   */
  async changeRole(
    input: ChangeClientAreaMembershipRoleInput,
  ): Promise<ClientAreaMembershipEntity> {
    if (!isClientAreaRole(input.role)) {
      throw codedError(
        BadRequestException,
        400,
        CLIENT_AREA_ERROR_CODES.roleInvalid,
        'Invalid Client Area role.',
      );
    }

    if (
      !isUuid(input.tenantId) ||
      !isUuid(input.companyContextId) ||
      !isUuid(input.membershipId) ||
      !isUuid(input.changedByUserId)
    ) {
      throw this.membershipNotFound();
    }

    const role: ClientAreaRole = input.role;

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ClientAreaMembershipEntity);
      const membership = await repo.findOne({
        where: {
          id: input.membershipId,
          tenantId: input.tenantId,
          companyContextId: input.companyContextId,
          status: 'active',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!membership) {
        throw this.membershipNotFound();
      }

      await this.assertAgencyActor(
        manager,
        membership.tenantId,
        membership.workspaceId,
        input.changedByUserId,
      );

      if (membership.role === role) {
        return membership;
      }

      await repo.update({ id: membership.id }, { role });
      await this.audit.record(manager, {
        company: membership,
        action: 'role_changed',
        actorSurface: 'agency',
        actorUserId: input.changedByUserId,
        membershipId: membership.id,
        targetUserId: membership.userId,
        previousRole: membership.role,
        newRole: role,
      });

      return { ...membership, role };
    });
  }

  listForUser(tenantId: string, userId: string) {
    return this.membershipsRepo.find({
      where: { tenantId, userId, status: 'active' },
      order: { grantedAt: 'ASC' },
    });
  }

  /**
   * The Company Context when it, its organization and its Agency Client are
   * all usable; `company_unavailable` otherwise. The company row is share-
   * locked so it cannot be archived under a grant in flight.
   */
  async findUsableCompany(
    manager: EntityManager,
    tenantId: string,
    companyContextId: string,
  ) {
    const unavailable = () =>
      codedError(
        NotFoundException,
        404,
        CLIENT_AREA_ERROR_CODES.companyUnavailable,
        'Company is not available.',
      );

    if (!isUuid(tenantId) || !isUuid(companyContextId)) {
      throw unavailable();
    }

    const company = await manager
      .getRepository(AgencyClientCompanyContext)
      .findOne({
        where: { id: companyContextId, tenantId },
        lock: manager.queryRunner?.isTransactionActive
          ? { mode: 'pessimistic_read' }
          : undefined,
      });

    if (!company || company.status !== 'active' || company.archivedAt) {
      throw unavailable();
    }

    const scope = { tenantId, workspaceId: company.workspaceId };
    const [organization, client] = await Promise.all([
      manager.getRepository(ContactEntity).findOne({
        where: { id: company.companyContactId, ...scope },
      }),
      manager.getRepository(AgencyClient).findOne({
        where: { id: company.agencyClientId, ...scope },
      }),
    ]);

    if (
      !organization ||
      organization.type !== 'organization' ||
      organization.status === 'archived' ||
      !client ||
      client.status !== AgencyClientStatus.Active ||
      client.archivedAt
    ) {
      throw unavailable();
    }

    return { company, organization, client };
  }

  isAgencyOperator(manager: EntityManager, tenantId: string, userId: string) {
    return manager.getRepository(AgencyWorkspaceUserEntity).exists({
      where: { tenantId, userId, status: 'active' },
    });
  }

  async assertAgencyActor(
    manager: EntityManager,
    tenantId: string,
    workspaceId: string,
    userId: string,
  ) {
    const actor = await manager
      .getRepository(AgencyWorkspaceUserEntity)
      .exists({
        where: { tenantId, workspaceId, userId, status: 'active' },
      });

    if (!actor) {
      throw codedError(
        ForbiddenException,
        403,
        CLIENT_AREA_ERROR_CODES.grantorInvalid,
        'Only an active Agency user of this workspace can manage memberships.',
      );
    }
  }

  membershipExists() {
    return codedError(
      ConflictException,
      409,
      CLIENT_AREA_ERROR_CODES.membershipExists,
      'The person already has an active membership for this company.',
    );
  }

  private membershipNotFound() {
    return codedError(
      NotFoundException,
      404,
      CLIENT_AREA_ERROR_CODES.membershipNotFound,
      'Membership not found.',
    );
  }
}

export function isUniqueViolation(error: unknown) {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { driverError?: { code?: string } })
      .driverError?.code === '23505'
  );
}
