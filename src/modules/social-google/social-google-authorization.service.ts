import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import {
  GoogleOAuthClient,
  GoogleOAuthError,
  type GoogleTokenSet,
} from './google-oauth.client';
import {
  GOOGLE_ACCESS_TOKEN_SKEW_MS,
  GOOGLE_LOCK_TIMEOUT_MS,
  GOOGLE_PRODUCT_SCOPES,
  type GoogleProduct,
} from './google-oauth.constants';
import {
  SocialGoogleAuditEventEntity,
  SocialGoogleAuthorizationEntity,
  SocialGoogleProductLinkEntity,
} from './entities';
import { toGoogleStatusView, whereScope } from './social-google.support';

export type GoogleCredentialErrorCode =
  | 'not_connected'
  | 'product_not_connected'
  | 'scope_not_granted'
  | 'reauth_required'
  | 'refresh_failed';

/** Raised to later-phase callers that need a token and cannot get one. */
export class GoogleCredentialError extends Error {
  constructor(public readonly code: GoogleCredentialErrorCode) {
    super(code);
    this.name = 'GoogleCredentialError';
  }
}

const TOKEN_COLUMNS = [
  'auth.accessTokenEncrypted',
  'auth.refreshTokenEncrypted',
];

/**
 * Lifecycle of an existing authorization: status, per-product disconnect,
 * full revocation, and the serialized token refresh that later phases
 * (GA4, Ads, Business Profile) consume through `getAccessToken`.
 *
 * Every mutation takes a `FOR UPDATE` lock on the authorization row, so
 * refresh, disconnect and revoke are totally ordered per authorization — a
 * refresh that finishes after a revoke can never resurrect it, because it
 * re-reads the status under the lock before writing.
 */
@Injectable()
export class SocialGoogleAuthorizationService {
  private readonly logger = new Logger(SocialGoogleAuthorizationService.name);
  /** Overridable in tests only. */
  protected lockTimeoutMs = GOOGLE_LOCK_TIMEOUT_MS;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly google: GoogleOAuthClient,
    private readonly crypto: SettingsCryptoService,
  ) {}

  async getStatus(scope: CompanyAwareScope) {
    const authorization = await whereScope(
      this.dataSource
        .getRepository(SocialGoogleAuthorizationEntity)
        .createQueryBuilder('auth')
        .where(`auth.status <> 'revoked'`),
      'auth',
      scope,
    ).getOne();
    const links = authorization
      ? await this.dataSource
          .getRepository(SocialGoogleProductLinkEntity)
          .find({ where: { authorizationId: authorization.id } })
      : [];
    const sharedIdentity = authorization
      ? (await this.countOtherLiveHolders(
          this.dataSource.manager,
          authorization,
        )) > 0
      : false;
    const adsAccounts = authorization
      ? await this.listSelectedAdsAccounts(this.dataSource.manager, scope)
      : [];
    return toGoogleStatusView(
      authorization,
      links,
      sharedIdentity,
      adsAccounts,
    );
  }

  /** Google Ads accounts the context selected (G1); never credential data. */
  async listSelectedAdsAccounts(
    manager: EntityManager,
    scope: CompanyAwareScope,
  ) {
    const rows = await manager
      .getRepository(SocialAdAccountConnectionEntity)
      .createQueryBuilder('c')
      .where(`c.provider = 'google_ads'`)
      .andWhere(`c.connectionStatus = 'connected'`)
      .andWhere('c.credentialRemovedAt IS NULL')
      .andWhere('c.externalAccountId IS NOT NULL')
      .andWhere('c.tenantId = :tenantId', { tenantId: scope.tenantId })
      .andWhere('c.workspaceId = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere('c.agencyClientId IS NOT DISTINCT FROM :agencyClientId', {
        agencyClientId: scope.agencyClientId,
      })
      .andWhere('c.companyContextId IS NOT DISTINCT FROM :companyContextId', {
        companyContextId: scope.companyContextId,
      })
      .orderBy('c.createdAt', 'ASC')
      .getMany();
    return rows.map((row) => ({
      id: row.externalAccountId as string,
      name: row.accountName ?? (row.externalAccountId as string),
    }));
  }

  /**
   * Runs `work` inside a transaction holding the live authorization's row lock,
   * so selection writes are ordered with refresh, disconnect and revoke.
   */
  async withLockedAuthorization<T>(
    scope: CompanyAwareScope,
    work: (ctx: {
      manager: EntityManager;
      authorization: SocialGoogleAuthorizationEntity;
      audit: (
        event: string,
        product: string | null,
        actorId: string | null,
        detail?: string | null,
      ) => Promise<void>;
    }) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const authorization = await this.lockLive(manager, scope);
      if (!authorization) throw new NotFoundException('not_connected');
      return work({
        manager,
        authorization,
        audit: (event, product, actorId, detail = null) =>
          this.audit(
            manager,
            scope,
            authorization.id,
            event,
            product,
            actorId,
            detail,
          ),
      });
    });
  }

  /** A-11: a product that is gone must leave no selection that a sync would read. */
  private async clearSelections(
    manager: EntityManager,
    scope: CompanyAwareScope,
    products: GoogleProduct[],
  ) {
    if (!products.includes('ads')) return;
    await manager
      .createQueryBuilder()
      .update(SocialAdAccountConnectionEntity)
      .set({
        connectionStatus: 'disconnected',
        credentialRemovedAt: () => 'now()',
      })
      .where(`provider = 'google_ads'`)
      .andWhere(`connection_status <> 'disconnected'`)
      .andWhere('tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('workspace_id = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere('agency_client_id IS NOT DISTINCT FROM :agencyClientId', {
        agencyClientId: scope.agencyClientId,
      })
      .andWhere('company_context_id IS NOT DISTINCT FROM :companyContextId', {
        companyContextId: scope.companyContextId,
      })
      .execute();
  }

  /**
   * Other live authorizations (any tenant or context) that hold a grant for the
   * same Google identity. Google ties a grant to user + OAuth client, so
   * revoking one token at Google can invalidate the others; we cannot prove it
   * does not, hence this only ever returns a count, never who they are.
   */
  private countOtherLiveHolders(
    manager: EntityManager,
    authorization: SocialGoogleAuthorizationEntity,
  ) {
    return manager
      .getRepository(SocialGoogleAuthorizationEntity)
      .createQueryBuilder('auth')
      .where('auth.googleSub = :sub', { sub: authorization.googleSub })
      .andWhere('auth.id <> :id', { id: authorization.id })
      .andWhere(`auth.status = 'connected'`)
      .getCount();
  }

  /**
   * Disconnects one product. Other products keep working. When it was the last
   * connected product the stored credentials have no purpose left and are
   * discarded locally — but the grant at Google is never touched here: it may
   * be shared with other products, contexts or tenants, and removing it is the
   * separate, explicitly confirmed `revoke` action.
   */
  async disconnectProduct(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    product: GoogleProduct;
  }) {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const authorization = await this.lockLive(manager, input.scope);
      if (!authorization) throw new NotFoundException('not_connected');

      const links = manager.getRepository(SocialGoogleProductLinkEntity);
      const link = await links.findOne({
        where: { authorizationId: authorization.id, product: input.product },
      });
      if (!link || link.status !== 'connected') {
        throw new NotFoundException('product_not_connected');
      }

      link.status = 'disconnected';
      link.disconnectedAt = new Date();
      link.resources = [];
      await links.save(link);
      await this.clearSelections(manager, input.scope, [input.product]);
      await this.audit(
        manager,
        input.scope,
        authorization.id,
        'product_disconnected',
        input.product,
        input.userId,
      );

      const remaining = await links.count({
        where: { authorizationId: authorization.id, status: 'connected' },
      });
      if (remaining > 0) {
        return { authorizationRevoked: false };
      }
      await this.tearDown(
        manager,
        input.scope,
        authorization,
        input.userId,
        'credentials_discarded',
      );
      return { authorizationRevoked: true };
    });

    return {
      product: input.product,
      status: 'disconnected' as const,
      // True when the last product went away and local credentials were wiped.
      authorizationRevoked: outcome.authorizationRevoked,
      // Never revoked at Google by a product disconnect. The Google grant stays
      // until `revoke` with `revokeAtGoogle`, or the user removes it in their
      // Google account.
      providerRevoked: null,
      remoteGrantRetained: outcome.authorizationRevoked,
      // Google cannot drop a single scope from a live grant; the other
      // connected products keep theirs until the authorization is revoked.
      remainingProducts: outcome.authorizationRevoked
        ? []
        : (await this.getStatus(input.scope)).revokeImpact.products,
    };
  }

  /**
   * Disconnects every product and discards local credentials; needs explicit
   * confirmation. The grant at Google is revoked only when `revokeAtGoogle` is
   * also set, and even then not while another live authorization holds a grant
   * for the same Google identity (`skipped_shared_identity`): the impact on the
   * others cannot be ruled out, so it is never done automatically.
   */
  async revoke(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    confirm: boolean;
    revokeAtGoogle?: boolean;
  }) {
    if (input.confirm !== true) {
      throw new BadRequestException('confirmation_required');
    }

    const { token, impacted, shared } = await this.dataSource.transaction(
      async (manager) => {
        const authorization = await this.lockLive(manager, input.scope);
        if (!authorization) throw new NotFoundException('not_connected');

        const links = manager.getRepository(SocialGoogleProductLinkEntity);
        const connected = await links.find({
          where: { authorizationId: authorization.id, status: 'connected' },
        });
        const now = new Date();
        for (const link of connected) {
          link.status = 'disconnected';
          link.disconnectedAt = now;
          link.resources = [];
        }
        if (connected.length) await links.save(connected);
        await this.clearSelections(
          manager,
          input.scope,
          connected.map((link) => link.product),
        );

        const shared =
          (await this.countOtherLiveHolders(manager, authorization)) > 0;
        const wantsRemote = input.revokeAtGoogle === true && !shared;
        const revokedToken = await this.tearDown(
          manager,
          input.scope,
          authorization,
          input.userId,
          wantsRemote ? 'authorization_revoked' : 'credentials_discarded',
        );
        return {
          token: wantsRemote ? revokedToken : null,
          impacted: connected.map((link) => link.product),
          shared,
        };
      },
    );

    const providerRevoked = token ? await this.revokeAtProvider(token) : null;
    const remoteRevocation =
      input.revokeAtGoogle !== true
        ? ('not_requested' as const)
        : shared
          ? ('skipped_shared_identity' as const)
          : providerRevoked
            ? ('revoked' as const)
            : ('failed' as const);
    return {
      status: 'revoked' as const,
      disconnectedProducts: impacted,
      providerRevoked,
      remoteRevocation,
    };
  }

  /**
   * Returns a usable access token for a connected product, refreshing it when
   * it is expired or about to be. Later phases call this and nothing else.
   */
  async getAccessToken(input: {
    scope: CompanyAwareScope;
    product: GoogleProduct;
  }): Promise<{ accessToken: string; expiresAt: Date | null }> {
    const requiredScope = GOOGLE_PRODUCT_SCOPES[input.product];

    const result = await this.runRefreshTransaction(async (manager) => {
      // The lock is what serializes concurrent refreshes: the second caller
      // blocks here, then finds the fresh token the first one stored.
      const authorization = await this.lockLive(manager, input.scope);
      if (!authorization) throw new GoogleCredentialError('not_connected');
      if (authorization.status === 'reauth_required') {
        throw new GoogleCredentialError('reauth_required');
      }

      const link = await manager
        .getRepository(SocialGoogleProductLinkEntity)
        .findOne({
          where: { authorizationId: authorization.id, product: input.product },
        });
      if (!link || link.status !== 'connected') {
        throw new GoogleCredentialError('product_not_connected');
      }
      if (!authorization.grantedScopes.includes(requiredScope)) {
        throw new GoogleCredentialError('scope_not_granted');
      }

      const current = this.readValidAccessToken(authorization);
      if (current) return { token: current };

      const repo = manager.getRepository(SocialGoogleAuthorizationEntity);
      const refreshToken = this.safeDecrypt(
        authorization.refreshTokenEncrypted,
      );
      if (!refreshToken) {
        await this.markReauth(
          manager,
          input.scope,
          authorization,
          'missing_refresh_token',
        );
        // Returned, not thrown: a throw would roll the new state back.
        return { error: 'reauth_required' as const };
      }

      let tokens: GoogleTokenSet;
      try {
        tokens = await this.google.refresh(refreshToken);
      } catch (error) {
        if (
          error instanceof GoogleOAuthError &&
          error.code === 'invalid_grant'
        ) {
          await this.markReauth(
            manager,
            input.scope,
            authorization,
            'invalid_grant',
          );
          return { error: 'reauth_required' as const };
        }
        // Transient failure: keep the connection as it is.
        this.logger.warn(
          `Google token refresh failed: ${error instanceof GoogleOAuthError ? error.code : 'unknown_error'}`,
        );
        throw new GoogleCredentialError('refresh_failed');
      }

      authorization.accessTokenEncrypted = this.crypto.encrypt(
        tokens.accessToken,
      );
      // Preserve the stored refresh token unless Google rotated it.
      if (tokens.refreshToken) {
        authorization.refreshTokenEncrypted = this.crypto.encrypt(
          tokens.refreshToken,
        );
      }
      authorization.tokenExpiresAt = tokens.expiresInSeconds
        ? new Date(Date.now() + tokens.expiresInSeconds * 1000)
        : null;
      // The refresh response is authoritative about what is still granted.
      if (tokens.scopes.length) authorization.grantedScopes = tokens.scopes;
      authorization.lastError = null;
      await repo.save(authorization);

      if (!authorization.grantedScopes.includes(requiredScope)) {
        throw new GoogleCredentialError('scope_not_granted');
      }
      return {
        token: {
          accessToken: tokens.accessToken,
          expiresAt: authorization.tokenExpiresAt,
        },
      };
    });

    if ('error' in result) throw new GoogleCredentialError('reauth_required');
    return result.token;
  }

  /** A lock wait that times out is a transient refresh failure for callers. */
  private async runRefreshTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new GoogleCredentialError('refresh_failed');
      }
      throw error;
    }
  }

  private readValidAccessToken(auth: SocialGoogleAuthorizationEntity) {
    const token = this.safeDecrypt(auth.accessTokenEncrypted);
    if (
      token &&
      auth.tokenExpiresAt &&
      auth.tokenExpiresAt.getTime() - GOOGLE_ACCESS_TOKEN_SKEW_MS > Date.now()
    ) {
      return { accessToken: token, expiresAt: auth.tokenExpiresAt };
    }
    // Unknown expiry is treated as expired: never use a token we cannot date.
    return null;
  }

  private safeDecrypt(value: string | null) {
    try {
      return this.crypto.decrypt(value);
    } catch {
      return null;
    }
  }

  private async lockLive(manager: EntityManager, scope: CompanyAwareScope) {
    // Bounded wait: never queue forever behind a slow Google call. SET LOCAL
    // dies with the transaction, so it cannot leak to the pooled connection.
    await manager.query(
      `SET LOCAL lock_timeout = ${Math.trunc(this.lockTimeoutMs)}`,
    );
    try {
      return await this.lockLiveQuery(manager, scope);
    } catch (error) {
      if ((error as { code?: string }).code === '55P03') {
        throw new ServiceUnavailableException('authorization_busy');
      }
      throw error;
    }
  }

  private lockLiveQuery(manager: EntityManager, scope: CompanyAwareScope) {
    return whereScope(
      manager
        .getRepository(SocialGoogleAuthorizationEntity)
        .createQueryBuilder('auth')
        .addSelect(TOKEN_COLUMNS)
        .where(`auth.status <> 'revoked'`),
      'auth',
      scope,
    )
      .setLock('pessimistic_write')
      .getOne();
  }

  /** Marks revoked, wipes tokens, returns the token to revoke at Google. */
  private async tearDown(
    manager: EntityManager,
    scope: CompanyAwareScope,
    authorization: SocialGoogleAuthorizationEntity,
    actorId: string | null,
    event: 'authorization_revoked' | 'credentials_discarded',
  ): Promise<string | null> {
    const token =
      this.safeDecrypt(authorization.refreshTokenEncrypted) ??
      this.safeDecrypt(authorization.accessTokenEncrypted);
    authorization.status = 'revoked';
    authorization.revokedAt = new Date();
    authorization.accessTokenEncrypted = null;
    authorization.refreshTokenEncrypted = null;
    authorization.tokenExpiresAt = null;
    authorization.grantedScopes = [];
    await manager
      .getRepository(SocialGoogleAuthorizationEntity)
      .save(authorization);
    await this.audit(manager, scope, authorization.id, event, null, actorId);
    return token;
  }

  private async markReauth(
    manager: EntityManager,
    scope: CompanyAwareScope,
    authorization: SocialGoogleAuthorizationEntity,
    reason: string,
  ) {
    authorization.status = 'reauth_required';
    authorization.lastError = reason;
    authorization.accessTokenEncrypted = null;
    authorization.refreshTokenEncrypted = null;
    authorization.tokenExpiresAt = null;
    await manager
      .getRepository(SocialGoogleAuthorizationEntity)
      .save(authorization);
    await this.audit(
      manager,
      scope,
      authorization.id,
      'reauth_required',
      null,
      null,
      reason,
    );
  }

  private async revokeAtProvider(token: string) {
    // After commit and best effort: the local state is already authoritative.
    const ok = await this.google.revoke(token);
    if (!ok) this.logger.warn('Google token revocation did not complete.');
    return ok;
  }

  private async audit(
    manager: EntityManager,
    scope: CompanyAwareScope,
    authorizationId: string,
    event: string,
    product: string | null,
    actorId: string | null,
    detail: string | null = null,
  ) {
    await manager.getRepository(SocialGoogleAuditEventEntity).save({
      tenantId: scope.tenantId,
      authorizationId,
      event,
      product,
      actorId,
      detail,
    });
  }
}
