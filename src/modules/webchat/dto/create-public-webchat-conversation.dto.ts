import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePublicWebchatConversationDto {
  @IsUUID()
  visitorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  pageTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  utmCampaign?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
