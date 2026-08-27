import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialInternalAccessService } from '../internal/social-internal-access.service';
import { isSameAdAccountId } from '../meta-ad-account-id';
import { SOCIAL_META_ADS_SCOPES } from '../oauth/meta-ads-oauth.support';
import type { SocialAdAccountOptionView } from '../views/social-ad-connection.view';
import { toSocialAdConnectionView } from '../views/social-ad-connection.view';
import { MetaAdsGraphService } from './meta-ads-graph.service';
import { SocialAdBackfillPlannerService } from './social-ad-backfill-planner.service';

const PROVIDER = 'meta_ads' as const;
const METHOD = 'internal_system_user' as const;

export type SocialInternalScopeInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  userId: string | null;
};

export type SelectInternalAdAccountInput = SocialInternalScopeInput & {
  externalAccountId: string;
};

export type SocialInternalHealthView = {
  connectionId: string;
  /** Whether the server still holds a System User token at all. */
  tokenConfigured: boolean;
  /** Whether Meta answered the read. */
  graphReachable: boolean;
  /** Whether the bound account is still among the ones the token can read. */
  accountAccessible: boolean;
  checkedAt: string;
  /** Safe code, never a provider message. */
  error: string | null;
};

/**
 * Meta Ads connection for the tenant that owns the Meta App.
 *
 * Facebook Login for Business does not let an app's own owner select that
 * app's Business Manager, so the tenant behind the app cannot complete the
 * normal flow against itself. This path uses a System User token from server
 * configuration instead.
 *
 * It is an exception, not a fallback, and a narrow one: it covers exactly one
 * ad account, the one configuration names. `SocialInternalAccessService`
 * decides who may be here and which account they may touch, and every method
 * asks it again rather than trusting a caller to have asked once. Nothing in
 * this service reads `SOCIAL_META_ADS_APP_SECRET` or touches the OAuth
 * lifecycle: the two paths share the connection table and nothing else.
 *
 * The System User token is never written to the database. A connection made
 * this way stores no credential at all — `access_token_encrypted` stays NULL,
 * and `authorization_method` is what tells a future reader where the token
 * actually comes from.
 */
@Injectable()
export class MetaAdsSystemUserService {
  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly graphService: MetaAdsGraphService,
    private readonly accessService: SocialInternalAccessService,
    private readonly backfillPlanner: SocialAdBackfillPlannerService,
  ) {}

  /** Whether the settings screen should offer this method. No provider call. */
  isAvailable(scope: SocialInternalScopeInput): boolean {
    return this.accessService.isAvailable(scope);
  }

  /**
   * The one account the exception covers, confirmed against Meta.
   *
   * Not a listing of what the System User can reach. The token can read every
   * account in the agency's Business Manager, client accounts included, and
   * offering that list would turn an administrative exception into a way to
   * bind a client's account without that client ever authorizing anything.
   *
   * Two conditions, both required, and neither sufficient alone: configuration
   * names the account, and Meta confirms the System User can actually read it.
   * Returning a single-element array keeps the option shape the OAuth flow
   * returns, so the settings screen has one contract to render.
   */
  async listAdAccounts(
    scope: SocialInternalScopeInput,
  ): Promise<SocialAdAccountOptionView[]> {
    const token = this.accessService.requireSystemUserToken(scope);
    const allowedAccountId = this.accessService.requireInternalAccountId(scope);

    const account = await this.findAllowedAccount(token, allowedAccountId);

    if (!account) {
      // The configured account is not readable. Reported as an error rather
      // than as an empty list so the screen says what is wrong instead of
      // implying the Business Manager is empty.
      throw new BadRequestException('account_not_accessible');
    }

    return [
      {
        externalAccountId: account.externalAccountId,
        accountName: account.accountName,
        currency: account.currency,
        timezone: account.timezone,
        businessName: account.businessName,
        accountStatus: account.accountStatus,
      },
    ];
  }

  /**
   * Reads the allowed account back from Meta.
   *
   * The comparison goes through `isSameAdAccountId` because Meta spells the
   * same account two ways; a raw string compare here would reject the right
   * account whenever the two spellings met.
   */
  private async findAllowedAccount(token: string, allowedAccountId: string) {
    const accounts = await this.graphService.listAdAccounts(token);

    return (
      accounts.find((candidate) =>
        isSameAdAccountId(candidate.externalAccountId, allowedAccountId),
      ) ?? null
    );
  }

  /**
   * Binds the allowed account as a connection.
   *
   * The request names an account, but it does not get to choose one. It is
   * checked against configuration first — before any provider call, so a
   * caller cannot even use this route to probe which accounts the System User
   * can see — and the account is then re-read from Meta rather than trusted
   * from the request, so no row can claim an account the token cannot read.
   *
   * Refusing with 404 keeps the shape the rest of the internal path uses: to a
   * caller asking about an account that is not theirs, this route is simply
   * not there.
   */
  async select(input: SelectInternalAdAccountInput) {
    const token = this.accessService.requireSystemUserToken(input);
    const allowedAccountId = this.accessService.requireInternalAccountId(input);

    if (!isSameAdAccountId(input.externalAccountId, allowedAccountId)) {
      throw new NotFoundException('Not found.');
    }

    const account = await this.findAllowedAccount(token, allowedAccountId);

    if (!account) {
      throw new BadRequestException('account_not_available');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const connections = manager.getRepository(
        SocialAdAccountConnectionEntity,
      );

      const existing = await connections
        .createQueryBuilder('connection')
        .where('connection.tenantId = :tenantId', { tenantId: input.tenantId })
        .andWhere('connection.workspaceId = :workspaceId', {
          workspaceId: input.workspaceId,
        })
        .andWhere('connection.provider = :provider', { provider: PROVIDER })
        // The id Meta returned, not the one the request sent: the row is
        // looked up under the same canonical spelling it is written under, so
        // a request in the other spelling cannot miss the existing row and
        // insert a duplicate for the same account.
        .andWhere('connection.externalAccountId = :externalAccountId', {
          externalAccountId: account.externalAccountId,
        })
        .setLock('pessimistic_write')
        .getOne();

      // Live means live regardless of how it was authorized: re-binding an
      // account that already reads would leave two rows for one account.
      if (existing && !existing.credentialRemovedAt) {
        return {
          ok: false as const,
          code: 'account_already_connected' as const,
        };
      }

      const target =
        existing ??
        connections.create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId: null,
          provider: PROVIDER,
          credentialVersion: 1,
        });

      target.agencyClientId = null;
      target.authorizationMethod = METHOD;
      target.externalAccountId = account.externalAccountId;
      target.externalBusinessId = account.businessId;
      target.accountName = account.accountName;
      target.currency = account.currency;
      target.timezone = account.timezone;
      target.connectionStatus = 'connected';
      // No credential is persisted. The token lives in server configuration
      // and is read per request; writing it here would put a long-lived
      // Business Manager credential in a table that a backup copies.
      target.accessTokenEncrypted = null;
      target.refreshTokenEncrypted = null;
      // A System User token does not expire, so there is no date to show.
      target.tokenExpiresAt = null;
      target.scopes = [...SOCIAL_META_ADS_SCOPES];
      target.credentialVersion = existing ? existing.credentialVersion + 1 : 1;
      target.credentialRemovedAt = null;
      target.lastSyncError = null;
      target.oauthStateHash = null;
      target.oauthExpiresAt = null;
      target.createdById = input.userId;
      target.metadata = {
        connectedAt: new Date().toISOString(),
        businessName: account.businessName,
        accountStatus: account.accountStatus,
      };

      await connections.save(target);

      return { ok: true as const, connection: target };
    });

    if (!result.ok) {
      throw new BadRequestException(result.code);
    }

    // The same hand-off as the business-login path, through the same planner:
    // the two flows differ in how a token is obtained and in nothing about what
    // a connected account owes. Outside the transaction, for the same reason.
    await this.backfillPlanner.planForConnectedAccount(result.connection);

    return toSocialAdConnectionView(result.connection);
  }

  /**
   * Read-only liveness check for an internal connection.
   *
   * Reports what it found instead of throwing on a provider failure: "Meta did
   * not answer" is an answer the settings screen has to render, not a 500.
   */
  async health(
    input: SocialInternalScopeInput & { connectionId: string },
  ): Promise<SocialInternalHealthView> {
    this.accessService.requireInternalScope(input);

    const connection = await this.connectionsRepository
      .createQueryBuilder('connection')
      .where('connection.id = :id', { id: input.connectionId })
      .andWhere('connection.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('connection.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere('connection.agencyClientId IS NULL')
      .andWhere('connection.provider = :provider', { provider: PROVIDER })
      .getOne();

    if (!connection) {
      throw new NotFoundException('Connection not found.');
    }

    if (connection.authorizationMethod !== METHOD) {
      throw new BadRequestException('connection_not_internal');
    }

    const base = {
      connectionId: connection.id,
      checkedAt: new Date().toISOString(),
    };

    const unconfigured = {
      ...base,
      graphReachable: false,
      accountAccessible: false,
    };

    if (!this.tokenConfigured(input)) {
      return {
        ...unconfigured,
        tokenConfigured: false,
        error: 'system_user_token_missing',
      };
    }

    const allowedAccountId = this.allowedAccountId(input);

    if (!allowedAccountId) {
      // Distinct from a missing token on purpose: half a configuration is a
      // different repair from none, and the operator has to know which half.
      return {
        ...unconfigured,
        tokenConfigured: true,
        error: 'internal_account_not_configured',
      };
    }

    // Configuration can be re-pointed after a connection was made. When that
    // happens the row is no longer the allowed account, and saying so is more
    // useful than checking Meta for an account this connection may not use.
    if (!isSameAdAccountId(connection.externalAccountId, allowedAccountId)) {
      return {
        ...unconfigured,
        tokenConfigured: true,
        error: 'account_not_allowed',
      };
    }

    const token = this.accessService.requireSystemUserToken(input);

    let account: Awaited<ReturnType<typeof this.findAllowedAccount>>;

    try {
      account = await this.findAllowedAccount(token, allowedAccountId);
    } catch {
      return {
        ...base,
        tokenConfigured: true,
        graphReachable: false,
        accountAccessible: false,
        error: 'graph_unreachable',
      };
    }

    return {
      ...base,
      tokenConfigured: true,
      graphReachable: true,
      accountAccessible: account !== null,
      error: account ? null : 'account_not_accessible',
    };
  }

  /** Config probes that report instead of throwing, for the health payload. */
  private tokenConfigured(scope: SocialInternalScopeInput): boolean {
    try {
      this.accessService.requireSystemUserToken(scope);
      return true;
    } catch {
      return false;
    }
  }

  private allowedAccountId(scope: SocialInternalScopeInput): string | null {
    try {
      return this.accessService.requireInternalAccountId(scope);
    } catch {
      return null;
    }
  }
}
