import { IsString, Length } from 'class-validator';

export class ConfirmTwoFactorDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
