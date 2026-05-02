import { IsHexColor, IsOptional, IsString, Length } from 'class-validator';

export class CreateContactTagDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}
