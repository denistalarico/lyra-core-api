import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListCreativeAssetsQueryDto {
  @IsOptional() @IsIn(['image', 'video']) assetType?: 'image' | 'video';
  @IsOptional() @IsUUID() folderId?: string;
  @IsOptional() @IsIn(['ready', 'archived']) status?: 'ready' | 'archived';
  @IsOptional() @IsUUID() contentItemId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @MaxLength(40) sourceType?: string;
  @IsOptional() @IsISO8601() createdFrom?: string;
  @IsOptional() @IsISO8601() createdTo?: string;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}
export class CreateCreativeAssetDto { @IsOptional() @IsString() @MaxLength(255) name?: string; @IsOptional() @IsUUID() folderId?: string; @IsOptional() @IsUUID() contentItemId?: string; }
export class UpdateCreativeAssetDto { @IsOptional() @IsString() @MaxLength(255) name?: string; @IsOptional() @IsUUID() folderId?: string | null; }
export class CreateCreativeFolderDto { @IsString() @MaxLength(160) name!: string; @IsOptional() @IsUUID() parentId?: string; }
export class UpdateCreativeFolderDto { @IsString() @MaxLength(160) name!: string; }
