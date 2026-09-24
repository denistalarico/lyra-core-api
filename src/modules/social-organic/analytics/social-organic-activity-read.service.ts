import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import { SocialOrganicOnlineFollowersEntity } from './entities/social-organic-online-followers.entity';
import {
  convertPacificHour,
  type SocialOrganicActivityHourPoint,
  type SocialOrganicActivityView,
  type SocialOrganicActivityWeekdayPoint,
} from './views/social-organic-activity.view';

export type SocialOrganicActivityReadInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
  assetId: string;
};

/** One stored hour as Postgres returns it — every column text. */
type GridRow = {
  metric_date: string;
  hour_of_day: number;
  source_timezone: string;
  followers_online: string;
};

/**
 * "Melhor dia para postagem" and "melhor horário para postagens", from the
 * stored hourly grid.
 *
 * ## No period parameter, deliberately
 *
 * Meta serves roughly the last 30 days of `online_followers` and nothing older,
 * regardless of the report's period. A period argument here could only be
 * honoured by filtering a window that is already the whole of what exists,
 * which would let a report ask for June and receive September's grid under
 * June's heading. The response states the window it actually averaged instead.
 *
 * ## Averaged in the asset's timezone, stored in Meta's
 *
 * Rows are indexed by Pacific hour. Converting them here rather than at write
 * time is what makes a correction cheap if Meta changes zones — and the
 * conversion is not cosmetic: on a São Paulo account the peak moves by four or
 * five hours, so the un-converted chart would recommend the wrong time to post.
 *
 * Reads two local tables, holds no credential, and answers identically for a
 * disconnected asset.
 */
@Injectable()
export class SocialOrganicActivityReadService {
  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,
    @InjectRepository(SocialOrganicOnlineFollowersEntity, 'agency')
    private readonly gridRepository: Repository<SocialOrganicOnlineFollowersEntity>,
  ) {}

  async activity(
    input: SocialOrganicActivityReadInput,
  ): Promise<SocialOrganicActivityView> {
    const asset = await this.findInScope(input);
    const timezone = asset.assetTimezone ?? 'UTC';

    const rows = await this.gridRepository.query<GridRow[]>(GRID_SQL, [
      asset.tenantId,
      asset.workspaceId,
      asset.id,
    ]);

    return buildActivityView(asset.id, timezone, rows);
  }

  /**
   * Same scope-and-existence query every other organic read uses: an asset in
   * another tenant is "not found", never "forbidden", so the endpoint cannot be
   * used to confirm that an id exists.
   */
  private async findInScope(input: SocialOrganicActivityReadInput) {
    const asset = await this.assetsRepository.findOne({
      where: {
        id: input.assetId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId ?? IsNull(),
        companyContextId: input.companyContextId ?? IsNull(),
      },
      select: ['id', 'assetTimezone', 'tenantId', 'workspaceId'],
    });

    if (!asset) throw new NotFoundException('Asset not found.');

    return asset;
  }
}

/**
 * Folds the stored grid into the two charts.
 *
 * Exported for the unit tests, which drive it with rows rather than a database:
 * everything interesting here — the conversion, the averaging, the
 * always-24-points shape — is pure, and testing it through Postgres would test
 * the driver instead.
 */
export function buildActivityView(
  assetId: string,
  timezone: string,
  rows: GridRow[],
): SocialOrganicActivityView {
  const sourceTimezone = rows[0]?.source_timezone ?? 'America/Los_Angeles';

  // Sums with their counts, because the answer is a mean: the counts are a
  // stock, so a total across hours is not a number of people. Kept as numbers
  // rather than BigInt — these are averages of follower counts, orders of
  // magnitude below the precision limit, and a mean is a decimal anyway.
  const byHour = new Map<number, { total: number; days: Set<string> }>();
  const byWeekday = new Map<number, { total: number; days: Set<string> }>();
  const localDays = new Set<string>();

  for (const row of rows) {
    const value = Number(row.followers_online);
    if (!Number.isFinite(value)) continue;

    const local = convertPacificHour(
      row.metric_date,
      Number(row.hour_of_day),
      row.source_timezone,
      timezone,
    );

    localDays.add(local.date);
    accumulate(byHour, local.hour, value, local.date);
    accumulate(byWeekday, local.weekday, value, local.date);
  }

  const dates = [...localDays].sort();

  const hours: SocialOrganicActivityHourPoint[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const bucket = byHour.get(hour);
    hours.push({
      hour,
      average: mean(bucket?.total ?? 0, bucket?.days.size ?? 0),
      sampleDays: bucket?.days.size ?? 0,
    });
  }

  const weekdays: SocialOrganicActivityWeekdayPoint[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const bucket = byWeekday.get(weekday);
    // Divided by days, not by readings: a weekday bucket holds 24 hours per
    // day, and dividing by 24×days would give the mean hour of that weekday
    // rather than the weekday's own level. Both are defensible; this one is
    // comparable with the hourly chart's scale, which is what a reader
    // comparing the two expects.
    weekdays.push({
      weekday,
      average: mean(bucket?.total ?? 0, (bucket?.days.size ?? 0) * 24),
      sampleDays: bucket?.days.size ?? 0,
    });
  }

  return {
    assetId,
    timezone,
    sourceTimezone,
    windowSince: dates[0] ?? null,
    windowUntil: dates[dates.length - 1] ?? null,
    daysCovered: dates.length,
    hasData: rows.length > 0,
    hours,
    weekdays,
  };
}

function accumulate(
  into: Map<number, { total: number; days: Set<string> }>,
  key: number,
  value: number,
  day: string,
): void {
  const bucket = into.get(key) ?? { total: 0, days: new Set<string>() };
  bucket.total += value;
  bucket.days.add(day);
  into.set(key, bucket);
}

/** A mean to one decimal, as a string; zero samples reads as `"0"`. */
function mean(total: number, samples: number): string {
  if (samples <= 0) return '0';

  return (Math.round((total / samples) * 10) / 10).toString();
}

/**
 * The whole stored grid for one asset.
 *
 * Unbounded by date on purpose: the table only ever holds what Meta's retention
 * allowed us to capture, so "everything" and "the last 30 days" are the same
 * set — and a bound would quietly drop days on the boundary when the two
 * timezones disagree about which day an hour belongs to.
 *
 * Parameters: `$1` tenant, `$2` workspace, `$3` asset.
 */
const GRID_SQL = `
  /* social-organic-activity:grid */
  SELECT grid.metric_date::text AS "metric_date",
         grid.hour_of_day AS "hour_of_day",
         grid.source_timezone AS "source_timezone",
         grid.followers_online::text AS "followers_online"
  FROM social_organic_online_followers grid
  WHERE grid.tenant_id = $1
    AND grid.workspace_id = $2
    AND grid.asset_id = $3
  ORDER BY grid.metric_date ASC, grid.hour_of_day ASC
`;
