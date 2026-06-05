import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";

export class CreateKnowledgeCategoryDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(180)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateKnowledgeCategoryDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
