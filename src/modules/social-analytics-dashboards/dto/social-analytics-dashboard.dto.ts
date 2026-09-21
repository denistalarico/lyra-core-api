import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  DASHBOARD_CHANNEL_IDS,
  type DashboardChannelId,
} from '../dashboard-layout.contract';

export class CreateSocialAnalyticsDashboardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(DASHBOARD_CHANNEL_IDS.length)
  @IsIn(DASHBOARD_CHANNEL_IDS, { each: true })
  channels!: DashboardChannelId[];
}

export class UpdateSocialAnalyticsDashboardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(DASHBOARD_CHANNEL_IDS.length)
  @IsIn(DASHBOARD_CHANNEL_IDS, { each: true })
  channels?: DashboardChannelId[];

  /**
   * Declared as an opaque object, then parsed by `parseDashboardLayout`.
   *
   * A tree of nested DTO classes would be a second definition of every card
   * kind in the backend — and with the global `whitelist: true` pipe, any card
   * field not mirrored here would be silently stripped from the document on its
   * way to the database. `@IsObject()` keeps the body intact; the contract
   * module is what actually rejects a malformed one.
   */
  @IsOptional()
  @IsObject()
  layout?: unknown;
}
