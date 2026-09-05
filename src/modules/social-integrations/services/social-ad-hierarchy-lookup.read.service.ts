import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  SocialAdHierarchyPath,
  SocialAdHierarchyResult,
} from '../analytics/social-ad-hierarchy-lookup';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';

/**
 * The level an observed referral id is looked up at.
 *
 * Meta's `referral.source_id` is an *ad* id when `source_type` is `'ad'`. It is
 * pinned as a literal rather than accepted as an argument because the whole
 * safety property of the lookup depends on it: ids are unique per level and not
 * across levels, so a lookup that could be asked for another level could return
 * an ad set whose id happened to equal an ad's.
 */
const AD_ENTITY_LEVEL = 'ad';

/** The only provider that produces ad ids on inbound today — see I4 §16. */
const META_PROVIDER = 'meta_ads';

export type SocialAdHierarchyLookupInput = {
  tenantId: string;
  workspaceId: string;
  /**
   * NULL means the agency's own context — never "any client".
   *
   * Bound with `IS NOT DISTINCT FROM` rather than `=` so that a null client
   * matches the agency's rows instead of matching nothing. Written as `=` this
   * would silently return no path for every agency-context conversation.
   */
  agencyClientId: string | null;
  /** The observed provider ad id, verbatim. */
  adId: string;
};

/** One mirror row as Postgres returns it. */
type HierarchyRow = {
  connection_id: string;
  ad_id: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_entity_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  account_id: string | null;
};

/**
 * Resolves an observed ad id to its place in the mirrored hierarchy.
 *
 * ## The walk, and why it is not `campaign_external_id`
 *
 * `social_ad_entities` denormalises `campaign_external_id` onto every level
 * below the account, and using it would save two joins. It is not used here for
 * ad set: the denormalised column names the campaign, not the ad set, so the ad
 * set still has to be reached through `parent_external_id`. Having reached it,
 * walking one more link to the campaign costs nothing and keeps every level
 * resolved by the same rule — a mix of "one level by parent link, one by
 * denormalised column" is how the two silently disagree after a sync bug.
 *
 * ## Scope is in the join, not applied afterwards
 *
 * Every join carries tenant, workspace and connection. An ad's parent ad set is
 * only its parent *within the same connection*: two Businesses can both have an
 * object with the same provider id, and a parent walk that omitted the
 * connection would happily climb from one Business's ad into another's campaign
 * and report a hierarchy that never existed.
 */
@Injectable()
export class SocialAdHierarchyLookupReadService {
  constructor(
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entities: Repository<SocialAdEntity>,
  ) {}

  async lookup(
    input: SocialAdHierarchyLookupInput,
  ): Promise<SocialAdHierarchyResult> {
    const rows = await this.entities.query<HierarchyRow[]>(
      HIERARCHY_LOOKUP_SQL,
      [
        input.tenantId,
        input.workspaceId,
        input.agencyClientId,
        input.adId,
        AD_ENTITY_LEVEL,
        META_PROVIDER,
      ],
    );

    if (!rows.length) {
      return { status: 'ad_not_found', candidateConnectionIds: [] };
    }

    /**
     * More than one connection answered, so the evidence is undecidable.
     *
     * Meta ad ids are unique within a Business but not guaranteed across
     * Businesses, and an agency can legitimately connect several ad accounts
     * into one client context. Choosing "the first" — or the most recently
     * connected, or the one with spend — would produce a confident answer with
     * no evidence behind it, and every downstream number would inherit that
     * guess while being labelled `observed`.
     *
     * The connection ids are returned so an operator can see exactly which
     * accounts collided, rather than being told only that something is
     * ambiguous.
     */
    const connectionIds = [...new Set(rows.map((row) => row.connection_id))];

    if (connectionIds.length > 1) {
      return {
        status: 'ambiguous_connection',
        candidateConnectionIds: connectionIds.sort(),
      };
    }

    return { status: 'matched', path: toPath(rows[0]) };
  }

  /**
   * The same resolution, for many ad ids at once and within one connection.
   *
   * ## Why a batch method rather than a loop over `lookup`
   *
   * A cohort resolves every distinct ad its conversations observed. Calling
   * `lookup` per id would issue one round trip each — and the aggregate's whole
   * cost profile is "one query per layer", not "one query per attributed
   * conversation". The walk itself is character-for-character the same; only
   * the predicate on `external_id` differs.
   *
   * ## Why the connection is required here and optional there
   *
   * The individual endpoint has no connection to hand, so it discovers one and
   * fails closed when two answer. The aggregate is *given* a connection — I4.2
   * §7 requires it, because the account's timezone decides the window's day
   * boundary — so ambiguity cannot arise: an id is looked up inside exactly one
   * Business, which is the scope Meta actually guarantees ids to be unique in.
   *
   * Ids that resolve to nothing are simply absent from the map. The caller owns
   * what that means, because only it knows how many conversations observed them.
   */
  async lookupMany(input: {
    tenantId: string;
    workspaceId: string;
    agencyClientId: string | null;
    connectionId: string;
    adIds: readonly string[];
  }): Promise<Map<string, SocialAdHierarchyPath>> {
    const resolved = new Map<string, SocialAdHierarchyPath>();
    if (!input.adIds.length) return resolved;

    const rows = await this.entities.query<HierarchyRow[]>(
      HIERARCHY_BATCH_SQL,
      [
        input.tenantId,
        input.workspaceId,
        input.agencyClientId,
        [...new Set(input.adIds)],
        AD_ENTITY_LEVEL,
        META_PROVIDER,
        input.connectionId,
      ],
    );

    for (const row of rows) {
      resolved.set(row.ad_id, toPath(row));
    }

    return resolved;
  }
}

function toPath(row: HierarchyRow): SocialAdHierarchyPath {
  return {
    connectionId: row.connection_id,
    adId: row.ad_id,
    adsetId: row.adset_id,
    adsetEntityId: row.adset_entity_id,
    campaignId: row.campaign_id,
    accountId: row.account_id,
    adName: row.ad_name,
    adsetName: row.adset_name,
    campaignName: row.campaign_name,
  };
}

/**
 * Archived rows are included on purpose.
 *
 * `archived_at` marks an object the provider stopped returning, which is the
 * normal end state of every ad that ever finished running. The conversation
 * being resolved is historical evidence, so excluding archived ads would make
 * attribution decay: a conversation attributable today would become
 * `ad_not_found` a month later, with nothing having changed except Meta's
 * willingness to keep listing the ad.
 *
 * The LEFT JOINs up the tree are what make a partial hierarchy degrade instead
 * of vanishing. If the ad set failed to sync but the ad did, the answer is
 * still "this ad, under this connection" with the upper levels null — which is
 * a truthful partial result, where an INNER JOIN would have reported the ad as
 * not found at all.
 */
const HIERARCHY_WALK_SQL = `
  SELECT ad.connection_id                AS "connection_id",
         ad.external_id                  AS "ad_id",
         ad.name                         AS "ad_name",
         adset.external_id               AS "adset_id",
         adset.id::text                  AS "adset_entity_id",
         adset.name                      AS "adset_name",
         campaign.external_id            AS "campaign_id",
         campaign.name                   AS "campaign_name",
         account.external_id             AS "account_id"
  FROM social_ad_entities ad
  LEFT JOIN social_ad_entities adset
    ON adset.tenant_id = ad.tenant_id
   AND adset.workspace_id = ad.workspace_id
   AND adset.connection_id = ad.connection_id
   AND adset.entity_level = 'adset'
   AND adset.external_id = ad.parent_external_id
  LEFT JOIN social_ad_entities campaign
    ON campaign.tenant_id = ad.tenant_id
   AND campaign.workspace_id = ad.workspace_id
   AND campaign.connection_id = ad.connection_id
   AND campaign.entity_level = 'campaign'
   AND campaign.external_id = adset.parent_external_id
  LEFT JOIN social_ad_entities account
    ON account.tenant_id = ad.tenant_id
   AND account.workspace_id = ad.workspace_id
   AND account.connection_id = ad.connection_id
   AND account.entity_level = 'account'
   AND account.external_id = campaign.parent_external_id
`;

/** The single-id lookup: the shared walk plus its own predicate. */
const HIERARCHY_LOOKUP_SQL = `
  /* social-ad-hierarchy:lookup */
  ${HIERARCHY_WALK_SQL}
  WHERE ad.tenant_id = $1
    AND ad.workspace_id = $2
    AND ad.agency_client_id IS NOT DISTINCT FROM $3
    AND ad.external_id = $4
    AND ad.entity_level = $5
    AND ad.provider = $6
`;

/**
 * The batch walk, built from the same text as the single lookup.
 *
 * The joins are shared rather than copied: `HIERARCHY_WALK_SQL` below is the
 * one definition of "how an ad reaches its ad set, campaign and account", and
 * both queries append their own predicate to it. Two hand-maintained copies of
 * a four-level join is precisely how one of them loses a `connection_id` and
 * starts climbing into another Business's campaign.
 *
 * The extra `ad.connection_id = $7` is what makes ambiguity impossible here:
 * within one connection an external id is unique by
 * `UQ_social_ad_entities_identity`, so at most one row can come back per id.
 */
const HIERARCHY_BATCH_SQL = `
  /* social-ad-hierarchy:lookup-many */
  ${HIERARCHY_WALK_SQL}
  WHERE ad.tenant_id = $1
    AND ad.workspace_id = $2
    AND ad.agency_client_id IS NOT DISTINCT FROM $3
    AND ad.external_id = ANY($4::varchar[])
    AND ad.entity_level = $5
    AND ad.provider = $6
    AND ad.connection_id = $7
`;
