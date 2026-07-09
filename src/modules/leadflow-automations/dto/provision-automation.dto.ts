import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ProvisionAutomationDto {
  /** Recipe to provision from. Required — automations are always recipe-based. */
  @IsString()
  @MaxLength(120)
  recipeKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** When true, activates the automation right after provisioning. */
  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}
