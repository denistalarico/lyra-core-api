import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  SocialOrganicCredentialError,
  SocialOrganicCredentialResolver,
} from '../credentials';
import { SocialOrganicAssetEntity } from '../entities';
import { MetaOrganicGraphError } from '../providers/meta/meta-organic-graph.error';
import {
  type MetaOrganicLeadForm,
  MetaOrganicGraphService,
} from '../providers/meta/meta-organic-graph.service';
import {
  META_ORGANIC_PROVIDER,
  SOCIAL_META_LEAD_ADS_SCOPES,
} from '../providers/meta/meta-organic-oauth.support';

export type { MetaOrganicLeadForm } from '../providers/meta/meta-organic-graph.service';

/** Exact scope of a Page: the form that reads its leads must have the same one. */
export type OrganicLeadAdsScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
};

export type OrganicLeadAdsPage = OrganicLeadAdsScope & {
  assetId: string;
  pageId: string;
  name: string | null;
  /**
   * `reconnect_required`: the connection was authorized before ML1, so its
   * stamped scopes lack `leads_retrieval`/`pages_manage_metadata`. The Graph
   * call is the real proof; this is the hint the panel can show beforehand.
   */
  permission: 'ready' | 'reconnect_required';
};

export type OrganicLeadAdsSubscription =
  | 'subscribed'
  | 'missing_permission'
  | 'failed';

/** Safe, enumerated failure of a Lead Ads call: no Meta text, no token. */
export class OrganicLeadAdsError extends Error {
  constructor(
    readonly kind: 'permission' | 'transient' | 'permanent',
    readonly code: string,
  ) {
    super(code);
    this.name = 'OrganicLeadAdsError';
  }
}

const LEADGEN_FIELD = 'leadgen';

/**
 * ML1 (D-L7): the only door other modules use to Meta Lead Ads. It owns which
 * Pages exist, the Page token (through the credential resolver) and the Graph
 * calls, so Forms never reads organic tables, tokens or Meta errors directly.
 */
@Injectable()
export class SocialOrganicLeadAdsService {
  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assets: Repository<SocialOrganicAssetEntity>,
    private readonly credentials: SocialOrganicCredentialResolver,
    private readonly graph: MetaOrganicGraphService,
  ) {}

  /**
   * Active, connected Facebook Pages of the workspace. With `exact`, only the
   * Pages whose client and Company Context are exactly those (the form's).
   */
  async listPages(input: {
    tenantId: string;
    workspaceId: string;
    exact?: Pick<OrganicLeadAdsScope, 'agencyClientId' | 'companyContextId'>;
  }): Promise<OrganicLeadAdsPage[]> {
    const rows = await this.assets.find({
      relations: { connection: true },
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        provider: META_ORGANIC_PROVIDER,
        assetType: 'facebook_page',
        status: 'active',
        ...(input.exact
          ? {
              agencyClientId: input.exact.agencyClientId ?? IsNull(),
              companyContextId: input.exact.companyContextId ?? IsNull(),
            }
          : {}),
        connection: {
          connectionStatus: 'connected',
          credentialRemovedAt: IsNull(),
        },
      },
      order: { displayName: 'ASC' },
    });
    return rows.map((asset) => ({
      assetId: asset.id,
      pageId: asset.externalAssetId,
      name: asset.displayName,
      tenantId: asset.tenantId,
      workspaceId: asset.workspaceId,
      agencyClientId: asset.agencyClientId,
      companyContextId: asset.companyContextId,
      permission: SOCIAL_META_LEAD_ADS_SCOPES.every((scope) =>
        (asset.connection?.scopes ?? []).includes(scope),
      )
        ? 'ready'
        : 'reconnect_required',
    }));
  }

  async findPage(
    scope: OrganicLeadAdsScope,
    pageId: string,
  ): Promise<OrganicLeadAdsPage | null> {
    const pages = await this.listPages({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      exact: scope,
    });
    return pages.find((page) => page.pageId === pageId) ?? null;
  }

  /**
   * Installs the app on the Page for `leadgen`, keeping whatever fields it was
   * already subscribed to. Never throws: the outcome is shown per Page.
   */
  async subscribe(
    page: OrganicLeadAdsPage,
  ): Promise<OrganicLeadAdsSubscription> {
    try {
      const accessToken = await this.token(page);
      const current = await this.graph.getPageSubscribedFields({
        pageId: page.pageId,
        accessToken,
      });
      if (current.includes(LEADGEN_FIELD)) return 'subscribed';
      await this.graph.subscribePageFields({
        pageId: page.pageId,
        accessToken,
        fields: [...new Set([...current, LEADGEN_FIELD])],
      });
      return 'subscribed';
    } catch (error) {
      return this.classify(error).kind === 'permission'
        ? 'missing_permission'
        : 'failed';
    }
  }

  async readLead(
    page: Pick<OrganicLeadAdsPage, 'assetId'> & OrganicLeadAdsScope,
    leadId: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.graph.getLead({
        leadId,
        accessToken: await this.token(page),
      });
    } catch (error) {
      throw this.classify(error);
    }
  }

  async listForms(page: OrganicLeadAdsPage): Promise<MetaOrganicLeadForm[]> {
    try {
      return await this.graph.listLeadForms({
        pageId: page.pageId,
        accessToken: await this.token(page),
      });
    } catch (error) {
      throw this.classify(error);
    }
  }

  async listFormLeads(
    page: OrganicLeadAdsPage,
    formId: string,
    maxPages: number,
  ): Promise<{ leads: Record<string, unknown>[]; truncated: boolean }> {
    try {
      return await this.graph.listFormLeads({
        formId,
        accessToken: await this.token(page),
        maxPages,
      });
    } catch (error) {
      throw this.classify(error);
    }
  }

  private async token(
    page: Pick<OrganicLeadAdsPage, 'assetId'> & OrganicLeadAdsScope,
  ): Promise<string> {
    const credential = await this.credentials.resolvePersistedForLeads({
      assetId: page.assetId,
      tenantId: page.tenantId,
      workspaceId: page.workspaceId,
      agencyClientId: page.agencyClientId,
    });
    return credential.accessToken;
  }

  private classify(error: unknown): OrganicLeadAdsError {
    if (error instanceof OrganicLeadAdsError) return error;
    if (error instanceof MetaOrganicGraphError) {
      if (
        error.kind === 'permission_denied' ||
        error.kind === 'credential_invalid'
      )
        return new OrganicLeadAdsError('permission', error.code);
      if (error.kind === 'transient' || error.kind === 'rate_limited')
        return new OrganicLeadAdsError('transient', error.code);
      return new OrganicLeadAdsError('permanent', error.code);
    }
    if (error instanceof SocialOrganicCredentialError)
      return new OrganicLeadAdsError('permission', error.code);
    return new OrganicLeadAdsError('transient', 'lead_ads_unexpected_error');
  }
}
