import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpsertContactViewPreferenceDto {
  @IsString()
  @Length(2, 80)
  viewKey!: string;

  @IsOptional()
  @IsArray()
  columnsJson?: unknown[];

  @IsOptional()
  @IsObject()
  filtersJson?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sortJson?: Record<string, unknown>;
}
