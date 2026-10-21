import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class ClientAreaPasswordProofDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;
}

export class ClientAreaChangePasswordDto extends ClientAreaPasswordProofDto {
  @IsString()
  @Length(10, 128)
  password!: string;

  @IsString()
  @Length(10, 128)
  passwordConfirmation!: string;
}

export class ClientAreaSetupTwoFactorDto extends ClientAreaPasswordProofDto {
  @IsIn(['email', 'authenticator'])
  method!: 'email' | 'authenticator';
}

export class ClientAreaConfirmTwoFactorDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsIn(['email', 'authenticator'])
  method!: 'email' | 'authenticator';

  @IsString()
  @Length(6, 6)
  code!: string;
}
