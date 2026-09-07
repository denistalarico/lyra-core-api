import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SelectSocialOrganicAssetsDto {
  @IsUUID()
  connectionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(180, { each: true })
  externalAssetIds!: string[];
}
