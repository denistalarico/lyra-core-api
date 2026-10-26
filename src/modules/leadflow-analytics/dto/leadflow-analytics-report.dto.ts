import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  REPORT_ORIENTATIONS,
  REPORT_PAGE_MODES,
  type ReportOrientation,
  type ReportPageMode,
} from '../../analytics-reports/report-snapshot.contract';
import {
  DASHBOARD_CHANNEL_IDS,
  type DashboardChannelId,
} from '../dashboards/dashboard-layout.contract';

/**
 * The export request — AN-LF2, the Social one with LeadFlow sections.
 *
 * `snapshot` is `@IsObject()` and nothing more: the global pipe runs with
 * `whitelist: true`, so every nested property without a mirroring DTO class is
 * stripped on the way in. `parseReportSnapshot` is the validator instead, and
 * it rebuilds the value rather than trusting it.
 */
export class CreateLeadFlowAnalyticsReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  /** Which dashboard this came from, for the archive's reference. */
  @IsOptional()
  @IsUUID()
  dashboardId?: string | null;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(DASHBOARD_CHANNEL_IDS.length)
  @IsIn(DASHBOARD_CHANNEL_IDS, { each: true })
  channels!: DashboardChannelId[];

  @IsISO8601({ strict: true })
  since!: string;

  @IsISO8601({ strict: true })
  until!: string;

  @IsIn(REPORT_PAGE_MODES)
  pageMode!: ReportPageMode;

  /** Landscape by default: a dashboard is wider than it is tall. */
  @IsOptional()
  @IsIn(REPORT_ORIENTATIONS)
  orientation?: ReportOrientation;

  /** The browser's zone (LeadFlow has no account timezone), frozen on the emission. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  issuedTimezone?: string;

  @IsObject()
  snapshot!: Record<string, unknown>;
}

/** The same body, rendered to the same PDF and never recorded. */
export class PreviewLeadFlowAnalyticsReportDto extends CreateLeadFlowAnalyticsReportDto {}
