import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { ClientAreaRole } from '../client-area.types';

const HEX = /^#[0-9a-fA-F]{6}$/;

export class PatchClientAreaSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['agency', 'custom']) brandingMode?: 'agency' | 'custom';
  @IsOptional() @IsString() @MaxLength(120) displayName?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) logoLightUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) logoDarkUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) markLightUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) markDarkUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) faviconUrl?: string | null;
  @IsOptional() @Matches(HEX) primaryColor?: string | null;
  @IsOptional() @Matches(HEX) secondaryColor?: string | null;
  @IsOptional() @IsIn(['centered', 'split']) loginLayout?: 'centered' | 'split';
  @IsOptional() @IsString() @MaxLength(160) loginHeading?: string | null;
  @IsOptional() @IsString() @MaxLength(500) loginSupportingText?: string | null;
  @IsOptional() @Matches(HEX) loginBackgroundColor?: string | null;
  @IsOptional()
  @IsIn(['client_admin', 'client_operator', 'client_viewer'])
  defaultRole?: ClientAreaRole;
  @IsOptional() @IsBoolean() approvalsDefaultEnabled?: boolean;
  @IsOptional() @IsIn(['default', 'custom']) domainMode?: 'default' | 'custom';
  @IsOptional() @IsString() @MaxLength(253) customDomain?: string | null;
}

export class PatchClientAreaCompanySettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() approvalsEnabled?: boolean;
  @IsOptional()
  @IsIn(['client_admin', 'client_operator', 'client_viewer'])
  defaultRole?: ClientAreaRole;
}
