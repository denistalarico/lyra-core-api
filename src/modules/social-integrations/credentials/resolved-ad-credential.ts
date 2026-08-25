import { inspect } from 'node:util';
import type {
  SocialAdAuthorizationMethod,
  SocialAdProvider,
} from '../entities/social-ad-account-connection.entity';

/**
 * Everything a reader needs to call a provider on behalf of one connection.
 *
 * This is the whole point of the boundary: past this type, nothing knows or
 * asks how the connection was authorized. A future entity reader, insights
 * reader, sync service or worker receives one of these and calls Meta. Whether
 * the token came out of an encrypted column or out of server configuration is
 * `SocialAdCredentialResolver`'s problem and no one else's.
 *
 * The scope travels with the credential rather than being passed alongside it,
 * because every row a sync writes has to carry the same tenant, workspace and
 * client the credential was resolved under. Splitting them into two arguments
 * is how a batch ends up written under the scope of the previous batch.
 *
 * `accessToken` is declared here but is deliberately *not enumerable* on the
 * object — see `createResolvedAdCredential`.
 */
export type ResolvedAdCredential = {
  readonly connectionId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly agencyClientId: string | null;
  readonly provider: SocialAdProvider;
  readonly authorizationMethod: SocialAdAuthorizationMethod;
  /** Canonical `act_<digits>`, already validated. */
  readonly externalAccountId: string;
  readonly currency: string | null;
  /** A validated IANA zone. Never defaulted — the resolver refuses instead. */
  readonly timezone: string;
  readonly credentialVersion: number;
  /**
   * When the credential stops working, when there is a date at all.
   *
   * NULL means "no expiry to enforce": always the case for a System User token,
   * and also the case for a long-lived login token that Meta returned without
   * an `expires_in`. It is not a refusal — a connection that works today is not
   * made unusable by Meta declining to say when it stops.
   */
  readonly tokenExpiresAt: Date | null;
  readonly accessToken: string;
  toJSON(): Record<string, unknown>;
};

/** Fields safe to log, echo, or attach to a sync run. Never the token. */
export type ResolvedAdCredentialSummary = Omit<
  ResolvedAdCredential,
  'accessToken' | 'toJSON'
>;

/**
 * Builds the value object with the token hidden from every serializer.
 *
 * `accessToken` is a non-enumerable property, which means `JSON.stringify`
 * drops it, `{ ...credential }` drops it, `console.log` of the object does not
 * show it, and a DTO assembled by spreading this object cannot leak it. Code
 * that genuinely needs the token still reads `credential.accessToken` normally.
 *
 * Non-enumerability alone is not quite enough, though. `util.inspect` — which is
 * what `console.log` and most structured loggers call — prints hidden properties
 * when asked with `showHidden`, and something eventually asks: a debug logger
 * configured once and forgotten, `util.inspect(err, true)` in a catch block, a
 * REPL session on a production box. So the object also implements Node's custom
 * inspection hook, which wins over `showHidden` and redacts the token there too.
 *
 * This is a backstop, not the rule. The rule is that this object never leaves
 * the sync pipeline. But the rule is a convention and conventions are broken by
 * the person who did not read this file, whereas a non-enumerable property is
 * broken by nobody at all — the leak has to be typed out on purpose.
 */
export function createResolvedAdCredential(
  input: ResolvedAdCredentialSummary & { accessToken: string },
): ResolvedAdCredential {
  const summary: ResolvedAdCredentialSummary = {
    connectionId: input.connectionId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agencyClientId: input.agencyClientId,
    provider: input.provider,
    authorizationMethod: input.authorizationMethod,
    externalAccountId: input.externalAccountId,
    currency: input.currency,
    timezone: input.timezone,
    credentialVersion: input.credentialVersion,
    tokenExpiresAt: input.tokenExpiresAt,
  };

  const credential = { ...summary } as ResolvedAdCredential;
  const redacted = () => ({ ...summary, accessToken: '[REDACTED]' });

  Object.defineProperty(credential, 'accessToken', {
    value: input.accessToken,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  Object.defineProperty(credential, 'toJSON', {
    // Non-enumerable itself, so the summary shape stays clean, and explicit so
    // a serializer that ignores enumerability still gets a redacted object.
    value: redacted,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  Object.defineProperty(credential, inspect.custom, {
    // Node calls this instead of walking the object, so it holds under
    // `showHidden: true` — the one option that defeats non-enumerability.
    // Symbol-keyed on purpose: nothing about the object's public shape changes.
    value: redacted,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(credential);
}

/** The credential minus the token, for logs and future `sync_run` rows. */
export function summarizeCredential(
  credential: ResolvedAdCredential,
): ResolvedAdCredentialSummary {
  // Spreading is enough precisely because the token is not enumerable, but the
  // explicit pick keeps that from being an invisible dependency.
  return {
    connectionId: credential.connectionId,
    tenantId: credential.tenantId,
    workspaceId: credential.workspaceId,
    agencyClientId: credential.agencyClientId,
    provider: credential.provider,
    authorizationMethod: credential.authorizationMethod,
    externalAccountId: credential.externalAccountId,
    currency: credential.currency,
    timezone: credential.timezone,
    credentialVersion: credential.credentialVersion,
    tokenExpiresAt: credential.tokenExpiresAt,
  };
}
