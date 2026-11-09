import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { type EntityManager, In } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  permissionsForMemberAccess,
  resolveMemberAccess,
} from '../client-area/client-area-permissions.catalog';
import { ClientAreaMemberModuleAccessEntity } from '../client-area/entities/client-area-member-module-access.entity';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';
import {
  SocialApprovalStageDecisionEntity,
  type SocialApprovalRequestEntity,
} from './entities';

export const APPROVAL_NO_CLIENT_APPROVER = 'approval_no_client_approver';
export const APPROVAL_NOT_DESIGNATED = 'approval_not_designated';
export const APPROVAL_ALREADY_DECIDED = 'approval_already_decided';

export class ApprovalNoClientApproverException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: APPROVAL_NO_CLIENT_APPROVER,
      message:
        'Esta empresa não tem Owner nem responsável ativo para decidir a aprovação.',
    });
  }
}

export class ApprovalNotDesignatedException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: APPROVAL_NOT_DESIGNATED,
      message: 'Você não é responsável por decidir esta aprovação.',
    });
  }
}

export type ApprovalSettingsForAuthority = {
  internalApproverUserIds: readonly string[];
  clientApproverMembershipIds: readonly string[];
  clientDecisionPolicy: 'first' | 'all';
};

export type AgencyApprovalActor = { userId: string; role?: string | null };

export const isAgencyOwnerRole = (role?: string | null) =>
  role?.trim().toLowerCase() === 'owner';

const CLIENT_DECIDE_PERMISSION = 'client_area.approvals.decide' as const;

/**
 * D-17: who may decide. Decides nothing about permissions keys, which the
 * route guards already proved. Everything here is a live read, so a revoked
 * membership stops counting on the next evaluation (D-03).
 */
@Injectable()
export class SocialApprovalAuthorityService {
  canDecideInternal(
    settings: ApprovalSettingsForAuthority,
    actor: AgencyApprovalActor,
  ): boolean {
    return settings.internalApproverUserIds.length === 0
      ? isAgencyOwnerRole(actor.role)
      : settings.internalApproverUserIds.includes(actor.userId);
  }

  assertInternalDecider(
    settings: ApprovalSettingsForAuthority,
    actor: AgencyApprovalActor,
  ): void {
    if (!this.canDecideInternal(settings, actor))
      throw new ApprovalNotDesignatedException();
  }

  /**
   * Active memberships of the company that hold the decide permission. With
   * `membershipIds` omitted, only the company Owner is considered (D-08).
   */
  async eligibleClientApprovers(
    manager: EntityManager,
    scope: CompanyAwareScope,
    membershipIds?: readonly string[],
  ): Promise<ClientAreaMembershipEntity[]> {
    if (!scope.agencyClientId || !scope.companyContextId) return [];
    const memberships = await manager
      .getRepository(ClientAreaMembershipEntity)
      .find({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          status: 'active',
          ...(membershipIds
            ? { id: In([...membershipIds]) }
            : { role: 'client_owner' as const }),
        },
      });
    const others = memberships.filter((item) => item.role !== 'client_owner');
    const levels = others.length
      ? await manager.getRepository(ClientAreaMemberModuleAccessEntity).find({
          where: {
            membershipId: In(others.map((item) => item.id)),
            moduleKey: 'approvals',
          },
        })
      : [];
    const levelByMembership = new Map(
      levels.map((row) => [row.membershipId, row.level]),
    );
    return memberships.filter((membership) => {
      const level = levelByMembership.get(membership.id);
      return permissionsForMemberAccess(
        resolveMemberAccess(
          membership.role,
          { approvals: true },
          level ? { approvals: level } : {},
        ),
      ).has(CLIENT_DECIDE_PERMISSION);
    });
  }

  private designated(
    manager: EntityManager,
    scope: CompanyAwareScope,
    settings: ApprovalSettingsForAuthority,
  ) {
    return this.eligibleClientApprovers(
      manager,
      scope,
      settings.clientApproverMembershipIds.length
        ? settings.clientApproverMembershipIds
        : undefined,
    );
  }

  /**
   * Runs at every entry into the client stage. Refuses a piece nobody could
   * decide, and returns the list frozen for the round: membership ids under
   * "Todos", null under "Primeira decisão vale".
   */
  async requiredClientApprovers(
    manager: EntityManager,
    scope: CompanyAwareScope,
    settings: ApprovalSettingsForAuthority,
  ): Promise<string[] | null> {
    const approvers = await this.designated(manager, scope, settings);
    if (approvers.length === 0) throw new ApprovalNoClientApproverException();
    return settings.clientDecisionPolicy === 'all'
      ? approvers.map((approver) => approver.id)
      : null;
  }

  /** The approved decisions of the round currently open on this request. */
  async roundApprovals(
    manager: EntityManager,
    request: SocialApprovalRequestEntity,
  ): Promise<Set<string>> {
    const decisions = await manager
      .getRepository(SocialApprovalStageDecisionEntity)
      .find({
        where: {
          approvalRequestId: request.id,
          stage: 'client',
          decision: 'approved',
        },
      });
    const openedAt = request.sentToClientAt?.getTime() ?? 0;
    return new Set(
      decisions
        .filter((decision) => decision.createdAt.getTime() >= openedAt)
        .map((decision) => decision.actorUserId)
        .filter((userId): userId is string => Boolean(userId)),
    );
  }

  /** Read-side twin of `assertClientDecider`, for the `actions` block. */
  async canDecideClient(
    manager: EntityManager,
    scope: CompanyAwareScope,
    request: SocialApprovalRequestEntity,
    settings: ApprovalSettingsForAuthority,
    userId: string,
  ): Promise<boolean> {
    const approvers = request.requiredClientApproverIds
      ? await this.eligibleClientApprovers(
          manager,
          scope,
          request.requiredClientApproverIds,
        )
      : await this.designated(manager, scope, settings);
    if (!approvers.some((approver) => approver.userId === userId)) return false;
    if (!request.requiredClientApproverIds) return true;
    return !(await this.roundApprovals(manager, request)).has(userId);
  }

  async assertClientDecider(
    manager: EntityManager,
    scope: CompanyAwareScope,
    request: SocialApprovalRequestEntity,
    settings: ApprovalSettingsForAuthority,
    userId: string | null,
  ): Promise<void> {
    if (!userId) throw new ApprovalNotDesignatedException();
    const approvers = request.requiredClientApproverIds
      ? await this.eligibleClientApprovers(
          manager,
          scope,
          request.requiredClientApproverIds,
        )
      : await this.designated(manager, scope, settings);
    if (!approvers.some((approver) => approver.userId === userId))
      throw new ApprovalNotDesignatedException();
    if (
      request.requiredClientApproverIds &&
      (await this.roundApprovals(manager, request)).has(userId)
    )
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: APPROVAL_ALREADY_DECIDED,
        message: 'Você já decidiu nesta rodada.',
      });
  }
}
