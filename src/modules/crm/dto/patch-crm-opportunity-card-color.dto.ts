import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchCrmOpportunityCardColorDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardColor?: string | null;
}
