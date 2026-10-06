/**
 * CS3.1.1 — legacy media follows the root it belongs to.
 *
 * `media_assets` gained `company_context_id`, and its company is a fact of
 * its owners (creative versions, Planner bindings, publications), never of the
 * media row itself. When a legacy creative asset or plan is reconciled, media
 * that ONLY that root owns moves with it in the same transaction; otherwise
 * the root would become visible in its company with binaries that resolve to
 * 404. Media also owned by any other root is left legacy: moving it would be
 * the cross-company guess CC2G forbids.
 *
 * `owner_key` identifies a root as `<kind>:<id>`. Every branch is restricted
 * to the caller's tenant.
 */
export type CompanyLegacyMediaOwnerKind = 'creative_asset' | 'plan';

export const COMPANY_LEGACY_MEDIA_OWNERS_SQL = `
  SELECT version."media_asset_id" AS "media_asset_id",
         'creative_asset:' || asset."id" AS "owner_key"
    FROM "social_creative_asset_versions" version
    JOIN "social_creative_assets" asset ON asset."id" = version."creative_asset_id"
   WHERE asset."tenant_id" = :tenantId
  UNION ALL
  SELECT version."thumbnail_media_asset_id",
         'creative_asset:' || asset."id"
    FROM "social_creative_asset_versions" version
    JOIN "social_creative_assets" asset ON asset."id" = version."creative_asset_id"
   WHERE asset."tenant_id" = :tenantId
     AND version."thumbnail_media_asset_id" IS NOT NULL
  UNION ALL
  SELECT binding."media_asset_id", 'plan:' || item."plan_id"
    FROM "social_destination_creatives" binding
    JOIN "social_content_items" item ON item."id" = binding."content_item_id"
   WHERE binding."tenant_id" = :tenantId
  UNION ALL
  SELECT media."media_asset_id", 'plan:' || item."plan_id"
    FROM "social_publication_media" media
    JOIN "social_publications" publication ON publication."id" = media."publication_id"
    JOIN "social_content_items" item ON item."id" = publication."content_item_id"
   WHERE publication."tenant_id" = :tenantId
  UNION ALL
  SELECT publication."media_asset_id", 'plan:' || item."plan_id"
    FROM "social_publications" publication
    JOIN "social_content_items" item ON item."id" = publication."content_item_id"
   WHERE publication."tenant_id" = :tenantId
     AND publication."media_asset_id" IS NOT NULL
`;

/**
 * Assigns the legacy media exclusively owned by `ownerKey`, guarded exactly
 * like the root's own assignment: same tenant/workspace/client, still legacy.
 */
export const ASSIGN_EXCLUSIVE_LEGACY_MEDIA_SQL = `
  WITH owners AS (${COMPANY_LEGACY_MEDIA_OWNERS_SQL}),
  exclusive AS (
    SELECT "media_asset_id" FROM owners
     GROUP BY "media_asset_id"
    HAVING bool_and("owner_key" = :ownerKey)
  )
  UPDATE "media_assets" AS media
     SET "company_context_id" = :companyContextId
    FROM exclusive
   WHERE media."id" = exclusive."media_asset_id"
     AND media."tenant_id" = :tenantId
     AND media."workspace_id" = :workspaceId
     AND media."agency_client_id" = :agencyClientId
     AND media."company_context_id" IS NULL
  RETURNING media."id"
`;
