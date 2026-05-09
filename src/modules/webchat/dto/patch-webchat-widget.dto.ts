import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import type {
  WebchatLeadCaptureMode,
  WebchatWidgetPosition,
  WebchatWidgetStatus,
} from '../entities/webchat-widget.entity';

export class PatchWebchatWidgetDto {
  @IsOptional()
  @IsString()
  @Length(2, 140)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'inactive'])
  status?: WebchatWidgetStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  initialMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  @Matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
  primaryColor?: string;

  @IsOptional()
  @IsIn(['bottom-right', 'bottom-left'])
  position?: WebchatWidgetPosition;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  defaultLocale?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsUUID()
  defaultAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  agentDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  agentAvatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  brandFooterEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  brandFooterText?: string;

  @IsOptional()
  @IsBoolean()
  leadCaptureEnabled?: boolean;

  @IsOptional()
  @IsIn(['before_chat', 'during_chat', 'optional'])
  leadCaptureMode?: WebchatLeadCaptureMode;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
