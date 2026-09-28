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
  DASHBOARD_CHANNEL_IDS,
  type DashboardChannelId,
} from '../dashboard-layout.contract';
import {
  REPORT_ORIENTATIONS,
  REPORT_PAGE_MODES,
  type ReportOrientation,
  type ReportPageMode,
} from '../report-snapshot.contract';

/**
 * The export request — Etapa 9.
 *
 * `snapshot` is `@IsObject()` and nothing more, for the same reason `layout` is
 * on the dashboard DTO: the global pipe runs with `whitelist: true`, so every
 * nested property without a mirroring DTO class is stripped on the way in.
 * `parseReportSnapshot` is the validator instead, and it rebuilds the value
 * rather than trusting it.
 */
export class CreateSocialAnalyticsReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  /**
   * Which dashboard this came from, for the archive's reference.
   *
   * Optional and nullable: the FK is `ON DELETE SET NULL` precisely because an
   * emitted report outlives the dashboard it was built from, and a report
   * exported from the built-in Visão Geral has no saved row to point at while
   * the first list request has not seeded one.
   */
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

  /**
   * The dashboard's account timezone. It is frozen on the emission so the
   * archive keeps showing the instant in the client's operational timezone.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  issuedTimezone?: string;

  @IsObject()
  snapshot!: Record<string, unknown>;
}

/**
 * The preview request.
 *
 * The same body, rendered to the same PDF and never recorded: an operator who looks at
 * a preview and closes it has not emitted a report, and an archive that listed
 * every look would stop being a record of what the client received.
 */
export class PreviewSocialAnalyticsReportDto extends CreateSocialAnalyticsReportDto {}
