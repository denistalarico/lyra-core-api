import { IsDateString, IsOptional, IsString } from 'class-validator';

export class MarkContractManuallySignedDto {
  @IsOptional()
  @IsDateString()
  signedAt?: string | null;

  @IsOptional()
  @IsString()
  signedByName?: string | null;

  @IsOptional()
  @IsString()
  note?: string | null;
}
