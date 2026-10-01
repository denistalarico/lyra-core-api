import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

const AGENCY_CONNECTION = 'agency';
const SAMPLE_LIMIT = 50;

export type ClientAreaLegacyMembershipReason =
  | 'no_identity_contact'
  | 'no_company_link';

export type ClientAreaLegacyMembershipRow = {
  membershipId: string;
  userId: string;
  companyContextId: string;
  reason: ClientAreaLegacyMembershipReason;
};

export type ClientAreaLegacyMembershipReport = {
  total: number;
  valid: number;
  legacyUnlinked: number;
  sample: ClientAreaLegacyMembershipRow[];
};

/**
 * CA4.1 — Agency-admin-only, read-only classification of active memberships
 * against the CRM identity chain the runtime now enforces
 * (`ClientAreaEligibilityService.isMembershipEligible`). Nothing here is
 * persisted: every call recomputes live, the same "never infer, always
 * re-derive" stance as `CompanyLegacyReconciliationService`. Not wired to any
 * controller — invoke from a script/REPL when sizing the CA4.1 rollout, or
 * from a future admin endpoint if that becomes a real requirement.
 */
@Injectable()
export class ClientAreaLegacyAuditService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly db: DataSource,
  ) {}

  async classifyMemberships(
    tenantId: string,
    workspaceId: string,
  ): Promise<ClientAreaLegacyMembershipReport> {
    const rows = await this.db.query<
      Array<{
        membership_id: string;
        user_id: string;
        company_context_id: string;
        has_identity_contact: boolean;
        has_company_link: boolean;
      }>
    >(
      `SELECT
         m.id AS membership_id,
         m.user_id,
         m.company_context_id,
         (ic.id IS NOT NULL) AS has_identity_contact,
         (ic.id IS NOT NULL AND ccl.id IS NOT NULL) AS has_company_link
       FROM client_area_memberships m
       LEFT JOIN client_area_identity_contacts ic
         ON ic.tenant_id = m.tenant_id
        AND ic.user_id = m.user_id
        AND ic.status = 'active'
       LEFT JOIN agency_client_company_contexts company
         ON company.id = m.company_context_id
        AND company.tenant_id = m.tenant_id
        AND company.workspace_id = m.workspace_id
       LEFT JOIN contact_company_links ccl
         ON ccl.tenant_id = m.tenant_id
        AND ccl.workspace_id = m.workspace_id
        AND ccl.person_contact_id = ic.contact_id
        AND ccl.company_contact_id = company.company_contact_id
        AND ccl.status = 'active'
       WHERE m.tenant_id = $1
         AND m.workspace_id = $2
         AND m.status = 'active'`,
      [tenantId, workspaceId],
    );

    let valid = 0;
    const unlinked: ClientAreaLegacyMembershipRow[] = [];
    for (const row of rows) {
      if (row.has_company_link) {
        valid += 1;
        continue;
      }
      unlinked.push({
        membershipId: row.membership_id,
        userId: row.user_id,
        companyContextId: row.company_context_id,
        reason: row.has_identity_contact
          ? 'no_company_link'
          : 'no_identity_contact',
      });
    }

    return {
      total: rows.length,
      valid,
      legacyUnlinked: unlinked.length,
      sample: unlinked.slice(0, SAMPLE_LIMIT),
    };
  }
}
