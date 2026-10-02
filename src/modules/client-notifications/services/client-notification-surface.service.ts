import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { permissionsForClientAreaRole } from '../../client-area/client-area-permissions.catalog';
import {
  isClientAreaRole,
  type ClientAreaModuleKey,
  type ClientAreaPermissionKey,
} from '../../client-area/client-area.types';
import { ClientAreaMembershipEntity } from '../../client-area/entities/client-area-membership.entity';
import { ClientAreaEligibilityService } from '../../client-area/services/client-area-eligibility.service';
import { ClientAreaManagementService } from '../../client-area/services/client-area-management.service';
import type {
  ClientNotificationAudienceQuery,
  ClientNotificationRecipient,
  ClientNotificationSurface,
} from '../../notifications/ports/client-notification-surface.port';

const AGENCY_CONNECTION = 'agency';

/**
 * NTF-C1 §8 — who, on the Client Area surface, is a legitimate recipient.
 *
 * THIS IS AP3's `resolveRecipients()`, MOVED
 * ------------------------------------------
 * The rules are not reinvented: active membership for the company, role preset
 * holding the required permission, CRM eligibility still intact, company
 * module enabled. That chain was the hard part of AP3 and it was tested, so it
 * is reused rather than rewritten (§8). What changes is where it sits: it is
 * now a *resolver for the Notifications Core* instead of the front half of a
 * second delivery pipeline.
 *
 * WHY EVERYTHING IS RE-CHECKED AT CALL TIME
 * -----------------------------------------
 * A membership is historical evidence of a grant, not a standing entitlement.
 * An event may have been queued before a revocation, and the delivery decision
 * must reflect the moment of delivery (§21). So nothing here is cached and
 * every link in the chain is re-evaluated: a revoked membership, an archived
 * company, a broken CRM chain or a disabled module each stop the notification,
 * independently.
 *
 * WHY THE EMAIL COMES FROM `user_security_settings`
 * -------------------------------------------------
 * `current_email` is the address the person authenticates with, re-read after
 * the membership was revalidated. Not `workspace_users` (a client has no row
 * there — the single line that blocked all of this, per CCOM0 §16), and
 * explicitly not `Contact.email`, which is CRM data: it is where an
 * *invitation* goes, and it is not evidence that anybody holds access today
 * (§9).
 */
@Injectable()
export class ClientNotificationSurfaceService implements ClientNotificationSurface {
  constructor(
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly memberships: Repository<ClientAreaMembershipEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly identities: Repository<AgencyUserSecuritySettingsEntity>,
    private readonly eligibility: ClientAreaEligibilityService,
    private readonly management: ClientAreaManagementService,
  ) {}

  async resolveAudience(
    query: ClientNotificationAudienceQuery,
  ): Promise<ClientNotificationRecipient[]> {
    const memberships = await this.memberships.find({
      where: {
        tenantId: query.tenantId,
        workspaceId: query.workspaceId,
        companyContextId: query.companyContextId,
        status: 'active',
      },
    });

    const permitted = memberships.filter((membership) =>
      this.hasPermission(membership, query.requiredPermission),
    );

    if (permitted.length === 0) return [];

    // §28 — the module gate is the *company's* commercial entitlement for the
    // module the event belongs to (approvals, conversations). The Notification
    // Center itself has no such flag, by design: it is infrastructure of the
    // surface, not a product. Resolved from the membership because the
    // entitlement hangs off the Agency Client, and checked once since every
    // membership of one company shares it.
    if (!(await this.moduleEnabled(query, permitted[0]))) {
      return [];
    }

    const eligible = (
      await Promise.all(
        permitted.map(async (membership) =>
          (await this.isEligible(membership)) ? membership : null,
        ),
      )
    ).filter(
      (membership): membership is ClientAreaMembershipEntity =>
        membership !== null,
    );

    if (eligible.length === 0) return [];

    const emails = await this.resolveEmails(
      query.tenantId,
      eligible.map((membership) => membership.userId),
    );

    return eligible.map((membership) => ({
      userId: membership.userId,
      membershipId: membership.id,
      companyContextId: membership.companyContextId,
      email: emails.get(membership.userId) ?? null,
    }));
  }

  /**
   * §21 — the pre-delivery re-check for one known recipient.
   *
   * Deliberately the same chain as `resolveAudience`, not a cheaper subset: a
   * "quick" revalidation that skipped CRM eligibility or the module flag would
   * be a second, weaker definition of access, and the two would drift. Returns
   * null on any failure, so the caller fails closed without learning which
   * link broke.
   */
  async revalidate(
    query: ClientNotificationAudienceQuery & { userId: string },
  ): Promise<ClientNotificationRecipient | null> {
    const audience = await this.resolveAudience(query);
    return (
      audience.find((recipient) => recipient.userId === query.userId) ?? null
    );
  }

  private async moduleEnabled(
    query: ClientNotificationAudienceQuery,
    membership: ClientAreaMembershipEntity,
  ): Promise<boolean> {
    try {
      const modules = await this.management.resolveCompanyModules({
        tenantId: query.tenantId,
        workspaceId: query.workspaceId,
        agencyClientId: membership.agencyClientId,
        companyContextId: query.companyContextId,
      });
      return Boolean(modules[query.requiredModule as ClientAreaModuleKey]);
    } catch {
      return false;
    }
  }

  private hasPermission(
    membership: ClientAreaMembershipEntity,
    requiredPermission: string,
  ): boolean {
    if (!isClientAreaRole(membership.role)) return false;
    return permissionsForClientAreaRole(membership.role).has(
      requiredPermission as ClientAreaPermissionKey,
    );
  }

  private async isEligible(
    membership: ClientAreaMembershipEntity,
  ): Promise<boolean> {
    try {
      return await this.eligibility.isMembershipEligible(
        this.memberships.manager,
        {
          tenantId: membership.tenantId,
          userId: membership.userId,
          companyContextId: membership.companyContextId,
        },
      );
    } catch {
      return false;
    }
  }

  private async resolveEmails(
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.identities.find({
      where: { tenantId, userId: In(userIds) },
    });
    return new Map(
      rows
        .filter((row) => row.currentEmail?.trim())
        .map((row) => [row.userId, row.currentEmail.trim()]),
    );
  }
}
