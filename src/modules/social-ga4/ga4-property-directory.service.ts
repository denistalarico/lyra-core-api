import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { readGa4Resources } from '../social-google/social-google.support';

export type Ga4SelectedProperty = ReturnType<typeof readGa4Resources>[number];

export type Ga4ScopedProperties = {
  scope: CompanyAwareScope;
  authorizationId: string;
  properties: Ga4SelectedProperty[];
};

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  agency_client_id: string | null;
  company_context_id: string | null;
  resources: unknown;
};

const SELECT = `
  SELECT a.id, a.tenant_id, a.workspace_id, a.agency_client_id,
         a.company_context_id, l.resources
    FROM social_google_authorizations a
    JOIN social_google_product_links l
      ON l.authorization_id = a.id AND l.product = 'ga4' AND l.status = 'connected'`;

function toScoped(row: Row): Ga4ScopedProperties {
  return {
    scope: {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      agencyClientId: row.agency_client_id,
      companyContextId: row.company_context_id,
    },
    authorizationId: row.id,
    properties: readGa4Resources(row.resources),
  };
}

/**
 * Where the selected GA4 properties live (`social_google_product_links.resources`,
 * G1). Read-only: selection is written by `SocialGoogleSelectionService`. Never
 * touches a token column.
 */
@Injectable()
export class Ga4PropertyDirectoryService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async forScope(
    scope: CompanyAwareScope,
  ): Promise<Ga4ScopedProperties | null> {
    const rows = await this.dataSource.query<Row[]>(
      `${SELECT}
       WHERE a.status <> 'revoked'
         AND a.tenant_id = $1 AND a.workspace_id = $2
         AND a.agency_client_id IS NOT DISTINCT FROM $3
         AND a.company_context_id IS NOT DISTINCT FROM $4
       LIMIT 1`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    return rows[0] ? toScoped(rows[0]) : null;
  }

  /** Every context with at least one selected property (scheduler). */
  async listAll(): Promise<Ga4ScopedProperties[]> {
    // A context that must re-authorize cannot be read until it does.
    const rows = await this.dataSource.query<Row[]>(
      `${SELECT} WHERE a.status = 'connected'`,
    );
    return rows.map(toScoped).filter((entry) => entry.properties.length > 0);
  }
}
