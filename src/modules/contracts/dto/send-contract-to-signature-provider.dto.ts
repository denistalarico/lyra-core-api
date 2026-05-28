import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SendContractToSignatureProviderDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsBoolean()
  mockProvider?: boolean;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsString()
  message?: string | null;
}
