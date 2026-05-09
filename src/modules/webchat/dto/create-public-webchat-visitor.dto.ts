import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePublicWebchatVisitorDto {
  @IsString()
  @MaxLength(160)
  anonymousId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
