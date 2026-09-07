import type { SocialPublicationEntity } from '../entities/social-publication.entity';

/**
 * `provider_metadata` never reaches this view — it is raw provider payload
 * (blueprint §7.2 rule 2) and the column is `select: false` at the entity
 * level besides.
 */
export function toSocialPublicationView(publication: SocialPublicationEntity) {
  return {
    id: publication.id,
    contentItemId: publication.contentItemId,
    destinationId: publication.destinationId,
    provider: publication.provider,
    connectionId: publication.connectionId,
    assetId: publication.assetId,
    externalAssetId: publication.externalAssetId,
    mediaAssetId: publication.mediaAssetId,
    status: publication.status,
    scheduledAt: publication.scheduledAt,
    publishedAt: publication.publishedAt,
    externalPublicationId: publication.externalPublicationId,
    externalPermalink: publication.externalPermalink,
    attempts: publication.attempts,
    maxAttempts: publication.maxAttempts,
    lastErrorCode: publication.lastErrorCode,
    failureReason: publication.failureReason,
    createdById: publication.createdById,
    cancelledById: publication.cancelledById,
    cancelledAt: publication.cancelledAt,
    createdAt: publication.createdAt,
    updatedAt: publication.updatedAt,
  };
}
