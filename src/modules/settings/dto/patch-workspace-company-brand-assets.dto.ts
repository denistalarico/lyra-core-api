import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchWorkspaceCompanyBrandAssetsDto {
  @IsOptional()
  @IsString()
  brandLogoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  brandLogoAssetKey?: string;
}
