import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCrmPipelineDto {
  @IsString()
  @MaxLength(140)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessMode?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;


  @IsOptional()
  @IsIn(['workspace', 'private', 'team'])
  visibility?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  channels?: string[];

  @IsOptional()
  @IsArray()
  allowedUserIds?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
