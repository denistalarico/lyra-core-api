import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import type {
  AgencyClientArchiveEvent,
  CompanyContextArchiveEvent,
} from '../../clients/agency-client-lifecycle-hooks';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import {
  isActiveClient,
  isActiveCompany,
  isAvailableOrganization,
} from '../client-area-availability';
import { isUuid } from '../client-area.types';
import { ClientAreaCompanySettingsEntity } from '../entities/client-area-settings.entity';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import { ClientAreaMemberAuditService } from './client-area-member-audit.service';
import { ClientAreaMembershipService } from './client-area-membership.service';
import { ClientAreaInvitationService } from './client-area-invitation.service';

type Removal = CompanyContextArchiveEvent & {
  reason: 'access_removed' | 'client_archived' | 'company_archived';
};

/** CA5: one transactional path for explicit removal, archive hooks and repair.
 * No activation/entitlement gate: disabling a surface must never disable cleanup. */
@Injectable()
export class ClientAreaLifecycleService {
  private readonly logger = new Logger(ClientAreaLifecycleService.name);
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly memberships: ClientAreaMembershipService,
    private readonly invitations: ClientAreaInvitationService,
    private readonly audit: ClientAreaMemberAuditService,
  ) {}

  async removeCompanyAccess(input: Removal) {
    if (
      ![
        input.tenantId,
        input.workspaceId,
        input.agencyClientId,
        input.companyContextId,
      ].every(isUuid)
    ) {
      throw new NotFoundException('Company is not available.');
    }
    return this.db.transaction(async (manager) => {
      const scope = {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId,
        companyContextId: input.companyContextId,
      };
      const company = await manager
        .getRepository(AgencyClientCompanyContext)
        .findOne({
          where: {
            id: scope.companyContextId,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!company) throw new NotFoundException('Company is not available.');
      const settingsRepo = manager.getRepository(
        ClientAreaCompanySettingsEntity,
      );
      const settings = await settingsRepo.findOne({ where: scope });
      if (input.actorUserId === null) {
        // The hourly candidate snapshot may be stale by the time this company
        // lock is acquired. Never remove newly re-enabled, valid access.
        const [client, organization] = await Promise.all([
          manager.getRepository(AgencyClient).findOne({
            where: {
              id: scope.agencyClientId,
              tenantId: scope.tenantId,
              workspaceId: scope.workspaceId,
            },
          }),
          manager.getRepository(ContactEntity).findOne({
            where: {
              id: company.companyContactId,
              tenantId: scope.tenantId,
              workspaceId: scope.workspaceId,
            },
          }),
        ]);
        if (
          isActiveClient(client) &&
          isActiveCompany(company) &&
          isAvailableOrganization(organization) &&
          organization.status === 'active'
        ) {
          return {
            companyContextId: company.id,
            enabled: settings?.enabled ?? false,
            revokedMemberships: 0,
            revokedInvitations: 0,
          };
        }
      }
      if (settings?.enabled)
        await settingsRepo.update(scope, { enabled: false });
      const rows = await manager
        .getRepository(ClientAreaMembershipEntity)
        .find({
          where: { ...scope, status: 'active' },
          order: { userId: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        });
      for (const membership of rows) {
        await this.memberships.revokeInTransaction(manager, membership, {
          revokedByUserId: input.actorUserId,
          reason: input.reason,
        });
      }
      const revokedInvitations =
        await this.invitations.revokePendingForCompanyInTransaction(
          manager,
          scope,
          input.actorUserId,
          input.reason,
        );
      if (settings?.enabled || rows.length || revokedInvitations) {
        await this.audit.record(manager, {
          company: scope,
          action: 'access_removed',
          actorSurface: input.actorUserId ? 'agency' : 'system',
          actorUserId: input.actorUserId,
          metadata: {
            reason: input.reason,
            revokedMemberships: rows.length,
            revokedInvitations,
          },
        });
      }
      return {
        companyContextId: scope.companyContextId,
        enabled: false as const,
        revokedMemberships: rows.length,
        revokedInvitations,
      };
    });
  }

  async onClientArchived(event: AgencyClientArchiveEvent): Promise<void> {
    const companies = await this.db
      .getRepository(AgencyClientCompanyContext)
      .find({
        where: {
          tenantId: event.tenantId,
          workspaceId: event.workspaceId,
          agencyClientId: event.agencyClientId,
        },
        order: { id: 'ASC' },
      });
    for (const company of companies)
      await this.removeCompanyAccess({
        ...event,
        companyContextId: company.id,
        reason: 'client_archived',
      });
  }

  async onCompanyContextArchived(
    event: CompanyContextArchiveEvent,
  ): Promise<void> {
    await this.removeCompanyAccess({ ...event, reason: 'company_archived' });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async reconcile(): Promise<void> {
    const candidates = await this.db
      .getRepository(AgencyClientCompanyContext)
      .createQueryBuilder('company')
      .innerJoin(
        AgencyClient,
        'client',
        'client.id = company.agency_client_id AND client.tenant_id = company.tenant_id AND client.workspace_id = company.workspace_id',
      )
      .innerJoin(
        ContactEntity,
        'organization',
        'organization.id = company.company_contact_id AND organization.tenant_id = company.tenant_id AND organization.workspace_id = company.workspace_id',
      )
      .leftJoin(
        ClientAreaCompanySettingsEntity,
        'settings',
        'settings.company_context_id = company.id AND settings.tenant_id = company.tenant_id AND settings.workspace_id = company.workspace_id',
      )
      .where(
        "(client.status <> 'active' OR client.archived_at IS NOT NULL OR company.status <> 'active' OR company.archived_at IS NOT NULL OR organization.status <> 'active' OR organization.type <> 'organization')",
      )
      // Include remaining grants even when the data migration already disabled settings.
      .andWhere(
        `(settings.enabled = true OR EXISTS (SELECT 1 FROM client_area_memberships m WHERE m.company_context_id = company.id AND m.status = 'active') OR EXISTS (SELECT 1 FROM client_area_invitations i WHERE i.company_context_id = company.id AND i.status = 'pending'))`,
      )
      .addSelect(
        "CASE WHEN client.status <> 'active' OR client.archived_at IS NOT NULL THEN 'client_archived' ELSE 'company_archived' END",
        'removal_reason',
      )
      .getRawAndEntities<{ removal_reason: Removal['reason'] }>();
    for (let index = 0; index < candidates.entities.length; index++) {
      const company = candidates.entities[index];
      try {
        await this.removeCompanyAccess({
          tenantId: company.tenantId,
          workspaceId: company.workspaceId,
          agencyClientId: company.agencyClientId,
          companyContextId: company.id,
          actorUserId: null,
          reason: candidates.raw[index].removal_reason,
        });
      } catch {
        this.logger.error(
          `Client Area reconciliation failed for company ${company.id}; retry next hour.`,
        );
      }
    }
  }
}
