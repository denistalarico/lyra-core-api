import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizeAdAccountId } from '../meta-ad-account-id';

/**
 * The tenant allowed to use a System User instead of Facebook Login.
 *
 * There is no "internal tenant" flag anywhere in the domain today — a tenant is
 * a uuid carried on the request context, with no row of its own to mark — so
 * the identity comes from server configuration. That is the smallest safe
 * option available: the value is a stable uuid rather than a commercial name,
 * it lives only in the environment, and nothing in a request can influence it.
 *
 * If a tenants table ever gains an `is_internal` column, this is the single
 * place that has to change.
 */
export const SOCIAL_META_ADS_INTERNAL_TENANT_ID_ENV =
  'SOCIAL_META_ADS_INTERNAL_TENANT_ID';

export const SOCIAL_META_ADS_SYSTEM_USER_TOKEN_ENV =
  'SOCIAL_META_ADS_SYSTEM_USER_TOKEN';

/**
 * The single ad account the exception covers.
 *
 * A System User sees every ad account in the Business Manager it belongs to,
 * and the agency's Business Manager also holds accounts that belong to
 * clients. Without this the exception would be an administrative key to all of
 * them — which is a larger permission than the problem it exists to solve, and
 * one nobody would have chosen deliberately.
 *
 * So the account is named in configuration too, and it is a guardrail rather
 * than a default: nothing in the internal path reads, lists or binds an
 * account that is not this one.
 */
export const SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID_ENV =
  'SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID';

export type SocialInternalScope = {
  tenantId: string;
  agencyClientId: string | null;
};

/**
 * Gate for the `internal_system_user` authorization method.
 *
 * The method exists for exactly one reason: the tenant that owns the Meta App
 * cannot select its own Business Manager through Facebook Login for Business.
 * It is an exception for that tenant's own agency context, never a fallback —
 * a tenant whose OAuth merely failed must still fix its OAuth.
 *
 * Three things must all hold, and this class is where all three are decided:
 * the tenant is the configured internal one, the scope is the agency's own,
 * and the account being touched is the one account configuration names.
 */
@Injectable()
export class SocialInternalAccessService {
  private get internalTenantId() {
    return process.env[SOCIAL_META_ADS_INTERNAL_TENANT_ID_ENV]?.trim();
  }

  private get systemUserToken() {
    return process.env[SOCIAL_META_ADS_SYSTEM_USER_TOKEN_ENV]?.trim();
  }

  private get rawInternalAccountId() {
    return process.env[SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID_ENV]?.trim();
  }

  /** The configured account in canonical form, or null if unusable. */
  private get internalAccountId() {
    return normalizeAdAccountId(this.rawInternalAccountId);
  }

  /**
   * Whether this scope may use the internal method at all.
   *
   * Two conditions, both required. The tenant must be the configured internal
   * one, and the scope must be the agency's own — a managed client inside the
   * internal tenant is still a third party, and lending it the agency's System
   * User would hand it every ad account in the agency's Business Manager.
   *
   * An unconfigured tenant id disables the method entirely rather than
   * matching everyone: an empty string must never compare equal to a real
   * tenant.
   */
  isInternalScope(scope: SocialInternalScope): boolean {
    const internalTenantId = this.internalTenantId;

    if (!internalTenantId) {
      return false;
    }

    return scope.tenantId === internalTenantId && scope.agencyClientId === null;
  }

  /**
   * Whether the option should be offered: the scope is internal *and* usable.
   *
   * All three settings are required. A half-configured exception is not a
   * usable one — a token without an account would be an unbounded key, and an
   * account without a token cannot be read at all — so the method disappears
   * until the set is complete. None of this touches the OAuth path, which
   * reads its own variables and never these.
   */
  isAvailable(scope: SocialInternalScope): boolean {
    return (
      this.isInternalScope(scope) &&
      Boolean(this.systemUserToken) &&
      this.internalAccountId !== null
    );
  }

  /**
   * Reported as "not found", never as "forbidden".
   *
   * The same reasoning the connection lookup uses: answering "forbidden" would
   * confirm to any other tenant that an internal path exists and that somebody
   * else is allowed down it. To every tenant but one, these routes simply are
   * not there.
   */
  requireInternalScope(scope: SocialInternalScope): void {
    if (!this.isInternalScope(scope)) {
      throw new NotFoundException('Not found.');
    }
  }

  /**
   * The System User token, for a scope already proven internal.
   *
   * Callers must pass through `requireInternalScope` first — the argument is
   * required here so that reaching the token without a scope in hand is not
   * something the type system allows.
   */
  requireSystemUserToken(scope: SocialInternalScope): string {
    this.requireInternalScope(scope);

    const token = this.systemUserToken;

    if (!token) {
      // Names the variable, never a fragment of its value.
      throw new NotFoundException(
        `${SOCIAL_META_ADS_SYSTEM_USER_TOKEN_ENV} is not configured.`,
      );
    }

    return token;
  }

  /**
   * The one account the exception may bind, for a scope already proven
   * internal.
   *
   * A malformed value is reported as malformed rather than as missing: an
   * operator who pasted `415877197389621` without the prefix, or a stray quote,
   * deserves to be told which of the two mistakes they made. Neither message
   * echoes the value.
   */
  requireInternalAccountId(scope: SocialInternalScope): string {
    this.requireInternalScope(scope);

    if (!this.rawInternalAccountId) {
      throw new NotFoundException(
        `${SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID_ENV} is not configured.`,
      );
    }

    const accountId = this.internalAccountId;

    if (!accountId) {
      throw new NotFoundException(
        `${SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID_ENV} is not a valid Meta ad account id.`,
      );
    }

    return accountId;
  }
}
