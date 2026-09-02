import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * PATCH /brand-kit body (S1.4.9).
 *
 * Only visual identity. Name, description, contacts, address and offers stay
 * in the Business Profile — copying them here would create a second truth
 * about the same company, which D-1 forbids.
 *
 * Every field is optional: PATCH means "change what I sent". The service
 * only writes keys that are actually present, so an omitted `guidelines`
 * never blanks a stored one (the DTO-spread bug this project has hit before).
 */

const PALETTE_ROLES = /^[a-z][a-z0-9_]{0,31}$/;

export class BrandKitPaletteEntryDto {
  /** `primary`, `secondary`, `accent`, … — a slug, not free prose. */
  @IsString()
  @Matches(PALETTE_ROLES)
  role!: string;

  /** Validated as a real colour so the UI never renders a broken swatch. */
  @IsHexColor()
  hex!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class BrandKitTypographyEntryDto {
  @IsString()
  @Matches(PALETTE_ROLES)
  role!: string;

  @IsString()
  @MaxLength(120)
  family!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(100, { each: true })
  @Max(1000, { each: true })
  weights?: number[];
}

export class UpdateBrandKitDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => BrandKitPaletteEntryDto)
  palette?: BrandKitPaletteEntryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => BrandKitTypographyEntryDto)
  typography?: BrandKitTypographyEntryDto[];

  /** Usage notes. Bounded so a single row cannot become a document store. */
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  guidelines?: string;
}
