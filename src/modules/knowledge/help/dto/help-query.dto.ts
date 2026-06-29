import { IsOptional, IsString, MaxLength } from "class-validator";

/** Locale fallback applied across every Help Center read endpoint. */
export const DEFAULT_HELP_LOCALE = "pt-BR";

export class ListHelpArticlesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  categoryKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;
}

export class HelpLocaleQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;
}
