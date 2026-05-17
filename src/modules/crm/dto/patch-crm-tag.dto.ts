import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PatchCrmTagDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string | null;

  @IsOptional()
  @IsIn(['system', 'user'])
  kind?: string;

  @IsOptional()
  @IsIn(['workspace', 'user'])
  scope?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isEditable?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
