import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { AgencyClientStatus } from '../../clients/enums';
import { ContactCompanyLinkEntity } from '../../contacts/entities/contact-company-link.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { ClientAreaIdentityContactEntity } from '../entities/client-area-identity-contact.entity';
import { CLIENT_AREA_ERROR_CODES } from '../client-area.types';
import { clientAreaCodedError } from './client-area-membership.service';

export type EligibleClientAreaCompany = {
  companyContextId: string;
  organizationContactId: string;
  displayName: string;
};

/**
 * CA4 boundary for CRM provisioning eligibility. This service intentionally
 * does not authorize requests; a ClientAreaMembership is still required by
 * every Client Area guard.
 */
@Injectable()
export class ClientAreaEligibilityService {
  async listEligibleCompaniesForContact(
    manager: EntityManager,
    tenantId: string,
    workspaceId: string,
    contactId: string,
  ): Promise<EligibleClientAreaCompany[]> {
    const contact = await manager.getRepository(ContactEntity).findOne({
      where: { id: contactId, tenantId, workspaceId },
    });
    if (!contact || contact.type !== 'person' || contact.status !== 'active') {
      return [];
    }

    const rows = await manager
      .getRepository(ContactCompanyLinkEntity)
      .createQueryBuilder('link')
      .innerJoin(
        AgencyClientCompanyContext,
        'company',
        `company.company_contact_id = link.company_contact_id
          AND company.tenant_id = link.tenant_id
          AND company.workspace_id = link.workspace_id`,
      )
      .innerJoin(
        ContactEntity,
        'organization',
        `organization.id = company.company_contact_id
          AND organization.tenant_id = company.tenant_id
          AND organization.workspace_id = company.workspace_id`,
      )
      .innerJoin(
        AgencyClient,
        'client',
        `client.id = company.agency_client_id
          AND client.tenant_id = company.tenant_id
          AND client.workspace_id = company.workspace_id`,
      )
      .select('company.id', 'companyContextId')
      .addSelect('organization.id', 'organizationContactId')
      .addSelect('organization.display_name', 'displayName')
      .where('link.tenant_id = :tenantId', { tenantId })
      .andWhere('link.workspace_id = :workspaceId', { workspaceId })
      .andWhere('link.person_contact_id = :contactId', { contactId })
      .andWhere(`link.status = 'active'`)
      .andWhere(`company.status = 'active' AND company.archived_at IS NULL`)
      .andWhere(
        `organization.type = 'organization' AND organization.status = 'active'`,
      )
      .andWhere(
        `client.status = :clientStatus AND client.archived_at IS NULL`,
        {
          clientStatus: AgencyClientStatus.Active,
        },
      )
      .orderBy('organization.display_name', 'ASC')
      .getRawMany<EligibleClientAreaCompany>();
    return rows;
  }

  async assertContactEligibleForCompany(
    manager: EntityManager,
    input: {
      tenantId: string;
      workspaceId: string;
      contactId: string;
      companyContextId: string;
    },
  ): Promise<EligibleClientAreaCompany> {
    const companies = await this.listEligibleCompaniesForContact(
      manager,
      input.tenantId,
      input.workspaceId,
      input.contactId,
    );
    const company = companies.find(
      (candidate) => candidate.companyContextId === input.companyContextId,
    );
    if (company) return company;
    throw clientAreaCodedError(
      NotFoundException,
      404,
      CLIENT_AREA_ERROR_CODES.contactIneligible,
      'This CRM contact is not eligible for the selected company.',
    );
  }

  async resolveContactForIdentity(
    manager: EntityManager,
    tenantId: string,
    userId: string,
  ): Promise<ClientAreaIdentityContactEntity | null> {
    return manager.getRepository(ClientAreaIdentityContactEntity).findOne({
      where: { tenantId, userId, status: 'active' },
    });
  }

  async assertIdentityEligibleForCompany(
    manager: EntityManager,
    input: { tenantId: string; userId: string; companyContextId: string },
  ) {
    const link = await this.resolveContactForIdentity(
      manager,
      input.tenantId,
      input.userId,
    );
    if (!link) {
      throw clientAreaCodedError(
        NotFoundException,
        404,
        CLIENT_AREA_ERROR_CODES.identityContactMissing,
        'This identity is not linked to a CRM person.',
      );
    }
    return this.assertContactEligibleForCompany(manager, {
      tenantId: input.tenantId,
      workspaceId: link.workspaceId,
      contactId: link.contactId,
      companyContextId: input.companyContextId,
    });
  }

  /**
   * CA4.1 runtime re-check: proves the identity's CRM chain (active
   * identity-contact -> active PF -> active contact_company_link -> this
   * company) is still intact. Does not throw; callers fold this into their
   * own fail-closed shape so no check is individually enumerable.
   */
  async isMembershipEligible(
    manager: EntityManager,
    input: { tenantId: string; userId: string; companyContextId: string },
  ): Promise<boolean> {
    try {
      await this.assertIdentityEligibleForCompany(manager, input);
      return true;
    } catch {
      return false;
    }
  }

  async linkIdentityInTransaction(
    manager: EntityManager,
    input: {
      tenantId: string;
      workspaceId: string;
      userId: string;
      contactId: string;
      linkedByUserId: string | null;
    },
  ): Promise<ClientAreaIdentityContactEntity> {
    const repo = manager.getRepository(ClientAreaIdentityContactEntity);
    const existing = await repo.findOne({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        status: 'active',
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) {
      if (existing.contactId === input.contactId) return existing;
      throw clientAreaCodedError(
        ConflictException,
        409,
        CLIENT_AREA_ERROR_CODES.identityContactConflict,
        'This identity is already linked to a different CRM person.',
      );
    }
    const contactTaken = await repo.exists({
      where: {
        tenantId: input.tenantId,
        contactId: input.contactId,
        status: 'active',
      },
    });
    if (contactTaken) {
      throw clientAreaCodedError(
        ConflictException,
        409,
        CLIENT_AREA_ERROR_CODES.identityContactConflict,
        'This CRM person is already linked to another Client Area identity.',
      );
    }
    return repo.save(
      repo.create({
        ...input,
        status: 'active',
        linkedAt: new Date(),
        revokedAt: null,
        revokedByUserId: null,
      }),
    );
  }
}
