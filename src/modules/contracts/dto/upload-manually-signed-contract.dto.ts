import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadManuallySignedContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  fileName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsString()
  fileBase64!: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
