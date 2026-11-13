import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { requireSocialFrontendUrl } from '../social-integrations/oauth/meta-ads-oauth.support';
import {
  GoogleOAuthClient,
  GoogleOAuthError,
  type GoogleIdentity,
  type GoogleTokenSet,
  generateOpaque,
  pkceChallenge,
  sha256Hex,
  validateIdToken,
} from './google-oauth.client';
import {
  GOOGLE_OAUTH_SESSION_TTL_MS,
  GOOGLE_PRODUCT_SCOPES,
  SOCIAL_GOOGLE_CHANNEL_PATH,
  scopesForProduct,
  type GoogleProduct,
} from './google-oauth.constants';
import {
  SocialGoogleAuditEventEntity,
  SocialGoogleAuthorizationEntity,
  SocialGoogleOAuthSessionEntity,
  SocialGoogleProductLinkEntity,
} from './entities';
import { toGoogleStatusView, whereScope } from './social-google.support';

export type GoogleCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
};

type CallbackOutcome =
  | { ok: true; sessionId: string; product: GoogleProduct }
  | { ok: false; reason: string; product?: GoogleProduct };

const MAX_STATE_LENGTH = 512;

/**
 * Start → callback → confirm for Google OAuth.
 *
 * The public callback authenticates by `state` alone and only parks the
 * encrypted tokens on the session; binding them to the tenant's authorization
 * is the separate, authenticated `confirm` step performed by the same user who
 * started the flow.
 */
@Injectable()
export class SocialGoogleOAuthService {
  private readonly logger = new Logger(SocialGoogleOAuthService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly google: GoogleOAuthClient,
    private readonly crypto: SettingsCryptoService,
  ) {}

  async start(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    product: GoogleProduct;
  }) {
    if (!input.userId) throw new BadRequestException('invalid_user');

    const state = generateOpaque();
    const nonce = generateOpaque();
    const verifier = generateOpaque(48);
    const scopes = scopesForProduct(input.product);

    let authorizationUrl: string;
    try {
      authorizationUrl = this.google.buildAuthorizationUrl({
        scopes,
        state,
        nonce,
        codeChallenge: pkceChallenge(verifier),
      });
    } catch (error) {
      if (
        error instanceof GoogleOAuthError &&
        error.code === 'not_configured'
      ) {
        throw new ServiceUnavailableException('google_not_configured');
      }
      throw error;
    }
    requireSocialFrontendUrl();

    const encryptedVerifier = this.crypto.encrypt(verifier);
    if (!encryptedVerifier) throw new ServiceUnavailableException('crypto');

    const expiresAt = new Date(Date.now() + GOOGLE_OAUTH_SESSION_TTL_MS);

    const session = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(SocialGoogleOAuthSessionEntity);
      // Abandoned attempts for the same user/product are discarded so only
      // the newest state can ever complete.
      await sessions
        .createQueryBuilder()
        .delete()
        .where('tenant_id = :tenantId', { tenantId: input.scope.tenantId })
        .andWhere('workspace_id = :workspaceId', {
          workspaceId: input.scope.workspaceId,
        })
        .andWhere('agency_client_id IS NOT DISTINCT FROM :agencyClientId', {
          agencyClientId: input.scope.agencyClientId,
        })
        .andWhere('company_context_id IS NOT DISTINCT FROM :companyContextId', {
          companyContextId: input.scope.companyContextId,
        })
        .andWhere('initiated_by_id = :userId', { userId: input.userId })
        .andWhere('product = :product', { product: input.product })
        .andWhere(`status IN ('pending','awaiting_confirmation')`)
        .execute();

      return sessions.save(
        sessions.create({
          ...input.scope,
          initiatedById: input.userId!,
          product: input.product,
          status: 'pending',
          stateHash: sha256Hex(state),
          codeVerifierEncrypted: encryptedVerifier,
          nonceHash: sha256Hex(nonce),
          expiresAt,
          grantedScopes: [],
        }),
      );
    });

    return {
      sessionId: session.id,
      product: input.product,
      requestedScopes: scopes,
      authorizationUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Never throws: a public redirect endpoint must not render a stack page. */
  async handleCallback(input: GoogleCallbackInput): Promise<string> {
    let outcome: CallbackOutcome;
    try {
      outcome = await this.complete(input);
    } catch (error) {
      this.logger.warn(
        `Google OAuth callback failed: ${
          error instanceof Error ? error.name : 'unknown_error'
        }`,
      );
      outcome = { ok: false, reason: 'callback_failed' };
    }
    return this.buildFrontendRedirect(outcome);
  }

  private async complete(input: GoogleCallbackInput): Promise<CallbackOutcome> {
    const state = input.state;
    if (
      typeof state !== 'string' ||
      state.length < 16 ||
      state.length > MAX_STATE_LENGTH
    ) {
      return { ok: false, reason: 'invalid_state' };
    }
    const stateHash = sha256Hex(state);

    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(SocialGoogleOAuthSessionEntity);
      const session = await sessions
        .createQueryBuilder('session')
        .addSelect('session.codeVerifierEncrypted')
        .where('session.stateHash = :stateHash', { stateHash })
        .setLock('pessimistic_write')
        .getOne();

      if (!session) return { ok: false, reason: 'invalid_state' };
      const product = session.product;

      // Single use: any non-pending session (replay, double submit) is dead.
      if (session.status !== 'pending') {
        return { ok: false, reason: 'state_consumed', product };
      }

      const fail = async (reason: string): Promise<CallbackOutcome> => {
        session.status = 'failed';
        session.failureReason = reason;
        session.codeVerifierEncrypted = null;
        await sessions.save(session);
        return { ok: false, reason, product };
      };

      if (session.expiresAt.getTime() <= Date.now()) {
        return fail('session_expired');
      }
      if (input.error) return fail('oauth_denied');
      if (!input.code || input.code.length > 2048) {
        return fail('missing_code');
      }

      let verifier: string | null = null;
      try {
        verifier = this.crypto.decrypt(session.codeVerifierEncrypted);
      } catch {
        verifier = null;
      }
      if (!verifier) return fail('credential_decryption_failed');

      let tokens: GoogleTokenSet;
      try {
        tokens = await this.google.exchangeCode({
          code: input.code,
          codeVerifier: verifier,
        });
      } catch {
        return fail('token_exchange_failed');
      }

      let identity: GoogleIdentity;
      try {
        identity = validateIdToken(tokens.idToken, {
          clientId: this.google.getConfig().clientId,
          nonceHash: session.nonceHash,
        });
      } catch {
        return fail('invalid_identity');
      }

      // Google reports what was *actually* granted; the user can untick a
      // scope on the consent screen. Never assume the request was honored.
      if (!tokens.scopes.includes(GOOGLE_PRODUCT_SCOPES[product])) {
        return fail('scope_denied');
      }

      const accessEncrypted = this.crypto.encrypt(tokens.accessToken);
      const refreshEncrypted = this.crypto.encrypt(tokens.refreshToken);
      if (!accessEncrypted) return fail('credential_encryption_failed');

      session.status = 'awaiting_confirmation';
      session.codeVerifierEncrypted = null;
      session.googleSub = identity.sub;
      session.accessTokenEncrypted = accessEncrypted;
      session.refreshTokenEncrypted = refreshEncrypted;
      session.tokenExpiresAt = tokens.expiresInSeconds
        ? new Date(Date.now() + tokens.expiresInSeconds * 1000)
        : null;
      session.grantedScopes = tokens.scopes;
      session.failureReason = null;
      await sessions.save(session);

      return { ok: true, sessionId: session.id, product };
    });
  }

  /** Authenticated step: binds the parked tokens to the caller's context. */
  async confirm(input: {
    scope: CompanyAwareScope;
    userId: string | null;
    sessionId: string;
  }) {
    const result = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(SocialGoogleOAuthSessionEntity);
      const authorizations = manager.getRepository(
        SocialGoogleAuthorizationEntity,
      );
      const links = manager.getRepository(SocialGoogleProductLinkEntity);

      const session = await whereScope(
        sessions
          .createQueryBuilder('session')
          .addSelect([
            'session.accessTokenEncrypted',
            'session.refreshTokenEncrypted',
          ])
          .where('session.id = :id', { id: input.sessionId }),
        'session',
        input.scope,
      )
        .setLock('pessimistic_write')
        .getOne();

      // Wrong context, wrong user and unknown id are indistinguishable.
      if (!session || !input.userId || session.initiatedById !== input.userId) {
        return { ok: false as const, code: 'invalid_session' };
      }
      if (session.status === 'consumed') {
        return { ok: false as const, code: 'session_consumed' };
      }
      if (session.status !== 'awaiting_confirmation') {
        return { ok: false as const, code: 'invalid_session' };
      }

      const wipe = async (
        status: 'failed' | 'consumed',
        reason: string | null,
      ) => {
        session.status = status;
        session.failureReason = reason;
        session.accessTokenEncrypted = null;
        session.refreshTokenEncrypted = null;
        await sessions.save(session);
      };

      if (session.expiresAt.getTime() <= Date.now()) {
        await wipe('failed', 'session_expired');
        // Committed: the expired tokens must really be gone.
        return { ok: false as const, code: 'session_expired', commit: true };
      }

      let accessToken: string | null = null;
      let refreshToken: string | null = null;
      try {
        accessToken = this.crypto.decrypt(session.accessTokenEncrypted);
        refreshToken = this.crypto.decrypt(session.refreshTokenEncrypted);
      } catch {
        accessToken = null;
      }
      if (!accessToken || !session.googleSub) {
        await wipe('failed', 'credential_decryption_failed');
        return {
          ok: false as const,
          code: 'credential_decryption_failed',
          commit: true,
        };
      }

      const existing = await whereScope(
        authorizations
          .createQueryBuilder('auth')
          .addSelect([
            'auth.accessTokenEncrypted',
            'auth.refreshTokenEncrypted',
          ])
          .where(`auth.status <> 'revoked'`),
        'auth',
        input.scope,
      )
        .setLock('pessimistic_write')
        .getOne();

      if (existing && existing.googleSub !== session.googleSub) {
        // A different Google account must not be merged into this grant; the
        // user has to revoke the current authorization first.
        await wipe('failed', 'identity_mismatch');
        await this.audit(
          manager,
          input.scope,
          existing.id,
          'identity_mismatch',
          session.product,
          input.userId,
        );
        return { ok: false as const, code: 'identity_mismatch', commit: true };
      }

      const existingRefresh = existing
        ? this.crypto.decrypt(existing.refreshTokenEncrypted)
        : null;
      // Google only returns a refresh token on (re)consent; keep the old one
      // when this response has none. With neither, we could not renew later.
      if (!refreshToken && !existingRefresh) {
        await wipe('failed', 'missing_refresh_token');
        return {
          ok: false as const,
          code: 'missing_refresh_token',
          commit: true,
        };
      }

      const now = new Date();
      const scopes = Array.from(
        new Set([...(existing?.grantedScopes ?? []), ...session.grantedScopes]),
      );

      let authorization: SocialGoogleAuthorizationEntity;
      if (existing) {
        existing.accessTokenEncrypted = this.crypto.encrypt(accessToken);
        existing.refreshTokenEncrypted = refreshToken
          ? this.crypto.encrypt(refreshToken)
          : existing.refreshTokenEncrypted;
        existing.tokenExpiresAt = session.tokenExpiresAt;
        existing.grantedScopes = scopes;
        existing.status = 'connected';
        existing.lastError = null;
        existing.credentialVersion += 1;
        existing.connectedById = input.userId;
        authorization = await authorizations.save(existing);
      } else {
        authorization = await authorizations.save(
          authorizations.create({
            ...input.scope,
            googleSub: session.googleSub,
            status: 'connected',
            accessTokenEncrypted: this.crypto.encrypt(accessToken),
            refreshTokenEncrypted: this.crypto.encrypt(refreshToken),
            tokenExpiresAt: session.tokenExpiresAt,
            grantedScopes: scopes,
            credentialVersion: 1,
            connectedById: input.userId,
            connectedAt: now,
            revokedAt: null,
            lastError: null,
          }),
        );
      }

      const link =
        (await links.findOne({
          where: {
            authorizationId: authorization.id,
            product: session.product,
          },
        })) ??
        links.create({
          authorizationId: authorization.id,
          tenantId: input.scope.tenantId,
          product: session.product,
          resources: [],
        });
      link.status = 'connected';
      link.connectedAt = now;
      link.disconnectedAt = null;
      await links.save(link);

      await this.audit(
        manager,
        input.scope,
        authorization.id,
        existing ? 'product_connected_incremental' : 'authorization_created',
        session.product,
        input.userId,
      );
      await wipe('consumed', null);

      const allLinks = await links.find({
        where: { authorizationId: authorization.id },
      });
      return {
        ok: true as const,
        view: toGoogleStatusView(authorization, allLinks),
      };
    });

    if (!result.ok) {
      if (result.code === 'identity_mismatch') {
        throw new ConflictException(result.code);
      }
      throw new BadRequestException(result.code);
    }
    return result.view;
  }

  private async audit(
    manager: import('typeorm').EntityManager,
    scope: CompanyAwareScope,
    authorizationId: string | null,
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

  private buildFrontendRedirect(outcome: CallbackOutcome) {
    const url = new URL(SOCIAL_GOOGLE_CHANNEL_PATH, requireSocialFrontendUrl());
    url.searchParams.set('integration', 'google');
    if (outcome.product) url.searchParams.set('product', outcome.product);
    if (outcome.ok) {
      url.searchParams.set('status', 'confirm');
      url.searchParams.set('session', outcome.sessionId);
    } else {
      url.searchParams.set('status', 'error');
      url.searchParams.set('reason', outcome.reason);
    }
    return url.toString();
  }
}
