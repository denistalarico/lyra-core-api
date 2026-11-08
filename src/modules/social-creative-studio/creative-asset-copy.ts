import type { EntityManager } from 'typeorm';
import { CreativeAssetEntity, CreativeAssetVersionEntity } from './entities';

/**
 * A copy is a new asset with one version that shares the source's private
 * media, so it takes no extra storage. It never inherits the Planner link.
 */
export async function copyCreativeAssetRecords(
  manager: EntityManager,
  source: CreativeAssetEntity,
  sourceVersion: CreativeAssetVersionEntity,
  actor: string | null,
  target: { folderId: string | null; name: string },
) {
  const assets = manager.getRepository(CreativeAssetEntity);
  const versions = manager.getRepository(CreativeAssetVersionEntity);
  const asset = await assets.save(
    assets.create({
      tenantId: source.tenantId,
      workspaceId: source.workspaceId,
      agencyClientId: source.agencyClientId,
      companyContextId: source.companyContextId,
      name: target.name,
      assetType: source.assetType,
      sourceType: source.sourceType,
      status: 'ready',
      folderId: target.folderId,
      contentItemId: null,
      currentVersionId: null,
      metadata: { ...source.metadata, copiedFromAssetId: source.id },
      createdById: actor,
      archivedAt: null,
    }),
  );
  const version = await versions.save(
    versions.create({
      creativeAssetId: asset.id,
      versionNumber: 1,
      mediaAssetId: sourceVersion.mediaAssetId,
      thumbnailMediaAssetId: sourceVersion.thumbnailMediaAssetId,
      source: 'upload',
      createdById: actor,
    }),
  );
  asset.currentVersionId = version.id;
  return { asset: await assets.save(asset), version };
}
