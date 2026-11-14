import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  ConflictException,
  BadGatewayException,
} from '@nestjs/common';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import {
  GoogleApiClient,
  GoogleApiError,
  type Ga4PropertySummary,
  type GoogleAdsCustomer,
} from './google-api.client';
import {
  GOOGLE_GA4_MAX_PROPERTIES,
  GOOGLE_PRODUCT_SCOPES,
} from './google-oauth.constants';
import { SocialGoogleProductLinkEntity } from './entities';
import {
  GoogleCredentialError,
  SocialGoogleAuthorizationService,
} from './social-google-authorization.service';
import { readGa4Resources } from './social-google.support';

export type SelectableGoogleProduct = 'ads' | 'ga4';

export type GoogleAdsCandidateView = GoogleAdsCustomer;
export type Ga4PropertyCandidateView = Ga4PropertySummary;

/**
 * Selection step (G1): after `confirm`, the user chooses which Google Ads
 * account(s) and GA4 propert(ies) Lyra may read. Candidates are discovered live
 * under the stored token; a chosen id is only trusted if it appears in a fresh
 * listing made at selection time, never because the client said so.
 *
 * Nothing here talks to Google beyond read-only discovery (D-G7).
 */
@Injectable()
export class SocialGoogleSelectionService {
  constructor(
    private readonly authorizations: SocialGoogleAuthorizationService,
    private readonly google: GoogleApiClient,
  ) {}

  async listAdsCandidates(scope: CompanyAwareScope) {
    const customers = await this.discoverAds(scope);
    return { product: 'ads' as const, candidates: customers };
  }

  async listGa4Candidates(scope: CompanyAwareScope) {
    const properties = await this.discoverGa4(scope);
    return { product: 'ga4' as const, candidates: properties };
  }

  async selectAdsAccount(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    customerId: string;
  }) {
    const customer = (await this.discoverAds(input.scope)).find(
      (candidate) => candidate.customerId === input.customerId,
    );
    if (!customer || customer.isManager) {
      throw new BadRequestException('selection_invalid');
    }

    return this.authorizations.withLockedAuthorization(
      input.scope,
      async ({ manager, authorization, audit }) => {
        await this.requireConnectedLink(manager, authorization.id, 'ads');
        const repo = manager.getRepository(SocialAdAccountConnectionEntity);
        const existing = await repo
          .createQueryBuilder('c')
          .where(`c.provider = 'google_ads'`)
          .andWhere('c.externalAccountId = :id', { id: customer.customerId })
          .andWhere('c.tenantId = :tenantId', {
            tenantId: input.scope.tenantId,
          })
          .andWhere('c.workspaceId = :workspaceId', {
            workspaceId: input.scope.workspaceId,
          })
          .andWhere('c.agencyClientId IS NOT DISTINCT FROM :agencyClientId', {
            agencyClientId: input.scope.agencyClientId,
          })
          .andWhere(
            'c.companyContextId IS NOT DISTINCT FROM :companyContextId',
            { companyContextId: input.scope.companyContextId },
          )
          .getOne();

        const connection = existing ?? repo.create();
        connection.tenantId = input.scope.tenantId;
        connection.workspaceId = input.scope.workspaceId;
        connection.agencyClientId = input.scope.agencyClientId;
        connection.companyContextId = input.scope.companyContextId;
        connection.provider = 'google_ads';
        connection.authorizationMethod = 'google_oauth';
        connection.externalAccountId = customer.customerId;
        connection.accountName = customer.name.slice(0, 240);
        connection.currency = customer.currency;
        connection.timezone = customer.timezone;
        connection.connectionStatus = 'connected';
        connection.credentialRemovedAt = null;
        connection.lastSyncError = null;
        connection.scopes = [GOOGLE_PRODUCT_SCOPES.ads];
        connection.createdById = connection.createdById ?? input.userId;
        connection.metadata = {
          ...(connection.metadata ?? {}),
          googleAuthorizationId: authorization.id,
          loginCustomerId:
            customer.accessVia === 'direct' ? null : customer.accessVia,
          accountStatus: customer.status,
          isTest: customer.isTest,
        };
        await repo.save(connection);
        await audit(
          'resource_selected',
          'ads',
          input.userId,
          customer.customerId,
        );
        return {
          product: 'ads' as const,
          selected: await this.authorizations.listSelectedAdsAccounts(
            manager,
            input.scope,
          ),
        };
      },
    );
  }

  async removeAdsAccount(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    customerId: string;
  }) {
    return this.authorizations.withLockedAuthorization(
      input.scope,
      async ({ manager, audit }) => {
        const repo = manager.getRepository(SocialAdAccountConnectionEntity);
        const row = await repo
          .createQueryBuilder('c')
          .where(`c.provider = 'google_ads'`)
          .andWhere(`c.connectionStatus = 'connected'`)
          .andWhere('c.externalAccountId = :id', { id: input.customerId })
          .andWhere('c.tenantId = :tenantId', {
            tenantId: input.scope.tenantId,
          })
          .andWhere('c.workspaceId = :workspaceId', {
            workspaceId: input.scope.workspaceId,
          })
          .andWhere('c.agencyClientId IS NOT DISTINCT FROM :agencyClientId', {
            agencyClientId: input.scope.agencyClientId,
          })
          .andWhere(
            'c.companyContextId IS NOT DISTINCT FROM :companyContextId',
            { companyContextId: input.scope.companyContextId },
          )
          .getOne();
        if (!row) throw new NotFoundException('selection_not_found');
        row.connectionStatus = 'disconnected';
        row.credentialRemovedAt = new Date();
        await repo.save(row);
        await audit(
          'resource_deselected',
          'ads',
          input.userId,
          input.customerId,
        );
        return {
          product: 'ads' as const,
          selected: await this.authorizations.listSelectedAdsAccounts(
            manager,
            input.scope,
          ),
        };
      },
    );
  }

  async selectGa4Property(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    propertyId: string;
  }) {
    const candidate = (await this.discoverGa4(input.scope)).find(
      (item) => item.propertyId === input.propertyId,
    );
    if (!candidate) throw new BadRequestException('selection_invalid');
    const detail = await this.withApiErrors(async () =>
      this.google.getGa4Property(
        (await this.token(input.scope, 'ga4')).accessToken,
        candidate.propertyId,
      ),
    );

    return this.authorizations.withLockedAuthorization(
      input.scope,
      async ({ manager, authorization, audit }) => {
        const link = await this.requireConnectedLink(
          manager,
          authorization.id,
          'ga4',
        );
        const current = readGa4Resources(link.resources);
        const without = current.filter(
          (item) => item.propertyId !== candidate.propertyId,
        );
        if (
          without.length === current.length &&
          current.length >= GOOGLE_GA4_MAX_PROPERTIES
        ) {
          throw new BadRequestException('selection_limit_reached');
        }
        link.resources = [
          ...without,
          {
            propertyId: candidate.propertyId,
            displayName: candidate.displayName,
            accountId: candidate.accountId,
            timeZone: detail.timeZone,
            currency: detail.currency,
          },
        ];
        await manager.getRepository(SocialGoogleProductLinkEntity).save(link);
        await audit(
          'resource_selected',
          'ga4',
          input.userId,
          candidate.propertyId,
        );
        return this.ga4Selected(link);
      },
    );
  }

  async removeGa4Property(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    propertyId: string;
  }) {
    return this.authorizations.withLockedAuthorization(
      input.scope,
      async ({ manager, authorization, audit }) => {
        const link = await this.requireConnectedLink(
          manager,
          authorization.id,
          'ga4',
        );
        const current = readGa4Resources(link.resources);
        const next = current.filter(
          (item) => item.propertyId !== input.propertyId,
        );
        if (next.length === current.length) {
          throw new NotFoundException('selection_not_found');
        }
        link.resources = next;
        await manager.getRepository(SocialGoogleProductLinkEntity).save(link);
        await audit(
          'resource_deselected',
          'ga4',
          input.userId,
          input.propertyId,
        );
        return this.ga4Selected(link);
      },
    );
  }

  private ga4Selected(link: SocialGoogleProductLinkEntity) {
    return {
      product: 'ga4' as const,
      selected: readGa4Resources(link.resources).map((item) => ({
        id: item.propertyId,
        name: item.displayName,
      })),
    };
  }

  private async requireConnectedLink(
    manager: import('typeorm').EntityManager,
    authorizationId: string,
    product: SelectableGoogleProduct,
  ) {
    const link = await manager
      .getRepository(SocialGoogleProductLinkEntity)
      .findOne({ where: { authorizationId, product } });
    if (!link || link.status !== 'connected') {
      throw new NotFoundException('product_not_connected');
    }
    return link;
  }

  private discoverAds(scope: CompanyAwareScope) {
    return this.withApiErrors(async () =>
      this.google.listAdsCustomers(
        (await this.token(scope, 'ads')).accessToken,
      ),
    );
  }

  private discoverGa4(scope: CompanyAwareScope) {
    return this.withApiErrors(async () =>
      this.google.listGa4PropertySummaries(
        (await this.token(scope, 'ga4')).accessToken,
      ),
    );
  }

  private token(scope: CompanyAwareScope, product: SelectableGoogleProduct) {
    return this.authorizations.getAccessToken({ scope, product });
  }

  /** Maps internal failures to safe HTTP errors; provider bodies never leak. */
  private async withApiErrors<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof GoogleCredentialError) {
        switch (error.code) {
          case 'not_connected':
          case 'product_not_connected':
            throw new NotFoundException(error.code);
          case 'reauth_required':
          case 'scope_not_granted':
            throw new ConflictException('reauth_required');
          default:
            throw new ServiceUnavailableException('refresh_failed');
        }
      }
      if (error instanceof GoogleApiError) {
        switch (error.code) {
          case 'reauth_required':
            throw new ConflictException('reauth_required');
          case 'permission_denied':
            throw new ForbiddenException('permission_denied');
          case 'google_ads_not_configured':
            throw new ServiceUnavailableException('google_ads_not_configured');
          case 'transient':
            throw new ServiceUnavailableException('google_unavailable');
          default:
            throw new BadGatewayException('google_invalid_response');
        }
      }
      throw error;
    }
  }
}
