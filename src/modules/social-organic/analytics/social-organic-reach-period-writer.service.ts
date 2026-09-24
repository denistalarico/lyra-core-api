import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialOrganicReachPeriodEntity } from './entities/social-organic-reach-period.entity';

/**
 * One measurement of one window, with the scope it belongs to.
 *
 * The six figures travel together because they come from one pair of API calls
 * about one range. Writing a subset would leave the row describing a window
 * with numbers from two different readings of it.
 *
 * The slices are optional: a caller that only measured the totals passes them
 * as null, and null must stay null rather than becoming zero — see the entity.
 */
export type OrganicReachMeasurement = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  periodSince: string;
  periodUntil: string;
  assetTimezone: string;
  /** Total, ads included. */
  reach: string | null;
  reachOrganic?: string | null;
  reachPaid?: string | null;
  /** Feed posts only; a subset of `reachOrganic`, never added to it. */
  reachFeed?: string | null;
  views?: string | null;
  viewsOrganic?: string | null;
  viewsPaid?: string | null;
  /** The range Meta measured, when it differs from the window asked for. */
  measuredSince?: string | null;
  measuredUntil?: string | null;
  truncated?: boolean;
  isPartial: boolean;
};

/**
 * Stores period-reach measurements, one row per asset and window.
 *
 * Upsert rather than insert: a second read of the same window is a better
 * reading of the same thing — a window that was still open when first measured
 * closes and settles — and keeping both would leave the reader choosing between
 * two numbers for one question.
 */
@Injectable()
export class SocialOrganicReachPeriodWriterService {
  constructor(
    @InjectRepository(SocialOrganicReachPeriodEntity, 'agency')
    private readonly repository: Repository<SocialOrganicReachPeriodEntity>,
  ) {}

  async record(measurement: OrganicReachMeasurement): Promise<void> {
    await this.repository.query(
      `INSERT INTO social_organic_reach_periods (
         tenant_id, workspace_id, agency_client_id, asset_id, provider,
         period_since, period_until, asset_timezone, reach, is_partial,
         reach_organic, reach_paid, reach_feed,
         views, views_organic, views_paid,
         measured_since, measured_until, truncated,
         measured_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18, $19, now())
       ON CONFLICT (asset_id, period_since, period_until) DO UPDATE SET
         reach = EXCLUDED.reach,
         reach_organic = EXCLUDED.reach_organic,
         reach_paid = EXCLUDED.reach_paid,
         reach_feed = EXCLUDED.reach_feed,
         views = EXCLUDED.views,
         views_organic = EXCLUDED.views_organic,
         views_paid = EXCLUDED.views_paid,
         measured_since = EXCLUDED.measured_since,
         measured_until = EXCLUDED.measured_until,
         truncated = EXCLUDED.truncated,
         is_partial = EXCLUDED.is_partial,
         measured_at = now(),
         updated_at = now()`,
      [
        measurement.tenantId,
        measurement.workspaceId,
        measurement.agencyClientId,
        measurement.assetId,
        measurement.provider,
        measurement.periodSince,
        measurement.periodUntil,
        measurement.assetTimezone,
        measurement.reach,
        measurement.isPartial,
        // `?? null` rather than leaving them undefined: the driver would
        // otherwise send undefined, and the whole row is replaced on conflict —
        // an omitted slice must overwrite a stale one with null, not keep it.
        measurement.reachOrganic ?? null,
        measurement.reachPaid ?? null,
        measurement.reachFeed ?? null,
        measurement.views ?? null,
        measurement.viewsOrganic ?? null,
        measurement.viewsPaid ?? null,
        measurement.measuredSince ?? null,
        measurement.measuredUntil ?? null,
        measurement.truncated ?? false,
      ],
    );
  }
}
