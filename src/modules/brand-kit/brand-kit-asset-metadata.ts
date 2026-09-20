const PRIVATE_METADATA_KEY =
  /(?:storage.?path|storage.?key|bucket|credential|secret|password|token|(?:signed|internal)?url)/i;

/** Keeps extensible brand metadata while removing storage and auth capabilities. */
export function projectBrandKitAssetMetadata(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRIVATE_METADATA_KEY.test(key))
      .map(([key, entry]) => [key, projectMetadataValue(entry)]),
  );
}

function projectMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry && typeof entry === 'object'
        ? projectBrandKitAssetMetadata(entry)
        : entry,
    );
  }
  if (value && typeof value === 'object') {
    return projectBrandKitAssetMetadata(value);
  }
  return value;
}
