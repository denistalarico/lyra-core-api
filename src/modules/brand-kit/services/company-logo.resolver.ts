import {
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CompanyLogoRegistry,
  type CompanyLogoScope,
} from '../../../common/client-area-bridge/company-logo.registry';
import { BrandKitService } from './brand-kit.service';

type LogoRow = {
  ordinal: number;
  company: string | null;
  asset: string | null;
  avatar: string | null;
};

/** Reads the canonical logo; never writes an avatar copy or a public storage URL. */
@Injectable()
export class CompanyLogoResolver implements OnModuleInit {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly registry: CompanyLogoRegistry,
    private readonly kits: BrandKitService,
  ) {}
  onModuleInit() {
    this.registry.register(
      (scopes) => this.resolveMany(scopes),
      (scope) => this.read(scope),
    );
  }

  private rows(scopes: readonly CompanyLogoScope[]) {
    return this.db.query<LogoRow[]>(
      `
      SELECT s.ordinal, c.id AS company, a.id AS asset, p.avatar_url AS avatar
      FROM jsonb_to_recordset($1::jsonb) AS s(ordinal int, "tenantId" uuid, "workspaceId" uuid, "agencyClientId" uuid, "companyContextId" uuid)
      LEFT JOIN LATERAL (
        SELECT cc.* FROM agency_client_company_contexts cc
        JOIN agency_clients ac ON ac.id=cc.agency_client_id AND ac.tenant_id=cc.tenant_id AND ac.workspace_id=cc.workspace_id AND ac.archived_at IS NULL AND ac.status<>'archived'
        JOIN contacts contact ON contact.id=cc.company_contact_id AND contact.tenant_id=cc.tenant_id AND contact.workspace_id=cc.workspace_id AND contact.type='organization' AND contact.status<>'archived'
        WHERE cc.tenant_id=s."tenantId" AND cc.workspace_id=s."workspaceId" AND cc.agency_client_id=s."agencyClientId"
          AND cc.status='active' AND cc.archived_at IS NULL AND (s."companyContextId" IS NULL OR cc.id=s."companyContextId")
        ORDER BY cc.is_primary DESC, cc.created_at ASC, cc.id ASC LIMIT 1
      ) c ON true
      LEFT JOIN agency_contact_profiles p ON p.tenant_id=c.tenant_id AND p.workspace_id=c.workspace_id AND p.contact_id=c.company_contact_id
      LEFT JOIN LATERAL (
        SELECT ba.id FROM brand_kits bk JOIN brand_kit_assets ba ON ba.brand_kit_id=bk.id AND ba.tenant_id=bk.tenant_id AND ba.workspace_id=bk.workspace_id AND ba.agency_client_id=bk.agency_client_id
        WHERE bk.tenant_id=c.tenant_id AND bk.workspace_id=c.workspace_id AND bk.agency_client_id=c.agency_client_id AND bk.company_context_id=c.id
          AND ba.kind='logo' AND ba.usage='asset' AND ba.deleted_at IS NULL
        ORDER BY ba.created_at DESC, ba.id DESC LIMIT 1
      ) a ON true ORDER BY s.ordinal`,
      [JSON.stringify(scopes.map((scope, ordinal) => ({ ...scope, ordinal })))],
    );
  }
  async resolveMany(scopes: readonly CompanyLogoScope[]) {
    if (!scopes.length) return [];
    const rows = await this.rows(scopes);
    return rows.map((row) => {
      if (!row.company) return null;
      if (!row.asset) return row.avatar;
      const scope = scopes[row.ordinal];
      const base =
        scope.surface === 'client_area'
          ? `/client-area/companies/${row.company}/logo`
          : `/agency/clients/${scope.agencyClientId}/companies/${row.company}/logo`;
      return `${base}?v=${row.asset}`;
    });
  }
  async read(scope: CompanyLogoScope) {
    const [row] = await this.rows([scope]);
    if (!row?.company || !row.asset)
      throw new NotFoundException('Logo not found.');
    const result = await this.kits.getAssetContent(
      {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        managedContext: {
          operatingMode: 'client',
          productKey: 'social',
          clientId: scope.agencyClientId,
          companyContextId: row.company,
          managedTenantId: null,
        },
      },
      row.asset,
    );
    return { mimeType: result.asset.mimeType, body: result.file.body };
  }
}
