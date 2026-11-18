import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MEDIA_ASSET_DIRECT_UPLOAD_MAX_PARTS_PER_SIGN,
  MEDIA_ASSET_DIRECT_UPLOAD_MAX_BYTES,
} from '../media-asset-direct-upload.rules';

/** Direct upload (browser → R2). Scope never comes from the body. */
export class StartDirectUploadDto {
  @IsString() @MinLength(1) @MaxLength(255) filename!: string;
  @IsString() @MaxLength(100) mimeType!: string;
  @IsInt() @Min(1) @Max(MEDIA_ASSET_DIRECT_UPLOAD_MAX_BYTES) byteSize!: number;
}

/** Planner surface: only the Planner's own provenance may start one here. */
export class StartPlannerDirectUploadDto extends StartDirectUploadDto {
  @IsOptional() @IsIn(['planner_upload']) source?: 'planner_upload';
}

export class DirectUploadTokenDto {
  @IsString() @MinLength(16) @MaxLength(4096) token!: string;
}

export class SignDirectUploadPartsDto extends DirectUploadTokenDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MEDIA_ASSET_DIRECT_UPLOAD_MAX_PARTS_PER_SIGN)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10000, { each: true })
  partNumbers!: number[];
}

export class DirectUploadPartDto {
  @IsInt() @Min(1) @Max(10000) partNumber!: number;
  @IsString() @MinLength(1) @MaxLength(256) etag!: string;
}

export class CompleteDirectUploadDto extends DirectUploadTokenDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => DirectUploadPartDto)
  parts!: DirectUploadPartDto[];
}
