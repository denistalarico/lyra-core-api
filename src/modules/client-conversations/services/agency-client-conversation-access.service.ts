import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { ClientAreaManagementService } from '../../client-area/services/client-area-management.service';
import { isUuid } from '../client-conversation.types';
import type { ClientConversationScope } from './client-conversation-access';

const AGENCY_CONNECTION = 'agency';

function companyNotFound() {
  // Same generic answer for "no such company", "not your client" and a
  // malformed id: an operator must not be able to enumerate the agency's
  // companies through this boundary.
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Company is not available.',
  });
}

/**
 * CCOM1 — Agency-side eligibility for a Client Conversation (§29).
 *
 * THE RULE, TAKEN FROM THE EXISTING MODEL RATHER THAN INVENTED
 * -----------------------------------------------------------
 * An operator reaches a client conversation when the platform already says
 * they reach that client:
 *
 *   permission  `agency.client_conversations.{view,send}.assigned`
 *               (checked by `PermissionsGuard` on the controller)
 *   client       `PlatformPermissionService.canAccessClient` — Owner implied,
 *               everyone else needs an `agency_client_access` grant
 *   company      an active, non-archived Company Context of that client
 *   module       Client Area conversations enabled for that company
 *
 * Owner/Admin behaviour is inherited, not redefined: `canAccessClient` returns
 * true for Owner and requires an explicit grant for Admin and below, which is
 * exactly how every other client-scoped Agency route behaves. This sprint does
 * not widen anyone's reach.
 *
 * WHY THE COMPANY MODULE GATE APPLIES TO THE AGENCY TOO
 * ----------------------------------------------------
 * If a company has conversations switched off, the client cannot see the
 * thread — so letting an operator write into it would create messages nobody
 * can read, and would quietly re-enable a channel the agency turned off. The
 * gate is the same `resolveCompanyModules()` the client surface uses, so the
 * two can never disagree about whether the channel exists.
 */
@Injectable()
export class AgencyClientConversationAccessService {
  constructor(
    @InjectRepository(AgencyClientCompanyContext, AGENCY_CONNECTION)
    private readonly companyContexts: Repository<AgencyClientCompanyContext>,
    private readonly permissions: PlatformPermissionService,
    private readonly management: ClientAreaManagementService,
  ) {}

  /**
   * Resolves the scope of a company an operator is allowed to converse in.
   *
   * The Agency Client is derived from the company row, never taken from the
   * caller: that is what stops a request from pairing a company it may reach
   * with a client it may not, or vice versa.
   */
  async resolveScope(
    actor: {
      tenantId: string;
      workspaceId: string;
      userId: string;
      role?: string | null;
    },
    companyContextId: unknown,
  ): Promise<ClientConversationScope> {
    if (!isUuid(companyContextId)) throw companyNotFound();

    const company = await this.companyContexts.findOne({
      where: {
        id: companyContextId,
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
      },
    });

    if (!company || company.status !== 'active' || company.archivedAt) {
      throw companyNotFound();
    }

    const allowed = await this.permissions.canAccessClient({
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      role: actor.role ?? 'member',
      clientId: company.agencyClientId,
    });

    // 404 rather than 403: knowing a conversation or company UUID must not
    // confirm that it exists (§51).
    if (!allowed) throw companyNotFound();

    const modules = await this.management.resolveCompanyModules({
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      agencyClientId: company.agencyClientId,
      companyContextId: company.id,
    });

    if (!modules.conversations) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Conversations are not enabled for this company.',
      });
    }

    return {
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      agencyClientId: company.agencyClientId,
      companyContextId: company.id,
    };
  }

  /**
   * Companies the operator may converse in, for the "Clientes" section of the
   * Team Chat sidebar. Built from the same rule as `resolveScope`, so the list
   * and the per-conversation check cannot drift — the divergence that made
   * `assertChannel` wrong in the Agency chat.
   */
  async listEligibleCompanies(actor: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    role?: string | null;
  }): Promise<
    Array<{
      companyContextId: string;
      agencyClientId: string;
      companyContactId: string;
    }>
  > {
    const companies = await this.companyContexts.find({
      where: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        status: 'active',
      },
    });

    const eligible: Array<{
      companyContextId: string;
      agencyClientId: string;
      companyContactId: string;
    }> = [];

    for (const company of companies) {
      if (company.archivedAt) continue;

      const allowed = await this.permissions.canAccessClient({
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        role: actor.role ?? 'member',
        clientId: company.agencyClientId,
      });
      if (!allowed) continue;

      const modules = await this.management.resolveCompanyModules({
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        agencyClientId: company.agencyClientId,
        companyContextId: company.id,
      });
      if (!modules.conversations) continue;

      eligible.push({
        companyContextId: company.id,
        agencyClientId: company.agencyClientId,
        companyContactId: company.companyContactId,
      });
    }

    return eligible;
  }
}
