import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialOrganicReachPeriodEntity } from './entities/social-organic-reach-period.entity';

/** One measurement, with the scope it belongs to. */
export type OrganicReachMeasurement = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  periodSince: string;
  periodUntil: string;
  assetTimezone: string;
  reach: string | null;
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
         measured_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (asset_id, period_since, period_until) DO UPDATE SET
         reach = EXCLUDED.reach,
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
      ],
    );
  }
}
