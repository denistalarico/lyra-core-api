import { inspect } from 'node:util';

/** Everything an adapter needs to act as one publishable organic asset. */
export type ResolvedOrganicCredential = {
  readonly assetId: string;
  readonly connectionId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly agencyClientId: string | null;
  readonly provider: string;
  readonly assetType: string;
  readonly externalAssetId: string;
  readonly scopes: readonly string[];
  readonly credentialVersion: number;
  readonly accessToken: string;
  toJSON(): Record<string, unknown>;
};

export type ResolvedOrganicCredentialSummary = Omit<
  ResolvedOrganicCredential,
  'accessToken' | 'toJSON'
>;

/**
 * Creates a credential whose token is readable by adapters but not enumerable,
 * serializable or inspectable by loggers, even with hidden properties enabled.
 */
export function createResolvedOrganicCredential(
  input: ResolvedOrganicCredentialSummary & { accessToken: string },
): ResolvedOrganicCredential {
  const summary: ResolvedOrganicCredentialSummary = {
    assetId: input.assetId,
    connectionId: input.connectionId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agencyClientId: input.agencyClientId,
    provider: input.provider,
    assetType: input.assetType,
    externalAssetId: input.externalAssetId,
    scopes: Object.freeze([...input.scopes]),
    credentialVersion: input.credentialVersion,
  };
  const credential = { ...summary } as ResolvedOrganicCredential;
  const redacted = () => ({ ...summary, accessToken: '[REDACTED]' });

  Object.defineProperty(credential, 'accessToken', {
    value: input.accessToken,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(credential, 'toJSON', {
    value: redacted,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(credential, inspect.custom, {
    value: redacted,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(credential);
}

export function summarizeOrganicCredential(
  credential: ResolvedOrganicCredential,
): ResolvedOrganicCredentialSummary {
  return {
    assetId: credential.assetId,
    connectionId: credential.connectionId,
    tenantId: credential.tenantId,
    workspaceId: credential.workspaceId,
    agencyClientId: credential.agencyClientId,
    provider: credential.provider,
    assetType: credential.assetType,
    externalAssetId: credential.externalAssetId,
    scopes: credential.scopes,
    credentialVersion: credential.credentialVersion,
  };
}
