import type {
  SocialOrganicAssetEntity,
  SocialOrganicAuthorizationMethod,
  SocialOrganicConnectionEntity,
  SocialOrganicConnectionStatus,
} from '../../entities';
import type { SocialOrganicDiscoveredAsset } from '../social-organic-oauth.provider';

export type SocialOrganicConnectionState =
  | 'connecting'
  | 'awaiting_selection'
  | 'connected'
  | 'error'
  | 'disconnected';

export type SocialOrganicAssetView = {
  id: string;
  assetType: string;
  maskedExternalAssetId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  isPublishEnabled: boolean;
};

export type SocialOrganicAvailableAssetView = {
  externalAssetId: string;
  assetType: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type SocialOrganicConnectionView = {
  id: string;
  provider: string;
  state: SocialOrganicConnectionState;
  status: SocialOrganicConnectionStatus;
  authorizationMethod: SocialOrganicAuthorizationMethod;
  agencyClientId: string | null;
  scopes: string[];
  hasCredential: boolean;
  tokenExpiresAt: string | null;
  lastError: string | null;
  assets: SocialOrganicAssetView[];
  availableAssets?: SocialOrganicAvailableAssetView[];
  createdAt: string;
  updatedAt: string;
};

export function maskOrganicExternalAssetId(value: string): string {
  if (value.length <= 4) return value;

  return `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

export function resolveOrganicConnectionState(
  connection: Pick<
    SocialOrganicConnectionEntity,
    'connectionStatus' | 'credentialRemovedAt'
  >,
): SocialOrganicConnectionState {
  if (connection.credentialRemovedAt) return 'disconnected';

  return connection.connectionStatus === 'pending'
    ? 'connecting'
    : connection.connectionStatus;
}

export function toSocialOrganicConnectionView(
  connection: SocialOrganicConnectionEntity,
): SocialOrganicConnectionView {
  const state = resolveOrganicConnectionState(connection);

  return {
    id: connection.id,
    provider: connection.provider,
    state,
    status: connection.connectionStatus,
    authorizationMethod: connection.authorizationMethod,
    agencyClientId: connection.agencyClientId,
    scopes: Array.isArray(connection.scopes) ? [...connection.scopes] : [],
    hasCredential:
      connection.connectionStatus === 'connected' &&
      !connection.credentialRemovedAt,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastError: connection.lastError,
    assets: (connection.assets ?? []).map(toSocialOrganicAssetView),
    ...(state === 'awaiting_selection'
      ? { availableAssets: readSelectableAssets(connection.metadata) }
      : {}),
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

function toSocialOrganicAssetView(
  asset: SocialOrganicAssetEntity,
): SocialOrganicAssetView {
  return {
    id: asset.id,
    assetType: asset.assetType,
    maskedExternalAssetId: maskOrganicExternalAssetId(asset.externalAssetId),
    displayName: asset.displayName,
    username: asset.username,
    avatarUrl: asset.avatarUrl,
    status: asset.status,
    isPublishEnabled: asset.isPublishEnabled,
  };
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

/** Rebuilds provider metadata field by field before it can reach a client. */
export function readSelectableAssets(
  metadata: Record<string, unknown> | null | undefined,
): SocialOrganicAvailableAssetView[] {
  const raw = metadata?.selectableAssets;

  if (!Array.isArray(raw)) return [];

  const assets: SocialOrganicAvailableAssetView[] = [];

  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue;

    const entry = candidate as Record<string, unknown>;
    const externalAssetId = readString(entry, 'externalAssetId');
    const assetType = readString(entry, 'assetType');

    if (!externalAssetId || !assetType) continue;

    assets.push({
      externalAssetId,
      assetType,
      displayName: readString(entry, 'displayName'),
      username: readString(entry, 'username'),
      avatarUrl: readString(entry, 'avatarUrl'),
    });
  }

  return assets;
}

/** Internal reconstruction used only by the selection lifecycle. */
export function readSelectableAssetsForSelection(
  metadata: Record<string, unknown> | null | undefined,
): SocialOrganicDiscoveredAsset[] {
  const visible = readSelectableAssets(metadata);
  const raw = Array.isArray(metadata?.selectableAssets)
    ? metadata.selectableAssets
    : [];

  return visible.map((asset) => {
    const matching = raw.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as Record<string, unknown>).externalAssetId ===
          asset.externalAssetId,
    ) as Record<string, unknown> | undefined;

    return {
      ...asset,
      capabilities:
        matching?.capabilities &&
        typeof matching.capabilities === 'object' &&
        !Array.isArray(matching.capabilities)
          ? (matching.capabilities as Record<string, unknown>)
          : {},
      selectionData:
        matching?.selectionData &&
        typeof matching.selectionData === 'object' &&
        !Array.isArray(matching.selectionData)
          ? (matching.selectionData as Record<string, unknown>)
          : {},
    };
  });
}
