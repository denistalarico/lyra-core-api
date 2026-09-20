import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import type { SocialOrganicAudienceKind } from './entities/social-organic-audience-daily.entity';
import { SocialOrganicAudienceDailyEntity } from './entities/social-organic-audience-daily.entity';
import {
  describeAudienceKey,
  sortAudienceBuckets,
  type SocialOrganicAudienceBucket,
  type SocialOrganicAudienceView,
} from './views/social-organic-audience.view';

export type SocialOrganicAudienceReadInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  kind: SocialOrganicAudienceKind;
};

/** One stored bucket as Postgres returns it — every column text. */
type AudienceRow = {
  breakdown_key: string;
  value: string;
  metric_date: string;
};

/**
 * The newest follower-demographics snapshot for one asset and dimension.
 *
 * ## One day, never a range
 *
 * The whole contract of this read is that it returns *one snapshot*. Follower
 * demographics are a lifetime stock, so an aggregate over a window would count
 * the same followers once per day in it — and the failure is quieter than the
 * reach one everybody knows about: a 30-day sum of a gender split still divides
 * into plausible-looking proportions, and the only thing wrong with it is that
 * every number is thirty times too large.
 *
 * So there is no period parameter here. Not as an omission to be filled in
 * later: a period would be a question this data cannot answer, and offering one
 * would mean the answer had to be either a sum (wrong) or the newest day inside
 * it (the same answer this gives, with a parameter implying otherwise).
 *
 * No Graph service, no credential resolver, no token. It reads two local tables
 * and would answer identically for a disconnected asset, because a disconnected
 * asset's stored history is still true.
 */
@Injectable()
export class SocialOrganicAudienceReadService {
  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,
    @InjectRepository(SocialOrganicAudienceDailyEntity, 'agency')
    private readonly audienceRepository: Repository<SocialOrganicAudienceDailyEntity>,
  ) {}

  async audience(
    input: SocialOrganicAudienceReadInput,
  ): Promise<SocialOrganicAudienceView> {
    const asset = await this.findInScope(input);

    const rows = await this.audienceRepository.query<AudienceRow[]>(
      NEWEST_AUDIENCE_SQL,
      [asset.tenantId, asset.workspaceId, asset.id, input.kind],
    );

    const buckets: SocialOrganicAudienceBucket[] = rows.map((row) => ({
      key: row.breakdown_key,
      label: describeAudienceKey(input.kind, row.breakdown_key),
      value: row.value,
    }));

    return {
      kind: input.kind,
      // Taken from a returned row rather than computed: it is the day the SQL
      // actually selected, so the answer and the stamp on it cannot disagree.
      asOf: rows[0]?.metric_date ?? null,
      timezone: asset.assetTimezone ?? 'UTC',
      hasData: buckets.length > 0,
      buckets: sortAudienceBuckets(input.kind, buckets),
    };
  }

  /**
   * Scope resolution and existence check are the same query, exactly as
   * `SocialOrganicAnalyticsReadService` does it.
   *
   * An asset in another tenant, workspace or managed client is "not found" — the
   * same answer as an id that never existed. Answering "forbidden" would confirm
   * the id is real and make the endpoint an enumeration oracle.
   *
   * No status filter: a revoked asset's stored history is still real.
   */
  private async findInScope(input: SocialOrganicAudienceReadInput) {
    const asset = await this.assetsRepository.findOne({
      where: {
        id: input.assetId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // `IsNull()` rather than `null`: agency scope must match rows where the
        // column is NULL, and TypeORM reads a literal null as "no filter" —
        // which would silently widen the lookup to every client.
        agencyClientId: input.agencyClientId ?? IsNull(),
      },
      select: ['id', 'assetTimezone', 'tenantId', 'workspaceId'],
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    return asset;
  }
}

/**
 * Every bucket of the newest day that has any.
 *
 * The date is resolved in a subquery rather than by ordering and taking a limit,
 * because "the newest day" and "the rows of that day" are two questions and a
 * `LIMIT` would answer the first while truncating the second — a city dimension
 * has hundreds of buckets, and a limit sized for one would silently return a
 * fraction of the distribution.
 *
 * There is deliberately no `SUM` anywhere in this statement. A period aggregate
 * over a lifetime stock double-counts followers, and its absence here is what
 * keeps a later edit from adding the one that looks obvious.
 *
 * Parameters: `$1` tenant, `$2` workspace, `$3` asset, `$4` breakdown kind.
 */
const NEWEST_AUDIENCE_SQL = `
  /* social-organic-audience:newest */
  SELECT snapshot.breakdown_key AS "breakdown_key",
         snapshot.value::text AS "value",
         snapshot.metric_date::text AS "metric_date"
  FROM social_organic_audience_daily snapshot
  WHERE snapshot.tenant_id = $1
    AND snapshot.workspace_id = $2
    AND snapshot.asset_id = $3
    AND snapshot.breakdown_kind = $4
    AND snapshot.metric_date = (
      SELECT MAX(newest.metric_date)
      FROM social_organic_audience_daily newest
      WHERE newest.asset_id = $3
        AND newest.breakdown_kind = $4
    )
`;
