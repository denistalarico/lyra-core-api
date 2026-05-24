import {
  IsHexColor,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export class CreateContactTagDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsHexColor()
  color?: string;
}
