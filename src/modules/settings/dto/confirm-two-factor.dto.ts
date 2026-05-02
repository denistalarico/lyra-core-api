import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export type TwoFactorMethodDto = 'authenticator' | 'email';

export class ConfirmTwoFactorDto {
  @IsOptional()
  @IsIn(['authenticator', 'email'])
  method?: TwoFactorMethodDto;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class SetupTwoFactorDto {
  @IsIn(['authenticator', 'email'])
  method!: TwoFactorMethodDto;
}
