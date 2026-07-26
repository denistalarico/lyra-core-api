import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientStatus } from '../../clients/enums/client-status.enum';
import {
  ContactRelationship,
  resolveContactRelationship,
} from '../../leadflow-agents/catalog/contact-relationship.catalog';

export interface ContactRelationshipInput {
  tenantId: string;
  workspaceId: string;
  contactId: string | null;
  /** The contact matches a workspace user (the existing internal gate). */
  isInternalUser: boolean;
  /** The inbound qualification verdict for this contact. */
  qualificationStatus: string;
}

/**
 * Resolves a contact's canonical relationship from auditable sources.
 *
 * Each signal comes from its owning domain's source of truth:
 *  - internal_user: the existing workspace-user match (never served by agents);
 *  - customer: a linked, non-archived `AgencyClient` — a proven conversion, NOT
 *    the mere existence of an opportunity;
 *  - lead: an inbound qualified as a prospect;
 *  - unknown: nothing classified it yet (never blocks audience filtering).
 */
@Injectable()
export class ContactRelationshipResolver {
  async resolve(
    manager: EntityManager,
    input: ContactRelationshipInput,
  ): Promise<ContactRelationship> {
    // Internal wins and needs no client lookup — resolve it before any query.
    if (input.isInternalUser) {
      return ContactRelationship.InternalUser;
    }
    return resolveContactRelationship({
      isInternalUser: false,
      isCustomer: await this.isCustomer(manager, input),
      isLead: input.qualificationStatus === 'qualified',
    });
  }

  private async isCustomer(
    manager: EntityManager,
    input: ContactRelationshipInput,
  ): Promise<boolean> {
    if (!input.contactId) {
      return false;
    }
    const client = await manager.getRepository(AgencyClient).findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
      },
      select: { id: true, status: true, archivedAt: true },
    });
    if (!client || client.archivedAt) {
      return false;
    }
    return client.status !== AgencyClientStatus.Archived;
  }
}
