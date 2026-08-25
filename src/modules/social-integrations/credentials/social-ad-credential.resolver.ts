import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialInternalAccessService } from '../internal/social-internal-access.service';
import { isSameAdAccountId, normalizeAdAccountId } from '../meta-ad-account-id';
import {
  ResolvedAdCredential,
  createResolvedAdCredential,
} from './resolved-ad-credential';
import { SocialAdCredentialError } from './social-ad-credential.error';

/**
 * Treat a token as expired slightly early.
 *
 * A sync that starts with forty seconds of validity left does not fail at the
 * start, where the failure is legible; it fails somewhere in the middle of a
 * paginated read, after writing part of a window. Refusing up front turns that
 * into one clear "reconnect" instead of a half-written run.
 */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

export type SocialAdCredentialScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
};

export type ResolveAdCredentialInput = SocialAdCredentialScope & {
  connectionId: string;
};

/**
 * The one place that turns a connection row into a usable credential.
 *
 * Lyra Social authorizes ad accounts two ways — Facebook Login for Business for
 * every tenant, and a System User token for the tenant that owns the Meta App —
 * and those two ways store their credential in completely different places: one
 * in an encrypted column, one in server configuration that is never persisted.
 *
 * The rule this class exists to enforce: **that difference stops here.**
 * `authorizationMethod` is branched on exactly once, in `resolve`, and
 * everything downstream — entity reader, insights reader, sync service, worker
 * — receives a `ResolvedAdCredential` and cannot tell the two apart. A second
 * branch anywhere else is not an optimization, it is the bug this boundary was
 * built to prevent: two credential paths drift, and the one that drifts is
 * always the one with fewer callers, which here is the one that carries an
 * agency-wide System User token.
 *
 * `social-ad-credential.boundary.spec.ts` fails the build if a second branch
 * appears.
 */
@Injectable()
export class SocialAdCredentialResolver {
  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
    private readonly cryptoService: SettingsCryptoService,
    private readonly internalAccess: SocialInternalAccessService,
  ) {}

  /**
   * Resolves the credential for one connection inside one scope.
   *
   * The scope is part of the lookup, not a check afterwards: a connection that
   * belongs to another tenant, another workspace or another managed client is
   * simply not found, and the caller never learns whether the id exists. That
   * is the same answer `SocialAdConnectionService.findInScope` gives, and it is
   * why a worker can be handed a connection id from a queue without that id
   * becoming a way to read across tenants.
   */
  async resolve(
    input: ResolveAdCredentialInput,
  ): Promise<ResolvedAdCredential> {
    const connection = await this.findInScope(input);

    if (!connection) {
      throw new SocialAdCredentialError('connection_not_found');
    }

    if (connection.provider !== 'meta_ads') {
      // Google Ads exists in the provider union and nowhere else. Refusing by
      // name beats resolving a Meta credential for a row that is not Meta.
      throw new SocialAdCredentialError('unsupported_provider');
    }

    if (connection.credentialRemovedAt) {
      throw new SocialAdCredentialError('credential_removed');
    }

    if (connection.connectionStatus !== 'connected') {
      throw new SocialAdCredentialError('connection_not_connected');
    }

    const externalAccountId = normalizeAdAccountId(
      connection.externalAccountId,
    );

    if (!externalAccountId) {
      throw new SocialAdCredentialError('account_not_bound');
    }

    const timezone = this.requireTimezone(connection.timezone);

    // Built from the row rather than from the argument. They are equal by
    // construction — the row was found *by* the argument — but the guardrails
    // below decide what a System User token may touch, and they should read the
    // stored truth rather than what a caller claimed about it.
    const scope: SocialAdCredentialScope = {
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      agencyClientId: connection.agencyClientId,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // The only runtime branch on `authorization_method` in the codebase.
    // ─────────────────────────────────────────────────────────────────────────
    switch (connection.authorizationMethod) {
      case 'business_login':
        return createResolvedAdCredential({
          ...this.describe(connection, externalAccountId, timezone),
          tokenExpiresAt: connection.tokenExpiresAt,
          accessToken: await this.resolveBusinessLoginToken(connection),
        });

      case 'internal_system_user':
        return createResolvedAdCredential({
          ...this.describe(connection, externalAccountId, timezone),
          // A System User token has no expiry to enforce, and the row stores
          // none. Reading `connection.tokenExpiresAt` here would propagate
          // whatever a previous authorization happened to leave behind.
          tokenExpiresAt: null,
          accessToken: this.resolveInternalSystemUserToken(
            scope,
            externalAccountId,
          ),
        });

      default:
        // A method the union does not cover reached the database. Guessing a
        // branch would mean guessing where a credential lives.
        throw new SocialAdCredentialError('unsupported_authorization_method');
    }
  }

  /**
   * Facebook Login for Business: the token is in the row, encrypted.
   *
   * The column is `select: false`, so it is loaded here by a query that asks
   * for nothing else — the entity that travelled through the checks above never
   * carried the ciphertext, and the internal path never issues this query at
   * all.
   */
  private async resolveBusinessLoginToken(
    connection: SocialAdAccountConnectionEntity,
  ): Promise<string> {
    this.assertNotExpired(connection.tokenExpiresAt);

    const row = await this.connectionsRepository
      .createQueryBuilder('connection')
      .select('connection.accessTokenEncrypted')
      .where('connection.id = :id', { id: connection.id })
      .getOne();

    const encrypted = row?.accessTokenEncrypted;

    if (!encrypted) {
      throw new SocialAdCredentialError('token_missing');
    }

    let decrypted: string | null;

    try {
      decrypted = this.cryptoService.decrypt(encrypted);
    } catch {
      // A rotated `SETTINGS_ENCRYPTION_KEY` and a corrupted ciphertext are the
      // same repair — reconnect — and neither may surface the crypto error,
      // which carries fragments of the payload.
      throw new SocialAdCredentialError('credential_decryption_failed');
    }

    if (!decrypted) {
      throw new SocialAdCredentialError('credential_decryption_failed');
    }

    return decrypted;
  }

  /**
   * The internal exception: the token is in server configuration.
   *
   * Every guardrail comes from `SocialInternalAccessService`, which is the one
   * component that decides who may use this method and which account it covers.
   * None of them is re-implemented here — a copy of a guardrail is a guardrail
   * that will be updated in one place and not the other.
   *
   * The one thing this method adds is *when* the check happens. S1 validated
   * the account at bind time; this validates it again at resolve time, because
   * `SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID` can be re-pointed at another account
   * long after a connection was made. A drifted configuration must stop the
   * read, not quietly send the System User token at whatever account the row
   * still names.
   */
  private resolveInternalSystemUserToken(
    scope: SocialAdCredentialScope,
    externalAccountId: string,
  ): string {
    if (!this.internalAccess.isInternalScope(scope)) {
      // Reached when a row claims the internal method from a scope that may not
      // use it: another tenant, or a managed client inside the internal tenant.
      // Both are refusals, not misconfigurations.
      throw new SocialAdCredentialError('internal_scope_denied');
    }

    const allowedAccountId = this.readInternalAccountId(scope);

    if (!isSameAdAccountId(externalAccountId, allowedAccountId)) {
      throw new SocialAdCredentialError('internal_account_drift');
    }

    return this.readSystemUserToken(scope);
  }

  private readSystemUserToken(scope: SocialAdCredentialScope): string {
    try {
      return this.internalAccess.requireSystemUserToken(scope);
    } catch {
      // The gate throws `NotFoundException` so an HTTP caller learns nothing.
      // Here the scope has already been proven internal, so the only remaining
      // cause is an unset variable, and an operator needs to be told which.
      throw new SocialAdCredentialError('system_user_token_missing');
    }
  }

  private readInternalAccountId(scope: SocialAdCredentialScope): string {
    try {
      return this.internalAccess.requireInternalAccountId(scope);
    } catch {
      throw new SocialAdCredentialError('internal_account_not_configured');
    }
  }

  private assertNotExpired(tokenExpiresAt: Date | null) {
    if (!tokenExpiresAt) return;

    if (tokenExpiresAt.getTime() - TOKEN_EXPIRY_SKEW_MS <= Date.now()) {
      throw new SocialAdCredentialError('token_expired');
    }
  }

  /**
   * The ad account's timezone, or a refusal.
   *
   * No fallback to UTC, deliberately, and not as caution for its own sake: a
   * day in Meta's reporting is a day in the account's own zone, so guessing the
   * zone means attributing spend to the wrong date — silently, permanently, and
   * only in the hours that straddle midnight. `America/Sao_Paulo` read as UTC
   * moves every evening's spend to the following day.
   *
   * Whether an ingest may ever default is a decision for the ingest, made in
   * the open. Until then, an unknown zone is a stop.
   */
  private requireTimezone(timezone: string | null): string {
    const candidate = timezone?.trim();

    if (!candidate) {
      throw new SocialAdCredentialError('timezone_missing');
    }

    try {
      // The runtime's own IANA database is the authority. A zone this process
      // cannot format with is a zone no date arithmetic here can trust.
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    } catch {
      throw new SocialAdCredentialError('timezone_unsupported');
    }

    return candidate;
  }

  private describe(
    connection: SocialAdAccountConnectionEntity,
    externalAccountId: string,
    timezone: string,
  ) {
    return {
      connectionId: connection.id,
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      agencyClientId: connection.agencyClientId,
      provider: connection.provider,
      authorizationMethod: connection.authorizationMethod,
      externalAccountId,
      currency: connection.currency,
      timezone,
      credentialVersion: connection.credentialVersion,
    };
  }

  private findInScope(input: ResolveAdCredentialInput) {
    return this.connectionsRepository.findOne({
      where: {
        id: input.connectionId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // `IsNull()` rather than `null`: agency scope has to match rows where
        // the column is NULL, and TypeORM reads a literal null as "no filter".
        agencyClientId: input.agencyClientId ?? IsNull(),
      },
    });
  }
}
