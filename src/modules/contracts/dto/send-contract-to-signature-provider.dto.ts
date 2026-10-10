import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SendContractToSignatureProviderDto {
  // Opt-in validation only: nothing is sent unless dryRun is absent/false.
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsString()
  message?: string | null;
}
