import type { AssetAccessService } from '../../common/files/asset-access.service';

/** Grants are response data; keep the stored message and its JSON untouched. */
export function authorizeInboxMessage<
  T extends {
    tenantId: string;
    workspaceId: string;
    metadata: Record<string, unknown>;
    attachments: unknown;
  },
>(
  assetAccess: AssetAccessService,
  message: T,
  viewerUserId?: string | null,
): T {
  const authorize = (value: unknown): unknown => {
    if (typeof value !== 'string' || !viewerUserId) return value;
    const base = value.split('?')[0];
    const prefix = '/api/assets/';
    const index = base.indexOf(prefix);
    if (index < 0) return value;
    if (index > 0) {
      const publicBase =
        process.env.API_PUBLIC_URL ||
        process.env.AGENCY_PUBLIC_API_URL ||
        process.env.META_WEBHOOK_CALLBACK_URL;
      if (!publicBase) return value;
      try {
        if (new URL(base).origin !== new URL(publicBase).origin) return value;
      } catch {
        return value;
      }
    }
    const path = base.slice(index + prefix.length);
    if (
      !path.startsWith(
        `tenants/${message.tenantId}/workspaces/${message.workspaceId}/inbox/`,
      )
    )
      return value;
    return assetAccess.authorizeUrl(base, path, viewerUserId);
  };
  return {
    ...message,
    metadata: {
      ...message.metadata,
      ...(typeof message.metadata.mediaUrl === 'string'
        ? { mediaUrl: authorize(message.metadata.mediaUrl) }
        : {}),
      ...(typeof message.metadata.attachmentUrl === 'string'
        ? { attachmentUrl: authorize(message.metadata.attachmentUrl) }
        : {}),
    },
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return entry;
          const attachment = entry as Record<string, unknown>;
          return typeof attachment.url === 'string'
            ? { ...attachment, url: authorize(attachment.url) }
            : entry;
        })
      : message.attachments,
  };
}
