import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  BRAND_KIT_ASSET_KINDS,
  BRAND_KIT_ASSET_THEMES,
  BRAND_KIT_ASSET_VARIANTS,
  type BrandKitAssetKind,
  type BrandKitAssetTheme,
  type BrandKitAssetVariant,
} from '../entities';

/**
 * Multipart fields accompanying a Brand Kit upload (S1.4.9 §7/§15).
 *
 * `kind` is a closed catalog, not free text: an unvalidated kind would make
 * every consumer guess what a row means, and the database CHECK would reject
 * it anyway — better a 400 with a clear message than a 500 from the driver.
 *
 * `variant`/`theme` describe a logo's shape. The service discards them for
 * every other category, matching the database visual-shape constraint.
 */
export class CreateBrandKitAssetDto {
  @IsIn(BRAND_KIT_ASSET_KINDS as unknown as string[])
  kind!: BrandKitAssetKind;

  /** Friendly name stored in metadata; omitted values keep the filename label. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ValidateIf((dto: CreateBrandKitAssetDto) => dto.kind === 'logo')
  @IsOptional()
  @IsIn(BRAND_KIT_ASSET_VARIANTS as unknown as string[])
  variant?: BrandKitAssetVariant;

  @ValidateIf((dto: CreateBrandKitAssetDto) => dto.kind === 'logo')
  @IsOptional()
  @IsIn(BRAND_KIT_ASSET_THEMES as unknown as string[])
  theme?: BrandKitAssetTheme;
}
