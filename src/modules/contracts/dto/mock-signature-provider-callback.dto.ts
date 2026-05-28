import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class MockSignatureProviderCallbackDto {
  @IsOptional()
  @IsString()
  externalDocumentId?: string | null;

  @IsOptional()
  @IsEmail()
  signerEmail?: string | null;

  @IsIn(['viewed', 'signed', 'declined', 'completed'])
  status!: 'viewed' | 'signed' | 'declined' | 'completed';

  @IsOptional()
  @IsString()
  note?: string | null;
}
